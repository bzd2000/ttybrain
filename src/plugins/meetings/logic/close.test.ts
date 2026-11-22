// The meeting flow (design §5.2, §5.3, rulings M4–M6): agreed actions are real actions linked to the meeting and its
// subject; closing a meeting marks it held, keeps its unticked talk items open for next time (and remembers them, so
// the held meeting still shows what it covered), stores a 1:1's notes on the person as a 1:1 note, and says so in one
// line; a meeting not closed 3 days after its date closes itself the same way (the `auto-close` upkeep).
import { afterEach, describe, expect, test } from "bun:test"
import { builtinPlugins } from "../../../../tests/builtins"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { fixedClock } from "../../../kernel/clock"
import { runWithContext } from "../../../kernel/context"
import { bootKernel, type Kernel } from "../../../kernel/host"

let kernels: Kernel[] = []
let home: TestKernel | undefined
afterEach(async () => {
  for (const k of kernels.reverse()) await k.shutdown()
  kernels = []
  await home?.cleanup()
  home = undefined
})

type Api = { read: Record<string, (i: any) => Promise<any>>; write: Record<string, (i: any) => Promise<any>> }
const api = (k: Kernel, plugin = "meetings") => k.runtime(plugin)!.self() as Api
const w = (k: Kernel, op: string, input: unknown, plugin = "meetings") => runWithContext(k.context(), () => api(k, plugin).write[op]!(input))
const r = (k: Kernel, op: string, input: unknown) => runWithContext(k.context(), () => api(k).read[op]!(input))
const failure = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as { name: string; message: string }
  }
  throw new Error("expected a failure")
}

async function cli(k: Kernel, ...argv: string[]): Promise<{ code: number; out: string; err: string; json: any }> {
  let out = ""
  let err = ""
  const code = await runCli(argv, k, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => "" })
  let json: any
  try {
    json = JSON.parse(out)
  } catch {}
  return { code, out, err, json }
}

const sql = (k: Kernel, q: string) => k.db.raw.prepare(q).all([]) as any[]
// The meetings as stored: [ref, date, status].
const meetingRows = (k: Kernel) => sql(k, "SELECT id, date, status FROM meetings_meeting ORDER BY date, id").map((m) => [`M-${m.id}`, m.date, m.status])
// The talk items as stored: [ref, position, status, meeting].
const talkRows = (k: Kernel) =>
  sql(k, "SELECT id, position, status, meeting_id FROM meetings_talk_item ORDER BY id").map((t) => [`T-${t.id}`, t.position, t.status, t.meeting_id === null ? null : `M-${t.meeting_id}`])
const notesOn = (k: Kernel) => sql(k, "SELECT person_id, kind, date, text FROM people_note ORDER BY id")
const refs = (items: Array<{ ref: string }>) => items.map((t) => t.ref)

// Anna (person 1), Bob (2), Karim (3); CRM (project 1), ERP (2), BOARD (3).
async function boot(today: string): Promise<TestKernel> {
  home = await makeTestKernel({ plugins: builtinPlugins, today })
  await w(home, "addPerson", { name: "Anna Peeters", handle: "anna" }, "people")
  await w(home, "addPerson", { name: "Bob Willems", handle: "bob" }, "people")
  await w(home, "addPerson", { name: "Karim Haddad", handle: "karim" }, "people")
  await w(home, "addProject", { code: "CRM", name: "CRM replatforming" }, "projects")
  await w(home, "addProject", { code: "ERP", name: "ERP upgrade" }, "projects")
  await w(home, "addProject", { code: "BOARD", name: "Management board" }, "projects")
  return home
}
async function later(today: string): Promise<Kernel> {
  const k = await bootKernel({ env: { TTYBRAIN_HOME: home!.home, TTYBRAIN_TEST: "1" }, plugins: builtinPlugins, clock: fixedClock(today) })
  kernels.push(k)
  return k
}

