// The project Prep panel shows a failing project-status section (the kernel's `error: …` stand-in has no compact
// form) as its title and note, muted, instead of dropping it.
import { afterEach, expect, test } from "bun:test"
import { definePlugin } from "../../../kernel/api"
import { builtinPlugins } from "../../../../tests/builtins"
import { fgAt, seedMeetings } from "../../../../tests/design"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { theme } from "../../../kernel/tui/theme"

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const broken = definePlugin({
  id: "broken",
  name: "Broken",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.reportSection("project-status", {
      id: "flaky",
      order: 99,
      run: async () => {
        throw new Error("boom")
      },
    })
  },
})

test("a failing project-status section shows as its title and error note in the prep", async () => {
  kernel = await makeTestKernel({ plugins: [...builtinPlugins, broken], today: "2026-11-20" })
  await seedMeetings(kernel)
  tui = await renderTui(kernel, { width: 118, height: 36 })
  await tui.nav.open("#CRM", "meetings")
  let frame = await tui.frame()
  for (let i = 0; i < 150 && !frame.includes("flaky error: boom"); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await tui.frame()
  }
  expect(frame).toContain("flaky error: boom")
  expect(fgAt(await tui.spans(), "error: boom", frame.split("\n").findIndex((l) => l.includes("flaky error: boom")))).toBe(theme.muted)
})
