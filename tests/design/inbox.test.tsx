// Screen 6, Inbox, as the screen designs draw it (docs/superpowers/specs/2026-11-13-pm-screens.html, "Inbox"): two
// panels, `New · 3` (focused, as tall as its rows) and `Processed · last 7 days` (the rest of the height); ref and
// time muted, `#tags` cyan and `@tags` magenta inside the text, an unknown tag followed by an amber
// `⚠ unknown project`; each processed item with its outcome under it (`✓ copilot` green in the time column, the
// muted summary, followed by the records it created that the summary does not name), a blank line between processed items, a dismissed
// item muted; and the status bar. Seeded with the designs' example data, today Thu 12 Nov 2026, 118×36. Data
// follows the seed (R5: I-5 rather than I-17, DE-8 rather than DE-12; the seed's ERP decision added no health
// note, so its summary has no `· health note added`). The processor shows by the configured assistant's name
// (`copilot`, the default `assistant.provider`).
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { fgAt, isSelected, line, seedDesign } from "../design"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"
import { theme } from "../../src/kernel/tui/theme"

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

// Columns ref 5, time 12, then the text, one cell apart.
const cols = (ref: string, time: string, text: string) => `${ref.padEnd(5)} ${time.padEnd(12)} ${text}`.trimEnd()
// The text inside a panel on line `i` (between `│ ` and `│`), without trailing spaces.
const inside = (frame: string, i: number) => (line(frame, i).split("│")[1] ?? "").slice(1).trimEnd()

async function open(width: number, height: number): Promise<{ t: RenderedTui; frame: string }> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12", seed: seedDesign })
  tui = await renderTui(kernel, { width, height })
  tui.input.pressKey("6")
  const frame = await until(tui, (f) => f.includes("New · 3") && f.includes("dismissed") && f.includes("unknown project"))
  return { t: tui, frame }
}