const NOTES = "AWS: she wants the Solutions Architect Associate in Q1.\n\nWorkload is OK now that the CRM design is in review."

// The `oneonone` mock: Mon 23 Nov 2026, 1:1 Anna with five talk items (one carried over from 9 Nov), two ticked, two
// actions agreed, notes written.
async function oneOnOne(): Promise<Kernel> {
  const k = await boot("2026-11-09")
  await w(k, "addTalk", { about: "@anna", text: "Workload: two projects at once" }) // T-1, from before 9 Nov's 1:1
  await w(k, "addMeeting", { about: "@anna", title: "1:1 Anna", date: "2026-11-09" }) // M-1
  await w(k, "closeMeeting", { ref: "M-1" })
  const next = await later("2026-11-23")
  await w(next, "addTalk", { about: "@anna", text: "AWS training budget for next year" }) // T-2
  await w(next, "addTalk", { about: "@anna", text: "Her view on Vendor B's architecture", project: "ERP" }) // T-3
  await w(next, "addTalk", { about: "@anna", text: "Feedback from Marie on the demo", project: "CRM" }) // T-4
  await w(next, "addTalk", { about: "@anna", text: "Holiday planning around go-live" }) // T-5
  await w(next, "addMeeting", { about: "@anna", title: "1:1 Anna", date: "2026-11-23" }) // M-2
  await w(next, "discussTalk", { ref: "T-2", meeting: "M-2" })
  await w(next, "discussTalk", { ref: "T-1", meeting: "M-2" })
  const links = await r(next, "agreeLinks", { meeting: "M-2" })
  await w(next, "addAction", { title: "Approve AWS training", due: "2026-11-27", links }, "actions")
  await w(next, "addAction", { title: "Hand over DWH reviews to Mathias", owner: "anna", due: "2026-12-04", links }, "actions")
  await w(next, "setNotes", { meeting: "M-2", markdown: NOTES })
  return next
}

