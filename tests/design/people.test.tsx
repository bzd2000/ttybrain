// Screen 3, People, as the screen designs draw it (docs/superpowers/specs/2026-11-13-pm-screens.html, "People"):
// the `› All` crumb, the tabs under a blank line, accent group rows, magenta stakeholder names, cyan codes, muted
// `low`, `—` and low-influence contact days, amber stale high-influence contact, the sort footer on the bottom
// border, the right-hand panel of the selected person (Peter Janssens, as in the mock) and the status bar.
// Seeded with the designs' example data, today Thu 12 Nov 2026, 118×36. The data follows the seed (R5): 12 people
// (7 stakeholders, 5 team) rather than 31, no groups of people (E15, FEATURE), no `… n more` lines (R1), the
// follow-up is A-1 "Send revised budget to Peter", and a person's codes are in code order (Tom `DWH ERP`, where the
// mock writes `ERP DWH`). The Table's gap is 1 cell, as on the other screens; the right panel's lists use the mock's
// 2-cell gap.
import { rgbToHex } from "@opentui/core"
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

// The mock's columns (Name 16, Role 1fr, Projects 9, Infl. 5, Int. 5, Last 5); Role grows to 23 at 118.
const COLS = [16, 23, 9, 5, 5, 5]
const cols = (texts: string[], widths = COLS) =>
  texts
    .map((s, i) => s.padEnd(widths[i]!))
    .join(" ")
    .trimEnd()
// The text inside panel `n` (0 the list, 1 the detail) on line `i`, without trailing spaces.
const inside = (frame: string, i: number, n = 0) => (line(frame, i).split("│")[1 + 2 * n] ?? "").slice(1).trimEnd()

const STAKEHOLDERS = [
  ["Marie Dubois", "Head of Sales", "CRM HRP", "high", "high", "41d"],
  ["Luc Vermeulen", "Procurement lead", "ERP", "high", "low", "35d"],
  ["Ingrid Claes", "CIO", "IAM SEC", "high", "low", "12d"],
  ["Tom Maes", "COO", "DWH ERP", "high", "high", "9d"],
  ["Peter Janssens", "CFO, Finance", "CRM ERP", "high", "high", "2d"],
  ["Nadia El Amrani", "Legal counsel", "ERP", "low", "low", "60d"],
  ["Jan De Smet", "Sales manager", "CRM", "low", "high", "20d"],
]
const TEAM = [
  ["Anna Peeters", "Architect", "CRM DWH", "—", "—", "1d"],
  ["Bob Willems", "Integration lead", "CRM ERP", "—", "—", "3d"],
  ["Karim Haddad", "IAM engineer", "CRM IAM", "—", "—", "6d"],
  ["Mathias Wouters", "Developer", "DWH", "—", "—", "4d"],
  ["Sofie Lambert", "Business analyst", "CRM HRP", "—", "—", "1d"],
]

async function people(width: number, height: number): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  tui = await renderTui(kernel, { width, height })
  tui.input.pressKey("3")
  await until(tui, (f) => f.includes("Sofie Lambert") && (width < 110 || f.includes("Interactions")))
  return tui
}

