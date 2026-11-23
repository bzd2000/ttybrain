// The frame as the screen designs draw it (docs/superpowers/specs/2026-11-13-pm-screens.html, "Screen switcher",
// "Attention", "Project detail" and "Quick capture"): the header (`ttybrain · ` chip, breadcrumb, amber inbox badge,
// muted date), the status bar's format and shared tail, the switcher dropping down under the chip and overlays
// placed as designed over a dimmed screen. Seeded with the designs' example data, today Thu 12 Nov 2026, 118×36.
import { afterEach, expect, test } from "bun:test"
import { bgAt, boldAt, fgAt, line, seedDesign } from "../../../tests/design"
import { builtinPlugins } from "../../../tests/builtins"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { theme } from "./theme"

const WIDTH = 118
const HEIGHT = 36

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

async function open(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12", seed: seedDesign })
  tui = await renderTui(kernel, { width: WIDTH, height: HEIGHT })
  await tui.frame()
  return tui
}

// Waits (bounded) until `check` holds for the frame; returns the last frame.
async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 50 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

const rows = (frame: string) => frame.split("\n")

test("header as designed", async () => {
  const t = await open()
  const frame = await until(t, (f) => line(f, 0).includes("● 3 new in inbox"))
  const head = line(frame, 0)
  expect(head.startsWith(" ttybrain ·  1 Attention ▾ ")).toBe(true)
  expect(head.endsWith("● 3 new in inbox  Thu 12 Nov 2026")).toBe(true)
  const spans = await t.spans()
  expect(fgAt(spans, "ttybrain", 0)).toBe(theme.accent)
  expect(boldAt(spans, "ttybrain", 0)).toBe(true)
  expect(fgAt(spans, "·", 0)).toBe(theme.muted)
  expect(boldAt(spans, "·", 0)).toBe(false)
  // The chip: on the selected-row background with one cell of padding each side, accent text.
  expect(bgAt(spans, " 1 Attention ▾ ", 0)).toBe(theme.selectedBg)
  expect(bgAt(spans, "▾ ", 0)).toBe(theme.selectedBg)
  expect(fgAt(spans, "1 Attention ▾", 0)).toBe(theme.accent)
  expect(bgAt(spans, "ttybrain", 0)).toBe(theme.panel)
  expect(fgAt(spans, "● 3 new in inbox", 0)).toBe(theme.amber)
  expect(fgAt(spans, "Thu 12 Nov 2026", 0)).toBe(theme.muted)
})

test("record breadcrumbs: screen chip, code cyan, label; no extra line", async () => {
  const t = await open()
  // Opened from the Attention screen: the chip still names the screen the project belongs to.
  await t.nav.open("#CRM")
  let frame = await until(t, (f) => line(f, 0).includes("CRM replatforming"))
  expect(line(frame, 0)).toContain("ttybrain ·  2 Projects ▾  › CRM CRM replatforming")
  // A blank line, then the tabs: no `› CRM` line between.
  expect(line(frame, 1)).toBe("")
  expect(line(frame, 2)).toMatch(/^\s+Overview\s+Milestones \d+\s+Deliverables \d+/)
  expect(frame).not.toMatch(/^\s*› CRM/m)
  let spans = await t.spans()
  expect(fgAt(spans, "›", 0)).toBe(theme.muted)
  expect(fgAt(spans, "CRM CRM", 0)).toBe(theme.cyan)
  expect(fgAt(spans, "CRM replatforming", 0)).toBe(theme.text)

  // A record opened from a record replaces the crumb; it is never stacked.
  await t.nav.open("@peter")
  frame = await until(t, (f) => line(f, 0).includes("Peter Janssens"))
  // A person's crumb has no ref (the people plugin's crumb, as the 2026-11-20 designs draw it) and a muted detail.
  expect(line(frame, 0)).toContain("ttybrain ·  3 People ▾  › Peter Janssens · CFO, Finance · stakeholder")
  await t.nav.open("@anna")
  frame = await until(t, (f) => line(f, 0).includes("Anna Peeters"))
  expect(line(frame, 0)).toContain("3 People ▾  › Anna Peeters")
  expect(line(frame, 0)).not.toContain("Peter")
  expect(line(frame, 0)).not.toContain("CRM")
  // Esc goes back a record, and its crumb comes back alone.
  t.input.pressEscape()
  frame = await until(t, (f) => line(f, 0).includes("Peter Janssens"))
  expect(line(frame, 0)).toContain("3 People ▾  › Peter Janssens")
  expect(line(frame, 0)).not.toContain("Anna")
  t.input.pressEscape()
  frame = await until(t, (f) => line(f, 0).includes("CRM replatforming"))
  expect(line(frame, 0)).toContain("2 Projects ▾  › CRM CRM replatforming")
  spans = await t.spans()
  expect(fgAt(spans, "CRM CRM", 0)).toBe(theme.cyan)
})

