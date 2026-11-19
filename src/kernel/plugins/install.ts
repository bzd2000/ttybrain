// `pm plugin add` / `pm plugin remove`: external plugins installed as npm dependencies of `paths.plugins`
// (a private package.json there), with npm or, without npm, `bun add --cwd` (R6). Folder plugins are removed
// by deleting their folder; built-ins cannot be removed, only disabled.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { loadConfig, updateConfigFile } from "../config"
import { NotFoundError, suggest, ValidationError } from "../errors"
import type { Kernel, PluginStatus } from "../host"
import { purgePluginData } from "../migrations"
import type { Paths } from "../paths"

export type Env = Record<string, string | undefined>

// `which(cmd)`: whether `cmd` runs (default: `<cmd> --version` exits 0). `underBun`: whether pm runs on Bun
// (default: process.versions.bun). Both are injectable for tests.
export type InstallerOptions = { which?: (cmd: string) => boolean; underBun?: boolean }

export const TRUST_WARNING =
  "warning: plugins run inside pm with full access to your files and data, like any npm package. Only add plugins you trust."

type Installer = { kind: "npm" | "bun"; cmd: string }

const runs = (cmd: string) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0

// R6: PM_PLUGIN_INSTALLER forces one; else npm when it runs; else bun when pm runs on Bun. `command` names the
// `pm plugin` command that needs it, in the error.
export function chooseInstaller(env: Env, opts: InstallerOptions = {}, command: "add" | "remove" = "add"): Installer {
  const underBun = opts.underBun ?? process.versions.bun !== undefined
  const bun: Installer = { kind: "bun", cmd: underBun ? process.execPath : "bun" }
  const forced = env.PM_PLUGIN_INSTALLER
  if (forced === "npm") return { kind: "npm", cmd: "npm" }
  if (forced === "bun") return bun
  if (forced !== undefined && forced !== "") throw new ValidationError(`PM_PLUGIN_INSTALLER must be npm or bun, not "${forced}"`)
  if ((opts.which ?? runs)("npm")) return { kind: "npm", cmd: "npm" }
  if (underBun) return bun
  throw new ValidationError(`pm plugin ${command} needs npm on the PATH`, { hint: "install Node.js (it comes with npm), or run pm with Bun" })
}

// Runs the installer in `dir` without a shell. Its output is kept back and written to stderr only on failure.
function runInstaller(installer: Installer, args: string[], dir: string, what: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(installer.cmd, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (b: Buffer) => (output += b.toString()))
    child.stderr.on("data", (b: Buffer) => (output += b.toString()))
    child.on("error", (e) => fail(new ValidationError(`could not run ${installer.kind}: ${e.message}`)))
    child.on("close", (code) => {
      if (code === 0) return done()
      if (output !== "") process.stderr.write(output.endsWith("\n") ? output : output + "\n")
      // npm ends with "A complete log of this run can be found in: …", which says nothing about the failure.
      const lines = output.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !/complete log of this run/i.test(l))
      const last = lines.pop() || `exit code ${code}`
      fail(new ValidationError(`${installer.kind} ${what} failed: ${last}`, { hint: `see the ${installer.kind} output above` }))
    })
  })
}

const installArgs = (i: Installer, dir: string, spec: string) =>
  i.kind === "npm" ? ["install", "--no-audit", "--no-fund", spec] : ["add", "--cwd", dir, spec]
const uninstallArgs = (i: Installer, dir: string, name: string) => (i.kind === "npm" ? ["uninstall", name] : ["remove", "--cwd", dir, name])

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

function readJson(file: string): Obj {
  let v: unknown
  try {
    v = JSON.parse(readFileSync(file, "utf8"))
  } catch (e) {
    throw new ValidationError(`invalid ${file}: ${(e as Error).message}`)
  }
  if (!isObj(v)) throw new ValidationError(`invalid ${file}: not a JSON object`)
  return v
}

// The plugins prefix: `paths.plugins/package.json`, created when missing.
function ensurePrefix(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, "package.json")
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ private: true, type: "module", dependencies: {} }, null, 2) + "\n")
}

function dependencies(dir: string): Record<string, string> {
  const deps = readJson(join(dir, "package.json")).dependencies
  if (!isObj(deps)) return {}
  return Object.fromEntries(Object.entries(deps).filter((e): e is [string, string] => typeof e[1] === "string"))
}

const TARBALL = /\.(tgz|tar\.gz|tar)$/i

// A local folder or tarball (as opposed to an npm name or another installer spec): resolved against the
// current directory, since the installer runs in the plugins folder.
function localPath(spec: string): string | undefined {
  if (/^(\.|\/)/.test(spec) || TARBALL.test(spec) || existsSync(resolve(spec))) return resolve(spec)
  return undefined
}

// The npm name in `name@range` / `@scope/name@range`.
const npmName = (spec: string) => {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0)
  return at > 0 ? spec.slice(0, at) : spec
}

// The dependency `spec` added: the one entry that is new or changed; else (re-adding the same thing) the entry
// whose value points at the same local path, or whose name the npm spec names.
function addedName(dir: string, before: Record<string, string>, after: Record<string, string>, spec: string, path: string | undefined): string | undefined {
  const changed = Object.keys(after).filter((k) => before[k] !== after[k])
  if (changed.length === 1) return changed[0]
  const pointsAt = (v: string) => path !== undefined && resolve(dir, v.replace(/^file:/, "")) === path
  const candidates = changed.length > 1 ? changed : Object.keys(after)
  const byPath = candidates.find((k) => pointsAt(after[k]!))
  if (byPath !== undefined) return byPath
  if (path === undefined && npmName(spec) in after) return npmName(spec)
  return changed[0]
}

