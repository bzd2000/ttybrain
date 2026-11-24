// A person's Talk tab, as the 2026-11-20 `talk` design draws it (docs/superpowers/specs/2026-11-20-ttybrain-meeting-
// screens.html): the header crumb `3 People ▾ › Anna Peeters · Architect · team`, the tabs with Talk 4 and Meetings
// after Summary, "To talk about · 4 open" (1.4 : 1) with `next: 1:1 Mon 23 Nov` on its border, the carried item under
// "Carried over from 9 Nov", and on the right Meetings (Next, Rhythm, Last) and "Your actions for Anna · 2" with
// "Anna's actions · 1" (ruling M10: the design's "Her actions"). Seeded with the meeting designs' data (seedMeetings),
// today Fri 20 Nov 2026, 118×36 and 80×24. Then its keys: J/K, Del, n, e and Enter (the next meeting, under Anna's
// crumb).
// Differences from the mock, from the seed: the actions are A-2/A-4/A-7 (the mock's A-31/A-44/A-38), A-4 reads "Ask
// HR about the AWS training budget" (the home design's wording), Anna owns one action (the mock's count is 3 with
// one row), and Notes/Goals have no items. Gaps are one cell (the Table convention).
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { fgAt, isSelected, line, seedMeetings } from "../design"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"
import { theme } from "../../src/kernel/tui/theme"
import { runWithContext } from "../../src/kernel/context"

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
// The text inside the left or right panel on line `i`, without trailing spaces.
const inside = (frame: string, i: number, side: 0 | 1) => (line(frame, i).split("│")[1 + 2 * side] ?? "").slice(1).trimEnd()
const talkList = (about: string) =>
  runWithContext(kernel!.context(), async () => (await (kernel!.runtime("meetings")!.self().read as any).talkList({ about })) as { open: Array<{ ref: string; text: string }> })

// At 118 wide the talk panel has 63 cells inside: #, Item, Project, Added.
const TALK = [3, 42, 7, 8]
const ACTIONS = [5, 31, 6]

async function annaTalk(width = 118, height = 36): Promise<{ t: RenderedTui; frame: string }> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  tui = await renderTui(kernel, { width, height })
  await tui.nav.open("@anna", "talk")
  const ready = (f: string) => f.includes("To talk about · 4 open") && f.includes("Anna's actions") && f.includes("Talk 4")
  await until(tui, ready)
  await tui.settle()
  return { t: tui, frame: await until(tui, ready) }
}

test("Person · Talk as designed", async () => {
  const { t, frame } = await annaTalk()
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}3 People ▾ {2}› Anna Peeters · Architect · team +● 2 new in inbox {2}Fri 20 Nov 2026$/)
  expect(line(frame, 1).trim()).toBe("")
  expect(line(frame, 2)).toMatch(/^ {2}Summary {3}Talk 4 {3}Meetings {3}Notes/)
  expect(line(frame, 3)).toMatch(/^ ╭─ To talk about · 4 open ─+╮ ╭─ Meetings ─+╮$/)
  expect([4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => inside(frame, i, 0))).toEqual([
    cols(TALK, ["", "Item", "Project", "Added"]),
    cols(TALK, ["1.", "AWS training budget for next year", "—", "Tue"]),
    cols(TALK, ["2.", "Her view on Vendor B's architecture", "ERP", "Wed"]),
    cols(TALK, ["3.", "Feedback from Marie on the design demo", "CRM", "Thu"]),
    cols(TALK, ["4.", "Holiday planning around go-live", "—", "today"]),
    "",
    "Carried over from 9 Nov",
    cols(TALK, ["↻", "Workload: two projects at once", "—", "2 Nov"]),
    "",
  ])
  expect(line(frame, 13)).toMatch(/^ ╰─+ next: 1:1 Mon 23 Nov ─╯ ╰─+╯$/)
  expect([4, 5, 6].map((i) => inside(frame, i, 1))).toEqual(["Next      Mon 23 Nov · 1:1 Anna", "Rhythm    every 2 weeks, Monday", "Last      Mon 9 Nov · 3 discussed, 1 carried"])
  expect(line(frame, 7)).toMatch(/╰─+╯$/)
  expect(line(frame, 8)).toMatch(/╭─ Your actions for Anna · 2 ─+╮$/)
  expect([9, 10, 11, 12].map((i) => inside(frame, i, 1))).toEqual([
    cols(ACTIONS, ["A-2", "Review her test strategy draft", "-4d"]),
    cols(ACTIONS, ["A-4", "Ask HR about the AWS training …", "Mon"]),
    "Anna's actions · 1",
    cols(ACTIONS, ["A-7", "Solution design v1", "Fri"]),
  ])
  // Both columns end on the same line.
  expect(line(frame, 13)).toMatch(/╯ ╰─+╯$/)
  expect(line(frame, 14).trim()).toBe("")
  expect(line(frame, 35)).toBe(" ←→ tabs   n add   e edit   J/K reorder   del drop   enter next meeting   esc back")

  const spans = await t.spans()
  expect(isSelected(spans, "AWS training budget for next year")).toBe(true)
  expect(fgAt(spans, "Talk 4", 2)).toBe(theme.accent)
  expect(fgAt(spans, "To talk about · 4 open", 3)).toBe(theme.accent)
  expect(fgAt(spans, "Meetings", 3)).toBe(theme.muted)
  expect(fgAt(spans, "· Architect · team", 0)).toBe(theme.muted)
  expect(fgAt(spans, "Anna Peeters", 0)).toBe(theme.text)
  expect(fgAt(spans, "Item", 4)).toBe(theme.muted)
  expect(fgAt(spans, "2.", 6)).toBe(theme.muted)
  expect(fgAt(spans, "ERP", 6)).toBe(theme.cyan)
  expect(fgAt(spans, "CRM", 7)).toBe(theme.cyan)
  expect(fgAt(spans, "—", 5)).toBe(theme.muted)
  expect(fgAt(spans, "Wed", 6)).toBe(theme.muted)
  expect(fgAt(spans, "Carried over from 9 Nov", 10)).toBe(theme.muted)
  for (const s of ["↻", "Workload: two projects at once", "2 Nov"]) expect(fgAt(spans, s, 11)).toBe(theme.muted)
  expect(fgAt(spans, "next: 1:1 Mon 23 Nov", 13)).toBe(theme.muted)
  expect(fgAt(spans, "Next", 4)).toBe(theme.muted)
  expect(fgAt(spans, "Mon 23 Nov", 4)).toBe(theme.text)
  expect(fgAt(spans, " · 1:1 Anna", 4)).toBe(theme.muted)
  expect(fgAt(spans, " · 3 discussed, 1 carried", 6)).toBe(theme.muted)
  expect(fgAt(spans, "A-2", 9)).toBe(theme.muted)
  expect(fgAt(spans, "-4d", 9)).toBe(theme.red)
  expect(fgAt(spans, "Mon", 10)).toBe(theme.text)
  expect(fgAt(spans, "Anna's actions · 1", 11)).toBe(theme.muted)
})

