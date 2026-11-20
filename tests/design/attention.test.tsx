// Screen 1, Attention, as the screen designs draw it (docs/superpowers/specs/2026-11-13-pm-screens.html,
// "Attention"): the design's six panels in paired grid rows (each pair starts on the same line and has the same
// height), fixed column widths, cyan project codes, magenta names, and the Inbox panel after them (R2). Seeded with
// the designs' example data, today Thu 12 Nov 2026, 118×36. Ids follow the seed (R5); "Due this week" lists the
// seed's three actions (the design's deliverable row is A12, a FEATURE).
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

// Waits (bounded) until `check` holds for the frame; returns the last frame.
async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 100 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

// A row of fixed-width cells, one cell apart (the Table's gap), as a panel draws it.
const cols = (widths: number[], texts: string[]) =>
  texts
    .map((s, i) => s.padEnd(widths[i]!))
    .join(" ")
    .trimEnd()
// The text inside the left or right panel on line `i` (between `│ ` and ` │`), without trailing spaces.
const inside = (frame: string, i: number, side: 0 | 1) => (line(frame, i).split("│")[1 + 2 * side] ?? "").slice(1).trimEnd()

// At 118 wide the left panel has 54 cells inside, the right one 53.
const ACTIONS_L = [5, 32, 7, 7]
const ACTIONS_R = [5, 31, 7, 7]
const PROJECTS = [2, 6, 31, 12]
const MILESTONES = [6, 37, 8]
const RISKS = [5, 6, 34, 6]
const STAKEHOLDERS = [17, 24, 10]

test("Attention as designed", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  tui = await renderTui(kernel, { width: 118, height: 36 })
  const frame = await until(tui, (f) => f.includes("Marie Dubois") && f.includes("Send revised budget to Peter") && f.includes("I-5"))

  // Row 1: Overdue actions and Due this week.
  expect(line(frame, 1)).toMatch(/^ ╭─ Overdue actions · 3 ─+╮ ╭─ Due this week · 3 ─+╮$/)
  expect([2, 3, 4].map((i) => inside(frame, i, 0))).toEqual([
    cols(ACTIONS_L, ["A-1", "Send revised budget to Peter", "CRM", "-3d"]),
    cols(ACTIONS_L, ["A-2", "Book vendor demo slot", "ERP", "-2d"]),
    cols(ACTIONS_L, ["A-3", "Review test strategy", "DWH", "-1d"]),
  ])
  expect([2, 3, 4].map((i) => inside(frame, i, 1))).toEqual([
    cols(ACTIONS_R, ["A-4", "Prepare SteerCo deck input", "CRM", "Fri"]),
    cols(ACTIONS_R, ["A-5", "Confirm licence count", "IAM", "Fri"]),
    cols(ACTIONS_R, ["A-7", "Send training plan options", "—", "Sun"]),
  ])
  expect(line(frame, 5)).toMatch(/^ ╰─+╯ ╰─+╯$/)

  // Row 2: Projects needing attention (no count, no on-hold BI2) and Late milestones with its sub-heading; the
  // pair starts on the same line and closes on the same line.
  expect(line(frame, 6)).toMatch(/^ ╭─ Projects needing attention ─+╮ ╭─ Late milestones · 2 ─+╮$/)
  expect([7, 8, 9, 10, 11].map((i) => inside(frame, i, 0))).toEqual([
    cols(PROJECTS, ["●", "ERP", "Vendor B contract not signed", "upd 9d ago"]),
    cols(PROJECTS, ["●", "CRM", "Design slipping 2 weeks, waiti…", "upd 2d ago"]),
    cols(PROJECTS, ["●", "HRP", "Key user availability", "upd 5d ago"]),
    cols(PROJECTS, ["○", "IAM", "Health not updated", "31d ago"]),
    "",
  ])
  expect([7, 8, 9, 10, 11].map((i) => inside(frame, i, 1))).toEqual([
    cols(MILESTONES, ["ERP", "Vendor selected", "-6d"]),
    cols(MILESTONES, ["DWH", "Test environment ready", "-1d"]),
    "",
    "Next 14 days",
    cols(MILESTONES, ["CRM", "Design approved", "26 Nov"]),
  ])
  expect(line(frame, 12)).toMatch(/^ ╰─+╯ ╰─+╯$/)

  // Row 3: High risks & issues and Stakeholders to contact (no count, high influence only, the footer row).
  expect(line(frame, 13)).toMatch(/^ ╭─ High risks & issues · 3 ─+╮ ╭─ Stakeholders to contact ─+╮$/)
  expect([14, 15, 16].map((i) => inside(frame, i, 0))).toEqual([
    cols(RISKS, ["R-1", "ERP", "Vendor B may miss go-live", "risk"]),
    cols(RISKS, ["R-4", "CRM", "Budget overrun ~12%", "issue"]),
    cols(RISKS, ["R-6", "DWH", "Source data quality", "risk"]),
  ])
  expect([14, 15, 16].map((i) => inside(frame, i, 1))).toEqual([
    cols(STAKEHOLDERS, ["Marie Dubois", "high/high · CRM, HRP", "41d"]),
    cols(STAKEHOLDERS, ["Luc Vermeulen", "high/low · ERP", "35d"]),
    "last contact over 30 days, high influence first",
  ])
  expect(line(frame, 17)).toMatch(/^ ╰─+╯ ╰─+╯$/)

  // The Inbox panel after the design's panels, on its own grid row.
  expect(line(frame, 18)).toMatch(/^ ╭─ Inbox · 3 ─+╮$/)
  expect(frame).not.toContain("BI2")
  expect(frame).not.toContain("Nadia")

  // The status bar of Task 2.
  expect(line(frame, 35)).toBe(" tab panel   enter open   i capture   g or 1-6 screens   ? help   q quit")

  const spans = await tui.spans()
  expect(isSelected(spans, "Send revised budget to Peter")).toBe(true)
  // Project codes cyan, ids muted, overdue red.
  for (const [code, at] of [["CRM", 2], ["ERP", 7], ["IAM", 10], ["DWH", 8], ["ERP", 14], ["CRM", 15]] as const) expect(fgAt(spans, code, at)).toBe(theme.cyan)
  expect(fgAt(spans, "CRM", "Design approved")).toBe(theme.cyan)
  expect(fgAt(spans, "A-1", 2)).toBe(theme.muted)
  expect(fgAt(spans, "-3d", 2)).toBe(theme.red)
  expect(fgAt(spans, "—", 4)).toBe(theme.muted)
  expect(fgAt(spans, "○", 10)).toBe(theme.muted)
  expect(fgAt(spans, "31d ago", 10)).toBe(theme.amber)
  expect(fgAt(spans, "-6d", 7)).toBe(theme.red)
  expect(fgAt(spans, "Next 14 days", 10)).toBe(theme.muted)
  // People names magenta, their levels muted, the age amber, the footer muted.
  expect(fgAt(spans, "Marie Dubois", 14)).toBe(theme.magenta)
  expect(fgAt(spans, "Luc Vermeulen", 15)).toBe(theme.magenta)
  expect(fgAt(spans, "high/high", 14)).toBe(theme.muted)
  expect(fgAt(spans, "41d", 14)).toBe(theme.amber)
  expect(fgAt(spans, "last contact over", 16)).toBe(theme.muted)
  // The focused panel's title is accent, the others muted.
  expect(fgAt(spans, "Overdue actions", 1)).toBe(theme.accent)
  expect(fgAt(spans, "Late milestones", 6)).toBe(theme.muted)
})
