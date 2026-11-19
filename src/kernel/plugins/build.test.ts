// `pm plugin build`: compiling a plugin's src/ to dist/ and the shims that hand it pm's own shared modules.
// This file is kernel code outside src/kernel/tui/, so it loads the UI side (installTuiModules, renderTui) with
// dynamic imports only (tests/logic-ui-split.test.ts).
import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { runCli } from "../cli/dispatch"
import { ValidationError } from "../errors"
import { installApiModule } from "../loader"
import { RESOLVE_EXTENSIONS, SOLID_OPTIONS } from "./babel-options"
import { buildPlugin } from "./build"

const temps: string[] = []
let kernel: TestKernel | undefined
afterEach(async () => {
  await kernel?.cleanup()
  kernel = undefined
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "pm-plugin-build-")))
  temps.push(d)
  return d
}

// A plugin folder `<parent>/<id>` with a manifest and the given src/ files.
function pluginDir(files: Record<string, string>, o: { id?: string; parent?: string; tui?: boolean } = {}): string {
  const id = o.id ?? "demo"
  const dir = join(o.parent ?? tmp(), id)
  const pm = { plugin: true, id, ...(o.tui !== false && { tui: "dist/tui/index.js" }) }
  write(dir, "package.json", JSON.stringify({ name: `pm-plugin-${id}`, version: "1.0.0", type: "module", main: "dist/logic/index.js", pm }))
  for (const [path, text] of Object.entries(files)) write(dir, path, text)
  return dir
}

function write(dir: string, path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}

const LOGIC = (id = "demo") =>
  `import { definePlugin } from "@pm/api"\n` +
  `import type { PluginDef } from "@pm/api"\n` +
  `const def: PluginDef = definePlugin({ id: ${JSON.stringify(id)}, name: "Demo", version: "1.0.0", apiVersion: 1, activate() {} })\n` +
  `export default def\n`

// A screen whose text follows a signal; "+" bumps it.
const TUI = (id = "demo") =>
  `import { createSignal } from "solid-js"\n` +
  `import { defineTui, printable, useScreenKeys } from "@pm/api/tui"\n` +
  `export { For } from "solid-js"\n` +
  `function Counter() {\n` +
  `  const [n, setN] = createSignal<number>(0)\n` +
  `  useScreenKeys((key) => {\n` +
  `    if (printable(key) !== "+") return\n` +
  `    key.preventDefault()\n` +
  `    setN(n() + 1)\n` +
  `  })\n` +
  `  return <box><text>{"count " + n()}</text></box>\n` +
  `}\n` +
  `export default defineTui({ plugin: ${JSON.stringify(id)}, activate(ui) { ui.screen({ id: "counter", title: "Counter", slot: 7, component: Counter }) } })\n`

// The bare specifiers of a built file's static imports and re-exports.
const bare = (code: string) =>
  [...code.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?["']([^"']+)["']/g)].map((m) => m[1]!).filter((s) => !s.startsWith("."))

test("babel-options.ts and scripts/build-node.mjs use the same Babel values", () => {
  const script = readFileSync(resolve(import.meta.dir, "../../../scripts/build-node.mjs"), "utf8")
  const value = (name: string) => {
    const m = script.match(new RegExp(`const ${name} = (.+)\\n`))
    if (!m) throw new Error(`build-node.mjs has no "const ${name} = …"`)
    return JSON.parse(m[1]!)
  }
  expect(value("solidOptions")).toEqual(SOLID_OPTIONS)
  expect(value("resolveExtensions")).toEqual(RESOLVE_EXTENSIONS)
})

test("compiles src/ to dist/ and shims shared imports", async () => {
  const dir = pluginDir({ "src/logic/index.ts": LOGIC(), "src/tui/index.tsx": TUI() })
  const result = await buildPlugin(dir)
  expect(result).toEqual({ files: 2, shims: ["@pm/api", "@pm/api/tui", "solid-js", "@opentui/solid"] })
  expect(existsSync(join(dir, "dist/logic/index.js"))).toBe(true)
  expect(existsSync(join(dir, "dist/tui/index.js"))).toBe(true)
  const shims = readdirSync(join(dir, "dist/__pm")).sort()
  expect(shims).toEqual(["opentui-solid.js", "pm-api-tui.js", "pm-api.js", "solid-js.js"])
  for (const f of walk(join(dir, "dist"))) expect({ f, bare: bare(readFileSync(f, "utf8")) }).toEqual({ f, bare: [] })
  const tui = readFileSync(join(dir, "dist/tui/index.js"), "utf8")
  expect(tui).toContain('from "../__pm/opentui-solid.js"') // the JSX-generated import, shimmed too
  expect(tui).toContain('from "../__pm/solid-js.js"')
  expect(readFileSync(join(dir, "dist/logic/index.js"), "utf8")).toContain('from "../__pm/pm-api.js"')
  expect(readFileSync(join(dir, "dist/__pm/solid-js.js"), "utf8")).toBe(
    `const m = globalThis.__PM_MODULES__?.["solid-js"]\n` +
      `if (!m) throw new Error('"solid-js" is provided by pm; load this plugin from pm')\n` +
      'for (const n of ["createSignal", "For"]) if (!(n in m)) throw new Error(`rebuild the plugin with this pm (missing export "${n}" from "solid-js")`)\n' +
      `export const createSignal = m.createSignal, For = m.For\n`,
  )
})

