// Screen 5, Meetings (the 2026-11-20 `meetings` design; its look is asserted in tests/design/meetings.test.tsx): the
// groups beyond the design's frame (This week, Not closed, No subject with its hint), long codes at 80×24, and the
// keys: s skips a date after a confirmation, m moves it, n opens the one-off form (About first), N the series form,
// Enter opens a meeting (Esc comes back to it) or what a series is about; closing on a meeting's Agenda tab says
// what closeMeeting did.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { theme } from "../../../kernel/tui/api"
import { builtinPlugins } from "../../../../tests/builtins"
import { fgAt, isSelected, seedMeetings } from "../../../../tests/design"
import { EMPTY, SERIES_EMPTY } from "./meetings-screen"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const write = (plugin = "meetings") => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const sql = (q: string) => kernel!.db.raw.prepare(q).all([]) as any[]

const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))
const statusLine = (frame: string) => lines(frame.trimEnd()).at(-1)!

async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 120 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}
const select = async (t: RenderedTui, title: string) => {
  for (let i = 0; i < 12 && !isSelected(await t.spans(), title); i++) {
    t.input.pressKey("j")
    await t.settle()
  }
  expect(isSelected(await t.spans(), title)).toBe(true)
}

// Today Fri 13 Nov 2026. M-1 1:1 Anna today (this week), M-2 CRM sync Mon 16 (next week), M-3 Data sync Tue 24 (the
// week after, about DATAPLATFORM2027), M-4 Old review Mon 2 Nov (past when added: never closes itself), M-5 Board
// October 20 Oct (held, its subject taken away as a meeting from before subjects), M-6 Far off 10 Dec (not shown),
// M-7 Missed close Thu 5 Nov (closes itself, but the upkeep that would have closed it on 8 Nov never ran).
async function small(width = 118, height = 36): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await inCtx(async () => {
    await write("people").addPerson!({ name: "Anna Peeters", handle: "anna", is_team: true })
    await write("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
    await write("projects").addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
    const w = write()
    await w.addMeeting!({ about: "@anna", title: "1:1 Anna", date: "2026-11-13" })
    await w.addMeeting!({ about: "#CRM", title: "CRM sync", date: "2026-11-16" })
    await w.addMeeting!({ about: "#DATAPLATFORM2027", title: "Data sync", date: "2026-11-24" })
    await w.addMeeting!({ about: "#CRM", title: "Old review", date: "2026-11-02" })
    await w.addMeeting!({ about: "#CRM", title: "Board October", date: "2026-10-20", kind: "board" })
    await w.closeMeeting!({ ref: "M-5" })
    await w.addMeeting!({ about: "#CRM", title: "Far off", date: "2026-12-10" })
    await w.addMeeting!({ about: "#CRM", title: "Missed close", date: "2026-11-05" })
  })
  kernel.db.raw.prepare("UPDATE meetings_meeting SET subject_type = NULL, subject_id = NULL WHERE id = 5").run([])
  // Today's upkeep ran before the first write above, so nothing closes M-7 before the screen shows it.
  kernel.db.raw.prepare("UPDATE meetings_meeting SET auto_close = 1 WHERE id = 7").run([])
  tui = await renderTui(kernel, { width, height })
  tui.input.pressKey("5")
  await until(tui, (f) => f.includes("No subject") && f.includes("Data sync"))
  await tui.settle()
  return tui
}

async function designed(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  tui.input.pressKey("5")
  await until(tui, (f) => f.includes("Held, closes itself") && f.split("BOARD").length > 2)
  await tui.settle()
  return tui
}

