// Plugin discovery: turns ttybrain's built-in plugin folder, the plugin folders under `paths.plugins` and the npm
// dependencies installed there into plugin candidates, importing each enabled one's logic entry (`main`).
// A candidate that fails before boot carries `error`; the host decides what to do with the rest (requires sort,
// duplicate ids, activation). Disabled plugins are listed but never imported.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as api from "./api"
import type { Config } from "./config"
import type { Paths } from "./paths"
import type { PluginDef } from "./plugin"

export type PluginSource = "built-in" | "folder" | "npm"

export type PluginCandidate = {
  id: string // ttybrain.id, else the directory / package name when the manifest is unreadable
  source: PluginSource
  dir: string // absolute plugin directory (realpath for npm symlinks)
  version?: string // package.json version, when readable
  def?: PluginDef // set when imported
  tui?: string // absolute file URL of the ttybrain.tui entry, when declared
  error?: string // set when the candidate failed before boot
  disabled?: boolean // in config.plugins.disabled: not imported
}

export const DEFAULT_TIMEOUT_MS = 5000

const LEGACY_MANIFEST = 'built for pm; rebuild it with "ttybrain plugin build"'

export function builtinPluginDir(): string {
  return fileURLToPath(new URL("../plugins/", import.meta.url))
}

// Shared modules an external plugin's built shims read (`ttybrain plugin build`).
export function installApiModule(): void {
  const g = globalThis as { __TTYBRAIN_MODULES__?: Record<string, unknown> }
  ;(g.__TTYBRAIN_MODULES__ ??= {})["@ttybrain/api"] = api // in place: the TUI adds its modules to the same object
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

type Manifest = { kind: "none" } | { kind: "invalid"; reason: string } | { kind: "ok"; pkg: Obj }

function readManifest(dir: string): Manifest {
  let text: string
  try {
    text = readFileSync(join(dir, "package.json"), "utf8")
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "none" }
    return { kind: "invalid", reason: `invalid package.json: ${(e as Error).message}` }
  }
  let pkg: unknown
  try {
    pkg = JSON.parse(text)
  } catch (e) {
    return { kind: "invalid", reason: `invalid package.json: ${(e as Error).message}` }
  }
  if (!isObj(pkg)) return { kind: "invalid", reason: "invalid package.json: not a JSON object" }
  return { kind: "ok", pkg }
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Subdirectories of `root` by name, skipping dot-names and node_modules.
function subdirs(root: string): string[] {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  return names
    .filter((n) => !n.startsWith(".") && n !== "node_modules" && isDir(join(root, n)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

// Races `p` against `ms` (R2); the timer is cleared either way.
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

type Ctx = { config: Config; builtinIds: Set<string>; timeoutMs: number }

async function candidate(dir: string, fallbackId: string, source: PluginSource, ctx: Ctx): Promise<PluginCandidate | undefined> {
  const m = readManifest(dir)
  if (m.kind === "none") return undefined
  if (m.kind === "invalid") return { id: fallbackId, source, dir, error: m.reason }
  const { pkg } = m
  const version = typeof pkg.version === "string" ? pkg.version : undefined
  const manifest = pkg.ttybrain
  if (manifest === undefined) {
    // A plugin built before the rename (the old manifest key): reported, never imported.
    const legacy = pkg.pm
    if (!isObj(legacy) || legacy.plugin !== true) return undefined
    const id = typeof legacy.id === "string" && legacy.id !== "" ? legacy.id : fallbackId
    return { id, source, dir, ...(version !== undefined && { version }), error: LEGACY_MANIFEST }
  }
  if (!isObj(manifest) || manifest.plugin !== true) return undefined
  const tui = typeof manifest.tui === "string" ? pathToFileURL(resolve(dir, manifest.tui)).href : undefined
  const base = { source, dir, ...(version !== undefined && { version }), ...(tui !== undefined && { tui }) }
  if (typeof manifest.id !== "string" || manifest.id === "") return { id: fallbackId, ...base, error: "package.json has no ttybrain.id" }
  const id = manifest.id
  if (source !== "built-in" && ctx.builtinIds.has(id)) return { id, ...base, error: `plugin id "${id}" is taken by a built-in plugin` }
  if (ctx.config.plugins.disabled.includes(id)) return { id, ...base, disabled: true }
  if (typeof pkg.main !== "string" || pkg.main === "") return { id, ...base, error: "package.json has no main" }

  let mod: Obj
  try {
    const loading = import(pathToFileURL(resolve(dir, pkg.main)).href) as Promise<Obj>
    mod = source === "built-in" ? await loading : await withTimeout(loading, ctx.timeoutMs, `${id}: timed out after ${ctx.timeoutMs} ms while importing`)
  } catch (e) {
    return { id, ...base, error: e instanceof Error ? e.message : String(e) }
  }
  const def = mod.default
  if (def === undefined) return { id, ...base, error: "main has no default export" }
  if (!isObj(def) || typeof def.id !== "string" || typeof def.version !== "string") {
    return { id, ...base, error: "main's default export is not a plugin definition" }
  }
  if (def.id !== id) return { id, ...base, error: `ttybrain.id "${id}" does not match the plugin id "${def.id}"` }
  if (version !== def.version) {
    return { id, ...base, error: `package.json version ${version ?? "(missing)"} does not match the plugin version ${def.version}` }
  }
  return { id, ...base, def: def as unknown as PluginDef }
}

function npmDependencies(pluginsDir: string): string[] {
  const m = readManifest(pluginsDir)
  if (m.kind !== "ok" || !isObj(m.pkg.dependencies)) return []
  return Object.keys(m.pkg.dependencies).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export async function discoverPlugins(
  paths: Paths,
  config: Config,
  opts: { builtinDir?: string; timeoutMs?: number } = {},
): Promise<PluginCandidate[]> {
  installApiModule()
  const ctx: Ctx = { config, builtinIds: new Set(), timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS }
  const out: PluginCandidate[] = []

  const builtinDir = opts.builtinDir ?? builtinPluginDir()
  for (const name of subdirs(builtinDir)) {
    const c = await candidate(join(builtinDir, name), name, "built-in", ctx)
    if (c === undefined) continue
    out.push(c)
    ctx.builtinIds.add(c.id)
  }

  for (const name of subdirs(paths.plugins)) {
    const c = await candidate(join(paths.plugins, name), name, "folder", ctx)
    if (c !== undefined) out.push(c)
  }

  for (const name of npmDependencies(paths.plugins)) {
    const linked = join(paths.plugins, "node_modules", name)
    let dir = linked
    let installed = true
    try {
      dir = realpathSync(linked)
      installed = readManifest(dir).kind !== "none"
    } catch {
      installed = false
    }
    if (!installed) {
      // No manifest to read ttybrain.id from: the id is the package name, and a disabled one is just disabled.
      const disabled = config.plugins.disabled.includes(name)
      out.push({ id: name, source: "npm", dir, ...(disabled ? { disabled: true } : { error: `not installed; run npm install in ${paths.plugins}` }) })
      continue
    }
    const c = await candidate(dir, name, "npm", ctx)
    if (c !== undefined) out.push(c)
  }
  return out
}
