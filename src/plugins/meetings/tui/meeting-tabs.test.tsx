// The meeting record view's Agenda, Prep, Notes and Export tabs, against the built-in plugins seeded through write ops (the
// Task 6 seed: M-1 SteerCo Q3 held on 28 Oct covering #CRM, and M-2 Steering committee Q4 on 4 Dec).
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { rgbToHex, type CapturedFrame } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { theme } from "../../../kernel/tui/api"
import { clearMessages } from "../../../kernel/tui/messages"
import { builtinPlugins } from "../../../../tests/builtins"
import { isSelected, selectedText } from "../../../../tests/design"
import { attendeeLines } from "./agenda-list"
import { exportFileName } from "./export-tab"
import { loggedRows } from "./notes-tab"
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
    await write("actions").addAction!({ title: "Send revised budget to Peter", project: "CRM", due: "2026-11-10" }) // A-1, overdue
    await write("actions").addAction!({ title: "Share integration specs", project: "CRM", meeting: "M-1" }) // A-2, from M-1
    await w.closeMeeting!({ ref: "M-1" })
    await w.addMeeting!({ title: "Steering committee Q4", date: "2026-12-04", kind: "steering", attendees: ["peter", "marie"] }) // M-2
    await w.addAgendaItem!({ meeting: "M-2", text: "Minutes & open actions" })
    await w.addAgendaItem!({ meeting: "M-2", text: "CRM status", project: "CRM", ask: ASK })
    await w.addAgendaItem!({ meeting: "M-2", text: "AOB" })
  })
}

