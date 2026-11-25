// Loading the plugins' tui entries from their manifests (load.ts), the shared UI modules for external plugins,
// a tui activate that returns a promise (R3), Help's global-action hints and the TUI with no plugins at all.
import * as opentuiCore from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import * as opentuiSolid from "@opentui/solid"
import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as solid from "solid-js"
import * as solidStore from "solid-js/store"
import { builtinPlugins, builtinTuiParts } from "../../../tests/builtins"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import * as api from "../api"
import { definePlugin } from "../api"
import * as tuiApi from "./api"
import { bootTui } from "./boot"
import { installTuiModules, loadTuiParts } from "./load"
import { runTui } from "./run"
import type { TuiDef } from "./types"

const temps: string[] = []
let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "pm-tui-load-")))
  temps.push(d)
  return d
}

const LOGIC = (id: string) => `export default { id: ${JSON.stringify(id)}, name: "Ext", version: "1.0.0", apiVersion: 1, activate() {} }\n`
// A hand-written tui entry that reaches the kernel only through the shared modules, as a built plugin's shims do.
const TUI = (id: string) =>
  `const { defineTui } = globalThis.__TTYBRAIN_MODULES__["@ttybrain/api/tui"]\n` +
  `export default defineTui({ plugin: ${JSON.stringify(id)}, activate() {} })\n`

// A folder plugin `<pluginsDir>/<id>` with a logic entry and, when given, a tui entry.
function folderPlugin(pluginsDir: string, id: string, o: { logic?: string; tui?: string } = {}): void {
  const dir = join(pluginsDir, id)
  mkdirSync(dir, { recursive: true })
  const ttybrain: Record<string, unknown> = { plugin: true, id, ...(o.tui !== undefined && { tui: "tui.js" }) }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `ttybrain-plugin-${id}`, version: "1.0.0", type: "module", main: "index.js", ttybrain }))
  writeFileSync(join(dir, "index.js"), o.logic ?? LOGIC(id))
  if (o.tui !== undefined) writeFileSync(join(dir, "tui.js"), o.tui)
}

// Boots a kernel over `pluginsDir`, with the real built-ins or an empty built-in folder.
async function discovered(pluginsDir: string, builtins: boolean): Promise<TestKernel> {
  kernel = await makeTestKernel({ env: { TTYBRAIN_PLUGINS: pluginsDir }, discover: builtins ? true : { builtinDir: tmp() } })
  return kernel
}

test("installTuiModules installs ttybrain's shared modules", () => {
  installTuiModules()
  const modules = (globalThis as { __TTYBRAIN_MODULES__?: Record<string, unknown> }).__TTYBRAIN_MODULES__!
  expect(modules["@ttybrain/api"]).toBe(api)
  expect(modules["@ttybrain/api/tui"]).toBe(tuiApi)
  expect(modules["solid-js"]).toBe(solid)
  expect(modules["solid-js/store"]).toBe(solidStore)
  expect(modules["@opentui/solid"]).toBe(opentuiSolid)
  expect(modules["@opentui/core"]).toBe(opentuiCore)
})

test("loadTuiParts imports each ok plugin's tui entry; built-ins and externals apart", async () => {
  const pluginsDir = tmp()
  folderPlugin(pluginsDir, "ext", { tui: TUI("ext") })
  folderPlugin(pluginsDir, "plain") // no tui entry
  const k = await discovered(pluginsDir, true)
  installTuiModules()
  const parts = await loadTuiParts(k)
  expect(parts.errors).toEqual([])
  expect(parts.builtin).toHaveLength(6)
  // Every built-in's ttybrain.tui entry, in load order.
  expect(parts.builtin.map((p) => p.plugin)).toEqual(k.plugins.filter((p) => p.source === "built-in").map((p) => p.id))
  expect(parts.external.map((p) => p.plugin)).toEqual(["ext"])
})

test("a tui entry that throws on import is reported, its logic stays loaded", async () => {
  const pluginsDir = tmp()
  folderPlugin(pluginsDir, "ext", { tui: `throw new Error("tui boom")\n` })
  const k = await discovered(pluginsDir, false)
  const parts = await loadTuiParts(k)
  expect(parts).toEqual({ builtin: [], external: [], errors: [{ plugin: "ext", error: "ext: tui boom" }] })
  expect(k.plugins.find((p) => p.id === "ext")?.status).toBe("ok")
})

test("an external tui entry that hangs while importing times out", async () => {
  const pluginsDir = tmp()
  folderPlugin(pluginsDir, "ext", { tui: `await new Promise(() => {})\nexport default {}\n` })
  const k = await discovered(pluginsDir, false)
  const parts = await loadTuiParts(k, { timeoutMs: 100 })
  expect(parts.errors).toEqual([{ plugin: "ext", error: "ext: timed out after 100 ms while importing" }])
  expect(k.plugins.find((p) => p.id === "ext")?.status).toBe("ok")
})

test("a tui entry must default-export a tui part for its own plugin", async () => {
  const pluginsDir = tmp()
  folderPlugin(pluginsDir, "a", { tui: `export const x = 1\n` })
  folderPlugin(pluginsDir, "b", { tui: TUI("a") })
  const k = await discovered(pluginsDir, false)
  const parts = await loadTuiParts(k)
  expect(parts.errors).toEqual([
    { plugin: "a", error: "a: the tui entry has no default export" },
    { plugin: "b", error: 'b: the tui entry is a part for plugin "a"' },
  ])
  expect(parts.external).toEqual([])
})

