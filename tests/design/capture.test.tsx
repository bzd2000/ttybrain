// Quick capture (`i`), as the screen designs draw it (docs/superpowers/specs/2026-11-13-pm-screens.html, "Quick
// capture"), on the CRM project: the overlay 76 wide, centred with its middle at about 44% of the height, the screen
// behind it dimmed; the title `Capture to inbox` and the footer `ctrl+s save · esc cancel` on the bottom border
// (Ctrl+S saves, design §3: Enter is a new line); the input in its own accent-bordered box with `#CRM` cyan and
// `@ma` magenta; the suggestions in a bordered 46-wide box, `@marie` magenta in 10 columns then the name and a
// muted role (`· team` for a team member); a blank line, then the prefill note with `#CRM` cyan; the status bar.
// Seeded with the designs' example data, 118×36. The people search matches inside names too, so `@ma` also lists
// Tom Maes after the design's two rows; the text wraps where OpenTUI's word wrap breaks it (after `go/`, where the
// mock's browser wrapped before it).
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { bgAt, fgAt, line, seedDesign } from "../design"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"
import { theme } from "../../src/kernel/tui/theme"

const WIDTH = 118
const HEIGHT = 36
const TEXT = "Marie wants a design walkthrough for the sales leads before go/no-go, invite @ma"

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 100 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

// The overlay's lines: what lies between its left and right border columns.
const box = (frame: string, left: number) => frame.split("\n").map((l) => l.slice(left, left + 76))

test("Quick capture as designed", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  tui = await renderTui(kernel, { width: WIDTH, height: HEIGHT })
  tui.input.pressKey("2")
  await until(tui, (f) => f.includes("CRM replatforming"))
  tui.input.pressKey("j")
  tui.input.pressEnter()
  await until(tui, (f) => f.includes("Overview") && f.includes("Milestones"))
  tui.input.pressKey("i")
  await until(tui, (f) => f.includes("added because"))
  await tui.input.typeText(TEXT)
  const frame = await until(tui, (f) => f.includes("Mathias Wouters"))

  const rows = frame.split("\n")
  const top = rows.findIndex((l) => l.includes("Capture to inbox"))
  const left = rows[top]!.indexOf("╭")
  expect(left).toBe((WIDTH - 76) / 2)
  const lines = box(frame, left).slice(top, top + 13)
  expect(lines[0]).toMatch(/^╭─ Capture to inbox ─+╮$/)
  expect(lines[1]).toMatch(/^│ ╭─+╮ │$/)
  expect(lines[2]).toBe(`│ │ ${"#CRM Marie wants a design walkthrough for the sales leads before go/".padEnd(68)} │ │`)
  expect(lines[3]).toBe(`│ │ ${"no-go, invite @ma".padEnd(68)} │ │`)
  expect(lines[4]).toMatch(/^│ ╰─+╯ │$/)
  expect(lines[5]).toBe(`│ ╭${"─".repeat(44)}╮${" ".repeat(26)} │`)
  expect(lines[6]).toBe(`│ │ ${"@marie".padEnd(10)}  ${"Marie Dubois · Head of Sales".padEnd(30)} │${" ".repeat(26)} │`)
  expect(lines[7]).toBe(`│ │ ${"@mathias".padEnd(10)}  ${"Mathias Wouters · team".padEnd(30)} │${" ".repeat(26)} │`)
  expect(lines[8]).toBe(`│ │ ${"@tom".padEnd(10)}  ${"Tom Maes · COO".padEnd(30)} │${" ".repeat(26)} │`)
  const end = 9
  expect(lines[end]).toBe(`│ ╰${"─".repeat(44)}╯${" ".repeat(26)} │`)
  expect(lines[end + 1]).toBe(`│${" ".repeat(74)}│`)
  expect(lines[end + 2]).toBe(`│ ${"#CRM added because you're on the CRM project".padEnd(72)} │`)
  expect(lines[end + 3]).toMatch(/^╰─+ ctrl\+s save · esc cancel ─╯$/)
  // Centred at about 44% of the height.
  const middle = top + (end + 3) / 2
  expect(top).toBeGreaterThan(1)
  expect(Math.abs(middle - 0.44 * HEIGHT)).toBeLessThanOrEqual(1.5)
  // The status bar: Ctrl+S saves (design §3).
  expect(line(frame, HEIGHT - 1)).toBe(" ctrl+s save   tab accept suggestion   esc cancel")

  const spans = await tui.spans()
  expect(fgAt(spans, "Capture to inbox")).toBe(theme.accent)
  expect(fgAt(spans, "ctrl+s save · esc cancel")).toBe(theme.muted)
  expect(fgAt(spans, "╭", top)).toBe(theme.borderFocused)
  // The input: its border accent, its tags coloured.
  expect(fgAt(spans, "╭", top + 1)).toBe(theme.borderFocused)
  expect(fgAt(spans, "#CRM Marie", top + 2)).toBe(theme.cyan)
  expect(fgAt(spans, "Marie wants", top + 2)).toBe(theme.text)
  expect(fgAt(spans, "@ma", top + 3)).toBe(theme.magenta)
  expect(fgAt(spans, "no-go", top + 3)).toBe(theme.text)
  // The suggestions: a muted border, the selected row on selectedBg, the tag magenta, the role muted.
  expect(fgAt(spans, "╭", top + 5)).toBe(theme.border)
  expect(bgAt(spans, "@marie", top + 6)).toBe(theme.selectedBg)
  expect(bgAt(spans, "@mathias", top + 7)).not.toBe(theme.selectedBg)
  expect(fgAt(spans, "@marie", top + 6)).toBe(theme.magenta)
  expect(fgAt(spans, "@mathias", top + 7)).toBe(theme.magenta)
  expect(fgAt(spans, "Marie Dubois", top + 6)).toBe(theme.text)
  expect(fgAt(spans, "· Head of Sales", top + 6)).toBe(theme.muted)
  expect(fgAt(spans, "· team", top + 7)).toBe(theme.muted)
  // The prefill note: the tag cyan, the rest muted.
  expect(fgAt(spans, "#CRM added", top + end + 2)).toBe(theme.cyan)
  expect(fgAt(spans, "added because", top + end + 2)).toBe(theme.muted)
  // The screen behind is dimmed.
  expect(fgAt(spans, "Thu 12 Nov 2026", 0)).not.toBe(theme.muted)
  expect(fgAt(spans, "ttybrain", 0)).not.toBe(theme.accent)
})
