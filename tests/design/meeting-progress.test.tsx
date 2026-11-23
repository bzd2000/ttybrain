// A 1:1 in progress, as the 2026-11-20 `oneonone` design draws it (ruling M11: the meeting's only view, no tab row):
// opened from Anna's Meetings tab on Mon 23 Nov 2026, the crumb `3 People ▾ › Anna Peeters › 1:1 Mon 23 Nov`; on the
// left "Talk · 2 of 5 discussed" (ticked items first, `✓` green, muted and struck through) and "Agreed actions · 2"
// (`new` in accent) with "Open from before"; on the right "Notes" with `e edit · E $EDITOR` on its border; the bar
// `space discussed   tab panel   e notes   a action   D decision   x close   esc back`. Space writes at once (M5); an
// action agreed through `a` (its links from agreeLinks) is on screen 4 at once; `x` closes with closeMeeting's
// message. Seeded with the meeting designs' data (seedMeetings), 118×36 and 80×24.
// Differences from the mock, from the seed: "Feedback from Marie on the design demo" (the talk design's wording; the
// mock shortens it here) and A-2 for the mock's A-31.
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { bgAt, fgAt, isSelected, line, seedMeetings, struckAt } from "../design"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"
import { theme } from "../../src/kernel/tui/theme"
import { runWithContext } from "../../src/kernel/context"
import type { Clock } from "../../src/kernel/clock"

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
const write = (plugin: string) => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)

const NOTES = [
  "AWS: she wants the Solutions Architect Associate in Q1. Budget fits if we skip the conference.",
  "",
  "Workload is OK now that the CRM design is in review. Asked her to flag it early if ERP starts pulling her in.",
  "",
  "Vendor B: _",
].join("\n")
const TALK = [3, 43, 6]
const ACTIONS = [5, 32, 8, 6]

// Mon 23 Nov 2026, its time a second later at every read: items ticked one after the other keep that order.
function ticking(): Clock {
  let n = 0
  const at = (s: number) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, "0")).join(":")
  return { today: () => "2026-11-23", now: () => `2026-11-23T${at(9 * 3600 + n++)}` }
}

// Anna's 1:1 of Mon 23 Nov (M-7), opened from her Meetings tab, with the mock's notes and one action agreed already.
async function inProgress(width = 118, height = 36): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, clock: ticking() })
  await seedMeetings(kernel)
  await inCtx(async () => {
    await write("meetings").setNotes!({ meeting: "M-7", markdown: NOTES })
    await write("actions").addAction!({ title: "Hand over DWH reviews to Mathias", owner: "anna", due: "2026-12-04", links: ["M-7", "@anna"] })
  })
  tui = await renderTui(kernel, { width, height })
  const t = tui
  await t.nav.open("@anna", "meetings")
  await until(t, (f) => f.includes("Past meetings"))
  await t.settle()
  t.input.pressEnter()
  await until(t, (f) => f.includes("Talk · 0 of 5 discussed"))
  await t.settle()
  return t
}