describe("Meetings screen", () => {
  test("this week, next week, the week after; then Not closed and No subject (with how to give one), later dates left out", async () => {
    const t = await small()
    const frame = await t.frame()
    const order = ["This week · 13–15 Nov", "1:1 Anna", "Next week · 16–20 Nov", "CRM sync", "Week after · 23–27 Nov", "Data sync", "Not closed · 2", "Old review", "Missed close", "No subject · 1", "Board October"]
    const at = order.map((s) => indexOf(frame, s))
    expect(at.every((i) => i > 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(frame).not.toContain("Far off")
    expect(frame).not.toContain("Held, closes itself")
    expect(lineWith(frame, "Missed close")).toMatch(/Thu 5 +Missed close +CRM +— +— /)
    expect(lineWith(frame, "Old review")).toMatch(/Mon 2 +Old review +CRM +— +— /)
    expect(lineWith(frame, "Board October")).toMatch(/Tue 20 +Board October +— +— +— /)
    expect(frame).toContain("give it one: ttybrain meeting subject M-5 <ref>")
    expect(lineWith(frame, "Data sync")).toContain(" DATAPLATFORM2027 ")
    const spans = await t.spans()
    expect(fgAt(spans, "Mon 2", "Old review")).toBe(theme.red)
    expect(fgAt(spans, "Not closed", "Not closed")).toBe(theme.muted)
    expect(fgAt(spans, "No subject", "No subject")).toBe(theme.muted)
    expect(fgAt(spans, "give it one")).toBe(theme.muted)
    expect(fgAt(spans, "This week", "This week")).toBe(theme.accent)
  })

  test("at 80×24 a 16-character code stays whole", async () => {
    const t = await small(80, 24)
    const frame = await t.frame()
    expect(lineWith(frame, "Data sync")).toMatch(/Data sync.* DATAPLATFORM2027 │/)
    expect(frame).not.toMatch(/DATAPLAT\w*…/)
  })

  test("s skips the selected date after a confirmation; another date stays", async () => {
    const t = await designed()
    await select(t, "1:1 Bob")
    t.input.pressKey("s")
    await until(t, (f) => f.includes("Skip 1:1 Bob on Wed 25 Nov?"))
    t.input.pressKey("n")
    await until(t, (f) => !f.includes("Skip 1:1 Bob"))
    expect(sql("SELECT status FROM meetings_meeting WHERE id = 15")).toEqual([{ status: "planned" }])
    t.input.pressKey("s")
    await until(t, (f) => f.includes("Skip 1:1 Bob on Wed 25 Nov?"))
    t.input.pressKey("y")
    const frame = await until(t, (f) => !f.includes("Wed 25"))
    expect(statusLine(frame)).toContain("skipped M-15")
    expect(sql("SELECT status, series_date FROM meetings_meeting WHERE id = 15")).toEqual([{ status: "cancelled", series_date: "2026-11-25" }])
    expect(frame).toContain("1:1 Anna")
  })

  test("m moves the selected meeting to another date; it keeps its series date", async () => {
    const t = await designed()
    t.input.pressKey("m")
    let frame = await until(t, (f) => f.includes("Move 1:1 Anna · Mon 23 Nov"))
    expect(lineWith(frame, "New date")).toContain("2026-11-23")
    for (let i = 0; i < 10; i++) t.input.pressBackspace()
    await t.input.typeText("2026-11-24")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => !f.includes("Move 1:1 Anna") && /Tue 24 +1:1 Anna/.test(f))
    expect(statusLine(frame)).toContain("moved M-7")
    expect(sql("SELECT date, series_date FROM meetings_meeting WHERE id = 7")).toEqual([{ date: "2026-11-24", series_date: "2026-11-23" }])
  })

  test("n opens the one-off meeting form with About first; N the series form; s and m do nothing on a held meeting", async () => {
    const t = await small()
    t.input.pressKey("n")
    let frame = await until(t, (f) => f.includes("New meeting"))
    const form = lines(frame).filter((l) => /About\*|Title\*|Kind/.test(l))
    expect(form[0]).toContain("› About*")
    expect(lineWith(frame, "Kind")).toMatch(/Kind +— \(1:1 · project · board\)/)
    t.input.pressEscape()
    await sleep(30)
    await until(t, (f) => !f.includes("New meeting"))
    t.input.pressKey("N")
    frame = await until(t, (f) => f.includes("New recurring meeting"))
    t.input.pressEscape()
    await sleep(30)
    await until(t, (f) => !f.includes("New recurring meeting"))
    await select(t, "Board October")
    t.input.pressKey("s")
    t.input.pressKey("m")
    await t.settle()
    frame = await t.frame()
    expect(frame).not.toContain("Skip Board October")
    expect(frame).not.toContain("Move Board October")
  })

  test("Enter opens the meeting and Esc comes back to the same row; Tab, then Enter on a series opens what it is about", async () => {
    const t = await designed()
    await select(t, "ERP vendor call")
    t.input.pressEnter()
    let frame = await until(t, (f) => f.includes("› M-24 ERP vendor call"))
    t.input.pressEscape()
    frame = await until(t, (f) => !f.includes("› M-24") && f.includes("Upcoming"))
    await t.settle()
    expect(isSelected(await t.spans(), "ERP vendor call")).toBe(true)
    t.input.pressTab()
    await t.settle()
    let spans = await t.spans()
    expect(fgAt(spans, "Series", 1)).toBe(theme.accent)
    expect(isSelected(spans, "1:1 Anna             Anna")).toBe(true)
    t.input.pressKey("j")
    await t.settle()
    spans = await t.spans()
    expect(isSelected(spans, "1:1 Bob")).toBe(true)
    t.input.pressEnter()
    frame = await until(t, (f) => f.includes("› Bob Willems"))
    expect(frame).toContain("› Bob Willems · Integration lead · team")
  })

  test("closing a meeting in progress says what closeMeeting did", async () => {
    const t = await designed()
    await t.nav.open("M-11") // Karim's 1:1 of Wed 18, with notes
    await until(t, (f) => f.includes("› M-11"))
    t.input.pressKey("x")
    await until(t, (f) => f.includes("Close M-11 as held?"))
    t.input.pressKey("y")
    const frame = await until(t, (f) => statusLine(f).includes("closed"))
    expect(statusLine(frame)).toContain("1:1 Karim closed · 2 kept for next time · notes saved")
  })

  test("empty: both panels say how to add one", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    tui = await renderTui(kernel, { width: 118, height: 36 })
    tui.input.pressKey("5")
    const frame = await until(tui, (f) => f.includes(SERIES_EMPTY))
    expect(frame).toContain(EMPTY)
    expect(frame).toContain(SERIES_EMPTY)
  })
})
