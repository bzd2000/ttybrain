import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { builtinPlugins } from "../../../../tests/builtins"
import { people } from "../../people/logic/index"
import { actions } from "../../actions/logic/index"
import { projects } from "../../projects/logic/index"
import { runWithContext } from "../../../kernel/context"
import { meetings } from "./index"
import type { MeetingRecord } from "./schema"

let k: TestKernel | undefined
afterEach(async () => {
  await k?.cleanup()
  k = undefined
})

const viewCols = (kernel: TestKernel, name: string) =>
  (kernel.db.raw.prepare(`PRAGMA table_info("meetings__pub_${name}")`).all([]) as any[]).map((r) => r.name)

describe("meetings plugin skeleton", () => {
  test("meetings loads after projects and people and publishes its views", async () => {
    k = await makeTestKernel({ plugins: [meetings, projects, people, actions] })
    expect(meetings.requires).toEqual({ projects: "^2", people: "^1", actions: "^2" })
    expect(viewCols(k, "meeting")).toEqual(["id", "title", "date", "kind", "status", "subject_type", "subject_id", "series_id"])
    expect(viewCols(k, "agenda_item")).toEqual(["id", "meeting_id", "position", "text", "project_id", "ask"])
    expect(viewCols(k, "attendee")).toEqual(["meeting_id", "person_id"])
    expect(viewCols(k, "series")).toEqual(["id", "subject_type", "subject_id", "title", "kind", "rhythm", "first_date", "end_date"])
    expect(k.db.raw.prepare(`SELECT * FROM "meetings__pub_meeting"`).all([])).toEqual([])
  })

  test("the built-in plugin list includes meetings", async () => {
    expect(builtinPlugins).toContain(meetings)
    k = await makeTestKernel({ plugins: builtinPlugins })
    expect(viewCols(k, "meeting")).toEqual(["id", "title", "date", "kind", "status", "subject_type", "subject_id", "series_id"])
  })
})

// ---- operations and the "since" rule ----

const inCtx = <T>(fn: () => Promise<T>) => runWithContext(k!.context(), fn)
const api = (plugin: string) => k!.runtime(plugin)!.self() as { read: Record<string, (i: any) => Promise<any>>; write: Record<string, (i: any) => Promise<any>> }
const w = (op: string, input: unknown, plugin = "meetings") => inCtx(() => api(plugin).write[op]!(input))
const r = (op: string, input: unknown) => inCtx(() => api("meetings").read[op]!(input))
const d = (op: string, input: unknown) => inCtx(() => k!.ops.describe("meetings", op, input))
const failure = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as { name: string; message: string; hint?: string; field?: string }
  }
  throw new Error("expected a failure")
}
// The agenda as stored: [position, text] in position order.
const agenda = (meetingId: number) =>
  inCtx(async () =>
    (
      await k!.runtime("meetings")!.data.selectFrom("agenda_item").select(["position", "text"]).where("meeting_id", "=", meetingId).orderBy("position").execute()
    ).map((i) => [Number(i.position), String(i.text)]),
  )

async function boot() {
  k = await makeTestKernel({ plugins: [meetings, projects, people, actions] })
  await w("addPerson", { name: "Peter Janssens", handle: "peter" }, "people")
  await w("addPerson", { name: "Marie Dubois", handle: "marie" }, "people")
  await w("addPerson", { name: "Tom Peeters", handle: "tom" }, "people")
  await w("addProject", { code: "CRM", name: "CRM replatforming" }, "projects")
  await w("addProject", { code: "ERP", name: "ERP upgrade" }, "projects")
}
const steerco = { about: "#CRM", title: "Steering committee Q4", date: "2026-12-04", kind: "steering", attendees: ["peter", "marie"], projects: ["CRM", "ERP"] }

