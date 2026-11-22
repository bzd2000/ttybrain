// The meeting record view's Prep tab, as the screen designs draw it
// (docs/superpowers/specs/2026-11-13-pm-screens.html, "Meeting prep"): the record crumb with its muted tail, a blank
// line, the tabs without counts, the Agenda panel (34 columns, unfocused, the selection still shown, muted numbers,
// cyan codes, the attendees inside it) beside the focused Prep panel (the health fact, muted sub-headings, rows in
// three columns with the designs' symbols, short dates, readable labels and first names, the ask under a muted
// `Ask for this meeting (your text)`, the footer on the border), and the status bar. Seeded with the designs'
// example data, today Thu 12 Nov 2026, 118×36. Data follows the seed (R5): M-2 rather than M-4, R-4 rather than R-9,
// A-1 rather than A-27; 4 Dec 2026 is a Friday (the mock says Thu); only the actions overdue today are listed (the
// controller's ruling on gap M12; the board pack's table keeps all due before the meeting); no done milestone (completed before the since: a logic question, gap M11) and no
// proposed date (FEATURE, gap M11); attendees are stakeholders first, then team, each in handle order.
import { afterEach, expect, test } from "bun:test"
import { runCli } from "../../src/kernel/cli/dispatch"
import { runWithContext } from "../../src/kernel/context"
import { theme } from "../../src/kernel/tui/theme"
import { builtinPlugins } from "../builtins"
import { bgAt, fgAt, line, seedDesign, selectedText } from "../design"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"

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
  for (let i = 0; i < 200 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

// The text inside panel `side` (0 left, 1 right) on line `i`, between `│ ` and `│`, without trailing spaces.
const inside = (frame: string, i: number, side: 0 | 1) => (line(frame, i).split("│")[1 + 2 * side] ?? "").slice(1).trimEnd()
const lines = (frame: string) => frame.split("\n")

async function openPrep(width: number, height: number): Promise<{ t: RenderedTui; frame: string }> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  tui = await renderTui(kernel, { width, height })
  await tui.settle()
  await tui.nav.open("M-2")
  await until(tui, (f) => f.includes("Agenda") && f.includes("Export"))
  tui.input.pressArrow("right")
  await until(tui, (f) => f.includes("Ask for this meeting"))
  tui.input.pressArrow("down")
  const frame = await until(tui, (f) => f.includes("Prep · CRM replatforming") && f.includes("Overdue actions") && f.includes("Design slipping") && f.includes("Approve 2-week"))
  return { t: tui, frame }
}

