// `pm plugin add` / `pm plugin remove`: installing external plugins into `paths.plugins` with npm or bun, the
// one-time trust warning, and removing them (with or without their data). Tarballs are packed in the test from
// a tiny built plugin with no dependencies, so everything works offline.
import { afterEach, expect, test } from "bun:test"
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { runCli } from "../cli/dispatch"
import { resolvePaths } from "../paths"
import { buildPlugin } from "./build"
import { addPlugin } from "./install"

const hasNpm = spawnSync("npm", ["--version"], { stdio: "ignore" }).status === 0
const WARNING = "warning: plugins run inside pm with full access to your files and data, like any npm package. Only add plugins you trust."

const temps: string[] = []
const kernels: TestKernel[] = []
afterEach(async () => {
  for (const k of kernels.splice(0)) await k.cleanup()
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmp(prefix = "pm-plugin-install-"): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(d)
  return d
}

function write(dir: string, path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}

// A built plugin folder `<parent>/<id>`: a table with an index, a published view and a record type `<id>-thing`.
// `plugin: false` writes a package without pm.plugin.
async function builtPlugin(id: string, o: { parent?: string; plugin?: boolean } = {}): Promise<string> {
  const dir = join(o.parent ?? tmp(), id)
  const pm = o.plugin === false ? {} : { pm: { plugin: true, id } }
  write(dir, "package.json", JSON.stringify({ name: `pm-plugin-${id}`, version: "1.0.0", type: "module", main: "dist/logic/index.js", ...pm }))
  write(
    dir,
    "src/logic/index.ts",
    `import { definePlugin } from "@pm/api"\n` +
      `export default definePlugin({ id: ${JSON.stringify(id)}, name: "T", version: "1.0.0", apiVersion: 1, activate(ctx) {\n` +
      `  ctx.migration("001", async (db) => {\n` +
      `    await db.schema.createTable("thing").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("name", "text").execute()\n` +
      `    await db.schema.createIndex("thing_name").on("thing").column("name").execute()\n` +
      `    await db.schema.createTable("part").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("thing_id", "integer", (c) => c.notNull().references("thing.id")).execute()\n` +
      `    await db.insertInto("thing").values({ id: 1, name: "a" }).execute()\n` +
      `    await db.insertInto("part").values({ id: 1, thing_id: 1 }).execute()\n` +
      `  })\n` +
      `  ctx.publish("thing", { version: 1, columns: { id: "integer", name: "text" }, query: (db) => db.selectFrom("thing").select(["id", "name"]) })\n` +
      `  ctx.recordType({ name: ${JSON.stringify(`${id}-thing`)}, prefix: ${JSON.stringify(`${id.toUpperCase()}-`)}, resolve: async () => null, label: async () => "", search: async () => [] })\n` +
      `} })\n`,
  )
  await buildPlugin(dir)
  return dir
}

// `bun pm pack` of a plugin folder into a fresh directory; returns the tarball's path.
function pack(dir: string): string {
  const dest = tmp("pm-plugin-tgz-")
  const tgz = join(dest, "plugin.tgz")
  const r = spawnSync(process.execPath, ["pm", "pack", "--filename", tgz, "--quiet"], { cwd: dir, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`bun pm pack failed: ${r.stderr}`)
  return tgz
}

function io() {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s), stdin: async () => "" } }
}

// A kernel with no built-ins and `plugins` as its plugins folder.
async function boot(plugins: string, o: { builtins?: boolean } = {}): Promise<TestKernel> {
  const k = await makeTestKernel({ env: { PM_PLUGINS: plugins }, discover: o.builtins ? true : { builtinDir: tmp() } })
  kernels.push(k)
  return k
}

const listed = (k: TestKernel) => k.plugins.map((p) => ({ id: p.id, source: p.source, status: p.status, error: p.error ?? null }))