// Opens `ref` and moves `tabs` tabs right (Agenda → Prep is 1, Notes 2, Export 3).
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
  for (let i = 0; i < 10 && !isSelected(await t.spans(), text); i++) t.input.pressKey("j")
  expect(isSelected(await t.spans(), text)).toBe(true)
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
    frame = await until(t, (f, s) => !f.includes("New agenda item") && isSelected(s, "Budget"))
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
    frame = await until(t, (_, s) => selectedText(s).some((l) => /^3\s+Budget 2027/.test(l)))
    expect((await agenda(2)).map((r) => r.text)).toEqual(["Minutes & open actions", "CRM status", "Budget 2027", "AOB"])
    t.input.pressKey("K")
    frame = await until(t, (_, s) => selectedText(s).some((l) => /^2\s+Budget 2027/.test(l)))
    expect((await agenda(2)).map((r) => r.text)).toEqual(["Minutes & open actions", "Budget 2027", "CRM status", "AOB"])
    t.input.pressKey("J")
    frame = await until(t, (_, s) => selectedText(s).some((l) => /^3\s+Budget 2027/.test(l)))
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

  test("agenda tab shows a 16-character project code whole", async () => {
    const t = await open("M-2", 0, {
      extra: async () => {
        await write("projects").addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
        await write().addAgendaItem!({ meeting: "M-2", text: "Data status", project: "DATAPLATFORM2027", ask: "Go" })
      },
    })
    const frame = await until(t, (f) => f.includes("Data status"))
    expect(lineWith(frame, "Data status")).toMatch(/4\s+Data status\s+DATAPLATFORM2027 Go/)
    expect(lineWith(frame, "CRM status")).toMatch(/2\s+CRM status\s+CRM\s+Approve/)
  })

  test("prep shows the selected project's sections with marks and the ask", async () => {
    const t = await open("M-2", 1)
    await select(t, "2.  CRM status")
    const frame = await until(t, (f) => f.includes("Prep · CRM replatforming"))
    expect(frame).toContain("● amber")
    // The compact form: no milestone or decision refs, the risk and action refs before their titles.
    expect(frame).toMatch(/[✓○] {2}Design approved/)
    expect(frame).toContain("▲  R-1")
    expect(frame).toContain("!  A-1")
    expect(frame).toContain("Ask for this meeting (your text)")
    expect(frame).toContain(ASK)
    expect(frame).toContain("generated from data · since SteerCo Q3 28 Oct")
    // Project and Name are left out: the panel title names the project.
    expect(lineWith(frame, "● amber")).not.toContain("#CRM")
    expect(lineWith(frame, "● amber")).not.toContain("CRM replatforming")
    const overdue = (await t.spans()).lines.find((l) => l.spans.map((s) => s.text).join("").includes("!  A-1"))!
    const span = overdue.spans.find((s) => s.text.includes("!"))!
    expect(rgbToHex(span.fg).toLowerCase()).toBe(theme.red)
    const ask = (await t.spans()).lines.find((l) => l.spans.map((s) => s.text).join("").includes("Ask for this meeting"))!
    expect(rgbToHex(ask.spans.find((s) => s.text.includes("Ask for this meeting"))!.fg).toLowerCase()).toBe(theme.muted)
  })

  test("prep of an item without a project", async () => {
    const t = await open("M-2", 1, { extra: () => write().editAgendaItem!({ meeting: "M-2", item: 3, ask: "Anything else?" }) })
    let frame = await until(t, (f) => f.includes("No project on this item."))
    // Item 1 is selected first: no project, no ask.
    expect(isSelected(await t.spans(), "1.  Minutes")).toBe(true)
    expect(frame).toContain("Ask for this meeting")
    expect(frame).toContain("—")
    expect(frame).not.toContain("● amber")
    await select(t, "3.  AOB")
    frame = await until(t, (f) => f.includes("Anything else?"))
    expect(frame).toContain("No project on this item.")
    expect(frame).not.toContain("since ")
  })

  test("a in prep logs an action linked to the meeting and project", async () => {
    const t = await open("M-2", 1)
    await select(t, "2.  CRM status")
    t.input.pressKey("a")
    await until(t, (f) => f.includes("New action · M-2"))
    await t.input.typeText("Send the budget")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("New action · M-2"))
    const rows = await inCtx(async () => await data("actions").selectFrom("action").select(["title", "meeting_id", "project_id"]).orderBy("id").execute())
    expect(rows.at(-1)).toEqual({ title: "Send the budget", meeting_id: 2, project_id: 1 })
  })

  test("D logs a decision", async () => {
    const t = await open("M-2", 1)
    await select(t, "2.  CRM status")
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
    const t = await open("M-2", 1, {
      width: 80,
      height: 24,
      extra: async () => {
        await write().editAgendaItem!({ meeting: "M-2", item: 2, ask: long })
        // More overdue actions, so the sections do not fit.
        for (const day of ["01", "02", "03", "04", "05"]) await write("actions").addAction!({ title: `Overdue ${day}`, project: "CRM", due: `2026-11-${day}` })
      },
    })
    await select(t, "2.  CRM")
    // The ask wraps (as the design's paragraph does), whole.
    const frame = await until(t, (f) => f.includes("Prep · CRM") && f.includes("the vendor"))
    expect(frame).toContain("1.  Minutes")
    expect(frame).toContain("Prep · CRM")
    const askAt = lines(frame).findIndex((l) => l.includes("Approve the two-week"))
    const ask = lines(frame)
      .slice(askAt, askAt + 3)
      .map((l) => (l.split("│")[3] ?? "").trim())
      .join(" ")
    expect(ask).toBe(long)
    for (const l of lines(frame)) expect([...l].length).toBeLessThanOrEqual(80)
    // The sections do not fit (a muted … at the bottom says so): PgDn scrolls them, and the ask stays in view.
    const marker = (f: string) => lines(f)[askAt - 3]!.trimEnd().endsWith("… │")
    expect(marker(frame)).toBe(true)
    const healthAt = lines(frame).findIndex((l) => l.includes("Health  ● amber"))
    expect(healthAt).toBeGreaterThan(0)
    t.input.pressKey("\u001b[6~") // PgDn
    const scrolled = await until(t, (f) => !f.includes("Health  ● amber"))
    expect(scrolled).not.toContain("Health  ● amber")
    expect(marker(scrolled)).toBe(false)
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
    t.input.pressArrow("right")
    await until(t, (f) => f.includes("Logged in this meeting"))
    for (const k of ["e", "E", "a", "D", "x"]) {
      await fresh(() => t.input.pressKey(k))
      frame = await until(t, (f) => statusLine(f).includes("M-3 is cancelled"))
      expect(statusLine(frame)).toContain("M-3 is cancelled")
      expect(frame).not.toContain("ctrl+s save")
      expect(frame).not.toContain("New action")
      expect(frame).not.toContain("New decision")
      expect(frame).not.toContain("Close M-3")
    }
    expect(await agenda(3)).toEqual([{ position: 1, text: "CRM replatforming status" }])
    const status = await inCtx(async () => (await data("meetings").selectFrom("meeting").select("status").where("id", "=", 3).executeTakeFirst()).status)
    expect(status).toBe("cancelled")
  })

  test("notes tab shows notes and what was logged; e edits through the editor and saves", async () => {
    const t = await open("M-2", 2)
    let frame = await until(t, (f) => f.includes("No notes yet. Press e to write them."))
    expect(frame).toContain("1.  Minutes")
    expect(frame).toContain("Logged in this meeting")
    expect(frame).not.toContain("A-2")

    // Logged against M-2 (A-2 belongs to M-1): the panel follows; the tabs have no counts (as designed).
    await inCtx(async () => {
      await write("actions").addAction!({ title: "Book the room", owner: "peter", due: "2026-11-20", meeting: "M-2" }) // A-3
      await write("actions").addAction!({ title: "Circulate the pack", meeting: "M-2" }) // A-4
      await write("projects").addDecision!({ title: "Go with vendor B", project: "CRM", meeting: "M-2" }) // DE-1
    })
    frame = await until(t, (f) => f.includes("DE-1 Go with vendor B"))
    expect(frame).toContain("A-3 Book the room · @peter · 20 Nov")
    expect(frame).toContain("A-4 Circulate the pack · me")
    expect(frame).toContain("DE-1 Go with vendor B")
    expect(frame).toMatch(/Agenda   Prep   Notes   Export/)
    expect(frame).not.toContain("Share integration specs")

    // e opens the built-in editor on the notes and saves them with setNotes.
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Notes · M-2 · ctrl+s save"))
    await t.input.typeText("Opened at 10:00")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => !f.includes("ctrl+s save") && f.includes("Opened at 10:00"))
    expect(frame).not.toContain("No notes yet.")
    const notes = await inCtx(async () => (await data("meetings").selectFrom("meeting").select("notes").where("id", "=", 2).executeTakeFirst()).notes)
    expect(notes).toBe("Opened at 10:00")

    // e again starts from the saved notes.
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Notes · M-2 · ctrl+s save"))
    t.input.pressKey("END")
    await t.input.typeText(", closed at 11:00")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("ctrl+s save") && f.includes("Opened at 10:00, closed at 11:00"))
    expect(await inCtx(async () => (await data("meetings").selectFrom("meeting").select("notes").where("id", "=", 2).executeTakeFirst()).notes)).toBe(
      "Opened at 10:00, closed at 11:00",
    )
  })

  test("long notes at 80x24 scroll inside the tab and keep the breadcrumb", async () => {
    const notes = Array.from({ length: 60 }, (_, i) => `Note line ${i + 1}`).join("\n")
    const t = await open("M-1", 2, { width: 80, height: 24, extra: () => write().setNotes!({ meeting: "M-1", markdown: notes }) })
    const frame = await until(t, (f) => f.includes("Note line 1") && f.includes("Logged in this meeting"))
    expect(frame).toContain("› M-1 SteerCo Q3")
    expect(frame).toContain("Note line 1")
    expect(frame).toContain("A-2 Share integration specs")
  })

  test("many logged items at 80x24: the logged panel stops at its cap with +n more and the notes keep their room", async () => {
    const t = await open("M-1", 2, {
      width: 80,
      height: 24,
      extra: async () => {
        await write().setNotes!({ meeting: "M-1", markdown: "Opened at 10:00\nBudget discussed" })
        // A-2 is already logged against M-1: 24 more make 25.
        for (let i = 3; i <= 26; i++) await write("actions").addAction!({ title: `Follow-up ${i}`, meeting: "M-1" })
      },
    })
    const frame = await until(t, (f) => f.includes("+19 more"))
    expect(frame).toContain("› M-1 SteerCo Q3")
    expect(frame).toContain("Opened at 10:00")
    expect(frame).toContain("Budget discussed")
    expect(frame).toContain("A-2 Share integration specs")
    expect(frame).toContain("A-7 Follow-up 7") // the sixth logged line
    expect(frame).not.toContain("A-8 Follow-up 8")
    // The logged panel closes: its bottom border is the line under `+19 more`.
    const rows = lines(frame)
    const more = rows.findIndex((l) => l.includes("+19 more"))
    expect(rows[more + 1]).toMatch(/╰─+╯/)
  })

  test("logged rows: at most 6, fewer when the column is short, +n more for the rest", () => {
    const logged = Array.from({ length: 25 }, (_, i) => `A-${i + 1}`)
    expect(loggedRows(logged.slice(0, 6), 30)).toEqual({ shown: logged.slice(0, 6), more: 0 })
    expect(loggedRows(logged.slice(0, 7), 30)).toEqual({ shown: logged.slice(0, 6), more: 1 })
    expect(loggedRows(logged, 0)).toEqual({ shown: logged.slice(0, 6), more: 19 }) // not measured yet
    // 14 rows: the Notes panel keeps 5 + 2 borders, the Logged panel's borders take 2, 5 rows are left.
    expect(loggedRows(logged, 14)).toEqual({ shown: logged.slice(0, 4), more: 21 })
    expect(loggedRows(logged.slice(0, 5), 14)).toEqual({ shown: logged.slice(0, 5), more: 0 })
    // No room at all: only the `+n more` line.
    expect(loggedRows(logged, 8)).toEqual({ shown: [], more: 25 })
  })

  test("export tab shows the board pack before and the minutes after closing; m switches", async () => {
    const t = await open("M-2", 3)
    let frame = await until(t, (f) => f.includes("# Steering committee Q4 · 2026-12-04"))
    expect(lineWith(frame, "2026-12-04-steering-committee-q4.md")).toContain("Board pack")
    expect(frame).toContain("› M-2 Steering committee Q4") // the pack scrolls inside the tab
    expect(frame).toContain("## Agenda")
    expect(frame).toContain(ASK)
    // PgDn scrolls down to the project block's actions.
    expect(frame).not.toContain("Send revised budget to Peter")
    for (let i = 0; i < 5 && !frame.includes("Send revised budget to Peter"); i++) {
      t.input.pressKey("\u001b[6~") // PgDn
      frame = await until(t, (f) => !f.includes("# Steering committee Q4 · 2026-12-04"))
    }
    frame = await until(t, (f) => f.includes("Send revised budget to Peter"))
    expect(frame).toContain("Send revised budget to Peter")
    expect(frame).not.toContain("# Steering committee Q4 · 2026-12-04")

    // Closing makes the minutes the default.
    await inCtx(() => write().closeMeeting!({ ref: "M-2" }))
    frame = await until(t, (f) => f.includes("# Minutes · Steering committee Q4 · 2026-12-04"))
    expect(lineWith(frame, "2026-12-04-steering-committee-q4-minutes.md")).toContain("Minutes")
    expect(frame).toContain("## Notes")

    // m switches between them.
    t.input.pressKey("m")
    frame = await until(t, (f) => f.includes("# Steering committee Q4 · 2026-12-04"))
    expect(lineWith(frame, "2026-12-04-steering-committee-q4.md")).toContain("Board pack")
    t.input.pressKey("m")
    frame = await until(t, (f) => f.includes("# Minutes · Steering committee Q4"))
    expect(lineWith(frame, "-minutes.md")).toContain("Minutes")
  })

  test("w writes <date>-<slug>.md under exportDir and says where", async () => {
    const t = await open("M-2", 3)
    await until(t, (f) => f.includes("# Steering committee Q4 · 2026-12-04"))
    t.input.pressKey("w")
    const path = join(kernel!.config.exportDir, "2026-12-04-steering-committee-q4.md")
    const frame = await until(t, (f) => statusLine(f).includes("wrote "))
    expect(statusLine(frame)).toContain(`wrote ${path}`)
    const expected = (await inCtx(() => kernel!.runtime("meetings")!.self().read.report!({ meeting: "M-2", kind: "board", format: "md" }))) as { text: string }
    expect(await readFile(path, "utf8")).toBe(expected.text)
    expect(expected.text).toContain("# Steering committee Q4 · 2026-12-04")
  })

  test("export slug", () => {
    expect(exportFileName({ date: "2026-12-04", title: "SteerCo Q4: CRM/ERP 🚀" }, "board")).toBe("2026-12-04-steerco-q4-crm-erp.md")
    expect(exportFileName({ date: "2026-12-04", title: "SteerCo Q4: CRM/ERP 🚀" }, "minutes")).toBe("2026-12-04-steerco-q4-crm-erp-minutes.md")
    expect(exportFileName({ date: "2026-12-04", title: "🚀🚀" }, "board")).toBe("2026-12-04-meeting.md")
    expect(exportFileName({ date: "2026-12-04", title: "a".repeat(50) }, "board")).toBe(`2026-12-04-${"a".repeat(40)}.md`)
  })

  test("y copies through OSC 52 and says so", async () => {
    const t = await open("M-2", 3)
    await until(t, (f) => f.includes("# Steering committee Q4 · 2026-12-04"))
    const copied: string[] = []
    let accept = true
    ;(t.renderer as any).copyToClipboardOSC52 = (text: string) => (copied.push(text), accept)
    t.input.pressKey("y")
    let frame = await until(t, (f) => statusLine(f).includes("copied to clipboard"))
    expect(statusLine(frame)).toContain("copied to clipboard")
    const expected = (await inCtx(() => kernel!.runtime("meetings")!.self().read.report!({ meeting: "M-2", kind: "board", format: "md" }))) as { text: string }
    expect(copied).toEqual([expected.text])

    clearMessages()
    await until(t, (f) => !statusLine(f).includes("copied"))
    accept = false
    t.input.pressKey("y")
    frame = await until(t, (f) => statusLine(f).includes("OSC 52"))
    expect(statusLine(frame)).toContain("the terminal did not accept the copy (OSC 52)")
    const line = (await t.spans()).lines.find((l) => l.spans.map((s) => s.text).join("").includes("OSC 52"))!
    expect(rgbToHex(line.spans.find((s) => s.text.includes("OSC 52"))!.fg).toLowerCase()).toBe(theme.red)
    expect(copied).toHaveLength(2)
  })
})
