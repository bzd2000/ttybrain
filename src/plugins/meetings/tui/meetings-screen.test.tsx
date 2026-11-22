// The Meetings screen (slot 5): the Upcoming and Past groups, the past-dated planned meeting in red, and the keys
// that add, edit, close and cancel meetings, against the built-in plugins seeded through write ops.
import { rgbToHex, type CapturedFrame } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { theme } from "../../../kernel/tui/api"
import { builtinPlugins } from "../../../../tests/builtins"
import { isSelected } from "../../../../tests/design"

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
const store = () => (kernel!.runtime("meetings")!.data as any)
const meetingRows = () => inCtx(async () => (await store().selectFrom("meeting").select(["id", "title", "date", "kind", "status"]).orderBy("id").execute()) as any[])

const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))
const statusLine = (frame: string) => lines(frame.trimEnd()).at(-1)!
const spansOf = async (t: RenderedTui, s: string) => (await t.spans()).lines.find((l) => l.spans.map((x) => x.text).join("").includes(s))!.spans

// Waits for `ok` on the frame and its spans (the selection is a row background: isSelected(spans, text)).
async function until(t: RenderedTui, ok: (f: string, spans: CapturedFrame) => boolean): Promise<string> {
  let frame = await t.frame()
  let spans = await t.spans()
  for (let i = 0; i < 80 && !ok(frame, spans); i++) {
    await sleep(25)
    frame = await t.frame()
    spans = await t.spans()
  }
  return frame
}

// Today is Fri 13 Nov 2026. Planned: M-1 SteerCo Q4 (20 Nov, @marie @luc, #CRM), M-2 Board December (4 Dec),
// M-3 Ops sync (10 Nov: before today). Past: M-4 SteerCo Q3 (15 Sep, held), M-5 Vendor review (1 Oct, cancelled),
// M-6 Board October (20 Oct, held).
async function seed() {
  await inCtx(async () => {
    const p = write("people")
    await p.addPerson!({ name: "Marie Dubois", handle: "marie", is_stakeholder: true })
    await p.addPerson!({ name: "Luc Peeters", handle: "luc", is_stakeholder: true })
    await p.addPerson!({ name: "Tom Claes", handle: "tom", is_team: true })
    await write("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
    await write("projects").addProject!({ code: "ERP", name: "ERP upgrade" })
    const w = write()
    await w.addMeeting!({ about: "#CRM", title: "SteerCo Q4", date: "2026-11-20", kind: "steering", attendees: ["marie", "luc"], projects: ["CRM"] })
    await w.addMeeting!({ about: "#CRM", title: "Board December", date: "2026-12-04", kind: "board" })
    await w.addMeeting!({ about: "#CRM", title: "Ops sync", date: "2026-11-10", kind: "other" })
    await w.addMeeting!({ about: "#CRM", title: "SteerCo Q3", date: "2026-09-15", kind: "steering", projects: ["CRM", "ERP"] })
    await w.addMeeting!({ about: "#CRM", title: "Vendor review", date: "2026-10-01", kind: "other" })
    await w.addMeeting!({ about: "#CRM", title: "Board October", date: "2026-10-20", kind: "board" })
    await w.closeMeeting!({ ref: "M-4" })
    await w.cancelMeeting!({ ref: "M-5" })
    await w.closeMeeting!({ ref: "M-6" })
  })
}

async function open(opts: { seed?: boolean } = {}): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  if (opts.seed !== false) await seed()
  tui = await renderTui(kernel, { width: 120, height: 30 })
  tui.input.pressKey("5")
  await until(tui, (f) => f.includes("Meetings ·") || f.includes("No meetings yet"))
  return tui
}

// Spies on the meetings write ops the screen calls: their names and inputs.
function spy(): Array<{ name: string; input: unknown }> {
  const ops = kernel!.ops as any
  const call = ops.call.bind(ops)
  const calls: Array<{ name: string; input: unknown }> = []
  ops.call = (plugin: string, name: string, kind: string, input: unknown) => {
    if (plugin === "meetings" && kind === "write") calls.push({ name, input })
    return call(plugin, name, kind, input)
  }
  return calls
}