test("Inbox as designed", async () => {
  const { t, frame } = await open(118, 36)
  expect(line(frame, 1)).toMatch(/^ ╭─ New · 3 ─+╮$/)
  expect([2, 3, 4].map((i) => inside(frame, i))).toEqual([
    cols("I-5", "today 09:42", "Peter worried about budget overrun on #CRM, wants an update before the board @peter"),
    cols("I-6", "today 10:15", "@anna finished the solution outline #CRM, Bob needs 3 more days on specs @bob"),
    cols("I-7", "today 11:03", "#CMR ⚠ unknown project ask Marie about key user dates"),
  ])
  expect(line(frame, 5)).toMatch(/^ ╰─+╯$/)
  expect(line(frame, 6)).toMatch(/^ ╭─ Processed · last 7 days ─+╮$/)
  expect([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((i) => inside(frame, i))).toEqual([
    cols("I-4", "yesterday", "#ERP decision: go with vendor B, signed off by steering"),
    cols("", "✓ copilot", '→ decision DE-8 "Select vendor B" on ERP'),
    "",
    cols("I-3", "yesterday", "1:1 @sofie wants project mgmt training next year, follow up with options"),
    // The records its summary does not name (the note and the goal) follow it.
    cols("", "✓ copilot", '→ 1:1 note on Sofie · goal "PM training 2027" · action A-7 (me, Sun) · N-1, G-1'),
    "",
    cols("I-2", "Mon 9 Nov", "#CRM #DWH migration overlap, Bob to align with DWH team"),
    cols("", "✓ copilot", '→ action A-6 (Bob, Mon) · risk R-11 "Data migration volume unknown"'),
    "",
    cols("I-1", "Mon 9 Nov", "remember to buy coffee for the team"),
    cols("", "✗ dismissed", "by you"),
  ])
  expect(line(frame, 34)).toMatch(/^ ╰─+╯$/)
  // The design's bar, then the kept `u reopen` (R2).
  expect(line(frame, 35)).toBe(" ↑↓ select   enter open   p process   z dismiss   e edit   i capture   ? help   u reopen")

  const spans = await t.spans()
  expect(isSelected(spans, "Peter worried about budget")).toBe(true)
  // Titles: the focused panel's accent, the other's muted.
  expect(fgAt(spans, "New · 3", 1)).toBe(theme.accent)
  expect(fgAt(spans, "Processed · last 7 days", 6)).toBe(theme.muted)
  // Ref and time muted; tags coloured inside normal text.
  for (const [ref, at] of [["I-5", 2], ["I-7", 4], ["I-4", 7], ["I-1", 16]] as const) expect(fgAt(spans, ref, at)).toBe(theme.muted)
  for (const [time, at] of [["today 09:42", 2], ["yesterday", 7], ["Mon 9 Nov", 13]] as const) expect(fgAt(spans, time, at)).toBe(theme.muted)
  expect(fgAt(spans, "Peter worried", 2)).toBe(theme.text)
  expect(fgAt(spans, "#CRM", 2)).toBe(theme.cyan)
  expect(fgAt(spans, "@peter", 2)).toBe(theme.magenta)
  expect(fgAt(spans, "@anna", 3)).toBe(theme.magenta)
  expect(fgAt(spans, "@bob", 3)).toBe(theme.magenta)
  // The unknown tag stays cyan; the warning amber; the rest of the line normal.
  expect(fgAt(spans, "#CMR", 4)).toBe(theme.cyan)
  expect(fgAt(spans, "⚠ unknown project", 4)).toBe(theme.amber)
  expect(fgAt(spans, "ask Marie", 4)).toBe(theme.text)
  // Processed items: the text normal with its tags, the outcome green then muted, the created refs normal.
  expect(fgAt(spans, "#ERP", 7)).toBe(theme.cyan)
  expect(fgAt(spans, "decision: go with vendor B", 7)).toBe(theme.text)
  expect(fgAt(spans, "#DWH", 13)).toBe(theme.cyan)
  expect(fgAt(spans, "@sofie", 10)).toBe(theme.magenta)
  expect(fgAt(spans, "✓ copilot", 8)).toBe(theme.green)
  expect(fgAt(spans, "→ decision", 8)).toBe(theme.muted)
  expect(fgAt(spans, "DE-8", 8)).toBe(theme.muted)
  expect(fgAt(spans, '"Select vendor B" on ERP', 8)).toBe(theme.muted)
  expect(fgAt(spans, "1:1 note on Sofie", 11)).toBe(theme.muted)
  expect(fgAt(spans, "A-7", 11)).toBe(theme.muted)
  expect(fgAt(spans, "N-1, G-1", 11)).toBe(theme.muted)
  for (const ref of ["A-6", "R-11"]) expect(fgAt(spans, ref, 14)).toBe(theme.muted)
  // The dismissed item all muted.
  expect(fgAt(spans, "remember to buy coffee", 16)).toBe(theme.muted)
  expect(fgAt(spans, "✗ dismissed", 17)).toBe(theme.muted)
  expect(fgAt(spans, "by you", 17)).toBe(theme.muted)
})

test("↓ past the last new item moves into Processed, ↑ back; Enter there opens what it created", async () => {
  const { t } = await open(118, 36)
  for (let i = 0; i < 3; i++) t.input.pressKey("j")
  let frame = await t.frame()
  let spans = await t.spans()
  expect(isSelected(spans, "#ERP decision: go with vendor B")).toBe(true)
  expect(fgAt(spans, "Processed · last 7 days", 6)).toBe(theme.accent)
  expect(fgAt(spans, "New · 3", 1)).toBe(theme.muted)
  t.input.pressKey("j")
  spans = await t.spans()
  expect(isSelected(spans, "1:1 @sofie wants")).toBe(true)
  t.input.pressKey("k")
  t.input.pressKey("k")
  spans = await t.spans()
  expect(isSelected(spans, "#CMR")).toBe(true)
  expect(fgAt(spans, "New · 3", 1)).toBe(theme.accent)
  t.input.pressKey("j")
  t.input.pressEnter()
  // A decision opens as its edit form (nav.open).
  frame = await until(t, (f) => f.includes("Edit DE-8"))
  expect(frame).toContain("Edit DE-8")
})

// At 80×24 both panels keep their borders, refs and times stay whole; the texts are cut with `…`.
test("Inbox at 80x24 keeps both panels' borders and whole refs and times", async () => {
  const { frame } = await open(80, 24)
  for (const l of frame.split("\n")) expect(l.length).toBeLessThanOrEqual(80)
  expect(line(frame, 1)).toMatch(/^ ╭─ New · 3 ─+╮$/)
  expect(line(frame, 5)).toMatch(/^ ╰─+╯$/)
  expect(line(frame, 6)).toMatch(/^ ╭─ Processed · last 7 days ─+╮$/)
  expect(line(frame, 22)).toMatch(/^ ╰─+╯$/)
  for (const [ref, time] of [["I-5", "today 09:42"], ["I-6", "today 10:15"], ["I-7", "today 11:03"], ["I-4", "yesterday"], ["I-2", "Mon 9 Nov"], ["I-1", "Mon 9 Nov"]])
    expect(frame).toContain(`│ ${cols(ref!, time!, "")}`)
  expect(inside(frame, 2)).toMatch(/…$/)
  expect(inside(frame, 4)).toBe(cols("I-7", "today 11:03", "#CMR ⚠ unknown project ask Marie about key user dates"))
})
