// The meeting, agenda item and attendees record forms, opened through the overlay, against the built-in plugins
// seeded through their write operations.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { defineTui, type TuiDef } from "../../../kernel/tui/api"
import { useOverlay, type Overlay } from "../../../kernel/tui/overlay"
import { builtinPlugins } from "../../../../tests/builtins"
import { makeStore } from "../logic/records"
import { meetingsTui } from "./index"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let overlay: Overlay | undefined
function Home() {
  overlay = useOverlay()
  return <text>home screen</text>
}
// The meetings part plus a test screen that captures the overlay.
const part: TuiDef = defineTui({
  plugin: "meetings",
  activate(ui) {
    meetingsTui.activate(ui)
    ui.screen({ id: "home", title: "Home", slot: 2, component: Home })
  },
})

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  overlay = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const write = (plugin = "meetings") => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const record = (ref: string) => inCtx(() => makeStore(kernel!.runtime("meetings")!).meeting(ref))
const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""
const statusLine = (frame: string) => frame.trimEnd().split("\n").at(-1)!

async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}

// @marie and @luc, #CRM and #ERP, and M-1 SteerCo Q4 (20 Nov, @marie, agenda: CRM replatforming status, #CRM).
async function open(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await inCtx(async () => {
    await write("people").addPerson!({ name: "Marie Dubois", handle: "marie", is_stakeholder: true })
    await write("people").addPerson!({ name: "Luc Peeters", handle: "luc", is_stakeholder: true })
    await write("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
    await write("projects").addProject!({ code: "ERP", name: "ERP upgrade" })
    await write().addMeeting!({ about: "#CRM", title: "SteerCo Q4", date: "2026-11-20", kind: "steering", attendees: ["marie"], projects: ["CRM"] })
  })
  tui = await renderTui(kernel, { parts: [part], width: 100, height: 34 })
  tui.input.pressKey("2")
  expect(await tui.frame()).toContain("home screen")
  return tui
}

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

describe("meeting form", () => {
  test("unknown attendee shows under the field", async () => {
    const t = await open()
    void overlay!.openForm("meeting", "meeting", {})
    await until(t, (f) => f.includes("New meeting"))
    await t.input.typeText("#CRM") // about
    t.input.pressTab() // title
    await t.input.typeText("Board")
    for (let i = 0; i < 3; i++) t.input.pressTab() // title → attendees
    await t.input.typeText("@marie @zorro")
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => f.includes('unknown person "zorro"'))
    const lines = frame.split("\n")
    const i = lines.findIndex((l) => l.includes("Attendees"))
    expect(lines[i + 1]).toContain('✗ unknown person "zorro"')
    expect(frame).toContain("New meeting")
    const ids = await inCtx(async () => (await (kernel!.runtime("meetings")!.data as any).selectFrom("meeting").select("id").execute()) as unknown[])
    expect(ids.length).toBe(1)
  })

  test("edit sends only the changed fields, attendees too, in one write", async () => {
    const t = await open()
    const calls = spy()
    void overlay!.openForm("meeting", "meeting", { recordRef: "M-1" })
    await until(t, (f) => f.includes("Edit M-1"))
    t.input.pressTab() // about → title
    await t.input.typeText(" bis")
    for (let i = 0; i < 3; i++) t.input.pressTab() // title → attendees
    await t.input.typeText(", @luc")
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => statusLine(f).includes("saved M-1"))
    expect(frame).not.toContain("Edit M-1")
    expect(calls).toEqual([
      { name: "editMeeting", input: { ref: "M-1", title: "SteerCo Q4 bis" } },
      { name: "setAttendees", input: { meeting: "M-1", people: ["marie", "luc"] } },
    ])
    const m = await record("M-1")
    expect([m.title, m.attendees]).toEqual(["SteerCo Q4 bis", ["@luc", "@marie"]])
  })

  test("edit with no change closes without a write", async () => {
    const t = await open()
    const calls = spy()
    void overlay!.openForm("meeting", "meeting", { recordRef: "M-1" })
    await until(t, (f) => f.includes("Edit M-1"))
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => !f.includes("Edit M-1"))
    expect(statusLine(frame)).not.toContain("saved")
    expect(calls).toEqual([])
  })

  test("About: an unknown subject shows under it; an edit of it gives the meeting its new subject", async () => {
    const t = await open()
    void overlay!.openForm("meeting", "meeting", {})
    await until(t, (f) => f.includes("New meeting"))
    await t.input.typeText("@zorro") // about, first
    t.input.pressTab()
    await t.input.typeText("1:1")
    t.input.pressKey("s", { ctrl: true })
    let frame = await until(t, (f) => f.includes('unknown person "@zorro"'))
    const lines = frame.split("\n")
    expect(lines[lines.findIndex((l) => l.includes("About")) + 1]).toContain('✗ unknown person "@zorro"')
    t.input.pressEscape()
    await until(t, (f) => !f.includes("New meeting"))

    const calls = spy()
    void overlay!.openForm("meeting", "meeting", { recordRef: "M-1" })
    frame = await until(t, (f) => f.includes("Edit M-1"))
    expect(lineWith(frame, "About")).toContain("#CRM")
    for (let i = 0; i < 4; i++) t.input.pressBackspace()
    await t.input.typeText("@marie")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => statusLine(f).includes("saved M-1"))
    expect(calls).toEqual([{ name: "setSubject", input: { meeting: "M-1", about: "@marie" } }])
    expect(await record("M-1")).toMatchObject({ about: "@marie", kind: "one_on_one" })
  })
})

