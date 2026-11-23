// A project's Meetings and Talk tabs, as the 2026-11-20 `project` design draws them: the series panel "CRM steering ·
// monthly, 4th Tue" (Next, With: stakeholders as `Peter J.` magenta, team members by first name; "To talk about · 3"
// and the list), "Past meetings" (muted dates and outcomes, a one-off's muted `one-off`), and on the right "Prep ·
// since 27 Oct" with `generated from data` on its border; the bar `←→ tabs   tab panel   t to talk   enter open   N
// series   n one-off   esc back`. Then its keys: t, N and n with the project filled in, Enter on the series (its next
// meeting, in progress, under the project's crumb) and on a past meeting. Seeded with the meeting designs' data
// (seedMeetings), today Fri 20 Nov 2026, 118×36 and 80×24.
// Differences from the mock, from the seed (ruling: CRM's talk-list keeps the seed's 3: its own 2 and Anna's
// CRM-tagged item, where the mock's 3rd row is "Marie's request"): CRM has no milestones, deliverables, risks or
// decisions (adding them would change the home design's panels), so the prep shows its sections empty; the 27 Oct
// steering logged one action; With lists the stakeholders by name (Marie D. before Peter J.). The tab row with Meetings
// and Talk is wider than 118 cells (in the mock too): it windows around the active tab.
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

const TALK = [3]
const PAST = [9, 25, 13]

async function crm(tab: "meetings" | "talk", width = 118, height = 36): Promise<{ t: RenderedTui; frame: string }> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20" })
  await seedMeetings(kernel)
  tui = await renderTui(kernel, { width, height })
  await tui.nav.open("#CRM", tab)
  const ready = (f: string) => (tab === "meetings" ? f.includes("Past meetings") && f.includes("Prep · since 27 Oct") && f.includes("Overdue actions") : f.includes("To talk about · 3 open"))
  await until(tui, ready)
  await tui.settle()
  return { t: tui, frame: await until(tui, ready) }
}

test("Project · Meetings as designed", async () => {
  const { t, frame } = await crm("meetings")
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}2 Projects ▾ {2}› CRM CRM replatforming +● 2 new in inbox {2}Fri 20 Nov 2026$/)
  expect(line(frame, 2)).toMatch(/People \d+ {3}Meetings {3}Talk 3 {3}Context/)
  expect(line(frame, 3)).toMatch(/^ ╭─ CRM steering · monthly, 4th Tue ─+╮ ╭─ Prep · since 27 Oct ─+╮$/)
  expect([4, 5, 6, 7, 8, 9, 10].map((i) => inside(frame, i, 0))).toEqual([
    "Next       Tue 24 Nov",
    "With       Marie D., Peter J., Anna, Bob",
    "",
    "To talk about · 3",
    cols(TALK, ["1.", "Shift design milestone by 2 weeks"]),
    cols(TALK, ["2.", "Release contingency budget"]),
    cols(TALK, ["3.", "Feedback from Marie on the design demo"]),
  ])
  expect(line(frame, 11)).toMatch(/^ ╰─+╯ │/)
  expect(line(frame, 12)).toMatch(/^ ╭─ Past meetings ─+╮ │/)
  expect([13, 14, 15].map((i) => inside(frame, i, 0))).toEqual([
    cols(PAST, ["27 Oct", "CRM steering", "1 act"]),
    cols(PAST, ["22 Sep", "CRM steering", "—"]),
    cols(PAST, ["14 Sep", "Kick-off one-off", "—"]),
  ])
  // The prep: the project's status since the last steering, generated (the board pack's compact form).
  expect(inside(frame, 4, 1)).toMatch(/^Health +● amber {2}Design slipping 2 weeks$/)
  expect(frame).toMatch(/!  A-1 Send revised budget to Peter +me · -6d/)
  // Both columns end on the same line.
  expect(line(frame, 16)).toMatch(/^ ╰─+╯ ╰─+ generated from data ─╯$/)
  expect(line(frame, 35)).toBe(" ←→ tabs   tab panel   t to talk   enter open   N series   n one-off   esc back")

  const spans = await t.spans()
  expect(fgAt(spans, "Meetings", 2)).toBe(theme.accent)
  expect(fgAt(spans, "CRM steering · monthly, 4th Tue", 3)).toBe(theme.accent)
  expect(fgAt(spans, "Prep · since 27 Oct", 3)).toBe(theme.muted)
  expect(fgAt(spans, "Next", 4)).toBe(theme.muted)
  expect(fgAt(spans, "Tue 24 Nov", 4)).toBe(theme.text)
  expect(fgAt(spans, "Marie D.", 5)).toBe(theme.magenta)
  expect(fgAt(spans, "Peter J.", 5)).toBe(theme.magenta)
  expect(fgAt(spans, "Anna", 5)).toBe(theme.text)
  expect(fgAt(spans, "To talk about · 3", 7)).toBe(theme.muted)
  expect(fgAt(spans, "1.", 8)).toBe(theme.muted)
  expect(isSelected(spans, "Shift design milestone by 2 weeks")).toBe(true)
  expect(fgAt(spans, "Past meetings", 12)).toBe(theme.muted)
  expect(fgAt(spans, "27 Oct", 13)).toBe(theme.muted)
  expect(fgAt(spans, "1 act", 13)).toBe(theme.muted)
  expect(fgAt(spans, "one-off", 15)).toBe(theme.muted)
  expect(fgAt(spans, "Kick-off", 15)).toBe(theme.text)
  expect(fgAt(spans, "generated from data", 16)).toBe(theme.muted)
})