// At 80 columns the space between the crumb and the badge gives way first, then the crumb's detail; only then is the
// label cut, with `…`, never the `› ` or the code.
test("record crumb at 80 columns: the spacer goes first, then the label is cut with …", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12", seed: seedDesign })
  const t = (tui = await renderTui(kernel, { width: 80, height: 24 }))
  await t.nav.open("@anna")
  // The spacer is gone and the detail gives way (a person's crumb has no ref); the name stays whole.
  let frame = await until(t, (f) => line(f, 0).includes("Anna Peeters ·") && line(f, 0).includes("inbox"))
  expect(line(frame, 0)).toBe(" ttybrain ·  3 People ▾  › Anna Peeters · Ar  ● 3 new in inbox  Thu 12 Nov 2026")
  t.renderer.resize(80, 24)
  await t.nav.open("#CRM")
  frame = await until(t, (f) => line(f, 0).includes("› CRM CRM replat…") && line(f, 0).includes("inbox"))
  expect(line(frame, 0)).toBe(" ttybrain ·  2 Projects ▾  › CRM CRM replat…  ● 3 new in inbox  Thu 12 Nov 2026")
  const spans = await t.spans()
  expect(fgAt(spans, "CRM CRM", 0)).toBe(theme.cyan)
  expect(fgAt(spans, "CRM replat…", 0)).toBe(theme.text)
})

test("status bar as designed", async () => {
  const t = await open()
  const frame = await t.frame()
  // The mock's `x done` is FEATURE A14, so it is left out; the 2026-11-20 home design draws no `q quit` (and its
  // `x done` / `t to talk` show only while the Upcoming meetings panel has rows).
  expect(line(frame, HEIGHT - 1).trim()).toBe("tab panel   enter open   i capture   g or 1-6 screens   ? help")
  const spans = await t.spans()
  const bar = HEIGHT - 1
  expect(fgAt(spans, "tab ", bar)).toBe(theme.accent)
  expect(fgAt(spans, "panel", bar)).toBe(theme.muted)
  expect(fgAt(spans, "enter", bar)).toBe(theme.accent)
  expect(fgAt(spans, "i capture", bar)).toBe(theme.accent)
  expect(fgAt(spans, "capture", bar)).toBe(theme.muted)
  expect(fgAt(spans, "g or", bar)).toBe(theme.accent)
  expect(fgAt(spans, "or 1-6", bar)).toBe(theme.muted)
  expect(fgAt(spans, "1-6", bar)).toBe(theme.accent)
  expect(fgAt(spans, "screens", bar)).toBe(theme.muted)
})

