// Review Focus 1: a database written by meetings 1.0.0 (migration 001 only: board, steering and other meetings,
// attendees, an agenda with asks, held and planned meetings, actions and decisions linked) is upgraded by migration
// 002. Every meeting keeps everything, kinds are remapped, all are still listed without a subject, none will close
// itself, and `meeting subject --all-without #BOARD` assigns them.
import { afterEach, describe, expect, test } from "bun:test"
import { builtinPlugins } from "../../../../tests/builtins"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { definePlugin } from "../../../kernel/api"
import { runCli } from "../../../kernel/cli/dispatch"
import { fixedClock } from "../../../kernel/clock"
import { runWithContext } from "../../../kernel/context"
import { bootKernel, type Kernel } from "../../../kernel/host"
import { actions } from "../../actions/logic/index"
import { people } from "../../people/logic/index"
import { projects } from "../../projects/logic/index"
import { migration001 } from "./schema"

let old: TestKernel | undefined
let upgraded: Kernel | undefined
afterEach(async () => {
  await upgraded?.shutdown()
  upgraded = undefined
  await old?.cleanup()
  old = undefined
})

// meetings 1.0.0 as far as its tables go: the same migration 001, nothing else.
const meetingsV1 = definePlugin({
  id: "meetings",
  name: "Meetings",
  version: "1.0.0",
  apiVersion: 1,
  activate: (ctx) => ctx.migration("001", migration001),
})

const w = (k: Kernel, plugin: string, op: string, input: unknown) => runWithContext(k.context(), () => (k.runtime(plugin)!.self() as any).write[op](input))
async function cli(k: Kernel, ...argv: string[]) {
  let out = ""
  let err = ""
  const code = await runCli(argv, k, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => "" })
  return { code, out, err, json: out.startsWith("{") || out.startsWith("[") ? JSON.parse(out) : undefined }
}