test("relative imports get .js", async () => {
  const dir = pluginDir(
    {
      "src/logic/index.ts": `import def from "./b"\nimport { c } from "./dir"\nexport default { ...def, c }\n`,
      "src/logic/b.ts": `export default { id: "demo", name: "Demo", version: "1.0.0", apiVersion: 1, activate() {} }\n`,
      "src/logic/dir/index.ts": `export const c = 1\n`,
    },
    { tui: false },
  )
  expect(await buildPlugin(dir)).toEqual({ files: 3, shims: [] })
  const index = readFileSync(join(dir, "dist/logic/index.js"), "utf8")
  expect(index).toContain('from "./b.js"')
  expect(index).toContain('from "./dir/index.js"')
  expect(existsSync(join(dir, "dist/logic/dir/index.js"))).toBe(true)
  expect(existsSync(join(dir, "dist/__pm"))).toBe(false)
})

test("logic importing UI fails the build", async () => {
  const dir = pluginDir(
    {
      "src/logic/index.ts": `import { h } from "./helper"\nexport default { id: "demo", name: "Demo", version: "1.0.0", apiVersion: 1, activate() { h() } }\n`,
      "src/logic/helper.ts": `import { createSignal } from "solid-js"\nexport const h = () => createSignal(0)\n`,
    },
    { tui: false },
  )
  const err = await buildPlugin(dir).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ValidationError)
  expect((err as Error).message).toBe('logic entry imports "solid-js" (via src/logic/helper.ts)')
  expect(existsSync(join(dir, "dist"))).toBe(false) // nothing is written when the build fails
})

test("namespace imports of shared modules fail", async () => {
  const cases: Array<[string, string]> = [
    [`import * as s from "solid-js"\nexport const x = s.createSignal\n`, 'src/tui/index.tsx: use named imports from "solid-js"'],
    [`export * from "@opentui/core"\n`, 'src/tui/index.tsx: use named imports from "@opentui/core"'],
    [`export * as c from "@opentui/core"\n`, 'src/tui/index.tsx: use named imports from "@opentui/core"'],
    [`export const w = () => import("solid-js/store")\n`, 'src/tui/index.tsx: use named imports from "solid-js/store"'],
    ["export const w = () => import(`solid-js`)\n", 'src/tui/index.tsx: use named imports from "solid-js"'],
  ]
  for (const [tui, message] of cases) {
    const dir = pluginDir({ "src/logic/index.ts": LOGIC(), "src/tui/index.tsx": tui })
    const err = await buildPlugin(dir).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as Error).message).toBe(message)
  }
  // A subpath of a shared package, or another OpenTUI package, is not shared: it would load a second instance.
  const notShared: Array<[string, string]> = [
    [`import { render } from "solid-js/web"\nexport { render }\n`, "solid-js/web"],
    [`import { ThreeRenderable } from "@opentui/three"\nexport { ThreeRenderable }\n`, "@opentui/three"],
    ["export const t = () => import(`@opentui/react`)\n", "@opentui/react"],
  ]
  for (const [code, spec] of notShared) {
    const dir = pluginDir({ "src/logic/index.ts": LOGIC(), "src/tui/index.tsx": code })
    expect(((await buildPlugin(dir).catch((e: unknown) => e)) as Error).message).toBe(
      `src/tui/index.tsx: "${spec}" is not shared by pm; use @pm/api, @pm/api/tui, solid-js, solid-js/store, @opentui/solid or @opentui/core`,
    )
  }
  // A computed specifier can't be checked statically: it is left alone.
  const computed = pluginDir({ "src/logic/index.ts": LOGIC(), "src/tui/index.tsx": "const n = \"x\"\nexport const w = () => import(`./${n}`)\n" })
  expect(await buildPlugin(computed)).toEqual({ files: 2, shims: ["@pm/api"] })
})

test("a built plugin loads in pm and its UI is reactive", async () => {
  const pluginsDir = tmp()
  const dir = pluginDir({ "src/logic/index.ts": LOGIC(), "src/tui/index.tsx": TUI() }, { parent: pluginsDir })
  await buildPlugin(dir)
  const { installTuiModules, loadTuiParts } = await import("../tui/load")
  const { renderTui } = await import("../../../tests/tui")
  installApiModule()
  installTuiModules()
  const logic = (await import(join(dir, "dist/logic/index.js"))) as { default: { id: string } }
  expect(logic.default.id).toBe("demo")
  kernel = await makeTestKernel({ env: { TTYBRAIN_PLUGINS: pluginsDir }, discover: { builtinDir: tmp() } })
  expect(kernel.plugins.map((p) => [p.id, p.status, p.error])).toEqual([["demo", "ok", undefined]])
  const parts = await loadTuiParts(kernel)
  expect(parts.errors).toEqual([])
  const tui = await renderTui(kernel, { parts: [], external: parts.external })
  try {
    tui.input.pressKey("7")
    expect(await tui.frame()).toContain("count 0")
    tui.input.pressKey("+")
    expect(await tui.frame()).toContain("count 1")
    tui.input.pressKey("+")
    expect(await tui.frame()).toContain("count 2")
  } finally {
    tui.destroy()
  }
})

