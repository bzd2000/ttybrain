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
    expect(calls).toEqual([{ name: "setSubject", input: { meeting: "M-1", about: "@marie", kind: "one_on_one" } }])
    expect(await record("M-1")).toMatchObject({ about: "@marie", kind: "one_on_one" })
  })

  test("About: a subject of another kind changes Kind with it, visibly, and the write carries it", async () => {
    const t = await open()
    const calls = spy()
    void overlay!.openForm("meeting", "meeting", { recordRef: "M-1" })
    let frame = await until(t, (f) => f.includes("Edit M-1"))
    expect(lineWith(frame, "Kind")).toContain("project")
    for (let i = 0; i < 4; i++) t.input.pressBackspace()
    await t.input.typeText("@marie")
    frame = await until(t, (f) => lineWith(f, "Kind").includes("1:1"))
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => statusLine(f).includes("saved M-1"))
    expect(calls[0]).toEqual({ name: "setSubject", input: { meeting: "M-1", about: "@marie", kind: "one_on_one" } })
  })
})

describe("talk item form", () => {
  test("an unknown subject shows under About; a prefilled one starts on Text, and a project tag is saved", async () => {
    const t = await open()
    void overlay!.openForm("talk_item", "talk", {})
    let frame = await until(t, (f) => f.includes("New talk item"))
    // The series form's look: a muted label column, the footer on the border, `tab field` in the bar.
    expect(lineWith(frame, "About")).toMatch(/│ About {11}/)
    expect(frame).toMatch(/╰─+ ctrl\+s save · esc cancel ─╯/)
    expect(statusLine(frame)).toContain("tab field   ctrl+s save   esc cancel")
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
    expect(lineWith(frame, "About")).toContain("Marie Dubois · person")
    await t.input.typeText("Sales lead walkthrough")
    t.input.pressTab()
    await t.input.typeText("CRM")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => statusLine(f).includes("added T-1"))
    const list: any = await inCtx(() => (kernel!.runtime("meetings")!.self().read as any).talkList({ about: "@marie" }))
    expect(list.open.map((i: any) => [i.ref, i.text, i.project])).toEqual([["T-1", "Sales lead walkthrough", "#CRM"]])
  })

  test("Project shows only for a person's item: new (as About is typed) and edit", async () => {
    const t = await open()
    void overlay!.openForm("talk_item", "talk", { prefill: { about: "#CRM" }, draftFor: "#CRM" })
    let frame = await until(t, (f) => f.includes("CRM replatforming · project"))
    expect(frame).not.toContain("Project")
    t.input.pressEscape()
    await until(t, (f) => !f.includes("New talk item"))
    void overlay!.openForm("talk_item", "talk", {})
    await until(t, (f) => f.includes("New talk item"))
    await t.input.typeText("#CRM ")
    frame = await t.frame()
    expect(frame).not.toContain("Project")
    for (let i = 0; i < 5; i++) t.input.pressBackspace()
    await t.input.typeText("@marie ")
    frame = await until(t, (f) => f.includes("Project"))
    expect(lineWith(frame, "Project")).toMatch(/Project/)
    t.input.pressEscape()
    await until(t, (f) => !f.includes("New talk item"))
    // An edit: a project's item has no Project field, a person's has.
    await inCtx(async () => {
      await write().addTalk!({ about: "#CRM", text: "Budget" }) // T-1
      await write().addTalk!({ about: "@marie", text: "Demo", project: "CRM" }) // T-2
    })
    void overlay!.openForm("talk_item", "talk", { recordRef: "T-1" })
    frame = await until(t, (f) => f.includes("Edit T-1"))
    expect(frame).not.toContain("Project")
    t.input.pressEscape()
    await until(t, (f) => !f.includes("Edit T-1"))
    void overlay!.openForm("talk_item", "talk", { recordRef: "T-2" })
    frame = await until(t, (f) => f.includes("Edit T-2"))
    expect(lineWith(frame, "Project")).toContain("CRM")
  })
})