describe("talk item form", () => {
  test("an unknown subject shows under About; a prefilled one starts on Text, and a project tag is saved", async () => {
    const t = await open()
    void overlay!.openForm("talk_item", "talk", {})
    let frame = await until(t, (f) => f.includes("New talk item"))
    expect(lineWith(frame, "About")).toContain("› About*")
    await t.input.typeText("@zorro")
    t.input.pressTab()
    await t.input.typeText("Lunch")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => f.includes('unknown person "@zorro"'))
    const lines = frame.split("\n")
    expect(lines[lines.findIndex((l) => l.includes("About")) + 1]).toContain('✗ unknown person "@zorro"')
    t.input.pressEscape()
    await until(t, (f) => !f.includes("New talk item"))

    // The cancelled form kept its draft; one for @marie (draftFor) has its own key, so none is offered.
    void overlay!.openForm("talk_item", "talk", { prefill: { about: "@marie" }, draftFor: "@marie" })
    frame = await until(t, (f) => f.includes("New talk item"))
    await t.settle()
    frame = await t.frame()
    expect(frame).not.toContain("restore")
    expect(lineWith(frame, "Text")).toContain("› Text*")
    await t.input.typeText("Sales lead walkthrough")
    t.input.pressTab()
    await t.input.typeText("CRM")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => statusLine(f).includes("added T-1"))
    const list: any = await inCtx(() => (kernel!.runtime("meetings")!.self().read as any).talkList({ about: "@marie" }))
    expect(list.open.map((i: any) => [i.ref, i.text, i.project])).toEqual([["T-1", "Sales lead walkthrough", "#CRM"]])
  })
})

describe("agenda item form", () => {
  test("adds an item to the meeting", async () => {
    const t = await open()
    void overlay!.openForm("meeting", "agenda-item", { recordRef: "M-1" })
    await until(t, (f) => f.includes("New agenda item · M-1"))
    await t.input.typeText("Budget")
    t.input.pressTab() // project
    t.input.pressTab() // ask
    await t.input.typeText("Release contingency")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => statusLine(f).includes("added M-1"))
    expect((await record("M-1")).agenda.map((a: any) => [a.position, a.text, a.project, a.ask])).toEqual([
      [1, "CRM replatforming status", "#CRM", null],
      [2, "Budget", null, "Release contingency"],
    ])
  })

  test("edits item n, sending only the changed fields", async () => {
    const t = await open()
    const calls = spy()
    void overlay!.openForm("meeting", "agenda-item", { recordRef: "M-1", prefill: { item: "1" } })
    const frame = await until(t, (f) => f.includes("Edit item 1 · M-1"))
    expect(lineWith(frame, "Text")).toContain("CRM replatforming status")
    expect(lineWith(frame, "Project")).toContain("#CRM")
    t.input.pressTab()
    t.input.pressTab() // ask
    await t.input.typeText("Approve phase 2")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => statusLine(f).includes("saved M-1"))
    expect(calls).toEqual([{ name: "editAgendaItem", input: { meeting: "M-1", item: 1, ask: "Approve phase 2" } }])
    expect((await record("M-1")).agenda[0]?.ask).toBe("Approve phase 2")
  })
})

describe("attendees form", () => {
  test("sets the attendees; no change writes nothing", async () => {
    const t = await open()
    const calls = spy()
    void overlay!.openForm("meeting", "attendees", { recordRef: "M-1" })
    let frame = await until(t, (f) => f.includes("Attendees · M-1"))
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => !f.includes("Attendees · M-1"))
    expect(calls).toEqual([])
    void overlay!.openForm("meeting", "attendees", { recordRef: "M-1" })
    frame = await until(t, (f) => f.includes("Attendees · M-1"))
    expect(frame.split("\n").find((l) => l.includes("Attendees") && !l.includes("·"))).toContain("@marie")
    await t.input.typeText(" luc")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => statusLine(f).includes("saved M-1"))
    expect(calls).toEqual([{ name: "setAttendees", input: { meeting: "M-1", people: ["marie", "luc"] } }])
    expect((await record("M-1")).attendees).toEqual(["@luc", "@marie"])
  })
})