describe("closing a meeting", () => {
  test("the oneonone mock: the close message, exactly", async () => {
    const k = await oneOnOne()
    const res = await cli(k, "meeting", "close", "M-2")
    expect([res.code, res.out, res.err]).toEqual([0, "1:1 Anna closed · 2 discussed, 3 kept for next time · 2 actions created · notes saved\n", ""])
  })

  test("the close result: the meeting, the counts, the message (logged kept for compatibility)", async () => {
    const k = await oneOnOne()
    const out = await w(k, "closeMeeting", { ref: "M-2" })
    expect(out).toMatchObject({
      ref: "M-2",
      status: "held",
      notes: NOTES,
      logged: { actions: 2, decisions: 0 },
      discussed: 2,
      kept: 3,
      actions: 2,
      notesSaved: true,
      message: "1:1 Anna closed · 2 discussed, 3 kept for next time · 2 actions created · notes saved",
    })
    expect((await cli(k, "meeting", "close", "M-2", "--json")).code).toBe(1) // already held
  })

  test("agreed actions link to the meeting and its subject", async () => {
    const k = await oneOnOne()
    expect(await r(k, "agreeLinks", { meeting: "M-2" })).toEqual(["M-2", "@anna"])
    const shown = await cli(k, "action", "list", "--json")
    expect(shown.json.map((a: any) => [a.ref, a.links.map((l: any) => l.ref)])).toEqual([
      ["A-1", ["M-2", "@anna"]],
      ["A-2", ["M-2", "@anna"]],
    ])
    await w(k, "addMeeting", { about: "#CRM", title: "CRM steering", date: "2026-11-24" }) // M-3
    expect(await r(k, "agreeLinks", { meeting: "M-3" })).toEqual(["M-3", "#CRM"])
    expect((await failure(r(k, "agreeLinks", { meeting: "M-9" }))).message).toBe('unknown meeting "M-9"')
  })

  test("the notes land on Anna as a 1:1 note dated the meeting's day, and stay on the meeting", async () => {
    const k = await oneOnOne()
    await w(k, "closeMeeting", { ref: "M-2" })
    expect(notesOn(k)).toEqual([{ person_id: 1, kind: "one_on_one", date: "2026-11-23", text: NOTES }])
    expect((await cli(k, "meeting", "show", "M-2", "--json")).json.notes).toBe(NOTES)
  })

  test("unticked items stay open for next time, ticked ones are discussed in M-2; the held meeting keeps what it covered", async () => {
    const k = await oneOnOne()
    await w(k, "closeMeeting", { ref: "M-2" })
    expect(talkRows(k)).toEqual([
      ["T-1", null, "discussed", "M-2"],
      ["T-2", null, "discussed", "M-2"],
      ["T-3", 1, "open", null],
      ["T-4", 2, "open", null],
      ["T-5", 3, "open", null],
    ])
    // Ticked at the same moment (a fixed clock): in id order. Added after the close: on Anna's list, not on the held
    // meeting's agenda.
    await w(k, "addTalk", { about: "@anna", text: "Conference in May" }) // T-6
    expect(refs((await r(k, "agendaFor", { meeting: "M-2" })).items)).toEqual(["T-1", "T-2", "T-3", "T-4", "T-5"])
    // Discussed later elsewhere: the held meeting still lists it as kept.
    await w(k, "discussTalk", { ref: "T-5" })
    expect(refs((await r(k, "agendaFor", { meeting: "M-2" })).items)).toEqual(["T-1", "T-2", "T-3", "T-4", "T-5"])
    // The minutes list what was discussed, between the notes and the decisions.
    const minutes = await cli(k, "report", "minutes", "M-2", "--json")
    expect(minutes.json.sections.map((s: any) => s.title)).toEqual(["Attendees", "Notes", "Discussed", "Decisions", "Actions"])
    expect(minutes.json.sections[2]).toMatchObject({
      columns: ["ID", "Item", "Project"],
      rows: [
        { ID: "T-1", Item: "Workload: two projects at once", Project: null },
        { ID: "T-2", Item: "AWS training budget for next year", Project: null },
      ],
    })
  })

  test("each part of the message only when there is one; a project meeting names itself by its title", async () => {
    const k = await boot("2026-11-24")
    await w(k, "addTalk", { about: "#CRM", text: "Shift design milestone by 2 weeks" }) // T-1
    await w(k, "addTalk", { about: "#CRM", text: "Release contingency budget" }) // T-2
    await w(k, "addMeeting", { about: "#CRM", title: "CRM steering", date: "2026-11-24" }) // M-1
    await w(k, "discussTalk", { ref: "T-1", meeting: "M-1" })
    await w(k, "discussTalk", { ref: "T-2", meeting: "M-1" })
    await w(k, "setNotes", { meeting: "M-1", markdown: "Shift approved." })
    expect((await cli(k, "meeting", "close", "M-1")).out).toBe("CRM steering closed · 2 discussed\n")
    expect(notesOn(k)).toEqual([]) // a project meeting keeps its notes on the meeting

    await w(k, "addMeeting", { about: "@bob", title: "1:1 Bob", date: "2026-11-24" }) // M-2: nothing on it
    expect((await cli(k, "meeting", "close", "M-2")).out).toBe("1:1 Bob closed\n")
    expect(notesOn(k)).toEqual([]) // no notes, none saved

    await w(k, "addTalk", { about: "@karim", text: "Team offsite" }) // T-3
    await w(k, "addMeeting", { about: "@karim", title: "Catch-up", date: "2026-11-24" }) // M-3
    await w(k, "addAction", { title: "Book the venue", links: await r(k, "agreeLinks", { meeting: "M-3" }) }, "actions")
    expect((await cli(k, "meeting", "close", "M-3")).out).toBe("1:1 Karim closed · 1 kept for next time · 1 action created\n")

    // A cancelled action agreed in the meeting is not counted as created (it still shows as logged).
    await w(k, "addMeeting", { about: "#ERP", title: "ERP vendor call", date: "2026-11-24" }) // M-4
    await w(k, "addAction", { title: "Dropped idea", links: ["M-4"] }, "actions") // A-2
    await w(k, "cancelAction", { ref: "A-2" }, "actions")
    const erp = await w(k, "closeMeeting", { ref: "M-4" })
    expect([erp.message, erp.actions, erp.logged]).toEqual(["ERP vendor call closed", 0, { actions: 1, decisions: 0 }])
  })

  test("an archived person's 1:1: the notes stay on the meeting only", async () => {
    const k = await boot("2026-11-23")
    await w(k, "addMeeting", { about: "@bob", title: "1:1 Bob", date: "2026-11-23" })
    await w(k, "setNotes", { meeting: "M-1", markdown: "Last one before he leaves." })
    await w(k, "archivePerson", { ref: "@bob" }, "people")
    expect(await w(k, "closeMeeting", { ref: "M-1" })).toMatchObject({ status: "held", notesSaved: false, notes: "Last one before he leaves.", message: "1:1 Bob closed" })
    expect(notesOn(k)).toEqual([])
  })
})

