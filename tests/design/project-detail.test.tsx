// The project record view's first tab, Overview, as the screen designs draw it
// (docs/superpowers/specs/2026-11-13-pm-screens.html, "Project detail"): the record crumb, a blank line, the tabs
// with their totals, the Overview panel (facts with 14-cell labels, the muted health comment under the value, the
// muted description) beside the bordered Milestones, Deliverables, Open risks & issues and Recent decisions panels
// (all unfocused: moving focus between them is a FEATURE, gap D5), and the status bar. Seeded with the designs'
// example data, today Thu 12 Nov 2026, 118×36. Data follows the seed (R5): R-4/R-11, People 7, team in name order,
// three recent decisions (the mock draws one).
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { bgAt, fgAt, line, seedDesign, selectedText } from "../design"
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

// The text inside panel `side` (0 left, 1 right) on line `i`, between `│ ` and `│`, without trailing spaces.
const inside = (frame: string, i: number, side: 0 | 1) => (line(frame, i).split("│")[1 + 2 * side] ?? "").slice(1).trimEnd()

async function openCrm(width: number, height: number): Promise<{ t: RenderedTui; frame: string }> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  tui = await renderTui(kernel, { width, height })
  tui.input.pressKey("2")
  await until(tui, (f) => f.includes("CRM replatforming"))
  await tui.nav.open("#CRM")
  const frame = await until(tui, (f) => f.includes("Phase 1 excludes") && f.includes("Replace the legacy") && f.includes("Milestones 5") && f.includes("Solution outline approved"))
  return { t: tui, frame }
}

