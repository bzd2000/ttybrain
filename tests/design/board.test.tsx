// A board meeting's Agenda tab, as the 2026-11-20 `board` design draws it: opened from the board BOARD's Meetings
// tab, the crumb `5 Meetings ▾ › BOARD Management board › Board Fri 27 Nov` (design §5.7: a board is no project; the
// mock's chip is `2 Projects`); the tabs Agenda · Prep · Notes · Export
// (+ the actions plugin's Actions, already accepted); "Agenda · 5" (1.3 : 1: # muted, Item, Project cyan, Ask, `—`
// muted for none) beside "Board talk-list · 2" (`·` muted, then `A adds one to the agenda`); the bar `←→ tabs   n
// agenda item   J/K reorder   A talk-list → agenda   e edit ask   esc back`. `A` takes a talk item onto the agenda
// and ticks it discussed in this meeting (ruling M8). A 1:1 has none of these tabs, nor the Actions tab (M11).
// Seeded with the meeting designs' data (seedMeetings), today Fri 20 Nov 2026, 118×36 and 80×24.
// Differences from the mock: row 1's empty ask shows `—` as row 5's does (the mock draws one blank, one `—`); the
// mock has no Actions tab.
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { fgAt, isSelected, line, seedMeetings } from "../design"
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
  for (let i = 0; i < 150 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}
const cols = (widths: number[], texts: string[]) =>
  texts
    .map((s, i) => s.padEnd(widths[i]!))
    .join(" ")
    .trimEnd()
const inside = (frame: string, i: number, side: 0 | 1) => (line(frame, i).split("│")[1 + 2 * side] ?? "").slice(1).trimEnd()
const AGENDA = [3, 24, 7]

async function board(width = 118, height = 36): Promise<{ t: RenderedTui; frame: string }> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  tui = await renderTui(kernel, { width, height })
  await tui.nav.open("#BOARD", "meetings")
  await until(tui, (f) => f.includes("Past meetings"))
  await tui.settle()
  tui.input.pressEnter()
  const ready = (f: string) => f.includes("Board talk-list · 2") && f.includes("Budget 2027 first view")
  await until(tui, ready)
  await tui.settle()
  return { t: tui, frame: await until(tui, ready) }
}

test("Board meeting as designed", async () => {
  const { t, frame } = await board()
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}5 Meetings ▾ {2}› BOARD Management board › Board Fri 27 Nov +● 2 new in inbox {2}Fri 20 Nov 2026$/)
  expect(line(frame, 1).trim()).toBe("")
  expect(line(frame, 2)).toBe("  Agenda   Prep   Notes   Export   Actions 1")
  expect(line(frame, 3)).toMatch(/^ ╭─ Agenda · 5 ─+╮ ╭─ Board talk-list · 2 ─+╮$/)
  const agenda = [4, 5, 6, 7, 8, 9].map((i) => inside(frame, i, 0))
  expect(agenda.map((l) => l.slice(0, 36).trimEnd())).toEqual([
    cols(AGENDA, ["", "Item", "Project"]),
    cols(AGENDA, ["1.", "Minutes & open actions", ""]),
    cols(AGENDA, ["2.", "CRM status", "CRM"]),
    cols(AGENDA, ["3.", "ERP vendor decision", "ERP"]),
    cols(AGENDA, ["4.", "HR portal pilot go/no-go", "HRP"]),
    cols(AGENDA, ["5.", "Budget 2027 first view", ""]),
  ])
  expect(agenda.map((l) => l.slice(37))).toEqual(["Ask", "—", "approve 2-week shift", "choose vendor B", "go for pilot", "—"])
  expect([4, 5, 6, 7].map((i) => inside(frame, i, 1))).toEqual(["·   Hiring freeze impact on IAM wave 2", "·   Security awareness: board sponsor?", "", "A adds one to the agenda"])
  // Both panels end on the same line.
  expect(line(frame, 10)).toMatch(/^ ╰─+╯ ╰─+╯$/)
  expect(line(frame, 11).trim()).toBe("")
  expect(line(frame, 35)).toBe(" ←→ tabs   n agenda item   J/K reorder   A talk-list → agenda   e edit ask   esc back")

  const spans = await t.spans()
  expect(fgAt(spans, "Agenda", 2)).toBe(theme.accent)
  expect(fgAt(spans, "Agenda · 5", 3)).toBe(theme.accent)
  expect(fgAt(spans, "Board talk-list · 2", 3)).toBe(theme.muted)
  expect(fgAt(spans, "BOARD", 0)).toBe(theme.cyan)
  expect(fgAt(spans, "Item", 4)).toBe(theme.muted)
  expect(fgAt(spans, "1.", 5)).toBe(theme.muted)
  expect(fgAt(spans, "CRM     approve", 6)).toBe(theme.cyan)
  expect(fgAt(spans, "—", 5)).toBe(theme.muted)
  expect(fgAt(spans, "·", 4)).toBe(theme.muted)
  expect(fgAt(spans, "A", 7)).toBe(theme.accent)
  expect(fgAt(spans, " adds one to the agenda", 7)).toBe(theme.muted)
  expect(isSelected(spans, "Minutes & open actions")).toBe(true)
})