describe("auto-close", () => {
  test("a held meeting not yet closed shows when it closes itself (upcoming: closes_on)", async () => {
    const k = await boot("2026-11-18")
    await w(k, "addMeeting", { about: "@karim", title: "1:1 Karim", date: "2026-11-18" }) // M-1, Wed 18
    await w(k, "addMeeting", { about: "@anna", title: "1:1 Anna", date: "2026-11-23" }) // M-2, Mon 23
    const next = await later("2026-11-20") // Fri 20, as the meetings mock
    await next.upkeep()
    const up = await r(next, "upcoming", { from: "2026-11-17", to: "2026-11-27" })
    expect(up.meetings.map((m: any) => [m.ref, m.date, m.status, m.closes_on])).toEqual([
      ["M-1", "2026-11-18", "planned", "2026-11-21"], // "Held, closes itself Sat"
      ["M-2", "2026-11-23", "planned", "2026-11-26"],
    ])
    // Sat 21: three days after its date, it closes itself.
    const sat = await later("2026-11-21")
    await sat.upkeep()
    expect(meetingRows(sat)).toEqual([
      ["M-1", "2026-11-18", "held"],
      ["M-2", "2026-11-23", "planned"],
    ])
  })

  test("closing a meeting that closed itself: already held, and the hint says it closed itself", async () => {
    const k = await boot("2026-11-18")
    await w(k, "addMeeting", { about: "@karim", title: "1:1 Karim", date: "2026-11-18" }) // M-1
    await w(k, "addMeeting", { about: "@anna", title: "1:1 Anna", date: "2026-11-18" }) // M-2, closed by hand
    await w(k, "closeMeeting", { ref: "M-2" })
    const sat = await later("2026-11-21")
    await sat.upkeep()
    const res = await cli(sat, "meeting", "close", "M-1")
    expect([res.code, res.out, res.err]).toEqual([
      1,
      "",
      "error: M-1 is already held\nhint: it closed itself 3 days after its date; see ttybrain report minutes M-1\n",
    ])
    // Closed by hand: no hint.
    expect((await cli(sat, "meeting", "close", "M-2")).err).toBe("error: M-2 is already held\n")
  })

  test("a meeting added with a past date never closes itself; one dated today or later does (as meeting subject, M4)", async () => {
    const k = await boot("2026-11-20")
    await w(k, "addMeeting", { about: "@karim", title: "1:1 Karim", date: "2026-11-10" }) // M-1: past
    await w(k, "addMeeting", { about: "@anna", title: "1:1 Anna", date: "today" }) // M-2
    await w(k, "addMeeting", { about: "@bob", title: "1:1 Bob", date: "2026-11-25" }) // M-3
    expect(sql(k, "SELECT id, auto_close FROM meetings_meeting ORDER BY id")).toEqual([
      { id: 1, auto_close: 0 },
      { id: 2, auto_close: 1 },
      { id: 3, auto_close: 1 },
    ])
    const up = await r(k, "upcoming", { from: "2026-11-01", to: "2026-11-30" })
    expect(up.meetings.map((m: any) => [m.ref, m.closes_on])).toEqual([
      ["M-1", null],
      ["M-2", "2026-11-23"],
      ["M-3", "2026-11-28"],
    ])
    const dec = await later("2026-12-01")
    await dec.upkeep()
    expect(meetingRows(dec)).toEqual([
      ["M-1", "2026-11-10", "planned"],
      ["M-2", "2026-11-20", "held"],
      ["M-3", "2026-11-25", "held"],
    ])
  })

  test("Review Focus 3: not opened for three weeks, the next write-capable start closes every overdue meeting, keeps unticked items, makes only future occurrences", async () => {
    const k = await boot("2026-11-02") // Mon 2 Nov
    await w(k, "addSeries", { about: "@anna", title: "1:1 Anna", every: "weekly on mon", from: "today" }) // M-1 … M-8: 2 Nov … 21 Dec
    await w(k, "addTalk", { about: "@anna", text: "AWS training budget" }) // T-1
    await w(k, "addTalk", { about: "@anna", text: "Holiday planning" }) // T-2
    await w(k, "discussTalk", { ref: "T-1", meeting: "M-1" })
    await w(k, "setNotes", { meeting: "M-1", markdown: "Budget OK." })
    await w(k, "addMeeting", { about: "#CRM", title: "CRM kick-off", date: "2026-11-05" }) // M-9
    await w(k, "addMeeting", { about: "#CRM", title: "CRM workshop", date: "2026-11-21" }) // M-10: less than 3 days ago
    // A meeting that never closes itself (as one from before subjects, M4).
    await w(k, "addMeeting", { about: "#ERP", title: "ERP review", date: "2026-11-03" }) // M-11
    k.db.raw.prepare("UPDATE meetings_meeting SET auto_close = 0 WHERE id = 11").run([])

    const next = await later("2026-11-23") // three weeks later: a read-only start changes nothing
    expect(meetingRows(next).filter((m) => m[2] === "held")).toEqual([])
    await w(next, "addPerson", { name: "Sofie Lambert", handle: "sofie" }, "people") // a write: the upkeeps run first
    expect(meetingRows(next)).toEqual([
      ["M-1", "2026-11-02", "held"],
      ["M-11", "2026-11-03", "planned"],
      ["M-9", "2026-11-05", "held"],
      ["M-2", "2026-11-09", "held"],
      ["M-3", "2026-11-16", "held"],
      ["M-10", "2026-11-21", "planned"],
      ["M-4", "2026-11-23", "planned"],
      ["M-5", "2026-11-30", "planned"],
      ["M-6", "2026-12-07", "planned"],
      ["M-7", "2026-12-14", "planned"],
      ["M-8", "2026-12-21", "planned"],
      ["M-12", "2026-12-28", "planned"],
      ["M-13", "2027-01-04", "planned"],
      ["M-14", "2027-01-11", "planned"],
    ])
    // The ticked item is discussed in M-1; the unticked one stays open and was kept by each 1:1 closed.
    expect(talkRows(next)).toEqual([
      ["T-1", null, "discussed", "M-1"],
      ["T-2", 1, "open", null],
    ])
    expect(refs((await r(next, "agendaFor", { meeting: "M-1" })).items)).toEqual(["T-1", "T-2"])
    expect(refs((await r(next, "agendaFor", { meeting: "M-3" })).items)).toEqual(["T-2"])
    // M-1's notes are on Anna, as a manual close would put them.
    expect(notesOn(next)).toEqual([{ person_id: 1, kind: "one_on_one", date: "2026-11-02", text: "Budget OK." }])
    // Run again (a TUI's day change): nothing more to do.
    const again = await later("2026-11-23")
    expect(await again.upkeep()).toBe(false)
    expect(notesOn(again)).toHaveLength(1)
  })
})