describe("meetings operations", () => {
  test("addMeeting with attendees and projects creates agenda items", async () => {
    await boot()
    expect(await d("addMeeting", steerco)).toBe('+ meeting "Steering committee Q4" 2026-12-04')
    const m: MeetingRecord = await w("addMeeting", steerco)
    expect(m).toEqual({
      ref: "M-1",
      id: 1,
      title: "Steering committee Q4",
      date: "2026-12-04",
      kind: "project",
      status: "planned",
      since_date: null,
      notes: "",
      attendees: ["@marie", "@peter"],
      agenda: [
        { position: 1, text: "CRM replatforming status", project: "#CRM", project_id: 1, ask: null },
        { position: 2, text: "ERP upgrade status", project: "#ERP", project_id: 2, ask: null },
      ],
      about: "#CRM",
      series: null,
    })
    const plain = await w("addMeeting", { about: "tom", title: "1:1", date: "tomorrow" })
    expect([plain.ref, plain.date, plain.kind, plain.attendees, plain.agenda, plain.about]).toEqual(["M-2", "2026-11-14", "one_on_one", ["@tom"], [], "@tom"])
    expect(await d("addMeeting", { about: "#ERP", title: "Next", date: "2026-12-01" })).toBe('+ meeting "Next" 2026-12-01')
    const bad = await failure(w("addMeeting", { about: "#ERP", title: "Next", date: "someday" }))
    expect([bad.name, bad.field]).toEqual(["ValidationError", "date"])
    const none = await failure(w("addMeeting", { title: "Next", date: "2026-12-01" }))
    expect([none.name, none.message]).toEqual(["ValidationError", "meetings.addMeeting: about is required"])
  })

  test("the subject gives the kind; a 1:1 needs a person, a project meeting a project, a board meeting a board; steering and other mean project", async () => {
    await boot()
    await w("addBoard", { code: "MB", name: "Management board" })
    expect((await w("addMeeting", { about: "#CRM", title: "a", date: "today" })).kind).toBe("project")
    const onProject = await failure(w("addMeeting", { about: "CRM", title: "b", date: "today", kind: "board" }))
    expect([onProject.name, onProject.message, onProject.field]).toEqual(["ValidationError", "a board meeting needs a board; #CRM is a project", "kind"])
    expect((await w("addMeeting", { about: "MB", title: "b", date: "today", kind: "board" })).kind).toBe("board")
    expect((await w("addMeeting", { about: "#CRM", title: "c", date: "today", kind: "other" })).kind).toBe("project")
    expect((await w("addMeeting", { about: "@peter", title: "d", date: "today" })).kind).toBe("one_on_one")
    const wrong = await failure(w("addMeeting", { about: "@peter", title: "e", date: "today", kind: "board" }))
    expect([wrong.name, wrong.message, wrong.field]).toEqual(["ValidationError", "a board meeting needs a board; @peter is a person", "kind"])
    const edit = await failure(w("editMeeting", { ref: "M-1", kind: "one_on_one" }))
    expect([edit.message, edit.field]).toEqual(["a 1:1 needs a person; #CRM is a project", "kind"])
    expect(await d("editMeeting", { ref: "M-1", kind: "steering" })).toBe("~ M-1 (no change)")
    // A meeting without a subject cannot become a 1:1 (it has no person).
    k!.db.raw.prepare("UPDATE meetings_meeting SET subject_type = NULL, subject_id = NULL WHERE id = 2").run([])
    const bare = await failure(w("editMeeting", { ref: "M-2", kind: "one_on_one" }))
    expect([bare.name, bare.message, bare.field, bare.hint]).toEqual(["ValidationError", "a 1:1 needs a person; this meeting has no subject", "kind", "run ttybrain meeting subject M-2 @handle first"])
    expect((await w("editMeeting", { ref: "M-2", kind: "board" })).kind).toBe("board")
    await w("setSubject", { meeting: "M-2", about: "#MB" }) // restores the subject for the checks below
    const unknown = await failure(w("addMeeting", { about: "nobody", title: "f", date: "today" }))
    expect([unknown.name, unknown.message]).toEqual(["NotFoundError", 'unknown person, project or board "nobody"'])
    const near = await failure(w("addMeeting", { about: "#CRN", title: "f", date: "today" }))
    expect([near.message, near.hint]).toEqual(['unknown project or board "#CRN"', 'did you mean "#CRM", "#ERP"?'])
    await w("addPerson", { name: "Crm Bot", handle: "crm" }, "people")
    const both = await failure(w("addMeeting", { about: "crm", title: "g", date: "today" }))
    expect([both.name, both.message, both.hint]).toEqual(["ValidationError", '"crm" is both a person and a project', "use @crm or #CRM"])
    // setSubject: a person makes a 1:1, a project a project meeting; a board meeting stays one, so it needs a board.
    expect(await d("setSubject", { meeting: "M-3", about: "@tom" })).toBe("~ M-3 about @tom")
    expect(await w("setSubject", { meeting: "M-3", about: "@tom" })).toMatchObject({ ref: "M-3", kind: "one_on_one", about: "@tom" })
    expect(await w("setSubject", { meeting: "M-3", about: "#ERP" })).toMatchObject({ kind: "project", about: "#ERP" })
    const board = await failure(w("setSubject", { meeting: "M-2", about: "@tom" }))
    expect([board.name, board.message]).toEqual(["ValidationError", "a board meeting needs a board; @tom is a person"])
  })

  test("edit, attendees and agenda change lines", async () => {
    await boot()
    await w("addMeeting", steerco)
    expect(await d("editMeeting", { ref: "M-1", date: "2026-12-11" })).toBe("~ M-1 date 2026-12-04 → 2026-12-11")
    expect(await d("editMeeting", { ref: "M-1", title: "SteerCo Q4", kind: "board" })).toBe('~ M-1 title "Steering committee Q4" → "SteerCo Q4", kind project → board')
    expect(await d("editMeeting", { ref: "1", sinceDate: "2026-10-01" })).toBe("~ M-1 since none → 2026-10-01")
    await w("editMeeting", { ref: "M-1", date: "2026-12-11", sinceDate: "2026-10-01" })
    expect(await d("editMeeting", { ref: "M-1", sinceDate: null })).toBe("~ M-1 since 2026-10-01 → none")
    expect(await d("editMeeting", { ref: "M-1", date: "2026-12-11" })).toBe("~ M-1 (no change)")
    expect((await w("editMeeting", { ref: "M-1", sinceDate: null })).since_date).toBeNull()

    expect(await d("setAttendees", { meeting: "M-1", people: ["peter", "tom"] })).toBe("~ M-1 attendees +@tom −@marie")
    expect((await w("setAttendees", { meeting: "M-1", people: ["tom", "peter"] })).attendees).toEqual(["@peter", "@tom"])
    expect(await d("setAttendees", { meeting: "M-1", people: ["marie", "luc"] })).toBe("~ M-1 attendees +@luc +@marie −@peter −@tom")

    expect(await d("addAgendaItem", { meeting: "M-1", text: "Budget", project: "CRM", ask: "Release contingency" })).toBe('+ M-1 item 3 "Budget"')
    expect(await d("addAgendaItem", { meeting: "M-1", text: "Minutes", position: 1 })).toBe('+ M-1 item 1 "Minutes"')
    const added = await w("addAgendaItem", { meeting: "M-1", text: "Budget", project: "CRM", ask: "Release contingency" })
    expect(added.agenda[2]).toEqual({ position: 3, text: "Budget", project: "#CRM", project_id: 1, ask: "Release contingency" })

    expect(await d("editAgendaItem", { meeting: "M-1", item: 2, ask: "Release contingency" })).toBe('~ M-1 item 2 ask: "Release contingency"')
    expect(await d("editAgendaItem", { meeting: "M-1", item: 3, text: "Budget 2027", project: null, ask: "Release contingency" })).toBe(
      '~ M-1 item 3 text: "Budget 2027", project: none',
    )
    expect(await d("editAgendaItem", { meeting: "M-1", item: 1, project: "erp" })).toBe('~ M-1 item 1 project: "ERP"')
    const edited = await w("editAgendaItem", { meeting: "M-1", item: 3, text: "Budget 2027", project: null, ask: null })
    expect(edited.agenda[2]).toEqual({ position: 3, text: "Budget 2027", project: null, project_id: null, ask: null })

    expect(await d("moveAgendaItem", { meeting: "M-1", item: 3, to: 1 })).toBe("~ M-1 item 3 → 1")
    expect(await d("removeAgendaItem", { meeting: "M-1", item: 2 })).toBe('- M-1 item 2 "ERP upgrade status"')
    expect(await d("setNotes", { meeting: "M-1", markdown: "# Notes" })).toBe("~ M-1 notes")
    expect((await w("setNotes", { meeting: "M-1", markdown: "# Notes" })).notes).toBe("# Notes")
    expect(await d("cancelMeeting", { ref: "M-1" })).toBe("~ M-1 cancelled")
    expect(await d("closeMeeting", { ref: "M-1" })).toBe("~ M-1 held")
  })

  test("agenda positions stay dense on add at a position, move and remove", async () => {
    await boot()
    await w("addMeeting", steerco)
    await w("addAgendaItem", { meeting: "M-1", text: "Minutes & open actions", position: 1 })
    await w("addAgendaItem", { meeting: "M-1", text: "AOB" })
    expect(await agenda(1)).toEqual([
      [1, "Minutes & open actions"],
      [2, "CRM replatforming status"],
      [3, "ERP upgrade status"],
      [4, "AOB"],
    ])
    await w("moveAgendaItem", { meeting: "M-1", item: 4, to: 2 })
    expect(await agenda(1)).toEqual([
      [1, "Minutes & open actions"],
      [2, "AOB"],
      [3, "CRM replatforming status"],
      [4, "ERP upgrade status"],
    ])
    await w("moveAgendaItem", { meeting: "M-1", item: 1, to: 4 })
    await w("removeAgendaItem", { meeting: "M-1", item: 1 })
    expect(await agenda(1)).toEqual([
      [1, "CRM replatforming status"],
      [2, "ERP upgrade status"],
      [3, "Minutes & open actions"],
    ])
    const out = await failure(w("moveAgendaItem", { meeting: "M-1", item: 1, to: 4 }))
    expect([out.name, out.message, out.field]).toEqual(["ValidationError", "M-1 has only 3 items", "to"])
    const past = await failure(w("addAgendaItem", { meeting: "M-1", text: "X", position: 5 }))
    expect([past.name, past.message, past.field]).toEqual(["ValidationError", "M-1 has only 3 items", "position"])
    const missing = await failure(w("removeAgendaItem", { meeting: "M-1", item: 7 }))
    expect([missing.name, missing.message]).toEqual(["NotFoundError", "M-1 has no item 7"])
    await w("removeAgendaItem", { meeting: "M-1", item: 3 })
    await w("addAgendaItem", { meeting: "M-1", text: "AOB", position: 3 })
    expect(await agenda(1)).toEqual([
      [1, "CRM replatforming status"],
      [2, "ERP upgrade status"],
      [3, "AOB"],
    ])
  })

  test("close and cancel rules", async () => {
    await boot()
    await w("addMeeting", steerco)
    await w("addBoard", { code: "MB", name: "Management board" })
    await w("addMeeting", { about: "#MB", title: "Board", date: "2026-12-10", kind: "board" })
    await w("addAction", { title: "Send the minutes", meeting: "M-1" }, "actions")
    await w("addDecision", { title: "Go with B", meeting: "M-2" }, "projects")
    const closed = await w("closeMeeting", { ref: "M-1" })
    expect([closed.ref, closed.status, closed.logged]).toEqual(["M-1", "held", { actions: 1, decisions: 0 }])
    const again = await failure(w("closeMeeting", { ref: "M-1" }))
    expect([again.name, again.message]).toEqual(["ValidationError", "M-1 is already held"])
    expect((await w("setNotes", { meeting: "M-1", markdown: "Finished later" })).notes).toBe("Finished later") // held: still writable
    const held = await failure(w("cancelMeeting", { ref: "M-1" }))
    expect([held.name, held.message]).toEqual(["ValidationError", "M-1 is held"])

    expect((await w("cancelMeeting", { ref: "M-2" })).status).toBe("cancelled")
    for (const [op, input] of [
      ["setNotes", { meeting: "M-2", markdown: "x" }],
      ["editMeeting", { ref: "M-2", title: "x" }],
      ["setAttendees", { meeting: "M-2", people: [] }],
      ["addAgendaItem", { meeting: "M-2", text: "x" }],
      ["closeMeeting", { ref: "M-2" }],
      ["cancelMeeting", { ref: "M-2" }],
    ] as const) {
      const e = await failure(w(op, input))
      expect([op, e.name, e.message]).toEqual([op, "ValidationError", "M-2 is cancelled"])
    }
  })

  test("the M- record type resolves and labels", async () => {
    await boot()
    await w("addMeeting", steerco)
    const rt = k!.runtime("meetings")!
    expect(await inCtx(() => rt.records.resolve("M-1"))).toEqual({ type: "meeting", id: 1 })
    expect(await inCtx(() => rt.records.label("M-1"))).toBe("Steering committee Q4")
    expect(await inCtx(() => rt.records.resolve("M-9"))).toBeNull()
  })

  test("sinceDate: own date, previous held meeting, default", async () => {
    await boot()
    await w("addMeeting", { about: "#CRM", title: "SteerCo Q3", date: "2026-10-28", projects: ["CRM"] })
    await w("closeMeeting", { ref: "M-1" })
    await w("addMeeting", steerco)
    const previous = { ref: "M-1", title: "SteerCo Q3", date: "2026-10-28" }
    expect(await r("sinceDate", { meeting: "M-2", project: "CRM" })).toEqual({ since: "2026-10-28", source: "previous", previous })
    expect(await r("sinceDate", { meeting: "M-2", project: "#erp" })).toEqual({ since: "2026-11-04", source: "default", previous: null })
    expect(await r("sinceDate", { meeting: "M-1", project: "CRM" })).toEqual({ since: "2026-09-28", source: "default", previous: null })
    await w("editMeeting", { ref: "M-2", sinceDate: "2026-10-01" })
    expect(await r("sinceDate", { meeting: "M-2", project: "CRM" })).toEqual({ since: "2026-10-01", source: "meeting", previous })
    expect(await r("sinceDate", { meeting: "M-2", project: "ERP" })).toEqual({ since: "2026-10-01", source: "meeting", previous: null })
  })

  test("sinceDate ignores cancelled, planned and later meetings", async () => {
    await boot()
    const add = (title: string, date: string, projects = ["CRM"]) => w("addMeeting", { about: "#CRM", title, date, projects })
    await add("Q3", "2026-10-01") // M-1 held: counts
    await add("Cancelled", "2026-10-15") // M-2 cancelled
    await add("Planned", "2026-10-20") // M-3 planned
    await add("Target", "2026-11-20") // M-4
    await add("Later", "2026-12-01") // M-5 held, later
    await add("Same day", "2026-11-20") // M-6 held, same date, higher id than M-4
    await add("Other project", "2026-10-25", ["ERP"]) // M-7 held, no CRM item
    for (const ref of ["M-1", "M-5", "M-6", "M-7"]) await w("closeMeeting", { ref })
    await w("cancelMeeting", { ref: "M-2" })
    expect(await r("sinceDate", { meeting: "M-4", project: "CRM" })).toEqual({
      since: "2026-10-01",
      source: "previous",
      previous: { ref: "M-1", title: "Q3", date: "2026-10-01" },
    })
    await w("closeMeeting", { ref: "M-4" })
    expect(await r("sinceDate", { meeting: "M-6", project: "CRM" })).toEqual({
      since: "2026-11-20",
      source: "previous",
      previous: { ref: "M-4", title: "Target", date: "2026-11-20" },
    })
    expect((await r("sinceDate", { meeting: "M-4", project: "CRM" })).previous.ref).toBe("M-1")
    const unknown = await failure(r("sinceDate", { meeting: "M-4", project: "CRN" }))
    expect([unknown.name, unknown.message, unknown.hint]).toEqual(["NotFoundError", 'unknown project "CRN"', 'did you mean "CRM", "ERP"?'])
  })

  test("unknown attendee or project suggests", async () => {
    await boot()
    const person = await failure(w("addMeeting", { ...steerco, attendees: ["petr"] }))
    expect([person.name, person.message, person.hint]).toEqual(["NotFoundError", 'unknown person "petr"', 'did you mean "peter"?'])
    const project = await failure(w("addMeeting", { ...steerco, projects: ["CRM", "CRN"] }))
    expect([project.name, project.message, project.hint]).toEqual(["NotFoundError", 'unknown project "CRN"', 'did you mean "CRM", "ERP"?'])
    expect(await inCtx(() => k!.runtime("meetings")!.data.selectFrom("meeting").select("id").execute())).toEqual([]) // rolled back
    await w("addMeeting", steerco)
    const later = await failure(w("setAttendees", { meeting: "M-1", people: ["marei"] }))
    expect([later.name, later.message, later.hint]).toEqual(["NotFoundError", 'unknown person "marei"', 'did you mean "marie"?'])
  })
})