test("A takes a talk item onto the agenda and ticks it discussed in this meeting (M8); Tab picks another", async () => {
  const { t } = await board()
  t.input.pressKey("A")
  let frame = await until(t, (f) => f.includes("Agenda · 6") && f.includes("Board talk-list · 1"))
  expect(inside(frame, 10, 0)).toMatch(/^6\. +Hiring freeze impact on/)
  const item = (id: number) => kernel!.db.raw.prepare("SELECT status, meeting_id FROM meetings_talk_item WHERE id = ?").all([id])[0]
  const m = (kernel!.db.raw.prepare("SELECT id FROM meetings_meeting WHERE title = 'Board' AND date = '2026-11-27'").all([])[0] as { id: number }).id
  const ids = kernel!.db.raw.prepare("SELECT id, text FROM meetings_talk_item WHERE text LIKE 'Hiring%' OR text LIKE 'Security%' ORDER BY id").all([]) as Array<{ id: number }>
  expect(item(ids[0]!.id)).toEqual({ status: "discussed", meeting_id: m })
  t.input.pressTab()
  await t.settle()
  t.input.pressKey("A")
  frame = await until(t, (f) => f.includes("Agenda · 7") && f.includes("Board talk-list · 0"))
  expect(item(ids[1]!.id)).toEqual({ status: "discussed", meeting_id: m })
})

test("Board meeting at 80×24: codes whole, panels keep their borders, whole hints", async () => {
  const { frame } = await board(80, 24)
  // The parent's name gives way first, then the meeting's text; the code stays whole.
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}5 Meetings ▾ {2}› BOARD › Board… +● 2 new in inbox/)
  expect(frame).toMatch(/2\. +CRM status +CRM /)
  expect(frame).toMatch(/4\. +HR portal pilot go\/no-go +HRP/)
  expect(frame).not.toMatch(/CR…|HR…|ER…/)
  expect(line(frame, 3)).toMatch(/^ ╭─ Agenda · 5 ─+╮ ╭─ Board talk-list · 2 ─+╮$/)
  expect(line(frame, 23)).toMatch(/^ ←→ tabs {3}n agenda item {3}J\/K reorder {3}A talk-list → agenda/)
})

test("a 1:1 has no tab row and no Actions tab (M11)", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  await tui.nav.open("M-7")
  const frame = await until(tui, (f) => f.includes("Talk · 0 of 5 discussed"))
  expect(line(frame, 1)).toMatch(/^ ╭─ Talk · 0 of 5 discussed ─+╮ ╭─ Notes ─+╮$/)
  expect(frame).not.toMatch(/Agenda|Export|Actions \d/)
})