test("People as designed", async () => {
  const t = await people(118, 36)
  // The mock selects Peter Janssens, the fifth stakeholder.
  for (let i = 0; i < 4; i++) t.input.pressArrow("down")
  const frame = await until(t, (f) => f.includes("Send revised budget to P…") && f.includes("Coffee, ERP vendor shortlist"))

  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}3 People ▾ {2}› All +● 3 new in inbox {2}Thu 12 Nov 2026$/)
  expect(line(frame, 1)).toBe("")
  expect(line(frame, 2)).toBe("  All 12   Stakeholders 7   Team 5")
  expect(line(frame, 3)).toMatch(/^ ╭─ People · 12 ─+╮ ╭─ Peter Janssens ─+╮$/)
  expect([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((i) => inside(frame, i))).toEqual([
    cols(["Name", "Role", "Projects", "Infl.", "Int.", "Last"]),
    "Stakeholders · 7",
    ...STAKEHOLDERS.map((r) => cols(r)),
    "Team · 5",
    ...TEAM.map((r) => cols(r)),
  ])
  // The right-hand panel: 10-cell labels and a 2-cell gap; follow-ups 5 / 1fr / 5, interactions 7 / 1fr.
  expect([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((i) => inside(frame, i, 1))).toEqual([
    "Role        CFO, Finance",
    "Projects    CRM sponsor · ERP steerco",
    "Influence   high · interest high",
    "Email       peter.janssens@example.com",
    "",
    "Open follow-ups",
    "A-1    Send revised budget to P…  -3d",
    "",
    "Interactions",
    "10 Nov   Worried about CRM budget",
    "28 Oct   SteerCo: agreed phase 1 scope",
    "15 Oct   Coffee, ERP vendor shortlist",
    "",
  ])
  // The follow-up's due sits in a 5-cell column at the panel's right edge.
  expect(line(frame, 10)).toMatch(/  -3d {3}│$/)
  // The footer on the bottom border; the status bar: the design's hints, then `? help` and the kept ones (R2).
  expect(line(frame, 34)).toMatch(/^ ╰─+ sort: influence, then last contact ─╯ ╰─+╯$/)
  expect(line(frame, 35)).toBe(" ↑↓ select   enter open   o sort   / filter   a all   n note   s stakeholders   t team   i capture   ? help   N new")

  const spans = await t.spans()
  expect(isSelected(spans, "Peter Janssens   CFO, Finance")).toBe(true)
  // The crumb is muted up to the tab's name; the active tab accent.
  expect(fgAt(spans, "›", 0)).toBe(theme.muted)
  expect(fgAt(spans, "All 12", 2)).toBe(theme.accent)
  // Group rows accent; column headers muted.
  expect(fgAt(spans, "Stakeholders · 7", 5)).toBe(theme.accent)
  expect(fgAt(spans, "Team · 5", 13)).toBe(theme.accent)
  for (const h of ["Name", "Role", "Projects", "Infl.", "Int.", "Last"]) expect(fgAt(spans, h, 4)).toBe(theme.muted)
  // Stakeholder names magenta, team names in the text colour; codes cyan.
  for (const [i, r] of STAKEHOLDERS.entries()) {
    expect(fgAt(spans, r[0]!, 6 + i)).toBe(theme.magenta)
    expect(fgAt(spans, r[2]!, 6 + i)).toBe(theme.cyan)
    expect(fgAt(spans, r[1]!, 6 + i)).toBe(theme.text)
  }
  for (const [i, r] of TEAM.entries()) {
    expect(fgAt(spans, r[0]!, 14 + i)).toBe(theme.text)
    expect(fgAt(spans, r[2]!, 14 + i)).toBe(theme.cyan)
    expect(fgAt(spans, "—", 14 + i)).toBe(theme.muted)
    expect(fgAt(spans, r[5]!, 14 + i)).toBe(theme.text)
  }
  // The colour of the cell at column `x` of line `i`.
  const fgCol = (i: number, x: number) => {
    let pos = 0
    for (const s of spans.lines[i]!.spans) {
      if (x < pos + s.text.length) return rgbToHex(s.fg)
      pos += s.text.length
    }
    return undefined
  }
  // Infl./Int.: `low` muted, `high` text. The list's text starts 3 cells in (screen padding, border, panel
  // padding); columns are 1 cell apart.
  const levelAt = (i: number, col: 3 | 4) => fgCol(i, 3 + COLS.slice(0, col).reduce((n, w) => n + w + 1, 0))
  expect([6, 7, 8, 9, 10, 11, 12].map((i) => [levelAt(i, 3), levelAt(i, 4)])).toEqual([
    [theme.text, theme.text],
    [theme.text, theme.muted],
    [theme.text, theme.muted],
    [theme.text, theme.text],
    [theme.text, theme.text],
    [theme.muted, theme.muted],
    [theme.muted, theme.text],
  ])
  // Last contact: amber when a high-influence stakeholder is stale, muted for low influence, else text.
  expect(fgAt(spans, "41d", 6)).toBe(theme.amber)
  expect(fgAt(spans, "35d", 7)).toBe(theme.amber)
  expect(fgAt(spans, "12d", 8)).toBe(theme.text)
  expect(fgAt(spans, "60d", 11)).toBe(theme.muted)
  expect(fgAt(spans, "20d", 12)).toBe(theme.muted)

  // The right panel: title muted (unfocused), labels muted, codes cyan, ` · interest` muted, sub-headings muted,
  // the follow-up's id muted and overdue due red, interaction dates muted. `right(i, text)`: the colour of the first
  // (or last) `text` inside the right panel on line `i`.
  const right = (i: number, text: string, last = false) => {
    const l = line(frame, i)
    const start = l.indexOf("│", l.indexOf("│", l.indexOf("│") + 1) + 1)
    const x = last ? l.lastIndexOf(text) : l.indexOf(text, start)
    return x < start ? undefined : fgCol(i, x)
  }
  expect(fgAt(spans, "Peter Janssens ", 3)).toBe(theme.muted)
  for (const [label, i] of [["Role", 4], ["Projects", 5], ["Influence", 6], ["Email", 7]] as const) expect(right(i, label)).toBe(theme.muted)
  expect(right(4, "CFO")).toBe(theme.text)
  expect([right(5, "CRM"), right(5, "sponsor"), right(5, "·"), right(5, "ERP"), right(5, "steerco")]).toEqual([theme.cyan, theme.text, theme.text, theme.cyan, theme.text])
  expect([right(6, "high"), right(6, "·"), right(6, "interest"), right(6, "high", true)]).toEqual([theme.text, theme.muted, theme.muted, theme.text])
  expect(right(9, "Open follow-ups")).toBe(theme.muted)
  expect(right(12, "Interactions")).toBe(theme.muted)
  expect(fgAt(spans, "A-1 ", /Send revised budget/)).toBe(theme.muted)
  expect(fgAt(spans, "-3d", /Send revised budget/)).toBe(theme.red)
  expect(fgAt(spans, "10 Nov", /Worried/)).toBe(theme.muted)
  expect(fgAt(spans, "Worried", /Worried/)).toBe(theme.text)
})