test("Person · Talk at 80×24: codes and names whole, the bar whole hints only", async () => {
  const { frame } = await annaTalk(80, 24)
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}3 People ▾ {2}› Anna Peeters/)
  expect(frame).toContain("To talk about · 4 open")
  expect(frame).toMatch(/2\. +Her view on Vendor B's archi… ERP +│/) // Added gives way first
  expect(frame).not.toMatch(/ER…|CR…|Ann…/)
  for (const i of [3, 13]) expect(line(frame, i)).toMatch(/^ ╭|^ ╰/)
  expect(line(frame, 23)).toMatch(/^ ←→ tabs {3}n add {3}e edit {3}J\/K reorder/)
  expect(line(frame, 23)).not.toMatch(/ \S+$(?<!back|meeting|drop|reorder)/)
})

test("Talk keys: J/K reorder, Del drops after a confirmation, n adds for Anna, e edits, Enter opens the next 1:1 under her crumb", async () => {
  const { t } = await annaTalk()
  t.input.pressKey("J")
  let frame = await until(t, (f) => inside(f, 6, 0).includes("AWS training budget"))
  expect((await talkList("@anna")).open.map((i) => i.text).slice(0, 2)).toEqual(["Her view on Vendor B's architecture", "AWS training budget for next year"])
  t.input.pressKey("K")
  frame = await until(t, (f) => inside(f, 5, 0).includes("AWS training budget"))
  expect((await talkList("@anna")).open[0]!.text).toBe("AWS training budget for next year")

  t.input.pressArrow("down")
  t.input.pressArrow("down")
  t.input.pressArrow("down")
  await t.settle()
  t.input.pressKey("DELETE")
  frame = await until(t, (f) => f.includes('Drop "Holiday planning around go-live"?'))
  t.input.pressKey("y")
  frame = await until(t, (f) => f.includes("To talk about · 3 open"))
  expect((await talkList("@anna")).open.map((i) => i.text)).not.toContain("Holiday planning around go-live")

  t.input.pressKey("n")
  frame = await until(t, (f) => f.includes("New talk item") && f.includes("Anna Peeters · person"))
  await t.input.typeText("Conference budget")
  t.input.pressKey("s", { ctrl: true })
  frame = await until(t, (f) => f.includes("To talk about · 4 open") && f.includes("Conference budget"))
  expect((await talkList("@anna")).open.at(-1)!.text).toBe("Conference budget")

  t.input.pressKey("e")
  frame = await until(t, (f) => f.includes("Edit T-"))
  t.input.pressKey("s", { ctrl: true })
  await until(t, (f) => !f.includes("Edit T-"))

  t.input.pressEnter()
  frame = await until(t, (f) => f.includes("Talk · 0 of 5 discussed"))
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}3 People ▾ {2}› Anna Peeters › 1:1 Mon 23 Nov +● 2 new in inbox/)
  t.input.pressEscape()
  frame = await until(t, (f) => f.includes("To talk about · 4 open"))
  expect(line(frame, 0)).toContain("› Anna Peeters · Architect · team")
})

// M9: `t` on any tab of a person or project (the meetings plugin's record key) opens the talk form for it.
test("t on a person's Summary and a project's Overview opens the talk-item form with the subject filled in", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  const t = tui
  await t.nav.open("@anna")
  await until(t, (f) => f.includes("Summary") && f.includes("Architect"))
  await t.settle()
  t.input.pressKey("t")
  await until(t, (f) => f.includes("New talk item") && f.includes("Anna Peeters · person"))
  await t.input.typeText("Mentoring plan")
  t.input.pressKey("s", { ctrl: true })
  await until(t, (f) => !f.includes("New talk item"))
  expect((await talkList("@anna")).open.at(-1)!.text).toBe("Mentoring plan")
  await t.nav.open("#CRM")
  await until(t, (f) => f.includes("Overview") && f.includes("Health"))
  await t.settle()
  t.input.pressKey("t")
  const frame = await until(t, (f) => f.includes("New talk item") && f.includes("CRM replatforming · project"))
  expect(frame).toContain("CRM replatforming · project")
})