const deps = (plugins: string): Record<string, string> =>
  (JSON.parse(readFileSync(join(plugins, "package.json"), "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {}

const allow = (k: TestKernel): string[] =>
  existsSync(k.paths.config) ? ((JSON.parse(readFileSync(k.paths.config, "utf8")) as { plugins?: { allow?: string[] } }).plugins?.allow ?? []) : []

// Runs `fn` with PM_PLUGIN_INSTALLER set (the CLI commands read process.env, as pm's entry point passes it).
async function withInstaller<T>(installer: string, fn: () => Promise<T>): Promise<T> {
  const before = process.env.PM_PLUGIN_INSTALLER
  process.env.PM_PLUGIN_INSTALLER = installer
  try {
    return await fn()
  } finally {
    if (before === undefined) delete process.env.PM_PLUGIN_INSTALLER
    else process.env.PM_PLUGIN_INSTALLER = before
  }
}

const installers = ["npm", "bun"] as const

for (const installer of installers) {
  test.skipIf(installer === "npm" && !hasNpm)(`add <tgz> with ${installer} installs into the plugins prefix`, async () => {
    const tgz = pack(await builtPlugin("demo"))
    const plugins = join(tmp(), "plugins")
    const paths = resolvePaths({ PM_HOME: tmp(), PM_PLUGINS: plugins })
    const added = await addPlugin(paths, tgz, { PM_PLUGIN_INSTALLER: installer })
    expect(added).toEqual({ name: "pm-plugin-demo", id: "demo", version: "1.0.0", warned: true })
    const pkg = JSON.parse(readFileSync(join(plugins, "package.json"), "utf8")) as { private: boolean; type: string }
    expect(pkg.private).toBe(true)
    expect(pkg.type).toBe("module")
    expect(Object.keys(deps(plugins))).toEqual(["pm-plugin-demo"])
    const k = await boot(plugins)
    expect(listed(k)).toEqual([{ id: "demo", source: "npm", status: "ok", error: null }])
  }, 60_000)
}

test.skipIf(!hasNpm)("add <folder> installs it as a file: dependency", async () => {
  const dir = await builtPlugin("demo")
  const plugins = join(tmp(), "plugins")
  const paths = resolvePaths({ PM_HOME: tmp(), PM_PLUGINS: plugins })
  await addPlugin(paths, dir, { PM_PLUGIN_INSTALLER: "npm" })
  expect(deps(plugins)["pm-plugin-demo"]).toStartWith("file:")
  expect(lstatSync(join(plugins, "node_modules", "pm-plugin-demo")).isSymbolicLink()).toBe(true)
  const k = await boot(plugins)
  expect(listed(k)).toEqual([{ id: "demo", source: "npm", status: "ok", error: null }])
  expect(k.plugins[0]!.dir).toBe(dir)
}, 60_000)

test("the trust warning is printed once per package name", async () => {
  const tgz = pack(await builtPlugin("demo"))
  const plugins = join(tmp(), "plugins")
  const k = await boot(plugins)
  const a = io()
  expect(await runCli(["plugin", "add", tgz], k, a.io)).toBe(0)
  expect(a.out.join("")).toBe(`${WARNING}\nadded demo 1.0.0 (npm)\n`)
  expect(allow(k)).toEqual(["pm-plugin-demo"])

  // The running kernel did not load it (it was added after boot): the next one does.
  const next = await boot(plugins)
  const r = io()
  expect(await runCli(["plugin", "remove", "demo", "--yes"], next, r.io)).toBe(0)
  expect(r.out.join("")).toBe("removed demo\n")
  expect(deps(plugins)).toEqual({})

  const b = io()
  expect(await runCli(["plugin", "add", tgz, "--json"], k, b.io)).toBe(0)
  expect(JSON.parse(b.out.join(""))).toEqual({ name: "pm-plugin-demo", id: "demo", version: "1.0.0", source: "npm", warned: false })
  expect(allow(k)).toEqual(["pm-plugin-demo"])
}, 60_000)

test("add of a package that is not a pm plugin is undone", async () => {
  const tgz = pack(await builtPlugin("plain", { plugin: false }))
  const plugins = join(tmp(), "plugins")
  const k = await boot(plugins)
  const a = io()
  expect(await runCli(["plugin", "add", tgz], k, a.io)).toBe(1)
  expect(a.err.join("")).toContain('"pm-plugin-plain" is not a pm plugin (package.json has no pm.plugin)')
  expect(a.out).toEqual([])
  expect(deps(plugins)).toEqual({})
  expect(existsSync(join(plugins, "node_modules", "pm-plugin-plain"))).toBe(false)
  expect(allow(k)).toEqual([])
}, 60_000)

test("add with no installer", async () => {
  const paths = resolvePaths({ PM_HOME: tmp(), PM_PLUGINS: join(tmp(), "plugins") })
  const failing = addPlugin(paths, "pm-plugin-demo", {}, { which: () => false, underBun: false })
  await expect(failing).rejects.toThrow("pm plugin add needs npm on the PATH")
  const forced = addPlugin(paths, "pm-plugin-demo", { PM_PLUGIN_INSTALLER: "yarn" })
  await expect(forced).rejects.toThrow("PM_PLUGIN_INSTALLER must be npm or bun")
})

test("add of a local path that does not exist fails before the installer runs", async () => {
  const plugins = join(tmp(), "plugins")
  const k = await boot(plugins)
  const missing = join(tmp(), "missing.tgz")
  const a = io()
  expect(await runCli(["plugin", "add", missing], k, a.io)).toBe(2)
  expect(a.err.join("")).toContain(`no file or folder "${missing}"`)
  expect(existsSync(plugins)).toBe(false)
})

test("remove needs --yes and refuses built-ins", async () => {
  const k = await boot(join(tmp(), "plugins"), { builtins: true })
  const a = io()
  expect(await runCli(["plugin", "remove", "projects"], k, a.io)).toBe(1)
  expect(a.err.join("")).toContain('"plugin remove" is destructive; add --yes')
  const b = io()
  expect(await runCli(["plugin", "remove", "projects", "--yes"], k, b.io)).toBe(1)
  expect(b.err.join("")).toContain('"projects" is built in; use "pm plugin disable projects"')
  const c = io()
  expect(await runCli(["plugin", "remove", "projects", "--yes", "--purge-data"], k, c.io)).toBe(1)
  expect(c.err.join("")).toContain('"projects" is built in; use "pm plugin disable projects"')
  expect(k.db.raw.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'projects\\_%' ESCAPE '\\'").all([])[0]!.n).not.toBe(0)
  const d = io()
  expect(await runCli(["plugin", "remove", "projcts", "--yes"], k, d.io)).toBe(2)
  expect(d.err.join("")).toContain('no plugin "projcts"')
  expect(d.err.join("")).toContain("projects")
  const e = io()
  expect(await runCli(["plugin", "remove", "zzz", "--yes"], k, e.io)).toBe(2)
  expect(e.err.join("")).toContain('no plugin "zzz"')
  expect(e.err.join("")).toContain('run "pm plugin list"')
}, 60_000)

const objects = (k: TestKernel, id: string) =>
  k.db.raw
    .prepare("SELECT type, name FROM sqlite_schema WHERE lower(name) LIKE ? ESCAPE '\\' ORDER BY type, name")
    .all([`${id}\\_%`])
    .map((r) => `${r.type} ${r.name}`)

const migrationRows = (k: TestKernel, id: string) => k.db.raw.prepare("SELECT id FROM kernel_plugin_migration WHERE plugin = ?").all([id]).map((r) => r.id)

test("remove of a folder plugin deletes the folder, keeps tables", async () => {
  const plugins = tmp()
  const dir = await builtPlugin("demo", { parent: plugins })
  const k = await boot(plugins)
  expect(listed(k)).toEqual([{ id: "demo", source: "folder", status: "ok", error: null }])
  const before = objects(k, "demo")
  expect(before).toEqual(["index demo_thing_name", "table demo_part", "table demo_thing", "view demo__pub_thing"])
  const a = io()
  expect(await runCli(["plugin", "remove", "demo", "--yes"], k, a.io)).toBe(0)
  expect(a.out.join("")).toBe("removed demo\n")
  expect(existsSync(dir)).toBe(false)
  expect(objects(k, "demo")).toEqual(before)
  expect(migrationRows(k, "demo")).toEqual(["001"])
})

test("remove refuses a folder that resolves outside the plugins folder", async () => {
  const plugins = tmp()
  const elsewhere = await builtPlugin("demo")
  symlinkSync(elsewhere, join(plugins, "demo"))
  const k = await boot(plugins)
  expect(listed(k)).toEqual([{ id: "demo", source: "folder", status: "ok", error: null }])
  const a = io()
  expect(await runCli(["plugin", "remove", "demo", "--yes"], k, a.io)).toBe(1)
  expect(a.err.join("")).toContain(`"demo" is at ${elsewhere}, outside ${plugins}; remove it by hand`)
  expect(existsSync(join(elsewhere, "package.json"))).toBe(true)
})

test("remove refuses an id that more than one plugin uses", async () => {
  const plugins = tmp()
  // plugins/a is a working plugin with pm.id "keep"; plugins/keep has a broken manifest, so its id falls back to "keep".
  const working = join(plugins, "a")
  cpSync(await builtPlugin("keep"), working, { recursive: true })
  const broken = join(plugins, "keep")
  write(broken, "package.json", "{ not json")
  const k = await boot(plugins)
  expect(listed(k).map((p) => [p.id, p.status])).toEqual([
    ["keep", "ok"],
    ["keep", "failed"],
  ])
  const before = objects(k, "keep")
  const r = io()
  expect(await runCli(["plugin", "remove", "keep", "--yes", "--purge-data"], k, r.io)).toBe(1)
  expect(r.err.join("")).toContain(`plugin id "keep" is used by more than one plugin (${working}, ${broken}); remove the folder or package by hand`)
  expect(existsSync(join(working, "package.json"))).toBe(true)
  expect(existsSync(join(broken, "package.json"))).toBe(true)
  expect(objects(k, "keep")).toEqual(before)
  expect(migrationRows(k, "keep")).toEqual(["001"])
})

test("remove --purge-data drops its tables and kernel rows", async () => {
  const plugins = tmp()
  const dir = await builtPlugin("demo", { parent: plugins })
  await builtPlugin("keep", { parent: plugins })
  const k = await boot(plugins)
  expect(listed(k).map((p) => p.status)).toEqual(["ok", "ok"])
  const origin = k.db.raw.prepare(
    "INSERT INTO kernel_record_origin (record_type, record_id, origin_type, origin_ref, created_at) VALUES (?, 1, 'inbox', 'I-1', '2026-11-13T00:00:00Z')",
  )
  origin.run(["demo-thing"])
  origin.run(["keep-thing"])
  const keepBefore = objects(k, "keep")
  const a = io()
  expect(await runCli(["plugin", "remove", "demo", "--purge-data", "--yes"], k, a.io)).toBe(0)
  expect(a.out.join("")).toBe("removed demo and its data\n")
  expect(existsSync(dir)).toBe(false)
  expect(objects(k, "demo")).toEqual([])
  expect(migrationRows(k, "demo")).toEqual([])
  expect(k.db.raw.prepare("SELECT record_type FROM kernel_record_origin").all([]).map((r) => r.record_type)).toEqual(["keep-thing"])
  expect(objects(k, "keep")).toEqual(keepBefore)
  expect(migrationRows(k, "keep")).toEqual(["001"])
  // The next boot no longer lists it and still runs the other plugin.
  const next = await makeTestKernel({ env: { PM_PLUGINS: plugins, PM_HOME: k.home }, discover: { builtinDir: tmp() } })
  kernels.push(next)
  expect(listed(next)).toEqual([{ id: "keep", source: "folder", status: "ok", error: null }])
})

for (const installer of installers) {
  test.skipIf(installer === "npm" && !hasNpm)(`remove works under a plugins path with spaces (${installer})`, async () => {
    const tgz = pack(await builtPlugin("demo"))
    const plugins = join(tmp(), "my plugins", "dir with spaces")
    await withInstaller(installer, async () => {
      const k = await boot(plugins)
      expect(await runCli(["plugin", "add", tgz], k, io().io)).toBe(0)
      const next = await boot(plugins)
      expect(listed(next)).toEqual([{ id: "demo", source: "npm", status: "ok", error: null }])
      const a = io()
      expect(await runCli(["plugin", "remove", "demo", "--yes", "--purge-data"], next, a.io)).toBe(0)
      expect(a.out.join("")).toBe("removed demo and its data\n")
      expect(objects(next, "demo")).toEqual([])
    })
    expect(deps(plugins)).toEqual({})
    expect(existsSync(join(plugins, "node_modules", "pm-plugin-demo"))).toBe(false)
  }, 60_000)
}
