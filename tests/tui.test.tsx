// renderTui itself (tests/tui.tsx): after destroy() every way of reading the screen fails at once with a clear
// error, so the body of a test that timed out (bun cannot stop it: it keeps running after afterEach destroyed its
// TUI) stops at its next frame()/settle() instead of looping on, or waiting on, a destroyed renderer.
import { afterEach, expect, test } from "bun:test"
import { definePlugin, type PluginDef } from "../src/kernel/api"
import { builtinPlugins } from "./builtins"
import { makeTestKernel, type TestKernel } from "./helpers"
import { renderTui, TUI_DESTROYED } from "./tui"

// Record type `hang` (prefix `H-`) whose resolve never settles: nav.open("H-1") is a tracked load that never ends.
const hangPlugin: PluginDef = definePlugin({
  id: "hang",
  name: "Hang",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.recordType({ name: "hang", prefix: "H-", resolve: () => new Promise(() => {}), label: async () => "Hang", search: async () => [] })
  },
})

let kernel: TestKernel | undefined
afterEach(async () => {
  await kernel?.cleanup()
  kernel = undefined
})

// What `p` did within `ms`: resolved, rejected (with the message) or still pending.
const outcome = (p: Promise<unknown>, ms = 1000) =>
  Promise.race([
    p.then(
      () => "resolved",
      (e: unknown) => `rejected: ${e instanceof Error ? e.message : String(e)}`,
    ),
    new Promise((r) => setTimeout(() => r("pending"), ms)),
  ])

test("after destroy() frame, peek, spans and settle reject with the destroyed error", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  const t = await renderTui(kernel)
  expect(await t.frame()).toContain("Attention")
  t.destroy()
  t.destroy() // twice is harmless (a finally after an afterEach)
  expect(await outcome(t.frame())).toBe(`rejected: ${TUI_DESTROYED}`)
  expect(await outcome(t.peek())).toBe(`rejected: ${TUI_DESTROYED}`)
  expect(await outcome(t.spans())).toBe(`rejected: ${TUI_DESTROYED}`)
  expect(await outcome(t.settle())).toBe(`rejected: ${TUI_DESTROYED}`)
})

test("a settle() waiting on a load that never finishes rejects when the TUI is destroyed", async () => {
  kernel = await makeTestKernel({ plugins: [hangPlugin] })
  const t = await renderTui(kernel, { parts: [] })
  await t.settle()
  void t.nav.open("H-1") // a hung load in a test that then times out
  const waiting = t.settle()
  expect(await outcome(waiting, 100)).toBe("pending")
  t.destroy()
  expect(await outcome(waiting)).toBe(`rejected: ${TUI_DESTROYED}`)
})