const select = async (t: RenderedTui, title: string) => {
  for (let i = 0; i < 10 && !isSelected(await t.spans(), title); i++) t.input.pressKey("j")
  expect(isSelected(await t.spans(), title)).toBe(true)
}

describe("Meetings screen", () => {
  test("opens on 5 with upcoming then past, cancelled muted", async () => {
    const t = await open()
    const frame = await t.frame()
    expect(lines(frame)[0]).toContain("ttybrain ·  5 Meetings")
    const upcoming = indexOf(frame, "Upcoming · 3")
    const past = indexOf(frame, "Past · 3")
    expect(upcoming).toBeGreaterThan(0)
    expect(past).toBeGreaterThan(upcoming)
    const at = ["Ops sync", "SteerCo Q4", "Board December", "Board October", "Vendor review", "SteerCo Q3"].map((s) => indexOf(frame, s))
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(at[2]!).toBeLessThan(past)
    expect(at[3]!).toBeGreaterThan(past)
    expect(lineWith(frame, "SteerCo Q4")).toMatch(/M-1\s+Fri 20 Nov\s+SteerCo Q4\s+project\s+planned\s+2\s+CRM/)
    expect(lineWith(frame, "SteerCo Q3")).toMatch(/M-4\s+Tue 15 Sep\s+SteerCo Q3\s+project\s+held\s+0\s+CRM ERP/)
    expect(lineWith(frame, "Vendor review")).toMatch(/M-5\s+Thu 1 Oct\s+Vendor review\s+project\s+cancelled/)
    const cancelled = (await spansOf(t, "Vendor review")).filter((s) => ["M-5", "Thu 1 Oct", "Vendor review", "cancelled"].some((x) => s.text.includes(x)))
    expect(cancelled.length).toBeGreaterThan(0)
    for (const s of cancelled) expect(rgbToHex(s.fg).toLowerCase()).toBe(theme.muted)
    const held = (await spansOf(t, "Board October")).find((s) => s.text.includes("Board October"))!
    expect(rgbToHex(held.fg).toLowerCase()).toBe(theme.text)
    expect(statusLine(frame)).toContain("enter open   n new   e edit   x close   del cancel")
  })

  test("a planned meeting in the past shows its date red", async () => {
    const t = await open()
    const past = (await spansOf(t, "Ops sync")).find((s) => s.text.includes("Tue 10 Nov"))!
    expect(rgbToHex(past.fg).toLowerCase()).toBe(theme.red)
    const ahead = (await spansOf(t, "SteerCo Q4")).find((s) => s.text.includes("Fri 20 Nov"))!
    expect(rgbToHex(ahead.fg).toLowerCase()).toBe(theme.text)
  })

  test("n adds a meeting with attendees and projects; the agenda is created", async () => {
    const t = await open()
    t.input.pressKey("n")
    let frame = await until(t, (f) => f.includes("New meeting"))
    expect(lineWith(frame, "Date*")).toContain("2026-11-13")
    expect(lineWith(frame, "Kind ")).not.toContain("project") // empty: it follows from About
    expect(lineWith(frame, "About*")).toBeTruthy()
    await t.input.typeText("SteerCo Q1")
    t.input.pressTab() // date: today
    t.input.pressTab() // kind: from About
    t.input.pressTab() // since
    t.input.pressTab() // attendees
    await t.input.typeText("@marie, luc")
    t.input.pressTab() // projects
    await t.input.typeText("#CRM,ERP")
    t.input.pressTab() // about
    await t.input.typeText("#CRM")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f, s) => !f.includes("New meeting") && isSelected(s, "SteerCo Q1"))
    expect(lineWith(frame, "SteerCo Q1")).toMatch(/M-7\s+Fri 13 Nov\s+SteerCo Q1\s+project\s+planned\s+2\s+CRM ERP/)
    expect(frame).toContain("Upcoming · 4")
    expect(statusLine(frame)).toContain("added M-7")
    const m = await inCtx(async () => {
      const agenda = await store().selectFrom("agenda_item").select(["position", "text"]).where("meeting_id", "=", 7).orderBy("position").execute()
      const attendees = await store().selectFrom("attendee").select("person_id").where("meeting_id", "=", 7).orderBy("person_id").execute()
      return { agenda, attendees: attendees.map((a: any) => Number(a.person_id)) }
    })
    expect(m.agenda).toEqual([
      { position: 1, text: "CRM replatforming status" },
      { position: 2, text: "ERP upgrade status" },
    ])
    expect(m.attendees).toEqual([1, 2]) // marie, luc
    expect((await meetingRows()).at(-1)).toEqual({ id: 7, title: "SteerCo Q1", date: "2026-11-13", kind: "project", status: "planned" })
  })

  test("edit changes attendees through setAttendees", async () => {
    const t = await open()
    const calls = spy()
    await select(t, "SteerCo Q4")
    t.input.pressKey("e")
    let frame = await until(t, (f) => f.includes("Edit M-1"))
    expect(lineWith(frame, "Attendees")).toContain("@luc @marie")
    expect(lines(frame).filter((l) => l.includes("Projects")).length).toBe(1) // the column title: no projects field
    for (let i = 0; i < 4; i++) t.input.pressTab() // title → attendees
    await t.input.typeText(" @tom")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f, s) => !f.includes("Edit M-1") && isSelected(s, "SteerCo Q4"))
    expect(lineWith(frame, "SteerCo Q4")).toMatch(/planned\s+3\s+CRM/)
    expect(statusLine(frame)).toContain("saved M-1")
    expect(calls).toEqual([{ name: "setAttendees", input: { meeting: "M-1", people: ["luc", "marie", "tom"] } }])
  })

  test("x closes after confirm and says what was logged", async () => {
    const t = await open()
    await inCtx(async () => {
      const p = write("projects")
      for (const title of ["Send the minutes", "Book the room", "Draft the budget"]) await write("actions").addAction!({ title, meeting: "M-1" })
      await p.addDecision!({ title: "Go with B", meeting: "M-1" })
    })
    await select(t, "SteerCo Q4")
    t.input.pressKey("x")
    let frame = await until(t, (f) => f.includes("Close M-1 as held?"))
    t.input.pressKey("y")
    frame = await until(t, (f) => f.includes("Past · 4"))
    expect(statusLine(frame)).toContain("closed M-1: 3 actions, 1 decision")
    expect(frame).toContain("Upcoming · 2")
    expect(indexOf(frame, "SteerCo Q4")).toBeGreaterThan(indexOf(frame, "Past · 4"))
    expect(lineWith(frame, "SteerCo Q4")).toContain("held")
    expect((await meetingRows())[0].status).toBe("held")
  })

  test("Del cancels after confirm", async () => {
    const t = await open()
    await select(t, "Board December")
    t.input.pressKey("DELETE")
    await until(t, (f) => f.includes("Cancel M-2?"))
    t.input.pressKey("n")
    let frame = await until(t, (f) => !f.includes("Cancel M-2?"))
    expect((await meetingRows())[1].status).toBe("planned")
    t.input.pressKey("DELETE")
    frame = await until(t, (f) => f.includes("Cancel M-2?"))
    expect(frame).toContain("Cancel M-2? It stays in the list as cancelled.")
    t.input.pressKey("y")
    frame = await until(t, (f) => f.includes("Past · 4"))
    expect(statusLine(frame)).toContain("cancelled M-2")
    expect(lineWith(frame, "Board December")).toContain("cancelled")
    expect(indexOf(frame, "Board December")).toBeGreaterThan(indexOf(frame, "Past · 4"))
    expect((await meetingRows())[1].status).toBe("cancelled")
    // A meeting that is not planned: x and Del ask nothing.
    t.input.pressKey("x")
    t.input.pressKey("DELETE")
    frame = await t.frame()
    expect(frame).not.toContain("Close M-2")
    expect(frame).not.toContain("Cancel M-2?")
  })

  test("Enter opens the meeting and Esc comes back to the same row", async () => {
    const t = await open()
    await select(t, "Board December")
    t.input.pressEnter()
    let frame = await until(t, (f) => f.includes("› M-2 Board December"))
    expect(frame).toContain("› M-2 Board December")
    expect(frame).toContain("No agenda yet. Press n to add an item.")
    // A meeting sorting above it: it would move the selection if it had been reset.
    await inCtx(() => write().addMeeting!({ about: "#CRM", title: "Kick-off", date: "2026-11-11" }))
    t.input.pressEscape()
    frame = await until(t, (f, s) => !f.includes("› M-2 Board December") && f.includes("Kick-off") && isSelected(s, "Board December"))
    expect(frame).not.toContain("› M-2 Board December")
    expect(isSelected(await t.spans(), "Board December")).toBe(true)
  })

  test("the Projects column shows a 16-character code whole at 80x24", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(async () => {
      await write("projects").addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
      await write("projects").addProject!({ code: "CRM", name: "CRM" })
      await write().addMeeting!({ about: "#CRM", title: "Data sync", date: "2026-11-20", kind: "steering", projects: ["DATAPLATFORM2027"] })
      await write().addMeeting!({ about: "#CRM", title: "CRM sync", date: "2026-11-21", kind: "steering", projects: ["CRM"] })
    })
    tui = await renderTui(kernel, { width: 80, height: 24 })
    tui.input.pressKey("5")
    const frame = await until(tui, (f) => f.includes("Data sync"))
    expect(lineWith(frame, "Data sync")).toContain(" DATAPLATFORM2027 ")
    expect(lineWith(frame, "CRM sync").lastIndexOf(" CRM ")).toBe(lineWith(frame, "Data sync").indexOf(" DATAPLATFORM2027 "))
    // The columns before it are still whole: kind, status and the attendee count.
    expect(lineWith(frame, "Data sync")).toMatch(/project  planned\s+0\s+DATAPLATFORM2027 │/)
  })

  test("a row with two codes keeps whole codes and ends with … at 80x24", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(async () => {
      await write("projects").addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
      await write("projects").addProject!({ code: "CRM", name: "CRM" })
      await write().addMeeting!({ about: "#CRM", title: "Data sync", date: "2026-11-20", kind: "steering", projects: ["DATAPLATFORM2027", "CRM"] })
      await write().addMeeting!({ about: "#CRM", title: "CRM sync", date: "2026-11-21", kind: "steering", projects: ["CRM", "DATAPLATFORM2027"] })
    })
    tui = await renderTui(kernel, { width: 80, height: 24 })
    tui.input.pressKey("5")
    const frame = await until(tui, (f) => f.includes("Data sync"))
    // In agenda order, in an 18-wide column: the long code first, then ` …`; after CRM it gives way.
    expect(lineWith(frame, "Data sync")).toMatch(/project  planned\s+0\s+DATAPLATFORM2027 … │/)
    expect(lineWith(frame, "CRM sync")).toMatch(/project  planned\s+0\s+CRM …\s+│/)
    expect(lineWith(frame, "CRM sync").lastIndexOf(" CRM …")).toBe(lineWith(frame, "Data sync").indexOf(" DATAPLATFORM2027 …"))
    expect(frame).not.toMatch(/DATAPLAT\w*…|CRM \w+…/)
  })

  test("empty state", async () => {
    const t = await open({ seed: false })
    expect(await t.frame()).toContain("No meetings yet. Press n to add one.")
  })
})