test("the crumb names the active tab; a person's record view has its tabs on row 2", async () => {
  const t = await people(118, 36)
  t.input.pressKey("s")
  let frame = await until(t, (f) => f.includes("› Stakeholders"))
  expect(line(frame, 0)).toMatch(/3 People ▾ {2}› Stakeholders /)
  t.input.pressKey("t")
  frame = await until(t, (f) => f.includes("› Team"))
  expect(line(frame, 0)).toMatch(/3 People ▾ {2}› Team /)
  t.input.pressEnter()
  frame = await until(t, (f) => f.includes("Summary"))
  expect(line(frame, 0)).not.toContain("› Team")
  expect(line(frame, 1)).toBe("")
  expect(line(frame, 2)).toMatch(/^ {2}Summary {3}Notes/)
})

// At 80×24 the detail panel is gone (it shows from 110 columns); names and codes stay whole.
test("People at 80x24 keeps names and codes whole", async () => {
  const t = await people(80, 24)
  const frame = await t.frame()
  expect(line(frame, 2)).toBe("  All 12   Stakeholders 7   Team 5")
  for (const r of [...STAKEHOLDERS, ...TEAM]) {
    expect(frame).toContain(`│ ${r[0]!.padEnd(16)} ${r[1]}`)
    expect(frame).toContain(` ${r[2]} `)
  }
  for (const l of frame.split("\n")) expect(l.length).toBeLessThanOrEqual(80)
})