test("Project detail (Overview) as designed", async () => {
  const { t, frame } = await openCrm(118, 36)

  // The record crumb (Task 2's frame), a blank line, the tabs with their totals.
  expect(line(frame, 0)).toContain(" 2 Projects ▾  › CRM CRM replatforming")
  expect(line(frame, 1)).toBe("")
  expect(line(frame, 2)).toBe("  Overview   Milestones 5   Deliverables 6   Risks & issues 4   Decisions 7   Actions 9   People 7   Context")

  // The Overview panel beside the right-hand panels (1 : 1.25).
  expect(line(frame, 3)).toMatch(/^ ╭─ Overview ─+╮ ╭─ Milestones ─+╮$/)
  const [left, right] = line(frame, 3).slice(1).split(" ╭")
  expect(left!.length).toBe(51)
  expect(right!.length + 1).toBe(64)
  expect([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((i) => inside(frame, i, 0))).toEqual([
    "Health          ● amber · 10 Nov",
    "                Design slipping 2 weeks,",
    "                waiting on integration specs",
    "                from Sales Ops.",
    "",
    "Status          active",
    "Dates           1 Sep 2026 → 30 Jun 2027",
    "Effort          220 person-days (incl. vendor)",
    "Sponsor         Peter Janssens",
    "Team            Anna, Bob, Karim, Sofie",
    "",
    "Replace the legacy CRM with a SaaS platform for",
    "Sales and Customer Service. Phase 1 covers",
    "accounts, contacts and opportunities.",
  ])

  // The right-hand panels, stacked, unfocused, with the mock's columns.
  const r = (i: number) => inside(frame, i, 1)
  expect(r(4)).toMatch(/^✓  Solution outline approved +14 Oct$/)
  expect(r(5)).toMatch(/^○  Design approved +26 Nov$/)
  expect(r(6)).toMatch(/^○  Build complete +31 Mar$/)
  expect(line(frame, 7)).toMatch(/╰─+╯$/)
  expect(line(frame, 8)).toMatch(/╭─ Deliverables ─+╮$/)
  expect(r(9)).toMatch(/^Solution outline +Anna    delivered    10 Oct$/)
  expect(r(10)).toMatch(/^Solution design +Anna    in review    Fri$/)
  expect(r(11)).toMatch(/^Integration specs +Bob     in progress  20 Nov$/)
  expect(line(frame, 13)).toMatch(/╭─ Open risks & issues ─+╮$/)
  expect(r(14)).toMatch(/^R-4   Budget overrun ~12% +high   issue$/)
  expect(r(15)).toMatch(/^R-11  Data migration volume unknown +med    risk$/)
  expect(line(frame, 17)).toMatch(/╭─ Recent decisions ─+╮$/)
  expect(r(18)).toBe("28 Oct  Phase 1 excludes marketing automation")
  expect(r(19)).toBe("8 Oct   Implementation partner selected")
  expect(r(20)).toBe("1 Oct   Weekly design reviews with Sales Ops")
  // The left panel stretches to the right column's height.
  expect(line(frame, 21)).toMatch(/^ ╰─+╯ ╰─+╯$/)

  // The status bar: the design's hints that have keys (tab panel, n new and x done act on a focused panel: FEATURE).
  expect(line(frame, 35)).toBe(" ←→ tabs   e edit   h health   esc back   i capture")

  const spans = await t.spans()
  // The active tab: accent on the selected background; the others muted.
  expect(fgAt(spans, "Overview", 2)).toBe(theme.accent)
  expect(bgAt(spans, "Overview", 2)).toBe(theme.selectedBg)
  expect(fgAt(spans, "Milestones 5", 2)).toBe(theme.muted)
  // No panel is focused: muted titles, plain borders, no selected row.
  for (const [title, at] of [["Overview", 3], ["Milestones", 3], ["Deliverables", 8], ["Open risks & issues", 13], ["Recent decisions", 17]] as const)
    expect(fgAt(spans, title, at)).toBe(theme.muted)
  expect(fgAt(spans, "╭", 3)).toBe(theme.border)
  expect(selectedText(spans)).toEqual(["2 Projects ▾", "Overview"]) // the header chip, the active tab: no row
  // Facts: muted labels; health amber, its date and comment muted; the effort note muted; the sponsor magenta;
  // the description muted.
  for (const label of ["Health", "Status", "Dates", "Effort", "Sponsor", "Team"]) expect(fgAt(spans, label, new RegExp(`│ ${label} `))).toBe(theme.muted)
  expect(fgAt(spans, "● amber", 4)).toBe(theme.amber)
  expect(fgAt(spans, "· 10 Nov", 4)).toBe(theme.muted)
  expect(fgAt(spans, "Design slipping", 5)).toBe(theme.muted)
  expect(fgAt(spans, "active", 9)).toBe(theme.text)
  expect(fgAt(spans, "220 person-days", 11)).toBe(theme.text)
  expect(fgAt(spans, "(incl. vendor)", 11)).toBe(theme.muted)
  expect(fgAt(spans, "Peter Janssens", 12)).toBe(theme.magenta)
  expect(fgAt(spans, "Anna, Bob", 13)).toBe(theme.text)
  expect(fgAt(spans, "Replace the legacy", 15)).toBe(theme.muted)
  // Milestones: ✓ green, the done one's title and date muted; open dates in the text colour.
  expect(fgAt(spans, "✓", 4)).toBe(theme.green)
  expect(fgAt(spans, "Solution outline approved", 4)).toBe(theme.muted)
  expect(fgAt(spans, "14 Oct", 4)).toBe(theme.muted)
  expect(fgAt(spans, "Design approved", 5)).toBe(theme.text)
  expect(fgAt(spans, "26 Nov", 5)).toBe(theme.text)
  // Deliverables: owner as first name in the text colour, status coloured, a past date muted, this week's weekday plain.
  expect(fgAt(spans, "Anna", 9)).toBe(theme.text)
  expect(fgAt(spans, "delivered", 9)).toBe(theme.green)
  expect(fgAt(spans, "in review", 10)).toBe(theme.cyan)
  expect(fgAt(spans, "in progress", 11)).toBe(theme.amber)
  expect(fgAt(spans, "10 Oct", 9)).toBe(theme.muted)
  expect(fgAt(spans, "Fri", 10)).toBe(theme.text)
  expect(fgAt(spans, "20 Nov", 11)).toBe(theme.text)
  // Risks: ref muted, high red, med amber, type muted; decision dates muted.
  expect(fgAt(spans, "R-4", 14)).toBe(theme.muted)
  expect(fgAt(spans, "high", 14)).toBe(theme.red)
  expect(fgAt(spans, "med", 15)).toBe(theme.amber)
  expect(fgAt(spans, "issue", 14)).toBe(theme.muted)
  expect(fgAt(spans, "28 Oct", 18)).toBe(theme.muted)
  expect(fgAt(spans, "Phase 1 excludes", 18)).toBe(theme.text)
})

// The item tabs follow the shared colour rules (gap §4, other tabs): the tab's count is the panel's, refs muted, `✓`
// green, a done milestone shows its date (not `-29d`), owners magenta.
test("Milestones and Deliverables tabs: totals, muted refs, green ✓, done dates as dates, owners magenta", async () => {
  const { t } = await openCrm(118, 36)
  t.input.pressArrow("right")
  let frame = await until(t, (f) => f.includes("Go-live") && f.includes("Solution outline approved"))
  expect(line(frame, 3)).toMatch(/^ ╭─ Milestones · 5 ─+╮$/)
  const done = frame.split("\n").findIndex((l) => l.includes("Solution outline approved"))
  expect(line(frame, done)).toMatch(/MS-\d+ +✓ Solution outline approved +14 Oct/)
  let spans = await t.spans()
  expect(fgAt(spans, "MS-", done)).toBe(theme.muted)
  expect(fgAt(spans, "✓", done)).toBe(theme.green)
  expect(fgAt(spans, "14 Oct", done)).toBe(theme.muted)
  t.input.pressArrow("right")
  frame = await until(t, (f) => f.includes("Training material"))
  expect(line(frame, 3)).toMatch(/^ ╭─ Deliverables · 6 ─+╮$/)
  spans = await t.spans()
  expect(fgAt(spans, "@anna", "Solution design")).toBe(theme.magenta)
  expect(fgAt(spans, "D-", "Solution design")).toBe(theme.muted)
})

// At 80×24 nothing is wider than the terminal; the facts and the short lists' titles stay whole (the
// facts wrap, the Deliverables panel drops Owner).
test("Project detail at 80x24 keeps names whole", async () => {
  const { frame } = await openCrm(80, 24)
  for (const l of frame.split("\n")) expect(l.length).toBeLessThanOrEqual(80)
  // The header squeezes the crumb at 80 columns beside the inbox badge (Task 2's frame; reported).
  expect(line(frame, 0)).toContain("CRM")
  for (const name of ["Peter Janssens", "Solution outline approved", "Design approved", "Solution outline ", "Solution design", "Integration specs", "Budget overrun ~12%", "R-11"])
    expect(frame).toContain(name)
  expect(frame).not.toMatch(/Solution outli…|Integration spe…/)
  expect(line(frame, 23)).toBe(" ←→ tabs   e edit   h health   esc back   i capture")
})