test("Meeting prep as designed", async () => {
  const { t, frame } = await openPrep(118, 36)
  const spans = await t.spans()

  // The record crumb with its muted tail, a blank line, the tabs without counts.
  expect(line(frame, 0)).toContain(" 5 Meetings ▾  › M-2 Steering committee Q4 · Fri 4 Dec · 8 attendees")
  expect(fgAt(spans, "M-2", 0)).toBe(theme.text)
  expect(fgAt(spans, "Steering committee Q4", 0)).toBe(theme.text)
  expect(fgAt(spans, " · Fri 4 Dec", 0)).toBe(theme.muted)
  expect(line(frame, 1)).toBe("")
  // The actions plugin adds its Actions tab after Export (2026-11-20: every meeting gets one).
  expect(line(frame, 2)).toBe("  Agenda   Prep   Notes   Export   Actions 1")
  expect(fgAt(spans, "Prep", 2)).toBe(theme.accent)
  expect(fgAt(spans, "Agenda", 2)).toBe(theme.muted)

  // The Agenda panel (34 columns, no count) beside the Prep panel.
  expect(line(frame, 4)).toMatch(/^ ╭─ Agenda ─+╮ ╭─ Prep · CRM replatforming ─+╮$/)
  expect(line(frame, 4).slice(1).split(" ╭")[0]!.length).toBe(34)
  // The Prep panel has focus; the Agenda panel does not, and keeps its selection.
  expect(fgAt(spans, "Agenda", 4)).toBe(theme.muted)
  expect(fgAt(spans, "╭─ Agenda", 4)).toBe(theme.border)
  expect(fgAt(spans, "Prep · CRM replatforming", 4)).toBe(theme.accent)
  expect(fgAt(spans, "╮ ╭─ Prep", 4)).toBe(theme.border)
  expect(fgAt(spans, "╭─ Prep", 4)).toBe(theme.borderFocused)
  expect(selectedText(spans).filter((l) => l.includes("CRM status"))).toEqual(["2.  CRM status             CRM"])

  // The agenda: numbered, muted numbers (the selected one in text colour), cyan codes; the attendees inside the
  // panel: a muted heading, stakeholders as `First L.` in magenta, the team as first names, `+n` muted.
  expect([5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => inside(frame, i, 0))).toEqual([
    "1.  Minutes & open actions",
    "2.  CRM status             CRM",
    "3.  ERP vendor decision    ERP",
    "4.  HR portal pilot go/no… HRP",
    "5.  AOB",
    "",
    "Attendees",
    "Luc V., Marie D., Peter J.,",
    "Tom M., Anna, Bob, Karim +1",
  ])
  expect(fgAt(spans, "1.", "Minutes & open actions")).toBe(theme.muted)
  expect(fgAt(spans, "2.", "CRM status")).toBe(theme.text)
  expect(bgAt(spans, "2.", "CRM status")).toBe(theme.selectedBg)
  expect(fgAt(spans, "CRM │", "CRM status")).toBe(theme.cyan)
  expect(fgAt(spans, "ERP", "ERP vendor decision    ERP")).toBe(theme.text) // the item text
  expect(fgAt(spans, "ERP │", "ERP vendor decision")).toBe(theme.cyan)
  expect(fgAt(spans, "HRP │", "HR portal")).toBe(theme.cyan)
  expect(fgAt(spans, "Attendees", 11)).toBe(theme.muted)
  expect(fgAt(spans, "Luc V.", 12)).toBe(theme.magenta)
  expect(fgAt(spans, "Peter J.", 12)).toBe(theme.magenta)
  expect(fgAt(spans, "Tom M.", 13)).toBe(theme.magenta)
  expect(fgAt(spans, "Anna", 13)).toBe(theme.text)
  expect(fgAt(spans, "+1", 13)).toBe(theme.muted)

  // The prep: the health fact, then the sections in three columns (icon, text, the right-hand column of 16).
  const p = (i: number) => inside(frame, i, 1)
  expect([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map(p)).toEqual([
    "Health          ● amber  Design slipping 2 weeks, waiting on integration spe…",
    "",
    "Milestones",
    "○  Design approved                                           26 Nov",
    "Deliverables",
    "◐  Solution design · Anna                                    in review",
    "◐  Integration specs · Bob                                   in progress",
    "○  Data migration plan · Bob                                 not started",
    "Risks & issues",
    "▲  R-4 Budget overrun ~12%                                   high · issue",
    "▲  R-11 Data migration volume unknown                        medium · risk",
    "Decisions since last meeting",
    "·  Phase 1 excludes marketing automation                     28 Oct",
    "Overdue actions",
    "!  A-1 Send revised budget to Peter                          me · -3d",
    "",
    "Ask for this meeting (your text)",
    "Approve 2-week shift of design milestone and release of contingency budget.",
    "",
  ])
  // The footer on the bottom border, right-aligned, muted.
  const bottom = lines(frame).findIndex((l, i) => i > 4 && l.includes("generated from data"))
  expect(line(frame, bottom)).toMatch(/─ generated from data · since SteerCo 28 Oct ─╯$/)
  expect(fgAt(spans, "generated from data", bottom)).toBe(theme.muted)

  // Colours: the fact label muted, the health word amber and its comment in text colour; sub-headings muted.
  expect(fgAt(spans, "Health", 5)).toBe(theme.muted)
  expect(fgAt(spans, "● amber", 5)).toBe(theme.amber)
  expect(fgAt(spans, "Design slipping", 5)).toBe(theme.text)
  for (const h of ["Milestones", "Deliverables", "Risks & issues", "Decisions since last meeting", "Overdue actions"]) expect(fgAt(spans, h, `│ ${h}`)).toBe(theme.muted)
  // Milestones: open, due before the meeting (amber).
  expect(fgAt(spans, "○", "Design approved")).toBe(theme.amber)
  expect(fgAt(spans, "Design approved", "Design approved")).toBe(theme.text)
  expect(fgAt(spans, "26 Nov", "Design approved")).toBe(theme.amber)
  // Deliverables: ◐ cyan, the status in text colour; not started muted.
  expect(fgAt(spans, "◐", "Solution design")).toBe(theme.cyan)
  expect(fgAt(spans, "in review", "Solution design")).toBe(theme.text)
  expect(fgAt(spans, "○", "Data migration plan")).toBe(theme.muted)
  expect(fgAt(spans, "not started", "Data migration plan")).toBe(theme.muted)
  // Risks: high red, medium amber.
  expect(fgAt(spans, "▲", "R-4 Budget")).toBe(theme.red)
  expect(fgAt(spans, "R-4 Budget", "R-4 Budget")).toBe(theme.text)
  expect(fgAt(spans, "high · issue", "R-4 Budget")).toBe(theme.red)
  expect(fgAt(spans, "▲", "R-11")).toBe(theme.amber)
  // Decisions: `·` and the date muted.
  expect(fgAt(spans, "·", "Phase 1 excludes")).toBe(theme.muted)
  expect(fgAt(spans, "28 Oct", "Phase 1 excludes")).toBe(theme.muted)
  // Actions: only those overdue today, red. A-4 (due Fri 13 Nov, before the meeting) is not overdue yet: not here,
  // though the board pack's table (Markdown and text) still lists it.
  expect(fgAt(spans, "!", "A-1 Send")).toBe(theme.red)
  expect(fgAt(spans, "A-1 Send", "A-1 Send")).toBe(theme.text)
  expect(fgAt(spans, "me · -3d", "A-1 Send")).toBe(theme.red)
  expect(frame).not.toContain("A-4 Prepare SteerCo deck input")
  const report = async (...format: string[]) => {
    let out = ""
    const code = await runCli(["report", "board", "M-2", ...format], kernel!, { out: (s) => void (out += s), err: () => {}, stdin: async () => "" })
    expect(code).toBe(0)
    return out
  }
  expect(await report()).toContain("| ! A-4 | Prepare SteerCo deck input | me | 2026-11-13 | overdue |")
  expect(await report("--format", "text")).toContain("Prepare SteerCo deck input")
  // The ask.
  expect(fgAt(spans, "Ask for this meeting", "(your text)")).toBe(theme.muted)
  expect(fgAt(spans, "(your text)", "(your text)")).toBe(theme.muted)
  expect(fgAt(spans, "Approve 2-week", "Approve 2-week")).toBe(theme.text)
  // No scrollbar: everything fits.
  expect(frame).not.toContain("█")

  // The status bar as designed, then the kept hints.
  expect(line(frame, 35)).toMatch(/^ ←→ tabs {3}↑↓ agenda item {3}J\/K reorder {3}e edit ask {3}a action {3}D decision {3}i capture {3}esc back {3}x close/)
}, 20_000)

test("J/K reorder the agenda on the Prep tab; the selection follows", async () => {
  const { t } = await openPrep(118, 36)
  t.input.pressKey("J")
  let frame = await until(t, (f) => inside(f, 7, 0).startsWith("3.  CRM status"))
  expect(selectedText(await t.spans()).filter((l) => l.includes("CRM status"))).toEqual(["3.  CRM status             CRM"])
  expect(frame).toContain("Prep · CRM replatforming")
  const items = async () =>
    runWithContext(kernel!.context(), async () => (await (kernel!.runtime("meetings")!.data as any).selectFrom("agenda_item").select(["position", "text"]).where("meeting_id", "=", 2).orderBy("position").execute()).map((r: any) => r.text))
  expect(await items()).toEqual(["Minutes & open actions", "ERP vendor decision", "CRM status", "HR portal pilot go/no-go", "AOB"])
  t.input.pressKey("K")
  frame = await until(t, (f) => inside(f, 6, 0).startsWith("2.  CRM status"))
  expect(await items()).toEqual(["Minutes & open actions", "CRM status", "ERP vendor decision", "HR portal pilot go/no-go", "AOB"])
}, 20_000)

test("an item without a project shows its empty prep, readable", async () => {
  const { t } = await openPrep(118, 36)
  t.input.pressArrow("up")
  const frame = await until(t, (f) => f.includes("No project on this item."))
  expect(line(frame, 4)).toMatch(/╭─ Prep · Minutes & open actions ─+╮$/)
  expect(inside(frame, 5, 1)).toBe("No project on this item.")
  expect(inside(frame, 6, 1)).toBe("")
  expect(inside(frame, 7, 1)).toBe("Ask for this meeting (your text)")
  expect(inside(frame, 8, 1)).toBe("—")
  expect(fgAt(await t.spans(), "No project on this item.", 5)).toBe(theme.muted)
  expect(frame).not.toContain("generated from data")
}, 20_000)

test("Meeting prep at 80×24: panels keep their borders, codes and names whole", async () => {
  const { t, frame } = await openPrep(80, 24)
  for (const l of lines(frame)) expect([...l].length).toBeLessThanOrEqual(80)
  // Both panels keep their top and bottom borders.
  expect(line(frame, 4)).toMatch(/^ ╭─ Agenda ─+╮ ╭─ Prep · CRM replatforming ─+╮$/)
  expect(line(frame, 22)).toMatch(/^ ╰─+╯ ╰─+ generated from data · since SteerCo 28 Oct ─╯$/)
  // The codes and the names whole.
  for (const code of ["CRM", "ERP", "HRP"]) expect(frame).toMatch(new RegExp(` ${code} │`))
  expect(inside(frame, 11, 0)).toBe("Attendees")
  for (const i of [12, 13]) expect(inside(frame, i, 0)).not.toContain("…")
  expect(frame).toContain("Luc V.,")
  // The prep rows clip inside the panel, the right-hand column whole.
  expect(inside(frame, 8, 1)).toMatch(/^○  Design approved +26 Nov$/)
  expect(frame).toMatch(/R-4 Budget overrun ~12% +high · issue +│/)
  // The status bar keeps its first hints.
  expect(line(frame, 23)).toMatch(/^ ←→ tabs {3}↑↓ agenda item {3}J\/K reorder {3}e edit ask/)
  // PgDn scrolls the prep to the actions.
  expect(frame).not.toContain("A-1 Send revised")
  t.input.pressKey("\u001b[6~")
  const scrolled = await until(t, (f) => f.includes("A-1 Send revised"))
  expect(scrolled).toContain("A-1 Send revised budget to Peter")
}, 20_000)