test("1:1 in progress as designed: tick two items, agree an action, the frame", async () => {
  const t = await inProgress()
  // Tick AWS, then Workload (the carried item, first until then), then select Vendor B as the mock does.
  t.input.pressArrow("down")
  t.input.pressKey(" ")
  await until(t, (f) => f.includes("Talk · 1 of 5 discussed"))
  await t.settle()
  t.input.pressArrow("down")
  t.input.pressKey(" ")
  await until(t, (f) => f.includes("Talk · 2 of 5 discussed"))
  await t.settle()
  t.input.pressArrow("down")
  // The design's bar (before a message takes it).
  expect(line(await t.frame(), 35)).toBe(" space discussed   tab panel   e notes   a action   D decision   x close   esc back")
  // Agree an action: the form starts with the meeting and Anna as its links.
  t.input.pressKey("a")
  let frame = await until(t, (f) => f.includes("@anna M-7"))
  await t.input.typeText("Approve AWS training")
  t.input.pressTab()
  await t.input.typeText("fri")
  t.input.pressKey("s", { ctrl: true })
  frame = await until(t, (f) => f.includes("Agreed actions · 2"))
  await t.settle()
  frame = await t.frame()

  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}3 People ▾ {2}› Anna Peeters › 1:1 Mon 23 Nov +● 2 new in inbox {2}Mon 23 Nov 2026$/)
  expect(line(frame, 1)).toMatch(/^ ╭─ Talk · 2 of 5 discussed ─+╮ ╭─ Notes ─+╮$/)
  expect([2, 3, 4, 5, 6].map((i) => inside(frame, i, 0))).toEqual([
    cols(TALK, ["✓", "AWS training budget for next year"]),
    cols(TALK, ["✓", "Workload: two projects at once"]),
    cols(TALK, ["○", "Her view on Vendor B's architecture", "ERP"]),
    cols(TALK, ["○", "Feedback from Marie on the design demo", "CRM"]),
    cols(TALK, ["○", "Holiday planning around go-live"]),
  ])
  expect(line(frame, 7)).toMatch(/^ ╰─+╯ │/)
  expect(line(frame, 8)).toMatch(/^ ╭─ Agreed actions · 2 ─+╮ │/)
  expect([9, 10, 11, 12].map((i) => inside(frame, i, 0))).toEqual([
    cols(ACTIONS, ["new", "Hand over DWH reviews to Mathias", "Anna", "4 Dec"]),
    cols(ACTIONS, ["new", "Approve AWS training", "me", "Fri"]),
    "Open from before",
    cols(ACTIONS, ["A-2", "Review her test strategy draft", "me", "-7d"]),
  ])
  // The notes, in paragraphs; both columns end on the same line.
  expect(inside(frame, 2, 1)).toBe("AWS: she wants the Solutions Architect Associate in")
  expect(frame).toContain("Vendor B: _")
  expect(line(frame, 13)).toMatch(/^ ╰─+╯ ╰─+ e edit · E \$EDITOR ─╯$/)
  expect(line(frame, 35)).toBe(" added A-9")

  const spans = await t.spans()
  expect(fgAt(spans, "Talk · 2 of 5 discussed", 1)).toBe(theme.accent)
  expect(fgAt(spans, "Notes", 1)).toBe(theme.muted)
  expect(fgAt(spans, "✓", 2)).toBe(theme.green)
  expect(fgAt(spans, "AWS training budget for next year", 2)).toBe(theme.muted)
  expect(struckAt(spans, "AWS training budget for next year", 2)).toBe(true)
  expect(struckAt(spans, "Her view on Vendor B's architecture", 4)).toBe(false)
  expect(fgAt(spans, "Her view on Vendor B's architecture", 4)).toBe(theme.text)
  expect(fgAt(spans, "ERP", 4)).toBe(theme.cyan)
  expect(isSelected(spans, "Her view on Vendor B's architecture")).toBe(true)
  expect(fgAt(spans, "new", 9)).toBe(theme.accent)
  expect(fgAt(spans, "me", 10)).toBe(theme.muted)
  expect(fgAt(spans, "Open from before", 11)).toBe(theme.muted)
  expect(fgAt(spans, "A-2", 12)).toBe(theme.muted)
  expect(fgAt(spans, "-7d", 12)).toBe(theme.red)
  expect(fgAt(spans, "e edit · E $EDITOR", 13)).toBe(theme.muted)
  expect(bgAt(spans, "Holiday planning", 6)).not.toBe(theme.selectedBg)

  // M5: written at once.
  const status = (ref: string) => kernel!.db.raw.prepare("SELECT status, meeting_id FROM meetings_talk_item WHERE id = ?").all([Number(ref.slice(2))])[0]
  expect(status("T-5")).toEqual({ status: "discussed", meeting_id: 7 }) // AWS
  expect(status("T-1")).toEqual({ status: "discussed", meeting_id: 7 }) // Workload
  // Space again reopens the selected item; once more ticks it again.
  t.input.pressArrow("up")
  t.input.pressKey(" ")
  await until(t, (f) => f.includes("Talk · 1 of 5 discussed"))
  expect(status("T-1")).toMatchObject({ status: "open" })

  // The agreed action is a real action at once: on screen 4, linked to Anna and the meeting.
  t.input.pressKey("4")
  frame = await until(t, (f) => f.includes("Approve AWS training"))
  expect(frame.split("\n").find((l) => l.includes("Approve AWS training"))).toMatch(/A-9 +Approve AWS training +me +@anna 1:1 Anna 23 Nov +Fri/)
})

test("closing the 1:1 (x): closeMeeting's message, notes on Anna, unticked items kept", async () => {
  const t = await inProgress()
  t.input.pressKey(" ")
  await until(t, (f) => f.includes("Talk · 1 of 5 discussed"))
  t.input.pressKey("x")
  await until(t, (f) => f.includes("Close M-7 as held?"))
  t.input.pressKey("y")
  const frame = await until(t, (f) => f.includes("1:1 Anna closed"))
  expect(line(frame, 35)).toContain("1:1 Anna closed · 1 discussed, 4 kept for next time · 1 action created · notes saved")
  const notes = kernel!.db.raw.prepare("SELECT kind, text FROM people_note WHERE kind = 'one_on_one'").all([]) as Array<{ text: string }>
  expect(notes.map((n) => n.text)).toEqual([NOTES])
})

test("1:1 in progress at 80×24: panels keep their borders, the bar shows whole hints", async () => {
  const t = await inProgress(80, 24)
  const frame = await t.frame()
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}3 People ▾ {2}› Anna Peeters › 1… {2}● 2 new in inbox {2}Mon 23 Nov 2026$/)
  expect(line(frame, 1)).toMatch(/^ ╭─ Talk · 0 of 5 discussed ─+╮ ╭─ Notes ─+╮$/)
  expect(frame).toMatch(/○ +Her view on Vendor B's.*ERP/)
  expect(line(frame, 23)).toMatch(/^ space discussed {3}tab panel {3}e notes {3}a action {3}D decision {3}x close/)
})