// The install spec that brings back dependency `name` as recorded (`value` from package.json): a file:
// dependency (relative to the plugins folder, where the installer runs) as is, a range as `name@range`.
const reinstallSpec = (name: string, value: string) => (/^(file:|\.|\/)/.test(value) ? value : `${name}@${value}`)

export async function addPlugin(
  paths: Paths,
  spec: string,
  env: Env,
  opts: InstallerOptions = {},
): Promise<{ name: string; id: string; version: string; warned: boolean }> {
  const installer = chooseInstaller(env, opts)
  const dir = paths.plugins
  const path = localPath(spec)
  if (path !== undefined && !existsSync(path)) throw new NotFoundError(`no file or folder "${path}"`, { hint: "pass an npm package name, a plugin folder or a .tgz" })
  ensurePrefix(dir)
  // bun records a bare path as a plain dependency value; `file:` makes it the same file: dependency npm writes.
  const target = path === undefined ? spec : installer.kind === "bun" ? `file:${path}` : path
  const before = dependencies(dir)
  await runInstaller(installer, installArgs(installer, dir, target), dir, "install")
  const after = dependencies(dir)
  const name = addedName(dir, before, after, spec, path)
  if (name === undefined) throw new ValidationError(`could not tell which package "${spec}" installed`, { hint: `check ${join(dir, "package.json")}` })

  const undo = async (message: string): Promise<never> => {
    // A package this add brought in is taken out again; one that was there before is put back as it was.
    const previous = before[name]
    const args = previous === undefined ? uninstallArgs(installer, dir, name) : installArgs(installer, dir, reinstallSpec(name, previous))
    await runInstaller(installer, args, dir, previous === undefined ? "uninstall" : "install").catch(() => {})
    throw new ValidationError(message, { hint: "only packages with pm.plugin in their package.json can be added" })
  }
  let pkg: Obj
  try {
    pkg = readJson(join(realpathSync(join(dir, "node_modules", name)), "package.json"))
  } catch (e) {
    return undo(`"${name}" could not be read after installing: ${(e as Error).message}`)
  }
  const pm = pkg.pm
  if (!isObj(pm) || pm.plugin !== true) return undo(`"${name}" is not a pm plugin (package.json has no pm.plugin)`)
  if (typeof pm.id !== "string" || pm.id === "") return undo(`"${name}" is not a pm plugin (package.json has no pm.id)`)

  const allow = loadConfig(paths, env).plugins.allow
  const warned = !(Array.isArray(allow) && allow.includes(name))
  if (warned) {
    updateConfigFile(paths, (cfg) => {
      if (!isObj(cfg.plugins)) cfg.plugins = {}
      const plugins = cfg.plugins as Obj
      const list = Array.isArray(plugins.allow) ? plugins.allow.filter((a): a is string => typeof a === "string") : []
      plugins.allow = list.includes(name) ? list : [...list, name]
    })
  }
  return { name, id: pm.id, version: typeof pkg.version === "string" ? pkg.version : "", warned }
}

// The dependency name an npm plugin was installed under (its pm.id may differ).
function packageNameOf(paths: Paths, p: PluginStatus): string | undefined {
  const deps = Object.keys(dependencies(paths.plugins))
  return deps.find((name) => {
    const linked = join(paths.plugins, "node_modules", name)
    if (p.dir === linked) return true // not installed: the loader keeps the unresolved path
    try {
      return realpathSync(linked) === p.dir
    } catch {
      return false
    }
  }) ?? (deps.includes(p.id) ? p.id : undefined)
}

// What removing a folder plugin deletes. A symlinked entry is only unlinked, wherever it points: its target
// is never followed into a delete. A real directory must be inside the plugins folder.
function folderRemoval(paths: Paths, p: PluginStatus): () => void {
  const entry = p.dir!
  if (lstatSync(entry, { throwIfNoEntry: false })?.isSymbolicLink()) return () => unlinkSync(entry)
  const root = realpathSync(paths.plugins)
  const real = realpathSync(entry)
  const rel = relative(root, real)
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ValidationError(`"${p.id}" is at ${real}, outside ${root}; remove it by hand`)
  }
  return () => rmSync(real, { recursive: true, force: true })
}

export async function removePlugin(
  kernel: Kernel,
  id: string,
  opts: { purgeData: boolean; env?: Env } & InstallerOptions,
): Promise<void> {
  const matches = kernel.plugins.filter((x) => x.id === id)
  // Two entries can share an id (a broken manifest falls back to its directory name): never guess which one.
  if (matches.length > 1) {
    const dirs = matches.map((x) => x.dir ?? x.source).join(", ")
    throw new ValidationError(`plugin id "${id}" is used by more than one plugin (${dirs}); remove the folder or package by hand`)
  }
  const p = matches[0]
  if (!p) throw new NotFoundError(`no plugin "${id}"`, { suggestions: suggest(id, kernel.plugins.map((x) => x.id)), hint: 'run "pm plugin list"' })
  if (p.source === "built-in") throw new ValidationError(`"${id}" is built in; use "pm plugin disable ${id}"`)
  const paths = kernel.paths
  // Everything that can refuse is checked before the data goes.
  let remove: () => Promise<void>
  if (p.source === "folder") {
    const removeFolder = folderRemoval(paths, p)
    remove = async () => removeFolder()
  } else {
    const name = packageNameOf(paths, p)
    if (name === undefined) throw new NotFoundError(`"${id}" is not a dependency in ${join(paths.plugins, "package.json")}`)
    const installer = chooseInstaller(opts.env ?? process.env, opts, "remove")
    remove = () => runInstaller(installer, uninstallArgs(installer, paths.plugins, name), paths.plugins, "uninstall")
  }
  if (opts.purgeData) await purgePluginData(kernel, id)
  await remove()
}