describe("series form", () => {
  test("prefilled with a kind and attendees of its own: they are kept, and Esc on the untouched form keeps no draft", async () => {
    const t = await open()
    const from = { prefill: { about: "@marie", kind: "project", attendees: "@luc" }, draftFor: "@marie:prefilled" }
    void overlay!.openForm("series", "series", from)
    let frame = await until(t, (f) => f.includes("Marie Dubois · person") && f.includes("Luc Peeters"))
    expect(lineWith(frame, "Kind")).toMatch(/Kind +project \(1:1 · board\)/)
    expect(lineWith(frame, "Attendees")).toContain("Luc Peeters")
    t.input.pressEscape()
    await sleep(30)
    frame = await until(t, (f) => !f.includes("New recurring meeting"))
    expect(statusLine(frame)).not.toContain("draft kept")
    void overlay!.openForm("series", "series", from)
    frame = await until(t, (f) => f.includes("Luc Peeters"))
    await t.settle()
    frame = await t.frame()
    expect(frame).not.toContain("restore")
    expect(lineWith(frame, "Kind")).toMatch(/Kind +project/)
  })

  test("opened from a subject and left untouched, Esc keeps no draft; a restored draft keeps its derived fields following", async () => {
    const t = await open()
    const from = { prefill: { about: "@marie" }, draftFor: "@marie" }
    void overlay!.openForm("series", "series", from)
    let frame = await until(t, (f) => f.includes("Marie Dubois · person"))
    expect(lineWith(frame, "Attendees")).toContain("Marie Dubois")
    t.input.pressEscape()
    await sleep(30)
    frame = await until(t, (f) => !f.includes("New recurring meeting"))
    expect(statusLine(frame)).not.toContain("draft kept")
    void overlay!.openForm("series", "series", from)
    frame = await until(t, (f) => f.includes("Marie Dubois · person"))
    await t.settle()
    expect(await t.frame()).not.toContain("restore")

    // The rhythm typed: Esc keeps it; restored, First date and Attendees still follow.
    await until(t, (f) => statusLine(f).includes("tab field"))
    await t.input.typeText("weekly on mon")
    frame = await until(t, (f) => lineWith(f, "First date").includes("Mon 16 Nov"))
    t.input.pressEscape()
    await sleep(30)
    frame = await until(t, (f) => !f.includes("New recurring meeting"))
    expect(statusLine(frame)).toContain("draft kept")
    void overlay!.openForm("series", "series", from)
    await until(t, (f) => f.includes("restore"))
    t.input.pressKey("r")
    frame = await until(t, (f) => !f.includes("restore") && lineWith(f, "First date").includes("Mon 16 Nov"))
    expect(lineWith(frame, "Occurrence")).toContain("weekly on mon")
    for (let i = 0; i < 3; i++) t.input.pressBackspace()
    await t.input.typeText("wed")
    frame = await until(t, (f) => lineWith(f, "First date").includes("Wed 18 Nov"))
    expect(lineWith(frame, "First date")).toContain("Wed 18 Nov")
    expect(lineWith(frame, "Attendees")).toContain("Marie Dubois")
  })
})

describe("series form: Occurrence", () => {
  test("Enter lists the phrases the First date allows; each one picked saves as that rhythm; custom… lets one be typed", async () => {
    const t = await open()
    // Today is Fri 13 Nov 2026.
    const offered = ["weekly on fri", "every 2 weeks on fri", "every 4 weeks on fri", "monthly on the 2nd fri", "monthly on day 13"]
    for (const [i, phrase] of offered.entries()) {
      void overlay!.openForm("series", "series", { prefill: { about: "@marie" }, draftFor: `@marie:${i}` })
      let frame = await until(t, (f) => f.includes("Marie Dubois · person") && statusLine(f).includes("tab field"))
      expect(lineWith(frame, "Occurrence")).toMatch(/│ Occurrence /)
      t.input.pressEnter()
      frame = await until(t, (f) => f.includes("custom…"))
      for (const p of [...offered, "custom…"]) expect(frame).toContain(` ${p} `)
      for (let k = 0; k < i; k++) t.input.pressArrow("down")
      t.input.pressEnter()
      frame = await until(t, (f) => !f.includes("custom…"))
      expect(lineWith(frame, "Occurrence")).toContain(phrase)
      expect(lineWith(frame, "First date")).toContain("Fri 13 Nov")
      t.input.pressKey("s", { ctrl: true })
      await until(t, (f) => !f.includes("New recurring meeting"))
    }
    // custom…: the list closes, the phrase is typed.
    void overlay!.openForm("series", "series", { prefill: { about: "@marie" }, draftFor: "@marie:custom" })
    await until(t, (f) => f.includes("Marie Dubois · person") && statusLine(f).includes("tab field"))
    t.input.pressEnter()
    await until(t, (f) => f.includes("custom…"))
    await t.input.typeText("c")
    t.input.pressEnter()
    await until(t, (f) => !f.includes("custom…"))
    await t.input.typeText("monthly on the last tue")
    await until(t, (f) => f.includes("→ Tue 24 Nov"))
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("New recurring meeting"))
    const rows = kernel!.db.raw.prepare("SELECT rhythm FROM meetings_series ORDER BY id").all([]) as Array<{ rhythm: string }>
    expect(rows.map((r) => r.rhythm)).toEqual([...offered, "monthly on the last tue"])
  })

  test("the list follows the First date: Wed 25 Nov offers its weekday, the 4th and the last Wednesday, day 25", async () => {
    const t = await open()
    void overlay!.openForm("series", "series", { prefill: { about: "@marie", from: "2026-11-25" }, draftFor: "@marie:wed" })
    await until(t, (f) => f.includes("Marie Dubois · person") && statusLine(f).includes("tab field"))
    t.input.pressEnter()
    const frame = await until(t, (f) => f.includes("custom…"))
    for (const p of ["weekly on wed", "every 2 weeks on wed", "every 4 weeks on wed", "monthly on the 4th wed", "monthly on the last wed", "monthly on day 25"])
      expect(frame).toContain(` ${p} `)
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