test("Project · Talk: the same list on its own, Anna's CRM-tagged item from her", async () => {
  const { frame } = await crm("talk")
  expect(line(frame, 3)).toMatch(/^ ╭─ To talk about · 3 open ─+╮ ╭─ Meetings ─+╮$/)
  expect([4, 5, 6, 7].map((i) => inside(frame, i, 0))).toEqual([
    cols([3, 42, 7, 8], ["", "Item", "From", "Added"]),
    cols([3, 42, 7, 8], ["1.", "Shift design milestone by 2 weeks", "—", "Wed"]),
    cols([3, 42, 7, 8], ["2.", "Release contingency budget", "—", "Wed"]),
    cols([3, 42, 7, 8], ["3.", "Feedback from Marie on the design demo", "Anna", "Thu"]),
  ])
  expect([4, 5, 6].map((i) => inside(frame, i, 1))).toEqual(["Next      Tue 24 Nov · CRM steering", "Rhythm    monthly, 4th Tue", "Last      Tue 27 Oct"])
  expect(frame).toContain("Your actions for CRM · 1")
  expect(frame).toMatch(/╰─+ next: CRM steering Tue 24 Nov ─╯/)
})

test("Project · Meetings at 80×24: codes and names whole, panels keep their borders", async () => {
  const { frame } = await crm("meetings", 80, 24)
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}2 Projects ▾ {2}› CRM CRM replat/)
  expect(frame).toContain("CRM steering · monthly")
  // The names that fit whole, then how many more.
  expect(frame).toMatch(/With +Marie D\., \+3 /)
  expect(frame).toMatch(/27 Oct +CRM steering/)
  expect(frame).not.toMatch(/Mari…|Pete…|CR…/)
  expect(line(frame, 23)).toMatch(/^ ←→ tabs {3}tab panel {3}t to talk {3}enter open/)
})

test("Project · Meetings keys: t, N and n with the project filled in; Enter opens the next meeting under the project, Tab then Enter a past one", async () => {
  const { t } = await crm("meetings")
  t.input.pressKey("t")
  let frame = await until(t, (f) => f.includes("New talk item") && f.includes("CRM replatforming · project"))
  t.input.pressEscape()
  await until(t, (f) => !f.includes("New talk item"))
  t.input.pressKey("N")
  frame = await until(t, (f) => f.includes("New recurring meeting") && f.includes("CRM replatforming · project"))
  expect(frame).toMatch(/Kind +project \(1:1 · board\)/)
  t.input.pressEscape()
  await until(t, (f) => !f.includes("New recurring meeting"))
  t.input.pressKey("n")
  frame = await until(t, (f) => f.includes("New meeting") && f.includes("#CRM"))
  t.input.pressEscape()
  await until(t, (f) => !f.includes("New meeting"))

  t.input.pressEnter()
  frame = await until(t, (f) => f.includes("Talk · 0 of 3 discussed"))
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}2 Projects ▾ {2}› CRM CRM replatforming › CRM steering Tue 24 Nov +●/)
  t.input.pressEscape()
  await until(t, (f) => f.includes("Past meetings"))
  t.input.pressTab()
  await t.settle()
  expect(isSelected(await t.spans(), "27 Oct")).toBe(true)
  t.input.pressEnter()
  frame = await until(t, (f) => f.includes("Agreed actions · 1") && f.includes("Send revised budget to Peter"))
  expect(line(frame, 0)).toContain("› CRM CRM replatforming › CRM steering Tue 27 Oct")
  expect(frame).toContain("Send revised budget to Peter")
})
