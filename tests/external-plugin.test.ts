// The `contracts` fixture plugin (tests/fixtures/plugin-contracts) end to end as an external plugin: built with
// `ttybrain plugin build` into a temp copy, loaded as a folder in TTYBRAIN_PLUGINS and from npm through `ttybrain plugin add <tgz>`
// (npm, and bun), in the CLI and the TUI; and the failure cases, each with pm still starting (design §3.11, the
// permanent version of the spec's 2026-11-13 spike). `bash scripts/smoke-node.sh` repeats the build-and-load on Node.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { definePlugin } from "../src/kernel/api"
import { runCli } from "../src/kernel/cli/dispatch"
import { TRUST_WARNING } from "../src/kernel/plugins/install"
import { installTuiModules, loadTuiParts } from "../src/kernel/tui/load"
import { makeTestKernel, type TestKernel } from "./helpers"
import { renderTui, type RenderedTui } from "./tui"

const FIXTURE = fileURLToPath(new URL("./fixtures/plugin-contracts", import.meta.url))
const hasNpm = spawnSync("npm", ["--version"], { stdio: "ignore" }).status === 0

const temps: string[] = []
const kernels: TestKernel[] = []
let tui: RenderedTui | undefined
let builder: TestKernel // a kernel with no plugins, to run `ttybrain plugin build`
let built: string // the fixture, copied and built once

function tmp(prefix = "pm-external-"): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temps.push(d)
  return d
}

function io() {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s), stdin: async () => "" } }
}

async function cli(k: TestKernel, args: string[]): Promise<{ code: number; out: string; err: string }> {
  const o = io()
  const code = await runCli(args, k, o.io)
  return { code, out: o.out.join(""), err: o.err.join("") }
}

// Copies the fixture's source to <parent>/<name>, applies `patch` to it, and builds it with `ttybrain plugin build`.
async function buildCopy(parent: string, patch?: (dir: string) => void, name = "contracts"): Promise<string> {
  const dir = join(parent, name)
  cpSync(FIXTURE, dir, { recursive: true, filter: (src) => !/[/\\](dist|node_modules)$/.test(src) })
  patch?.(dir)
  const r = await cli(builder, ["plugin", "build", dir])
  if (r.code !== 0) throw new Error(`ttybrain plugin build failed: ${r.err}`)
  return dir
}

const edit = (dir: string, file: string, from: string, to: string) => {
  const path = join(dir, file)
  const text = readFileSync(path, "utf8")
  if (!text.includes(from)) throw new Error(`${file} has no "${from}"`)
  writeFileSync(path, text.replace(from, to))
}

// The already built fixture, copied into a fresh plugins folder.
function pluginsWithBuilt(): string {
  const plugins = tmp()
  cpSync(built, join(plugins, "contracts"), { recursive: true })
  return plugins
}

