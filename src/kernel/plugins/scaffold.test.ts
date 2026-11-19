import { afterAll, afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { runCli } from "../cli/dispatch"
import { buildPlugin } from "./build"
import { spawnSync } from "node:child_process"
import { symlinkSync } from "node:fs"
import { createdText, pmApiSources, scaffoldPlugin } from "./scaffold"

const temps: string[] = []
const kernels: TestKernel[] = []
let tui: RenderedTui | undefined

const tmp = () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "pm-scaffold-")))
  temps.push(d)
  return d
}

async function cli(k: TestKernel, args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, k, { out: (s) => void out.push(s), err: (s) => void err.push(s), stdin: async () => "" })
  return { code, out: out.join(""), err: err.join("") }
}

afterEach(async () => {
  tui?.destroy()
  tui = undefined
  for (const k of kernels.splice(0)) await k.cleanup()
})
afterAll(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

test("new → build → load", async () => {
  const parent = tmp()
  const dir = scaffoldPlugin(parent, "demo")
  expect(dir).toBe(join(parent, "demo"))
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  expect(pkg.name).toBe("pm-plugin-demo")
  expect(pkg.version).toBe("0.1.0")
  expect(pkg.pm).toEqual({ plugin: true, id: "demo", tui: "dist/tui/index.js" })
  expect(Object.keys(pkg.peerDependenciesMeta).sort()).toEqual(["@opentui/core", "@opentui/solid", "@pm/api", "solid-js"])

  await buildPlugin(dir)
  expect(existsSync(join(dir, "dist/logic/index.test.js"))).toBe(false) // test files are not built

  const k = await makeTestKernel({ env: { TTYBRAIN_PLUGINS: parent }, discover: true })
  kernels.push(k)
  expect(await cli(k, ["demo", "list"])).toEqual({ code: 0, out: "no items\n", err: "" })
  const row = (await cli(k, ["plugin", "list", "--json"])).out
  expect(JSON.parse(row).find((p: { id: string }) => p.id === "demo")).toEqual({ id: "demo", version: "0.1.0", source: "folder", status: "ok", error: null })
  k.db.raw.prepare("INSERT INTO demo_item (title) VALUES ('First')").run([])
  expect(await cli(k, ["demo", "list"])).toEqual({ code: 0, out: "id  title\n1   First\n", err: "" })

  // Dynamic: kernel files outside src/kernel/tui/ import the UI only through import().
  const { installTuiModules, loadTuiParts } = await import("../tui/load")
  installTuiModules()
  const parts = await loadTuiParts(k)
  expect(parts.errors).toEqual([])
  tui = await renderTui(k, { parts: parts.builtin, external: parts.external, width: 100, height: 30 })
  tui.input.pressKey("7")
  let frame = await tui.frame()
  for (let i = 0; i < 100 && !frame.includes("1 First"); i++) {
    await new Promise((r) => setTimeout(r, 20))
    frame = await tui.frame()
  }
  expect(frame.split("\n")[0]).toContain("ttybrain · 7 Demo")
  expect(frame).toContain("1 First")
})

test("invalid or taken id, existing dir", () => {
  const parent = tmp()
  expect(() => scaffoldPlugin(parent, "Bad_Id")).toThrow('plugin id "Bad_Id" must match [a-z][a-z0-9-]*')
  expect(() => scaffoldPlugin(parent, "projects")).toThrow('plugin id "projects" is taken by a built-in plugin')
  const dir = scaffoldPlugin(parent, "once")
  expect(() => scaffoldPlugin(parent, "once")).toThrow(`already exists: ${dir}`)
})

test("tsconfig paths point at this pm's API sources", () => {
  const sources = pmApiSources()
  expect(sources).toBeDefined()
  expect(existsSync(sources!.api)).toBe(true)
  expect(existsSync(sources!.tui)).toBe(true)
  const dir = scaffoldPlugin(tmp(), "paths")
  const ts = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8"))
  expect(ts.compilerOptions.jsx).toBe("preserve")
  expect(ts.compilerOptions.jsxImportSource).toBe("@opentui/solid")
  expect(ts.compilerOptions.paths).toEqual({ "@pm/api": [sources!.api], "@pm/api/tui": [sources!.tui] })
})

test("no pm sources found: no tsconfig paths, and a note", () => {
  const empty = tmp()
  expect(pmApiSources(empty)).toBeUndefined()
  const dir = scaffoldPlugin(tmp(), "nopaths", { pmRoot: empty })
  expect(JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8")).compilerOptions.paths).toBeUndefined()
  expect(createdText(dir, "nopaths", empty)).toBe(`created ${dir}; next: ttybrain plugin build nopaths\nnote: no ttybrain sources found; type-checking needs a git checkout of ttybrain`)
})

test("a fresh scaffold type-checks with zero errors", () => {
  const dir = scaffoldPlugin(tmp(), "typed")
  // Stands in for `npm install` of its devDependencies: pm's own node_modules has the same packages.
  symlinkSync(join(import.meta.dir, "../../../node_modules"), join(dir, "node_modules"))
  const r = spawnSync(process.execPath, ["check"], { cwd: dir, encoding: "utf8" })
  expect(r.stdout + r.stderr).toContain("No type errors")
  expect(r.status).toBe(0)
}, 60_000)

test("ttybrain plugin new <id> creates <cwd>/<id>", async () => {
  const k = await makeTestKernel()
  kernels.push(k)
  const cwd = process.cwd()
  const parent = tmp()
  process.chdir(parent)
  try {
    expect(await cli(k, ["plugin", "new", "demo"])).toEqual({ code: 0, out: `created ${join(parent, "demo")}; next: ttybrain plugin build demo\n`, err: "" })
  } finally {
    process.chdir(cwd)
  }
})
