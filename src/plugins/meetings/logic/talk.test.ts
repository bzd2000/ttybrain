// Talk-lists (design §5.3, rulings M5 and M12): things to raise with a person or about a project. Items keep a dense
// 1..n position per subject while open; dropping or discussing one takes it out of that order. A person's item tagged
// with a project also shows on that project's meetings until it is discussed in either place. Items added before the
// subject's last held meeting are the "carried over" group. An item whose subject or tag no longer resolves stays
// listed (Review Focus 4).
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
const d = (k: Kernel, op: string, input: unknown) => runWithContext(k.context(), () => k.ops.describe("meetings", op, input))
const failure = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as { name: string; message: string; hint?: string; field?: string }
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

// The items as stored: [ref, subject, position, status, meeting_id].
const stored = (k: Kernel) =>
  (k.db.raw.prepare("SELECT id, subject_type, subject_id, position, status, meeting_id FROM meetings_talk_item ORDER BY id").all([]) as any[]).map((t) => [
    `T-${t.id}`,
    `${t.subject_type}:${t.subject_id}`,
    t.position,
    t.status,
    t.meeting_id,
  ])
const refs = (items: Array<{ ref: string }>) => items.map((t) => t.ref)

// Today Fri 20 Nov 2026 (the mock's); Anna (person 1), Bob (person 2), CRM (project 1), ERP (2), BOARD (3).
async function boot(today = "2026-11-20"): Promise<TestKernel> {
  home = await makeTestKernel({ plugins: builtinPlugins, today })
  await w(home, "addPerson", { name: "Anna Peeters", handle: "anna" }, "people")
  await w(home, "addPerson", { name: "Bob Willems", handle: "bob" }, "people")
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

describe("talk-lists", () => {
  test("add, reorder, drop: positions stay 1..n per subject", async () => {
    const k = await boot()
    const t1 = await w(k, "addTalk", { about: "@anna", text: "AWS training budget for next year" })
    expect(t1).toEqual({
      ref: "T-1",
      id: 1,
      about: "@anna",
      text: "AWS training budget for next year",
      project: null,
      added_date: "2026-11-20",
      position: 1,
      status: "open",
      meeting: null,
    })
    expect(await w(k, "addTalk", { about: "anna", text: " Her view on Vendor B's architecture ", project: "erp" })).toEqual({
      ref: "T-2",
      id: 2,
      about: "@anna",
      text: "Her view on Vendor B's architecture",
      project: "#ERP",
      added_date: "2026-11-20",
      position: 2,
      status: "open",
      meeting: null,
    })
    await w(k, "addTalk", { about: "@anna", text: "Holiday planning around go-live" })
    expect(await w(k, "addTalk", { about: "#CRM", text: "Data migration rehearsal" })).toMatchObject({ ref: "T-4", about: "#CRM", position: 1 })

    expect(await w(k, "moveTalk", { ref: "T-3", to: 1 })).toMatchObject({ ref: "T-3", position: 1 })
    expect(stored(k)).toEqual([
      ["T-1", "person:1", 2, "open", null],
      ["T-2", "person:1", 3, "open", null],
      ["T-3", "person:1", 1, "open", null],
      ["T-4", "project:1", 1, "open", null],
    ])
    expect(await w(k, "dropTalk", { ref: "T-1" })).toMatchObject({ ref: "T-1", status: "dropped", position: null, meeting: null })
    expect(stored(k)).toEqual([
      ["T-1", "person:1", null, "dropped", null],
      ["T-2", "person:1", 2, "open", null],
      ["T-3", "person:1", 1, "open", null],
      ["T-4", "project:1", 1, "open", null],
    ])
    expect(await w(k, "editTalk", { ref: "T-2", text: "Vendor B's architecture", project: null })).toMatchObject({ ref: "T-2", text: "Vendor B's architecture", project: null })

    const list = await r(k, "talkList", { about: "@anna" })
    expect(list).toEqual({
      open: [
        { ref: "T-3", id: 3, about: "@anna", text: "Holiday planning around go-live", project: null, added_date: "2026-11-20", position: 1, status: "open", meeting: null },
        { ref: "T-2", id: 2, about: "@anna", text: "Vendor B's architecture", project: null, added_date: "2026-11-20", position: 2, status: "open", meeting: null },
      ],
      carried: [],
    })

    // Reopening puts it back at the end.
    expect(await w(k, "reopenTalk", { ref: "T-1" })).toMatchObject({ ref: "T-1", status: "open", position: 3 })

    expect(await d(k, "addTalk", { about: "@anna", text: "x", project: "ERP" })).toBe('+ talk @anna "x" #ERP')
    expect(await d(k, "moveTalk", { ref: "T-1", to: 1 })).toBe("~ T-1 position 3 → 1")
    expect(await d(k, "dropTalk", { ref: "t-1" })).toBe("~ T-1 dropped")
    expect(await d(k, "discussTalk", { ref: "T-1", meeting: "M-4" })).toBe("~ T-1 discussed in M-4")
    expect(await d(k, "reopenTalk", { ref: "T-1" })).toBe("~ T-1 reopened")
    expect(await d(k, "editTalk", { ref: "T-1", text: "y", project: null })).toBe('~ T-1 text "y", project none')
  })

  test("validation: unknown subject, a tag that is not a project, a move out of range, states", async () => {
    const k = await boot()
    const nobody = await failure(w(k, "addTalk", { about: "@nobody", text: "x" }))
    expect([nobody.name, nobody.message]).toEqual(["NotFoundError", 'unknown person "@nobody"'])
    const tag = await failure(w(k, "addTalk", { about: "@anna", text: "x", project: "@bob" }))
    expect([tag.name, tag.message]).toEqual(["NotFoundError", 'unknown project "@BOB"'])
    await w(k, "addTalk", { about: "@anna", text: "one" })
    const move = await failure(w(k, "moveTalk", { ref: "T-1", to: 2 }))
    expect([move.name, move.message, move.field, move.hint]).toEqual(["ValidationError", "@anna's talk-list has 1 open item", "to", "use 1 to 1"])
    const missing = await failure(w(k, "dropTalk", { ref: "T-9" }))
    expect([missing.name, missing.message]).toEqual(["NotFoundError", 'unknown talk item "T-9"'])
    await w(k, "dropTalk", { ref: "T-1" })
    expect((await failure(w(k, "dropTalk", { ref: "T-1" }))).message).toBe("T-1 is dropped")
    expect((await failure(w(k, "moveTalk", { ref: "T-1", to: 1 }))).message).toBe("T-1 is dropped")
    expect((await failure(w(k, "discussTalk", { ref: "T-1" }))).message).toBe("T-1 is dropped")
    await w(k, "reopenTalk", { ref: "T-1" })
    expect((await failure(w(k, "reopenTalk", { ref: "T-1" }))).message).toBe("T-1 is open")
    expect(stored(k)).toEqual([["T-1", "person:1", 1, "open", null]])
  })

  test("a person's item tagged #ERP is on Anna's list and on the ERP meeting's agenda; discussed in the 1:1 it is off both", async () => {
    const k = await boot()
    const oneOnOne = await w(k, "addMeeting", { about: "@anna", title: "1:1 Anna", date: "2026-11-23" }) // M-1
    const erp = await w(k, "addMeeting", { about: "#ERP", title: "ERP steering", date: "2026-11-24" }) // M-2
    await w(k, "addTalk", { about: "@anna", text: "AWS training budget" }) // T-1
    await w(k, "addTalk", { about: "@anna", text: "Vendor B's architecture", project: "#ERP" }) // T-2
    await w(k, "addTalk", { about: "#ERP", text: "Vendor shortlist" }) // T-3
    await w(k, "addTalk", { about: "#ERP", text: "Licence costs" }) // T-4
    await w(k, "addTalk", { about: "@bob", text: "Test data for ERP", project: "ERP" }) // T-5
    await w(k, "addTalk", { about: "#CRM", text: "Not for ERP", project: "ERP" }) // T-6: a project's own item; its tag shows nowhere else

    expect(refs((await r(k, "talkList", { about: "@anna" })).open)).toEqual(["T-1", "T-2"])
    // The project's list: its own items, then those tagged with it on people's lists.
    expect(refs((await r(k, "talkList", { about: "#ERP" })).open)).toEqual(["T-3", "T-4", "T-2", "T-5"])
    expect(refs((await r(k, "agendaFor", { meeting: oneOnOne.ref })).items)).toEqual(["T-1", "T-2"])
    expect(refs((await r(k, "agendaFor", { meeting: erp.ref })).items)).toEqual(["T-3", "T-4", "T-2", "T-5"])

    expect(await w(k, "discussTalk", { ref: "T-2", meeting: "M-1" })).toMatchObject({ ref: "T-2", status: "discussed", position: null, meeting: "M-1" })
    expect(refs((await r(k, "talkList", { about: "@anna" })).open)).toEqual(["T-1"])
    expect(refs((await r(k, "talkList", { about: "#ERP" })).open)).toEqual(["T-3", "T-4", "T-5"])
    // The meeting it was discussed in keeps it on its agenda, ticked, first; the other meeting no longer has it.
    const agenda = await r(k, "agendaFor", { meeting: "M-1" })
    expect(agenda.meeting).toBe("M-1")
    expect(agenda.items.map((t: any) => [t.ref, t.status])).toEqual([
      ["T-2", "discussed"],
      ["T-1", "open"],
    ])
    expect(refs((await r(k, "agendaFor", { meeting: "M-2" })).items)).toEqual(["T-3", "T-4", "T-5"])
    expect(stored(k).find((t) => t[0] === "T-1")).toEqual(["T-1", "person:1", 1, "open", null])

    // Ticking it again in the meeting reopens it (M5): back on both, at the end of Anna's list.
    await w(k, "reopenTalk", { ref: "T-2" })
    expect(refs((await r(k, "talkList", { about: "@anna" })).open)).toEqual(["T-1", "T-2"])
    // Discussed at the ERP meeting instead: off Anna's list too.
    expect(await w(k, "discussTalk", { ref: "T-2", meeting: "M-2" })).toMatchObject({ status: "discussed", meeting: "M-2" })
    expect(refs((await r(k, "talkList", { about: "@anna" })).open)).toEqual(["T-1"])
    expect(refs((await r(k, "agendaFor", { meeting: "M-1" })).items)).toEqual(["T-1"])
    expect((await r(k, "agendaFor", { meeting: "M-2" })).items.map((t: any) => [t.ref, t.status])).toEqual([
      ["T-3", "open"],
      ["T-4", "open"],
      ["T-2", "discussed"],
      ["T-5", "open"],
    ])

    // Only in a meeting it is on, and only once; a cancelled meeting takes nothing.
    const other = await failure(w(k, "discussTalk", { ref: "T-1", meeting: "M-2" }))
    expect([other.name, other.message]).toEqual(["ValidationError", "T-1 is not on M-2's agenda"])
    expect((await failure(w(k, "discussTalk", { ref: "T-2", meeting: "M-2" }))).message).toBe("T-2 is already discussed (M-2)")
    await w(k, "cancelMeeting", { ref: "M-1" })
    expect((await failure(w(k, "discussTalk", { ref: "T-1", meeting: "M-1" }))).message).toBe("M-1 is cancelled")
    // Without a meeting (talked about elsewhere).
    expect(await w(k, "discussTalk", { ref: "T-1" })).toMatchObject({ ref: "T-1", status: "discussed", meeting: null })
  })

  test("a board meeting's agenda read is the board project's talk-list, not its agenda items", async () => {
    const k = await boot()
    const board = await w(k, "addMeeting", { about: "#BOARD", title: "Board", date: "2026-12-04", kind: "board", projects: ["CRM"] })
    await w(k, "addTalk", { about: "#BOARD", text: "Budget round 2027" }) // T-1
    await w(k, "addTalk", { about: "#BOARD", text: "Office move" }) // T-2
    await w(k, "addTalk", { about: "#CRM", text: "Not the board's" }) // T-3
    const agenda = await r(k, "agendaFor", { meeting: board.ref })
    expect(refs(agenda.items)).toEqual(["T-1", "T-2"])
    // Taken onto the agenda (M8): discussed in the board meeting, no longer on its talk-list.
    await w(k, "discussTalk", { ref: "T-1", meeting: board.ref })
    expect(refs((await r(k, "agendaFor", { meeting: board.ref })).items)).toEqual(["T-2"])
    // A meeting without a subject has no talk-list.
    k.db.raw.prepare("UPDATE meetings_meeting SET subject_type = NULL, subject_id = NULL WHERE id = 1").run([])
    expect(await r(k, "agendaFor", { meeting: "M-1" })).toEqual({ meeting: "M-1", items: [] })
  })

  test("carried: open items added before the subject's last held meeting", async () => {
    const k0 = await boot("2026-11-02")
    await w(k0, "addTalk", { about: "@anna", text: "Workload: two projects at once" }) // T-1, 2 Nov
    await w(k0, "addTalk", { about: "@anna", text: "Old item, discussed" }) // T-2, 2 Nov
    const k9 = await later("2026-11-09")
    await w(k9, "addMeeting", { about: "@anna", title: "1:1 Anna", date: "2026-11-09" }) // M-1
    await w(k9, "discussTalk", { ref: "T-2", meeting: "M-1" })
    await w(k9, "closeMeeting", { ref: "M-1" })
    await w(k9, "addTalk", { about: "@anna", text: "Added on the day of the meeting" }) // T-3, 9 Nov: not before it
    const k = await later("2026-11-20")
    await w(k, "addMeeting", { about: "@anna", title: "1:1 Anna", date: "2026-11-30" }) // M-2, planned: not held
    await w(k, "addTalk", { about: "@anna", text: "AWS training budget" }) // T-4
    const list = await r(k, "talkList", { about: "@anna" })
    expect(list.carriedFrom).toBe("2026-11-09")
    expect(refs(list.open)).toEqual(["T-3", "T-4"])
    expect(list.carried).toEqual([
      { ref: "T-1", id: 1, about: "@anna", text: "Workload: two projects at once", project: null, added_date: "2026-11-02", position: 1, status: "open", meeting: null },
    ])
    // No held meeting with Bob: nothing is carried.
    expect(await r(k, "talkList", { about: "@bob" })).toEqual({ open: [], carried: [] })

    const shown = await cli(k, "talk", "list", "@anna")
    expect(shown.code).toBe(0)
    expect(shown.out).toBe(
      [
        "@anna · 2 open, 1 carried",
        "2. T-3  Added on the day of the meeting  —  2026-11-09",
        "3. T-4  AWS training budget              —  2026-11-20",
        "carried over from 2026-11-09",
        "1. T-1  Workload: two projects at once   —  2026-11-02",
        "",
      ].join("\n"),
    )
  })

  test("the CLI: talk add, list, move, done, drop", async () => {
    const k = await boot()
    await w(k, "addMeeting", { about: "@anna", title: "1:1 Anna", date: "2026-11-23" }) // M-1
    const added = await cli(k, "talk", "add", "@anna", "AWS training budget for next year")
    expect([added.code, added.out]).toEqual([0, "T-1 added to @anna's talk-list at 1\n"])
    expect((await cli(k, "talk", "add", "anna", "Her view on Vendor B", "--project", "ERP")).out).toBe("T-2 added to @anna's talk-list at 2\n")
    await cli(k, "talk", "add", "#CRM", "Data migration rehearsal")
    await cli(k, "talk", "add", "@bob", "Test data", "--project", "#CRM")

    const all = await cli(k, "talk", "list")
    expect(all.out).toBe(
      [
        "@anna · 2 open",
        "1. T-1  AWS training budget for next year  —     2026-11-20",
        "2. T-2  Her view on Vendor B               #ERP  2026-11-20",
        "",
        "@bob · 1 open",
        "1. T-4  Test data  #CRM  2026-11-20",
        "",
        "#CRM · 1 open",
        "1. T-3  Data migration rehearsal  —  2026-11-20",
        "",
      ].join("\n"),
    )
    const crm = await cli(k, "talk", "list", "CRM")
    expect(crm.out).toBe(["#CRM · 2 open", "1. T-3  Data migration rehearsal  —     2026-11-20", "   T-4  Test data                 @bob  2026-11-20", ""].join("\n"))

    const json = await cli(k, "talk", "list", "@anna", "--json")
    expect(json.json).toEqual([
      { ref: "T-1", id: 1, about: "@anna", text: "AWS training budget for next year", project: null, added_date: "2026-11-20", position: 1, status: "open", meeting: null },
      { ref: "T-2", id: 2, about: "@anna", text: "Her view on Vendor B", project: "#ERP", added_date: "2026-11-20", position: 2, status: "open", meeting: null },
    ])

    expect((await cli(k, "talk", "move", "T-2", "--to", "1")).out).toBe("T-2 moved to 1\n")
    const moveBad = await cli(k, "talk", "move", "T-2", "--to", "5")
    expect([moveBad.code, moveBad.err]).toEqual([1, "error: @anna's talk-list has 2 open items\nhint: use 1 to 2\n"])
    expect((await cli(k, "talk", "done", "T-2", "--meeting", "M-1")).out).toBe("T-2 discussed in M-1\n")
    expect((await cli(k, "talk", "done", "2")).code).toBe(1) // already discussed
    expect((await cli(k, "talk", "drop", "T-1")).out).toBe("T-1 dropped\n")
    expect((await cli(k, "talk", "list", "@anna")).out).toBe("no open talk items for @anna\n")
    const drop = await cli(k, "talk", "drop", "T-1", "--json")
    expect([drop.code, drop.json.error.message]).toEqual([1, "T-1 is dropped"])
    const unknown = await cli(k, "talk", "add", "@nobody", "x")
    expect([unknown.code, unknown.err]).toEqual([2, 'error: unknown person "@nobody"\n'])

    expect(stored(k)).toEqual([
      ["T-1", "person:1", null, "dropped", null],
      ["T-2", "person:1", null, "discussed", 1],
      ["T-3", "project:1", 1, "open", null],
      ["T-4", "person:2", 1, "open", null],
    ])
  })

  test("Review Focus 4: a deleted person, an archived or deleted project: items stay listed, shown by stored ref or —", async () => {
    const k = await boot()
    await w(k, "addMeeting", { about: "#CRM", title: "CRM steering", date: "2026-11-24" }) // M-1
    await w(k, "addTalk", { about: "@bob", text: "Bob's item", project: "#ERP" }) // T-1
    await w(k, "addTalk", { about: "#CRM", text: "CRM item" }) // T-2
    await w(k, "addTalk", { about: "@anna", text: "Anna's item", project: "#CRM" }) // T-3
    await w(k, "archiveProject", { project: "CRM" }, "projects")
    k.db.raw.prepare("DELETE FROM people_person WHERE handle = 'bob'").run([])
    k.db.raw.prepare("DELETE FROM projects_project WHERE code = 'ERP'").run([])

    // An archived project is still a project: its list, its meeting's agenda and its tag work as before.
    expect(refs((await r(k, "talkList", { about: "#CRM" })).open)).toEqual(["T-2", "T-3"])
    expect(refs((await r(k, "agendaFor", { meeting: "M-1" })).items)).toEqual(["T-2", "T-3"])
    const all = await cli(k, "talk", "list")
    expect(all.code).toBe(0)
    expect(all.out).toBe(
      [
        "@anna · 1 open",
        "1. T-3  Anna's item  #CRM  2026-11-20",
        "",
        "#CRM · 1 open",
        "1. T-2  CRM item  —  2026-11-20",
        "",
        "— · 1 open",
        "1. T-1  Bob's item  —  2026-11-20",
        "",
      ].join("\n"),
    )
    const json = await cli(k, "talk", "list", "--json")
    expect(json.json.find((t: any) => t.ref === "T-1")).toEqual({
      ref: "T-1",
      id: 1,
      about: "—",
      text: "Bob's item",
      project: "—",
      added_date: "2026-11-20",
      position: 1,
      status: "open",
      meeting: null,
    })
    // The item can still be worked on.
    expect(await w(k, "dropTalk", { ref: "T-1" })).toMatchObject({ ref: "T-1", about: "—", status: "dropped" })
    expect(await runWithContext(k.context(), () => k.records.label("T-1"))).toBe("Bob's item")
  })

  test("T-n record type, the published view, and an occurrence an item was discussed in is never removed", async () => {
    const k = await boot()
    await w(k, "addTalk", { about: "@anna", text: "AWS training budget" })
    await w(k, "addTalk", { about: "@anna", text: "Holiday planning" })
    expect(await runWithContext(k.context(), () => k.records.resolveAny("t-2"))).toEqual({ type: "talk_item", id: 2 })
    expect(await runWithContext(k.context(), () => k.records.label("T-1"))).toBe("AWS training budget")
    expect(await runWithContext(k.context(), () => k.records.byName("talk_item")!.search("budget", 5))).toEqual([{ ref: "T-1", label: "AWS training budget" }])
    const cols = (k.db.raw.prepare(`PRAGMA table_info("meetings__pub_talk_item")`).all([]) as any[]).map((c) => c.name)
    expect(cols).toEqual(["id", "subject_type", "subject_id", "text", "project_id", "added_date", "position", "status", "meeting_id", "status_date"])

    await w(k, "addSeries", { about: "@anna", title: "1:1 Anna", every: "weekly on mon", from: "mon" }) // M-1 2026-11-23 …
    await w(k, "discussTalk", { ref: "T-1", meeting: "M-1" })
    await w(k, "endSeries", { ref: "S-1", on: "2026-11-21" }) // removes the planned occurrences after it that carry nothing
    const left = (k.db.raw.prepare("SELECT id FROM meetings_meeting ORDER BY id").all([]) as any[]).map((m) => m.id)
    expect(left).toEqual([1])
  })
})