// `bun pm pack` of a built plugin folder; returns the tarball's path.
function pack(dir: string): string {
  const tgz = join(tmp("pm-external-tgz-"), "contracts.tgz")
  const r = spawnSync(process.execPath, ["pm", "pack", "--filename", tgz, "--quiet"], { cwd: dir, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`bun pm pack failed: ${r.stderr}`)
  return tgz
}

// pm with its built-ins (discovered from src/plugins) and `plugins` as its plugins folder.
async function boot(plugins: string, extra: Parameters<typeof makeTestKernel>[0] = {}): Promise<TestKernel> {
  const k = await makeTestKernel({ ...extra, env: { TTYBRAIN_PLUGINS: plugins, ...extra.env }, discover: true })
  kernels.push(k)
  return k
}

type Row = { id: string; version: string; source: string; status: string; error: string | null }
async function listed(k: TestKernel): Promise<Row[]> {
  const r = await cli(k, ["plugin", "list", "--json"])
  expect(r.code).toBe(0)
  return (JSON.parse(r.out) as Row[]).filter((p) => !["people", "projects", "actions", "meetings", "inbox"].includes(p.id)).sort((a, b) => (a.id < b.id ? -1 : 1))
}

// Runs `fn` with TTYBRAIN_PLUGIN_INSTALLER set (`ttybrain plugin add` reads process.env, as pm's entry point passes it).
async function withInstaller<T>(installer: string, fn: () => Promise<T>): Promise<T> {
  const before = process.env.TTYBRAIN_PLUGIN_INSTALLER
  process.env.TTYBRAIN_PLUGIN_INSTALLER = installer
  try {
    return await fn()
  } finally {
    if (before === undefined) delete process.env.TTYBRAIN_PLUGIN_INSTALLER
    else process.env.TTYBRAIN_PLUGIN_INSTALLER = before
  }
}

async function addTgz(plugins: string, tgz: string, installer: string): Promise<void> {
  const k = await boot(plugins)
  const r = await withInstaller(installer, () => cli(k, ["plugin", "add", tgz]))
  expect(r).toEqual({ code: 0, out: `${TRUST_WARNING}\nadded contracts 0.1.0 (npm)\n`, err: "" })
}

// A plugin that reads the fixture's published view `contracts.contracts`, as another plugin would.
const probe = definePlugin({
  id: "probe",
  name: "Probe",
  version: "1.0.0",
  apiVersion: 1,
  reads: { contracts: "^0.1" },
  activate(ctx) {
    ctx.command({
      thing: "probe",
      verb: "contracts",
      summary: "the rows of contracts.contracts",
      run: async () => {
        const rows = await ctx.data.selectFrom("contracts.contracts").select(["id", "project_id", "title"]).orderBy("id").execute()
        return { json: rows, text: "" }
      },
    })
  },
})

const CONTRACT_LIST = "ref  project  title\nC-1  #CRM     Support\n"

// The CLI walk the folder and npm cases share: a project, a contract through the plugin's command, its list, the
// published view and the plugin's own table (its migration ran).
async function walk(k: TestKernel, source: "folder" | "npm"): Promise<void> {
  expect((await cli(k, ["project", "add", "CRM", "CRM"])).code).toBe(0)
  expect(await cli(k, ["contract", "add", "CRM", "Support"])).toEqual({ code: 0, out: "C-1 Support\n", err: "" })
  expect(await cli(k, ["contract", "list"])).toEqual({ code: 0, out: CONTRACT_LIST, err: "" })
  expect(JSON.parse((await cli(k, ["contract", "list", "--json"])).out)).toEqual([{ ref: "C-1", project: "#CRM", title: "Support" }])
  const view = await cli(k, ["probe", "contracts", "--json"])
  expect(view.code).toBe(0)
  expect(JSON.parse(view.out)).toEqual([{ id: 1, project_id: 1, title: "Support" }])
  const migrations = k.db.raw.prepare("SELECT id FROM kernel_plugin_migration WHERE plugin = 'contracts'").all([]) as Array<{ id: string }>
  expect(migrations.map((m) => m.id)).toEqual(["1-contract"])
  expect(await listed(k)).toEqual([
    { id: "contracts", version: "0.1.0", source, status: "ok", error: null },
    { id: "probe", version: "1.0.0", source: "built-in", status: "ok", error: null },
  ])
  const text = await cli(k, ["plugin", "list"])
  expect(text.out).toMatch(new RegExp(`^contracts +0\\.1\\.0 +${source} +ok`, "m"))
}

beforeAll(async () => {
  builder = await makeTestKernel()
  built = await buildCopy(tmp())
}, 60_000)

afterEach(async () => {
  tui?.destroy()
  tui = undefined
  for (const k of kernels.splice(0)) await k.cleanup()
})

afterAll(async () => {
  await builder.cleanup()
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

test("loaded as a folder: command, migration, view", async () => {
  const k = await boot(pluginsWithBuilt(), { plugins: [probe] })
  await walk(k, "folder")
})

for (const installer of ["npm", "bun"] as const) {
  test.skipIf(installer === "npm" && !hasNpm)(`loaded from npm via ttybrain plugin add <tgz> (${installer})`, async () => {
    const plugins = join(tmp(), "plugins")
    await addTgz(plugins, pack(built), installer)
    const k = await boot(plugins, { plugins: [probe] })
    await walk(k, "npm")
  }, 60_000)
}

// Waits until the frame satisfies `cond` (the TUI loads asynchronously).
async function until(t: RenderedTui, cond: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 100 && !cond(frame); i++) {
    await new Promise((r) => setTimeout(r, 20))
    frame = await t.frame()
  }
  if (!cond(frame)) throw new Error(`frame condition not met:\n${frame}`)
  return frame
}

// The TUI as pm runs it: the tui entries of the loaded plugins, imported through their manifests.
async function renderLoaded(k: TestKernel): Promise<RenderedTui> {
  installTuiModules()
  const parts = await loadTuiParts(k)
  expect(parts.errors).toEqual([])
  expect(parts.external.map((p) => p.plugin)).toEqual(["contracts"])
  tui = await renderTui(k, { parts: parts.builtin, external: parts.external, width: 100, height: 30 })
  return tui
}

test("TUI: screen 7 and the project tab", async () => {
  const k = await boot(pluginsWithBuilt())
  expect((await cli(k, ["project", "add", "CRM", "CRM"])).code).toBe(0)
  expect((await cli(k, ["contract", "add", "CRM", "Support"])).code).toBe(0)
  const t = await renderLoaded(k)
  t.input.pressKey("7")
  let frame = await until(t, (f) => f.includes("C-1 Support"))
  expect(frame.split("\n")[0]).toContain("ttybrain ·  7 Contracts")
  expect(frame).toContain("C-1 Support · #CRM")

  t.input.pressKey("2")
  await until(t, (f) => (f.split("\n")[0] ?? "").includes("ttybrain ·  2 Projects"))
  await t.nav.open("#CRM", "contracts")
  frame = await until(t, (f) => f.includes("› CRM CRM") && f.includes("1 contract"))
  expect(frame.split("\n")[2]).toMatch(/\bPeople +Context +Contracts 1\b/) // the tab bar (a blank line under the header), scrolled to the new tab
  expect(frame).toContain("C-1 Support")
})

type FailureCase = {
  // Applied to the fixture's source before the build.
  patch?: (dir: string) => void
  // Prepares the plugins folder after the build (default: just the build in <plugins>/contracts).
  setup?: (plugins: string, dir: string) => Promise<void>
  rows: Row[]
}

const failed = (error: string, source = "folder"): Row => ({ id: "contracts", version: "0.1.0", source, status: "failed", error })

const failureCases: Array<[string, FailureCase]> = [
  [
    "a throwing import",
    { patch: (d) => edit(d, "src/logic/index.ts", "// FAILURE: import\n", 'throw new Error("contracts: broken import")\n'), rows: [failed("contracts: broken import")] },
  ],
  [
    "a throwing activate",
    { patch: (d) => edit(d, "src/logic/index.ts", "// FAILURE: activate\n", 'throw new Error("broken activate")\n'), rows: [failed("broken activate")] },
  ],
  [
    "a failing migration",
    {
      patch: (d) => edit(d, "src/logic/index.ts", "// FAILURE: migration\n", 'throw new Error("broken migration")\n'),
      rows: [failed("broken migration")],
    },
  ],
  [
    "apiVersion 2",
    { patch: (d) => edit(d, "src/logic/index.ts", "apiVersion: 1,", "apiVersion: 2,"), rows: [failed("apiVersion 2 is not supported (this ttybrain supports 1)")] },
  ],
  [
    "a missing shim export",
    {
      patch: (d) => edit(d, "src/logic/index.ts", "// FAILURE: import\n", 'import { retiredHelper } from "@ttybrain/api"\nexport const legacy = retiredHelper\n'),
      rows: [failed('rebuild the plugin with this ttybrain (missing export "retiredHelper" from "@ttybrain/api")')],
    },
  ],
  [
    "a duplicate id (folder + npm)",
    {
      setup: async (plugins, dir) => addTgz(plugins, pack(dir), hasNpm ? "npm" : "bun"),
      rows: [
        { id: "contracts", version: "0.1.0", source: "folder", status: "ok", error: null },
        failed('duplicate plugin id "contracts"', "npm"),
      ],
    },
  ],
  [
    'the id "projects"',
    {
      patch: (d) => {
        edit(d, "package.json", '"id": "contracts"', '"id": "projects"')
        edit(d, "src/logic/index.ts", 'id: "contracts",', 'id: "projects",')
      },
      rows: [{ id: "projects", version: "0.1.0", source: "folder", status: "failed", error: 'plugin id "projects" is taken by a built-in plugin' }],
    },
  ],
]

test.each(failureCases)("failure: %s — pm still starts", async (_name, c) => {
  const plugins = tmp()
  const dir = await buildCopy(plugins, c.patch)
  await c.setup?.(plugins, dir)
  const k = await boot(plugins)
  const rows = (await cli(k, ["plugin", "list", "--json"])).out
  const all = JSON.parse(rows) as Row[]
  const builtins = all.filter((p) => p.source === "built-in")
  expect(builtins.map((p) => [p.id, p.status])).toEqual([
    ["actions", "ok"],
    ["inbox", "ok"],
    ["people", "ok"],
    ["projects", "ok"],
    ["meetings", "ok"],
  ])
  expect(all.filter((p) => p.source !== "built-in")).toEqual(c.rows)
  // The rest of pm runs: a built-in command works; nothing the failed plugin did is kept.
  expect((await cli(k, ["project", "add", "CRM", "CRM"])).code).toBe(0)
  if (c.rows.every((r) => r.status === "failed")) {
    expect((await cli(k, ["contract", "list"])).code).toBe(1)
    const tables = k.db.raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'contracts_%'").all([]) as Array<{ name: string }>
    expect(tables).toEqual([])
  }
}, 60_000)

test("failure: an async tui activate rejecting — pm still starts", async () => {
  const rejections: unknown[] = []
  const onRejection = (e: unknown) => void rejections.push(e)
  process.on("unhandledRejection", onRejection)
  try {
    const plugins = tmp()
    await buildCopy(plugins, (d) => edit(d, "src/tui/index.tsx", "  activate(ui) {\n", '  async activate(ui) {\n    throw new Error("tui boom")\n'))
    const k = await boot(plugins)
    expect(await listed(k)).toEqual([{ id: "contracts", version: "0.1.0", source: "folder", status: "ok", error: null }])
    installTuiModules()
    const parts = await loadTuiParts(k)
    tui = await renderTui(k, { parts: parts.builtin, external: parts.external })
    expect((await tui.frame()).split("\n")[0]).toContain("ttybrain ·  1 Attention")
    tui.input.pressKey("?")
    expect(await until(tui, (f) => f.includes("Plugin problems"))).toContain("contracts: tui activate must be synchronous")
    tui.input.pressKey("?")
    tui.input.pressKey("7")
    expect((await tui.frame()).split("\n")[0]).not.toContain("Contracts")
    await new Promise((r) => setTimeout(r, 20))
    expect(rejections).toEqual([])
  } finally {
    process.off("unhandledRejection", onRejection)
  }
})

test("disabling projects skips contracts", async () => {
  const plugins = pluginsWithBuilt()
  const first = await boot(plugins)
  expect((await cli(first, ["plugin", "disable", "projects"])).code).toBe(0)
  const home = first.home
  const k = await makeTestKernel({ env: { TTYBRAIN_PLUGINS: plugins, TTYBRAIN_HOME: home }, discover: true })
  kernels.push(k)
  expect(await listed(k)).toEqual([{ id: "contracts", version: "0.1.0", source: "folder", status: "failed", error: 'requires "projects", which is disabled' }])
  expect((await cli(k, ["contract", "list"])).code).toBe(1)
})

test("a plugin built before the rename is reported, not fatal", async () => {
  const plugins = tmp()
  // A manifest from before the rename (the old key, no "ttybrain" key), as a folder and as an npm dependency. Its
  // code is never imported: importing it would set the marker.
  const legacy = (dir: string, id: string) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `ttybrain-plugin-${id}`, version: "1.0.0", type: "module", main: "index.js", pm: { plugin: true, id } }))
    writeFileSync(join(dir, "index.js"), `globalThis.__legacyImported = true\nexport default {}\n`)
  }
  legacy(join(plugins, "old"), "old")
  writeFileSync(join(plugins, "package.json"), JSON.stringify({ name: "plugins", private: true, dependencies: { "ttybrain-plugin-older": "1.0.0" } }))
  legacy(join(plugins, "node_modules", "ttybrain-plugin-older"), "older")
  const k = await boot(plugins)
  const all = JSON.parse((await cli(k, ["plugin", "list", "--json"])).out) as Row[]
  expect(all.filter((p) => p.source === "built-in").map((p) => [p.id, p.status])).toEqual([
    ["actions", "ok"],
    ["inbox", "ok"],
    ["people", "ok"],
    ["projects", "ok"],
    ["meetings", "ok"],
  ])
  const message = 'built for pm; rename "pm" to "ttybrain" in package.json and @pm/ imports to @ttybrain/, then run "ttybrain plugin build" (or update the plugin)'
  expect(all.filter((p) => p.source !== "built-in")).toEqual([
    { id: "old", version: "1.0.0", source: "folder", status: "failed", error: message },
    { id: "older", version: "1.0.0", source: "npm", status: "failed", error: message },
  ])
  expect((globalThis as { __legacyImported?: boolean }).__legacyImported).toBeUndefined()
  expect((await cli(k, ["project", "add", "CRM", "CRM"])).code).toBe(0)
})
