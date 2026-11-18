// The meeting record view's Agenda and Prep tabs, against the built-in plugins seeded through write ops (the
// Task 6 seed: M-1 SteerCo Q3 held on 28 Oct covering #CRM, and M-2 Steering committee Q4 on 4 Dec).
import { rgbToHex } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { theme } from "../../../kernel/tui/api"
import { clearMessages } from "../../../kernel/tui/messages"
import { builtinPlugins } from "../../index"
import { attendeeLines } from "./agenda-list"
import { sinceText } from "./prep-tab"

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
const data = (plugin: string) => kernel!.runtime(plugin)!.data as any
const agenda = (meetingId: number) =>
  inCtx(async () => (await data("meetings").selectFrom("agenda_item").select(["position", "text"]).where("meeting_id", "=", meetingId).orderBy("position").execute()) as any[])

const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const statusLine = (frame: string) => lines(frame.trimEnd()).at(-1)!

async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}

const ASK = "Approve 2-week shift of design milestone"

async function seed() {
  await inCtx(async () => {
    const p = write("projects")
    await write("people").addPerson!({ name: "Peter Janssens", handle: "peter" })
    await write("people").addPerson!({ name: "Marie Dubois", handle: "marie" })
    await p.addProject!({ code: "CRM", name: "CRM replatforming" })
    const w = write()
    await w.addMeeting!({ title: "SteerCo Q3", date: "2026-10-28", kind: "steering", projects: ["CRM"] }) // M-1
    await p.setHealth!({ project: "CRM", health: "amber", comment: "Design slipping 2 weeks", date: "2026-11-02" })
    await p.addMilestone!({ project: "CRM", title: "Design approved", due: "2026-12-10" }) // MS-1
    await p.addRisk!({ project: "CRM", title: "Budget overrun ~12%", type: "issue", severity: "high" }) // R-1
    await p.addAction!({ title: "Send revised budget to Peter", project: "CRM", due: "2026-11-10" }) // A-1, overdue
    await p.addAction!({ title: "Share integration specs", project: "CRM", meeting: "M-1" }) // A-2, from M-1
    await w.closeMeeting!({ ref: "M-1" })
    await w.addMeeting!({ title: "Steering committee Q4", date: "2026-12-04", kind: "steering", attendees: ["peter", "marie"] }) // M-2
    await w.addAgendaItem!({ meeting: "M-2", text: "Minutes & open actions" })
    await w.addAgendaItem!({ meeting: "M-2", text: "CRM status", project: "CRM", ask: ASK })
    await w.addAgendaItem!({ meeting: "M-2", text: "AOB" })
  })
}

// Opens `ref` and moves `tabs` tabs right (Agenda → Prep is 1).
async function open(ref: string, tabs = 0, opts: { width?: number; height?: number; extra?: () => Promise<void> } = {}): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await seed()
  if (opts.extra) await inCtx(opts.extra)
  tui = await renderTui(kernel, { width: opts.width ?? 120, height: opts.height ?? 32 })
  tui.input.pressKey("5")
  await until(tui, (f) => f.includes("Meetings ·"))
  await tui.nav.open(ref)
  await until(tui, (f) => f.includes("Agenda") && f.includes("Prep"))
  for (let i = 0; i < tabs; i++) tui.input.pressArrow("right")
  await tui.frame()
  return tui
}

// Moves the list selection onto the line holding `text`.
const select = async (t: RenderedTui, text: string) => {
  for (let i = 0; i < 10 && !lineWith(await t.frame(), text).includes("›"); i++) t.input.pressKey("j")
  expect(lineWith(await t.frame(), text)).toContain("›")
}