test("switcher drops down under the chip", async () => {
  const t = await open()
  t.input.pressKey("g")
  const frame = await until(t, (f) => f.includes("6  Inbox"))
  expect(line(frame, 0)).toContain("1 Attention ▴")
  // A 26-wide focused box on the line under the header, hanging under the chip: it starts 2 cells before the chip,
  // as the design's does (column 4 under `pm · `; `ttybrain · ` puts the chip at 12, so 10). No title.
  const chip = line(frame, 0).indexOf(" 1 Attention")
  expect(chip).toBe(12)
  const left = chip - 2
  const top = rows(frame)[1]!
  expect(top.slice(left, left + 26)).toBe(`╭${"─".repeat(24)}╮`)
  expect(frame).not.toContain("Screens")
  const list = rows(frame).slice(2, 8).map((l) => l.slice(left, left + 26))
  expect(list[0]).toMatch(/^│ 1  Attention\s+│$/)
  expect(list[1]).toMatch(/^│ 2  Projects\s+7 │$/)
  expect(list[5]).toMatch(/^│ 6  Inbox\s+3 │$/)
  expect(rows(frame)[8]!.slice(left, left + 26)).toBe(`╰${"─".repeat(24)}╯`)
  const spans = await t.spans()
  expect(fgAt(spans, `╭${"─".repeat(24)}╮`, 1)).toBe(theme.borderFocused)
  // The slot is muted, the title text, a count muted except the Inbox's (amber); the current screen is selected.
  expect(fgAt(spans, "2  Projects", 3)).toBe(theme.muted)
  expect(fgAt(spans, "Projects", 3)).toBe(theme.text)
  expect(fgAt(spans, "3 │", 7)).toBe(theme.amber)
  expect(bgAt(spans, "1  Attention", 2)).toBe(theme.selectedBg)
  expect(fgAt(spans, "1  Attention", 2)).toBe(theme.accent)
  // The switcher's bar.
  expect(line(frame, HEIGHT - 1).trim()).toBe("↑↓ move   1-6 jump   enter go   esc close")
  // The screen behind is dimmed, the header too; the status bar (the switcher's own keys) is not.
  expect(fgAt(spans, "Thu 12 Nov 2026", 0)).not.toBe(theme.muted)
  expect(fgAt(spans, "● 3 new in inbox", 0)).not.toBe(theme.amber)
  expect(fgAt(spans, "Due this week")).not.toBe(theme.muted)
  expect(fgAt(spans, "Prepare SteerCo deck input")).not.toBe(theme.text)
  expect(fgAt(spans, "↑↓", HEIGHT - 1)).toBe(theme.accent)
  expect(fgAt(spans, "move", HEIGHT - 1)).toBe(theme.muted)
  // Esc closes it: ▾ again, nothing dimmed.
  t.input.pressEscape()
  const after = await until(t, (f) => !f.includes("6  Inbox"))
  expect(line(after, 0)).toContain("1 Attention ▾")
  expect(fgAt(await t.spans(), "Prepare SteerCo deck input")).toBe(theme.text)
})

test("capture overlay centred at ~44% height, 76 wide, background dimmed", async () => {
  const t = await open()
  t.input.pressKey("i")
  const frame = await until(t, (f) => f.includes("Capture to inbox"))
  const all = rows(frame)
  const topRow = all.findIndex((l) => l.includes("Capture to inbox"))
  const top = all[topRow]!
  const left = top.search(/[┌╭]/)
  const right = Math.max(top.lastIndexOf("┐"), top.lastIndexOf("╮"))
  expect(right - left + 1).toBe(76)
  expect(left).toBe((WIDTH - 76) / 2)
  const bottomRow = all.findIndex((l, i) => i > topRow && /[└╰]/.test(l[left] ?? ""))
  expect(bottomRow).toBeGreaterThan(topRow)
  const middle = (topRow + bottomRow) / 2
  expect(Math.abs(middle - 0.44 * HEIGHT)).toBeLessThanOrEqual(1.5)
  const spans = await t.spans()
  expect(fgAt(spans, "Thu 12 Nov 2026", 0)).not.toBe(theme.muted)
  expect(fgAt(spans, "ttybrain", 0)).not.toBe(theme.accent)
})