test("a shim outside pm and a missing export", async () => {
  const g = globalThis as { __PM_MODULES__?: Record<string, unknown> }
  const before = g.__PM_MODULES__
  const outside = pluginDir({ "src/logic/index.ts": LOGIC() }, { tui: false })
  const missing = pluginDir({ "src/logic/index.ts": `import { definePlugin, x } from "@pm/api"\nexport const y = x\nexport default definePlugin\n` }, { tui: false })
  await buildPlugin(outside)
  await buildPlugin(missing)
  try {
    delete g.__PM_MODULES__
    await expect(import(join(outside, "dist/logic/index.js"))).rejects.toThrow('"@pm/api" is provided by pm; load this plugin from pm')
    installApiModule()
    await expect(import(join(missing, "dist/logic/index.js"))).rejects.toThrow('rebuild the plugin with this pm (missing export "x" from "@pm/api")')
  } finally {
    g.__PM_MODULES__ = before
    if (before) installApiModule()
  }
})

test("a shim exports names that clash with its own locals", async () => {
  const dir = pluginDir(
    { "src/logic/index.ts": `import { m, __pm0, definePlugin } from "@pm/api"\nexport const got = [m, __pm0]\nexport default definePlugin\n` },
    { tui: false },
  )
  await buildPlugin(dir)
  const g = globalThis as { __PM_MODULES__?: Record<string, unknown> }
  const before = g.__PM_MODULES__
  try {
    g.__PM_MODULES__ = { "@pm/api": { m: "the m", __pm0: "the __pm0", definePlugin: () => null } }
    const mod = (await import(join(dir, "dist/logic/index.js"))) as { got: unknown[] }
    expect(mod.got).toEqual(["the m", "the __pm0"])
  } finally {
    g.__PM_MODULES__ = before
  }
})

test("no src/ or no package.json", async () => {
  const empty = tmp()
  await expect(buildPlugin(empty)).rejects.toThrow(new ValidationError(`no package.json in ${empty}`))
  writeFileSync(join(empty, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", type: "module", main: "dist/logic/index.js" }))
  await expect(buildPlugin(empty)).rejects.toThrow(new ValidationError(`no src/ in ${empty}`))
  const err = await buildPlugin(empty).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ValidationError)
})

test("pm plugin build [dir] prints what it built", async () => {
  const dir = pluginDir({ "src/logic/index.ts": LOGIC(), "src/tui/index.tsx": TUI() })
  kernel = await makeTestKernel({ plugins: [] })
  const o = { out: "", err: "" }
  const io = { out: (s: string) => void (o.out += s), err: (s: string) => void (o.err += s), stdin: async () => "" }
  expect(await runCli(["plugin", "build", dir], kernel, io)).toBe(0)
  expect(o).toEqual({ out: "built pm-plugin-demo 1.0.0: 2 files, shims for @pm/api, @pm/api/tui, solid-js, @opentui/solid\n", err: "" })
  o.out = ""
  expect(await runCli(["plugin", "build", dir, "--json"], kernel, io)).toBe(0)
  expect(JSON.parse(o.out)).toEqual({ name: "pm-plugin-demo", version: "1.0.0", files: 2, shims: ["@pm/api", "@pm/api/tui", "solid-js", "@opentui/solid"] })
  o.out = ""
  expect(await runCli(["plugin", "build", join(dir, "nope")], kernel, io)).toBe(1)
  expect(o.err).toContain(`no package.json in ${join(dir, "nope")}`)
})

test("pm plugin build names a package without name or version by its folder", async () => {
  const dir = pluginDir({ "src/logic/index.ts": LOGIC() }, { tui: false })
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>
  delete pkg.name
  delete pkg.version
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg))
  kernel = await makeTestKernel({ plugins: [] })
  const o = { out: "", err: "" }
  const io = { out: (s: string) => void (o.out += s), err: (s: string) => void (o.err += s), stdin: async () => "" }
  expect(await runCli(["plugin", "build", dir], kernel, io)).toBe(0)
  expect(o).toEqual({ out: "built demo: 1 files, shims for @pm/api\n", err: "" })
  o.out = ""
  expect(await runCli(["plugin", "build", dir, "--json"], kernel, io)).toBe(0)
  expect(JSON.parse(o.out)).toEqual({ name: null, version: null, files: 1, shims: ["@pm/api"] })
})