describe("meeting tabs", () => {
  test("agenda tab lists items and attendees; n adds, e edits, J/K move, Del removes", async () => {
    const t = await open("M-2")
    let frame = await until(t, (f) => f.includes("CRM status"))
    expect(frame).toContain("› M-2 Steering committee Q4")
    expect(frame).toContain("Agenda · 3")
    expect(frame).toContain("Fri 4 Dec 2026 · steering · planned · 2 attendees")
    expect(lineWith(frame, "Minutes & open actions")).toMatch(/1\s+Minutes & open actions/)
    expect(lineWith(frame, "CRM status")).toMatch(/2\s+CRM status\s+CRM\s+Approve 2-week shift/)
    expect(frame).toContain("Attendees")
    expect(frame).toContain("Marie Dubois, Peter Janssens")

    // n adds an item at the end, and the list selects it.
    t.input.pressKey("n")
    await until(t, (f) => f.includes("New agenda item · M-2"))
    await t.input.typeText("Budget")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => !f.includes("New agenda item") && lineWith(f, "Budget").includes("›"))
    expect((await agenda(2)).map((r) => r.text)).toEqual(["Minutes & open actions", "CRM status", "AOB", "Budget"])

    // e edits the selected item.
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Edit item 4 · M-2"))
    await t.input.typeText(" 2027")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => !f.includes("Edit item 4") && f.includes("Budget 2027"))
    expect((await agenda(2)).at(-1)).toEqual({ position: 4, text: "Budget 2027" })

    // K moves it up twice, J down once; the selection follows it.
    t.input.pressKey("K")
    frame = await until(t, (f) => lineWith(f, "Budget 2027").match(/›\s+3\s/) !== null)
    expect((await agenda(2)).map((r) => r.text)).toEqual(["Minutes & open actions", "CRM status", "Budget 2027", "AOB"])
    t.input.pressKey("K")
    frame = await until(t, (f) => lineWith(f, "Budget 2027").match(/›\s+2\s/) !== null)
    expect((await agenda(2)).map((r) => r.text)).toEqual(["Minutes & open actions", "Budget 2027", "CRM status", "AOB"])
    t.input.pressKey("J")
    frame = await until(t, (f) => lineWith(f, "Budget 2027").match(/›\s+3\s/) !== null)
    expect(await agenda(2)).toEqual([
      { position: 1, text: "Minutes & open actions" },
      { position: 2, text: "CRM status" },
      { position: 3, text: "Budget 2027" },
      { position: 4, text: "AOB" },
    ])

    // Del removes it after a confirmation.
    t.input.pressKey("DELETE")
    frame = await until(t, (f) => f.includes('Remove item 3 "Budget 2027"?'))
    t.input.pressKey("y")
    frame = await until(t, (f) => !f.includes("Budget 2027"))
    expect(frame).toContain("Agenda · 3")
    expect(await agenda(2)).toEqual([
      { position: 1, text: "Minutes & open actions" },
      { position: 2, text: "CRM status" },
      { position: 3, text: "AOB" },
    ])
  })

  test("prep shows the selected project's sections with marks and the ask", async () => {
    const t = await open("M-2", 1)
    await select(t, "2. CRM status")
    const frame = await until(t, (f) => f.includes("Prep · CRM replatforming"))
    expect(frame).toContain("● amber")
    expect(frame).toMatch(/[✓○] MS-1 · Design approved/)
    expect(frame).toContain("▲ R-1")
    expect(frame).toContain("! A-1")
    expect(frame).toContain("Ask for this meeting")
    expect(frame).toContain(ASK)
    expect(frame).toContain("since SteerCo Q3 28 Oct")
    // Project and Name are left out: the panel title names the project.
    expect(lineWith(frame, "● amber")).not.toContain("#CRM")
    expect(lineWith(frame, "● amber")).not.toContain("CRM replatforming")
    const overdue = (await t.spans()).lines.find((l) => l.spans.map((s) => s.text).join("").includes("! A-1"))!
    const span = overdue.spans.find((s) => s.text.includes("! A-1"))!
    expect(rgbToHex(span.fg).toLowerCase()).toBe(theme.red)
    const ask = (await t.spans()).lines.find((l) => l.spans.map((s) => s.text).join("").includes("Ask for this meeting"))!
    expect(rgbToHex(ask.spans.find((s) => s.text.includes("Ask for this meeting"))!.fg).toLowerCase()).toBe(theme.accent)
  })

  test("prep of an item without a project", async () => {
    const t = await open("M-2", 1, { extra: () => write().editAgendaItem!({ meeting: "M-2", item: 3, ask: "Anything else?" }) })
    let frame = await until(t, (f) => f.includes("No project on this item."))
    // Item 1 is selected first: no project, no ask.
    expect(lineWith(frame, "1. Minutes")).toContain("›")
    expect(frame).toContain("Ask for this meeting")
    expect(frame).toContain("—")
    expect(frame).not.toContain("● amber")
    await select(t, "3. AOB")
    frame = await until(t, (f) => f.includes("Anything else?"))
    expect(frame).toContain("No project on this item.")
    expect(frame).not.toContain("since ")
  })

  test("a in prep logs an action linked to the meeting and project", async () => {
    const t = await open("M-2", 1)
    await select(t, "2. CRM status")
    t.input.pressKey("a")
    await until(t, (f) => f.includes("New action · M-2"))
    await t.input.typeText("Send the budget")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("New action · M-2"))
    const rows = await inCtx(async () => await data("projects").selectFrom("action").select(["title", "meeting_id", "project_id"]).orderBy("id").execute())
    expect(rows.at(-1)).toEqual({ title: "Send the budget", meeting_id: 2, project_id: 1 })
  })

  test("D logs a decision", async () => {
    const t = await open("M-2", 1)
    await select(t, "2. CRM status")
    t.input.pressKey("D")
    await until(t, (f) => f.includes("New decision · M-2"))
    t.input.pressTab() // date → title
    await t.input.typeText("Go with B")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("New decision · M-2"))
    const rows = await inCtx(async () => await data("projects").selectFrom("decision").select(["title", "meeting_id", "project_id"]).orderBy("id").execute())
    expect(rows).toEqual([{ title: "Go with B", meeting_id: 2, project_id: 1 }])
  })

  test("prep at 80x24", async () => {
    const long = "Approve the two-week shift of the design milestone and release the contingency budget for the vendor"
    const t = await open("M-2", 1, { width: 80, height: 24, extra: () => write().editAgendaItem!({ meeting: "M-2", item: 2, ask: long }) })
    await select(t, "2. CRM")
    const frame = await until(t, (f) => f.includes("Prep · CRM") && lineWith(f, "Approve the two-week").includes("…"))
    expect(frame).toContain("1. Minutes")
    expect(frame).toContain("Prep · CRM")
    expect(lineWith(frame, "Approve the two-week")).toContain("…")
    expect(frame).not.toContain("release the contingency budget for the vendor")
    for (const l of lines(frame)) expect([...l].length).toBeLessThanOrEqual(80)
    // The sections do not fit: PgDn scrolls them to the actions, and the ask stays in view.
    expect(frame).not.toContain("! A-1")
    t.input.pressKey("\u001b[6~") // PgDn
    const scrolled = await until(t, (f) => f.includes("! A-1"))
    expect(scrolled).toContain("! A-1")
    expect(scrolled).toContain("Ask for this meeting")
  })

  test("the since text names where the prep starts", () => {
    const previous = { ref: "M-1", title: "SteerCo Q3", date: "2026-10-28" }
    expect(sinceText({ since: "2026-10-28", source: "previous", previous })).toBe("since SteerCo Q3 28 Oct")
    expect(sinceText({ since: "2026-10-15", source: "meeting", previous })).toBe("since 15 Oct (set on the meeting)")
    expect(sinceText({ since: "2026-11-04", source: "default", previous: null })).toBe("since 4 Nov (30 days before)")
  })

  test("attendee names wrap to two lines, then +n", () => {
    expect(attendeeLines(["Marie Dubois", "Peter Janssens"], 28)).toEqual(["Marie Dubois, Peter Janssens"])
    expect(attendeeLines(["Marie Dubois", "Peter Janssens"], 20)).toEqual(["Marie Dubois,", "Peter Janssens"])
    const five = ["Ann Lee", "Bob Ray", "Cid Moe", "Dan Fox", "Eve Kim"]
    expect(attendeeLines(five, 20)).toEqual(["Ann Lee, Bob Ray,", "Cid Moe, Dan Fox +1"])
    expect(attendeeLines(five, 15)).toEqual(["Ann Lee,", "Bob Ray +3"])
    expect(attendeeLines([], 20)).toEqual([])
  })

  test("cancelled meeting: keys say so and open nothing", async () => {
    const t = await open("M-3", 0, {
      extra: async () => {
        await write().addMeeting!({ title: "Vendor review", date: "2026-11-20", projects: ["CRM"] }) // M-3
        await write().cancelMeeting!({ ref: "M-3" })
      },
    })
    let frame = await until(t, (f) => f.includes("CRM replatforming status"))
    expect(frame).toContain("cancelled")
    const keys: Array<() => void> = [
      () => t.input.pressKey("n"),
      () => t.input.pressKey("e"),
      () => t.input.pressKey("J"),
      () => t.input.pressKey("K"),
      () => t.input.pressKey("DELETE"),
      () => t.input.pressKey("x"),
      () => t.input.pressKey("p"),
    ]
    // Each key's own message: the status bar is cleared before it.
    const fresh = async (press: () => void) => {
      clearMessages()
      await until(t, (f) => !statusLine(f).includes("is cancelled"))
      press()
    }
    for (const press of keys) {
      await fresh(press)
      frame = await until(t, (f) => statusLine(f).includes("M-3 is cancelled"))
      expect(statusLine(frame)).toContain("M-3 is cancelled")
      expect(frame).not.toContain("New agenda item")
      expect(frame).not.toContain("Edit item")
      expect(frame).not.toContain("Remove item")
      expect(frame).not.toContain("Close M-3")
      expect(frame).not.toContain("Attendees · M-3")
    }
    t.input.pressArrow("right")
    await until(t, (f) => f.includes("Prep ·"))
    for (const k of ["e", "a", "D", "x"]) {
      await fresh(() => t.input.pressKey(k))
      frame = await until(t, (f) => statusLine(f).includes("M-3 is cancelled"))
      expect(statusLine(frame)).toContain("M-3 is cancelled")
      expect(frame).not.toContain("New action")
      expect(frame).not.toContain("New decision")
      expect(frame).not.toContain("Edit item")
      expect(frame).not.toContain("Close M-3")
    }
    expect(await agenda(3)).toEqual([{ position: 1, text: "CRM replatforming status" }])
    const status = await inCtx(async () => (await data("meetings").selectFrom("meeting").select("status").where("id", "=", 3).executeTakeFirst()).status)
    expect(status).toBe("cancelled")
  })
})