const T = "2026-10-01T09:00:00"
// Rows as meetings 1.0.0 wrote them.
function seedV1(k: Kernel) {
  const run = (sql: string, ...args: unknown[]) => k.db.raw.prepare(sql).run(args as any)
  const meeting = (id: number, title: string, date: string, kind: string, status: string, since: string | null, notes: string) =>
    run("INSERT INTO meetings_meeting (id, title, date, kind, status, since_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, title, date, kind, status, since, notes, T, T)
  meeting(1, "SteerCo Q3", "2026-10-28", "steering", "held", null, "# Minutes\n\n- agreed\n")
  meeting(2, "Steering committee Q4", "2026-12-04", "steering", "planned", "2026-10-01", "")
  meeting(3, "Board", "2026-11-27", "board", "planned", null, "")
  meeting(4, "Ops sync", "2026-11-10", "other", "cancelled", null, "")
  meeting(5, "Vendor call", "2026-11-18", "other", "planned", null, "") // planned and more than 3 days past
  for (const [m, p] of [[1, 1], [1, 2], [2, 1], [2, 2], [2, 3], [3, 3]]) run("INSERT INTO meetings_attendee (meeting_id, person_id) VALUES (?, ?)", m, p)
  const item = (id: number, m: number, pos: number, text: string, project: number | null, ask: string | null) =>
    run("INSERT INTO meetings_agenda_item (id, meeting_id, position, text, project_id, ask) VALUES (?, ?, ?, ?, ?, ?)", id, m, pos, text, project, ask)
  item(1, 1, 1, "CRM replatforming status", 1, null)
  item(2, 2, 1, "Minutes & open actions", null, null)
  item(3, 2, 2, "CRM status", 1, "Approve 2-week shift of design milestone.")
  item(4, 2, 3, "ERP vendor decision", 2, "Choose vendor B")
  item(5, 3, 1, "Budget 2027", null, "First view")
}

const dump = (k: Kernel) => ({
  meetings: k.db.raw.prepare("SELECT id, title, date, status, since_date, notes, created_at FROM meetings_meeting ORDER BY id").all([]),
  attendees: k.db.raw.prepare("SELECT meeting_id, person_id FROM meetings_attendee ORDER BY meeting_id, person_id").all([]),
  agenda: k.db.raw.prepare("SELECT id, meeting_id, position, text, project_id, ask FROM meetings_agenda_item ORDER BY id").all([]),
  links: k.db.raw.prepare("SELECT action_id, record_type, record_id FROM actions_link ORDER BY id").all([]),
  decisions: k.db.raw.prepare("SELECT id, meeting_id FROM projects_decision ORDER BY id").all([]),
})

describe("upgrading meetings 1.0.0 data", () => {
  test("every meeting keeps everything, kinds are remapped, none has a subject or closes itself", async () => {
    old = await makeTestKernel({ plugins: [meetingsV1, projects, people, actions], today: "2026-11-20" })
    await w(old, "people", "addPerson", { name: "Peter Janssens", handle: "peter" })
    await w(old, "people", "addPerson", { name: "Marie Dubois", handle: "marie" })
    await w(old, "people", "addPerson", { name: "Tom Peeters", handle: "tom" })
    await w(old, "projects", "addProject", { code: "CRM", name: "CRM replatforming" })
    await w(old, "projects", "addProject", { code: "ERP", name: "ERP upgrade" })
    await w(old, "projects", "addProject", { code: "BOARD", name: "Management board" })
    seedV1(old)
    await w(old, "actions", "addAction", { title: "Send revised budget", meeting: "M-1" })
    await w(old, "actions", "addAction", { title: "Book vendor demo", meeting: "M-2", project: "ERP" })
    await w(old, "projects", "addDecision", { project: "CRM", title: "Phase 1 excludes marketing", meeting: "M-1" })
    const before = dump(old)
    expect(before.links).toHaveLength(3)
    expect(before.decisions).toEqual([{ id: 1, meeting_id: 1 }])
    await old.shutdown()

    upgraded = await bootKernel({ env: { TTYBRAIN_HOME: old.home, TTYBRAIN_TEST: "1" }, plugins: builtinPlugins, clock: fixedClock("2026-11-20") })
    expect(upgraded.plugins.map((p) => [p.id, p.status, p.error ?? null])).toEqual(builtinPlugins.map((p) => [p.id, "ok", null]))
    expect(dump(upgraded)).toEqual(before)
    expect(upgraded.db.raw.prepare("SELECT id, kind, subject_type, subject_id, series_id, series_date, auto_close FROM meetings_meeting ORDER BY id").all([])).toEqual([
      { id: 1, kind: "project", subject_type: null, subject_id: null, series_id: null, series_date: null, auto_close: 0 },
      { id: 2, kind: "project", subject_type: null, subject_id: null, series_id: null, series_date: null, auto_close: 0 },
      { id: 3, kind: "board", subject_type: null, subject_id: null, series_id: null, series_date: null, auto_close: 0 },
      { id: 4, kind: "project", subject_type: null, subject_id: null, series_id: null, series_date: null, auto_close: 0 },
      { id: 5, kind: "project", subject_type: null, subject_id: null, series_id: null, series_date: null, auto_close: 0 },
    ])
    expect(upgraded.db.raw.prepare("PRAGMA foreign_key_check").all([])).toEqual([])
    // No ON DELETE action is left on the rebuilt tables (rule 6).
    for (const t of ["attendee", "agenda_item", "series_attendee", "meeting"])
      for (const fk of upgraded.db.raw.prepare(`PRAGMA foreign_key_list("meetings_${t}")`).all([]) as Array<{ on_delete: string }>) expect(fk.on_delete).toBe("NO ACTION")

    // Still listed, without a subject; a write (the upkeep runs first) changes none of them.
    await w(upgraded, "people", "addPerson", { name: "Anna Peeters", handle: "anna" })
    expect(dump(upgraded).meetings).toEqual(before.meetings)
    const list = await cli(upgraded, "meeting", "list", "--all", "--json")
    expect(list.json.map((m: any) => [m.ref, m.kind, m.status, m.about, m.series])).toEqual([
      ["M-1", "project", "held", null, null],
      ["M-4", "project", "cancelled", null, null],
      ["M-5", "project", "planned", null, null],
      ["M-3", "board", "planned", null, null],
      ["M-2", "project", "planned", null, null],
    ])
    const m2 = list.json.find((m: any) => m.ref === "M-2")
    expect(m2).toEqual({
      ref: "M-2",
      id: 2,
      title: "Steering committee Q4",
      date: "2026-12-04",
      kind: "project",
      status: "planned",
      since_date: "2026-10-01",
      notes: "",
      attendees: ["@marie", "@peter", "@tom"],
      agenda: [
        { position: 1, text: "Minutes & open actions", project: null, project_id: null, ask: null },
        { position: 2, text: "CRM status", project: "#CRM", project_id: 1, ask: "Approve 2-week shift of design milestone." },
        { position: 3, text: "ERP vendor decision", project: "#ERP", project_id: 2, ask: "Choose vendor B" },
      ],
      about: null,
      series: null,
    })
    expect((await cli(upgraded, "meeting", "show", "M-1")).out).toContain("  kind: project\n  status: held\n")
    // AUTOINCREMENT from 002 on: the copy back left the counter at the highest id, so the next meeting is M-6.
    expect(upgraded.db.raw.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'meetings_meeting'").all([])).toEqual([{ seq: 5 }])
    expect((await cli(upgraded, "meeting", "add", "Next board", "--about", "BOARD", "--date", "2026-12-18", "--json")).json.ref).toBe("M-6")
    expect((await cli(upgraded, "action", "list", "--meeting", "M-1", "--json")).json.map((a: any) => a.ref)).toEqual(["A-1"])
  })

  test("meeting subject --all-without #BOARD assigns them; only those dated today or later will close themselves", async () => {
    old = await makeTestKernel({ plugins: [meetingsV1, projects, people, actions], today: "2026-11-20" })
    for (const [name, handle] of [["Peter Janssens", "peter"], ["Marie Dubois", "marie"], ["Tom Peeters", "tom"]]) await w(old, "people", "addPerson", { name, handle })
    for (const [code, name] of [["CRM", "CRM replatforming"], ["ERP", "ERP upgrade"]]) await w(old, "projects", "addProject", { code, name })
    seedV1(old)
    await old.shutdown()
    upgraded = await bootKernel({ env: { TTYBRAIN_HOME: old.home, TTYBRAIN_TEST: "1" }, plugins: builtinPlugins, clock: fixedClock("2026-11-20") })
    await cli(upgraded, "board", "add", "BOARD", "Management board")

    const one = await cli(upgraded, "meeting", "subject", "M-5", "@tom")
    expect([one.code, one.out]).toEqual([0, "M-5 about @tom (one_on_one)\n"])
    // One write for all of them (one transaction).
    expect(await runWithContext(upgraded.context(), () => upgraded!.ops.describe("meetings", "setSubject", { allWithout: true, about: "#BOARD" }))).toBe(
      "~ meetings without a subject about #BOARD",
    )
    // Onto a project, the project meetings among them are assigned and the board meeting is skipped (and counted).
    const project = await cli(upgraded, "meeting", "subject", "--all-without", "#CRM")
    expect([project.code, project.out, project.err]).toEqual([
      0,
      ["M-1 about #CRM (project)", "M-4 about #CRM (project)", "M-2 about #CRM (project)", "skipped 1 board meeting (they need a board; #CRM is a project)", ""].join("\n"),
      "",
    ])
    // Onto a board, the board meeting becomes its board meeting.
    const all = await cli(upgraded, "meeting", "subject", "--all-without", "#BOARD")
    expect([all.code, all.out, all.err]).toEqual([0, "M-3 about #BOARD (board)\n", ""])
    expect((await cli(upgraded, "meeting", "subject", "--all-without", "#BOARD")).out).toBe("no meetings without a subject\n")
    expect(upgraded.db.raw.prepare("SELECT id, kind, subject_type, subject_id, auto_close FROM meetings_meeting ORDER BY id").all([])).toEqual([
      { id: 1, kind: "project", subject_type: "project", subject_id: 1, auto_close: 0 }, // 28 Oct: past
      { id: 2, kind: "project", subject_type: "project", subject_id: 1, auto_close: 1 },
      { id: 3, kind: "board", subject_type: "board", subject_id: 1, auto_close: 1 },
      { id: 4, kind: "project", subject_type: "project", subject_id: 1, auto_close: 0 },
      { id: 5, kind: "one_on_one", subject_type: "person", subject_id: 3, auto_close: 0 }, // 18 Nov: past
    ])
    const usage = await cli(upgraded, "meeting", "subject", "M-1")
    expect([usage.code, usage.err]).toEqual([1, "error: missing argument <about>\nhint: usage: ttybrain meeting subject <M-n> <about>, or ttybrain meeting subject --all-without <about>\n"])
    const both = await cli(upgraded, "meeting", "subject", "--all-without", "M-1", "#CRM")
    expect(both.code).toBe(1)
    const bare = await cli(upgraded, "meeting", "subject", "--all-without")
    expect([bare.code, bare.err.split("\n")[0]]).toEqual([1, "error: missing argument <about>"])
    // An unknown subject changes nothing, as one write.
    const none = await cli(upgraded, "meeting", "subject", "--all-without", "#NOPE")
    expect(none.code).toBe(2)
    const unknown = await cli(upgraded, "meeting", "subject", "M-1", "#NOPE")
    expect([unknown.code, unknown.err.split("\n")[0]]).toEqual([2, 'error: unknown project or board "#NOPE"'])
  })
})