test("the tui entry of a plugin whose logic failed or is disabled is not imported", async () => {
  const pluginsDir = tmp()
  const throwing = `throw new Error("must not be imported")\n`
  folderPlugin(pluginsDir, "bad", { logic: `throw new Error("logic boom")\n`, tui: throwing })
  folderPlugin(pluginsDir, "off", { tui: throwing })
  kernel = await makeTestKernel({
    env: { TTYBRAIN_PLUGINS: pluginsDir, TTYBRAIN_CONFIG_JSON: JSON.stringify({ plugins: { disabled: ["off"] } }) },
    discover: { builtinDir: tmp() },
  })
  expect(kernel.plugins.map((p) => p.status)).toEqual(["failed", "disabled"])
  expect(await loadTuiParts(kernel)).toEqual({ builtin: [], external: [], errors: [] })
})

// Renders until the frame contains `text` (up to 400 rounds of 25 ms, about 10 s) and returns it; else throws
// with the last frame.
async function untilFrame(setup: Awaited<ReturnType<typeof createTestRenderer>>, text: string): Promise<string> {
  let frame = ""
  for (let i = 0; i < 400; i++) {
    await setup.renderOnce()
    frame = setup.captureCharFrame()
    if (frame.includes(text)) return frame
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`timed out after about 10 s waiting for "${text}" in the frame:\n${frame}`)
}

test("runTui loads the tui entries and lists a failed import under Plugin problems", async () => {
  const pluginsDir = tmp()
  folderPlugin(pluginsDir, "ext", { tui: `throw new Error("tui boom")\n` })
  const k = await discovered(pluginsDir, false)
  const setup = await createTestRenderer({ width: 100, height: 30 })
  try {
    const done = runTui(k, { renderer: setup.renderer })
    await untilFrame(setup, "ttybrain ·  1 Attention")
    setup.mockInput.pressKey("?")
    const frame = await untilFrame(setup, "Plugin problems")
    expect(frame).toContain("ext: tui boom")
    setup.mockInput.pressKey("?") // closes Help
    await setup.renderOnce()
    setup.mockInput.pressKey("q")
    await done
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
  }
}, 25_000)

test("an async tui activate fails the part only", async () => {
  const rejections: unknown[] = []
  const onRejection = (e: unknown) => void rejections.push(e)
  process.on("unhandledRejection", onRejection)
  try {
    const ext = definePlugin({ id: "ext", name: "Ext", version: "1.0.0", apiVersion: 1, activate() {} })
    kernel = await makeTestKernel({ plugins: [...builtinPlugins, ext] })
    const asyncPart = {
      plugin: "ext",
      activate(ui) {
        ui.screen({ id: "ext", title: "Ext screen", component: () => null })
        return Promise.reject(new Error("x"))
      },
    } as TuiDef
    tui = await renderTui(kernel, { parts: builtinTuiParts, external: [asyncPart] })
    tui.input.pressKey("?")
    const help = await tui.frame()
    expect(help).toContain("ext: tui activate must be synchronous")
    tui.input.pressKey("?") // closes Help (Esc followed at once by g would arrive as Alt+g)
    expect(await tui.frame()).not.toContain("Plugin problems")
    tui.input.pressKey("g")
    const switcher = await tui.frame()
    expect(switcher).toMatch(/\b2  Projects\b/)
    expect(switcher).not.toContain("Ext screen")
    // The registry itself: the failed part's screen is gone, the built-ins' screens stay.
    const registry = bootTui(kernel, builtinTuiParts, { builtin: true, external: [asyncPart] })
    expect(registry.screens().filter((sc) => sc.plugin === "ext")).toEqual([])
    expect(registry.screens().map((sc) => sc.slot)).toEqual([2, 3, 4, 5, 6, 7])
    expect(registry.errors()).toEqual([{ plugin: "ext", error: "ext: tui activate must be synchronous" }])
    await new Promise((r) => setTimeout(r, 20))
    expect(rejections).toEqual([])
  } finally {
    process.off("unhandledRejection", onRejection)
  }
})

test("Help lists the capture key only when inbox is loaded", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  tui = await renderTui(kernel, { parts: builtinTuiParts })
  tui.input.pressKey("?")
  expect(await tui.frame()).toMatch(/\bi +capture\b/)
  tui.destroy()
  tui = undefined
  await kernel.cleanup()

  kernel = await makeTestKernel({ plugins: builtinPlugins, env: { TTYBRAIN_CONFIG_JSON: JSON.stringify({ plugins: { disabled: ["inbox"] } }) } })
  expect(kernel.plugins.find((p) => p.id === "inbox")?.status).toBe("disabled")
  tui = await renderTui(kernel, { parts: builtinTuiParts.filter((p) => p.plugin !== "inbox") })
  tui.input.pressKey("?")
  const frame = await tui.frame()
  expect(frame).toContain("Plugin problems")
  expect(frame).not.toContain("capture")
})

test("the TUI runs with no plugins", async () => {
  kernel = await makeTestKernel({ plugins: [] })
  tui = await renderTui(kernel, { parts: [] })
  const frame = await tui.frame()
  expect(frame.split("\n")[0]).toContain("ttybrain ·  1 Attention")
  expect(frame).toContain("No panels yet: plugins add them here.")
  tui.input.pressKey("?")
  const help = await tui.frame()
  expect(help).toContain("Plugin problems")
  expect(help).toContain("none")
})
