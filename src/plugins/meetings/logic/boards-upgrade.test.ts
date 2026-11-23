// Review Focus 3 (plan ruling B3) and migration 006: a database written by meetings 2.0.0 whose board meetings sit on
// projects (a series with its occurrences, a held meeting with notes, talk items discussed and kept in it, linked
// actions, a one-off) is upgraded. 006 rebuilds series, meeting and talk_item with `board` as a subject type, keeping
// every row and the ids' counters (a deleted id never comes back); the `boards-from-projects` step makes one board per
// such project (`<CODE>B`, cut to 16, a digit added while taken) and moves those meetings and series onto it, with
// ids and history intact. The project keeps everything else, a notice names each new board, and running the step
// again changes nothing.
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
import { MIGRATIONS } from "./schema"

let old: TestKernel | undefined
const booted: Kernel[] = []
afterEach(async () => {
  for (const k of booted.splice(0)) await k.shutdown()
  await old?.cleanup()
  old = undefined
})

// meetings 2.0.0 as far as its tables go: migrations 001 to 005.
const meetingsV2 = definePlugin({
  id: "meetings",
  name: "Meetings",
  version: "2.0.0",
  apiVersion: 1,
  activate: (ctx) => {
    for (const [id, up] of MIGRATIONS) if (id <= "005") ctx.migration(id, up)
  },
})

const w = (k: Kernel, plugin: string, op: string, input: unknown) => runWithContext(k.context(), () => (k.runtime(plugin)!.self() as any).write[op](input))
const r = (k: Kernel, op: string, input: unknown): Promise<any> => runWithContext(k.context(), () => (k.runtime("meetings")!.self() as any).read[op](input))
async function cli(k: Kernel, ...argv: string[]) {
  let out = ""
  let err = ""
  const code = await runCli(argv, k, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => "" })
  return { code, out, err, json: out.startsWith("{") || out.startsWith("[") ? JSON.parse(out) : undefined }
}
const boot = async (home: string) => {
  const k = await bootKernel({ env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1" }, plugins: builtinPlugins, clock: fixedClock("2026-11-20") })
  booted.push(k)
  return k
}
const close = async (k: Kernel) => {
  await k.shutdown()
  booted.splice(booted.indexOf(k), 1)
}
const all = (k: Kernel, q: string) => k.db.raw.prepare(q).all([])

const T = "2026-10-01T09:00:00"
// Rows as meetings 2.0.0 wrote them. Projects: 1 CRM, 2 BOARD, 3 BOARDB (so BOARD's board is BOARDB2), 4 a 16-letter code.
function seedV2(k: Kernel) {
  const run = (q: string, ...args: unknown[]) => k.db.raw.prepare(q).run(args as any)
  const series = (id: number, project: number, title: string, kind: string, rhythm: string, first: string) =>
    run(
      "INSERT INTO meetings_series (id, subject_type, subject_id, title, kind, rhythm, first_date, end_date, created_at, updated_at) VALUES (?, 'project', ?, ?, ?, ?, ?, NULL, ?, ?)",
      id, project, title, kind, rhythm, first, T, T,
    )
  series(1, 2, "Board", "board", "monthly on the last fri", "2026-10-30")
  series(2, 1, "CRM steering", "project", "monthly on the 3rd fri", "2026-10-16")
  series(3, 4, "Programme board", "board", "monthly on the 1st mon", "2027-01-04")
  run("INSERT INTO meetings_series_attendee (series_id, person_id) VALUES (1, 1), (1, 2)")
  const meeting = (id: number, title: string, date: string, kind: string, status: string, subject: number | null, seriesId: number | null, notes: string, autoClose: number) =>
    run(
      `INSERT INTO meetings_meeting (id, title, date, kind, status, since_date, notes, subject_type, subject_id, series_id, series_date, auto_close, created_at, updated_at, closed_itself)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      id, title, date, kind, status, notes, subject === null ? null : "project", subject, seriesId, seriesId === null ? null : date, autoClose, T, T,
    )
  meeting(1, "Board", "2026-10-30", "board", "held", 2, 1, "# Minutes\n\n- budget agreed\n", 1)
  meeting(2, "Board", "2026-11-27", "board", "planned", 2, 1, "", 1)
  meeting(3, "CRM steering", "2026-11-20", "project", "planned", 1, 2, "", 1)
  meeting(4, "Extra board", "2026-12-11", "board", "planned", 2, null, "", 1)
  meeting(5, "Old board", "2026-09-25", "board", "held", null, null, "", 0) // no subject: stays as it is
  meeting(6, "Gone", "2026-12-24", "board", "planned", 2, null, "", 1)
  meeting(7, "Gone too", "2026-12-31", "board", "planned", 2, null, "", 1)
  run("DELETE FROM meetings_meeting WHERE id IN (6, 7)") // the counter stays at 7: M-6 and M-7 are never given again
  run("INSERT INTO meetings_attendee (meeting_id, person_id) VALUES (1, 1), (1, 2), (2, 1), (2, 2)")
  run("INSERT INTO meetings_agenda_item (id, meeting_id, position, text, project_id, ask) VALUES (1, 4, 1, 'CRM status', 1, 'Approve the shift')")
  const talk = (id: number, type: string, subject: number, text: string, project: number | null, position: number | null, last: number | null, status: string, meetingId: number | null) =>
    run(
      `INSERT INTO meetings_talk_item (id, subject_type, subject_id, text, project_id, added_date, position, last_position, status, meeting_id, status_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '2026-10-20', ?, ?, ?, ?, ?, ?, ?)`,
      id, type, subject, text, project, position, last, status, meetingId, status === "open" ? null : "2026-10-30", T, T,
    )
  talk(1, "project", 2, "Budget 2027", null, null, 1, "discussed", 1)
  talk(2, "project", 2, "Hiring freeze impact", null, 1, null, "open", null)
  talk(3, "person", 1, "Board sponsor for security", 2, 1, null, "open", null)
  talk(4, "project", 2, "Gone", null, null, 2, "dropped", null)
  talk(5, "project", 2, "Gone too", null, null, 3, "dropped", null)
  run("DELETE FROM meetings_talk_item WHERE id IN (4, 5)") // the counter stays at 5
  run("INSERT INTO meetings_talk_kept (meeting_id, talk_id, position) VALUES (1, 2, 1)")
}

const dump = (k: Kernel) => ({
  meetings: all(k, "SELECT id, title, date, kind, status, notes, series_id, series_date, auto_close, created_at, updated_at, closed_itself FROM meetings_meeting ORDER BY id"),
  series: all(k, "SELECT id, title, kind, rhythm, first_date, end_date, created_at, updated_at FROM meetings_series ORDER BY id"),
  attendees: all(k, "SELECT * FROM meetings_attendee ORDER BY meeting_id, person_id"),
  seriesAttendees: all(k, "SELECT * FROM meetings_series_attendee ORDER BY series_id, person_id"),
  agenda: all(k, "SELECT * FROM meetings_agenda_item ORDER BY id"),
  talk: all(
    k,
    "SELECT id, text, project_id, added_date, position, last_position, status, meeting_id, status_date, created_at, updated_at FROM meetings_talk_item ORDER BY id",
  ),
  kept: all(k, "SELECT * FROM meetings_talk_kept ORDER BY meeting_id, talk_id"),
  links: all(k, "SELECT action_id, record_type, record_id FROM actions_link ORDER BY id"),
  projects: all(k, "SELECT id, code, name, archived_at FROM projects_project ORDER BY id"),
})
const subjects = (k: Kernel, table: string) => all(k, `SELECT id, subject_type, subject_id FROM meetings_${table} ORDER BY id`)

async function oldDatabase(): Promise<{ home: string; was: ReturnType<typeof dump>; wasMeetings: unknown[] }> {
  old = await makeTestKernel({ plugins: [meetingsV2, projects, people, actions], today: "2026-11-20" })
  await w(old, "people", "addPerson", { name: "Peter Janssens", handle: "peter" })
  await w(old, "people", "addPerson", { name: "Marie Dubois", handle: "marie" })
  for (const [code, name] of [["CRM", "CRM replatforming"], ["BOARD", "Management board"], ["BOARDB", "Boardroom AV"], ["ABCDEFGHIJKLMNOP", "Programme"]])
    await w(old, "projects", "addProject", { code, name })
  seedV2(old)
  await w(old, "actions", "addAction", { title: "Send the budget", links: ["#BOARD"] }) // A-1, agreed in M-1
  old.db.raw.prepare("INSERT INTO actions_link (action_id, record_type, record_id) VALUES (1, 'meeting', 1)").run([])
  const was = dump(old)
  const wasMeetings = subjects(old, "meeting")
  await old.shutdown()
  return { home: old.home, was, wasMeetings }
}

describe("upgrading meetings 2.0.0 data: boards", () => {
  test("Review Focus 3: board meetings and series on a project move to a new board, ids and history intact", async () => {
    const { home, was, wasMeetings } = await oldDatabase()
    const k = await boot(home)
    expect(k.plugins.map((p) => [p.id, p.status, p.error ?? null])).toEqual(builtinPlugins.map((p) => [p.id, "ok", null]))
    // Every row kept (only the subjects of what moved change).
    expect(dump(k)).toEqual(was)
    expect(all(k, "PRAGMA foreign_key_check")).toEqual([])
    expect(all(k, "SELECT id, code, name, note, archived_at, from_project_id FROM meetings_board ORDER BY id")).toEqual([
      { id: 1, code: "BOARDB2", name: "Management board", note: null, archived_at: null, from_project_id: 2 },
      { id: 2, code: "ABCDEFGHIJKLMNOB", name: "Programme", note: null, archived_at: null, from_project_id: 4 },
    ])
    expect(subjects(k, "meeting")).toEqual([
      { id: 1, subject_type: "board", subject_id: 1 },
      { id: 2, subject_type: "board", subject_id: 1 },
      wasMeetings[2], // CRM steering: a project meeting stays
      { id: 4, subject_type: "board", subject_id: 1 },
      { id: 5, subject_type: null, subject_id: null }, // no subject: until `meeting subject … #BOARDB2`
    ])
    expect(subjects(k, "series")).toEqual([
      { id: 1, subject_type: "board", subject_id: 1 },
      { id: 2, subject_type: "project", subject_id: 1 },
      { id: 3, subject_type: "board", subject_id: 2 },
    ])
    // BOARD held only board meetings, so its open talk item was the board's talk-list: it moves, in its place. The
    // item discussed in M-1 stays as it is (history), and so does the person's item tagged with BOARD, and its actions.
    expect(subjects(k, "talk_item")).toEqual([
      { id: 1, subject_type: "project", subject_id: 2 },
      { id: 2, subject_type: "board", subject_id: 1 },
      { id: 3, subject_type: "person", subject_id: 1 },
    ])
    expect((await cli(k, "project", "show", "BOARD")).out.split("\n")[0]).toBe("#BOARD Management board")
    expect((await cli(k, "talk", "list", "#BOARD", "--json")).json.map((t: any) => t.ref)).toEqual(["T-3"])
    expect((await cli(k, "talk", "list", "#BOARDB2", "--json")).json.map((t: any) => [t.ref, t.position])).toEqual([["T-2", 1]])
    // The planned board meeting's agenda is the board's talk-list, so the item can be taken up in it.
    expect((await r(k, "agendaFor", { meeting: "M-2" })).items.map((t: any) => t.ref)).toEqual(["T-2"])
    // The meetings read the same, about the board now.
    const m1 = (await cli(k, "meeting", "show", "M-1")).out
    expect(m1).toBe(
      ["M-1 Board", "  date: 2026-10-30", "  kind: board", "  status: held", "  about: #BOARDB2", "  series: S-1", "  attendees: @marie, @peter", "", "Notes", "# Minutes", "", "- budget agreed", ""].join("\n"),
    )
    expect((await r(k, "agendaFor", { meeting: "M-1" })).items.map((t: any) => [t.ref, t.status])).toEqual([["T-2", "open"]])
    expect((await cli(k, "action", "list", "--meeting", "M-1", "--json")).json.map((a: any) => a.links.map((l: any) => l.ref))).toEqual([["#BOARD", "M-1"]])
    expect((await cli(k, "meeting", "series", "list", "--json")).json.map((s: any) => [s.ref, s.about, s.kind])).toEqual([
      ["S-1", "#BOARDB2", "board"],
      ["S-2", "#CRM", "project"],
      ["S-3", "#ABCDEFGHIJKLMNOB", "board"],
    ])
    expect((await cli(k, "board", "show", "#BOARDB2")).out).toBe(
      ["#BOARDB2 Management board", "  series: S-1 Board: monthly on the last fri, next 2026-11-27", "  next: M-2 Board on 2026-11-27", "  talk: 1 open item", ""].join("\n"),
    )

    // The notice names each new board, in plugin list (text and JSON).
    const notice = (code: string, name: string, project: string) =>
      `board #${code} "${name}" now holds the board meetings of project #${project}; rename it: ttybrain board edit #${code} --code <CODE>`
    const list = await cli(k, "plugin", "list")
    expect(list.out.trimEnd().split("\n").slice(-2)).toEqual([
      `notice (meetings): ${notice("ABCDEFGHIJKLMNOB", "Programme", "ABCDEFGHIJKLMNOP")}`,
      `notice (meetings): ${notice("BOARDB2", "Management board", "BOARD")}`,
    ])
    expect((await cli(k, "plugin", "list", "--json")).json.find((p: any) => p.id === "meetings").notices).toHaveLength(2)

    // The counters survived the rebuild: M-6, M-7 and T-4, T-5 were deleted before it and are not given again.
    expect(all(k, "SELECT name, seq FROM sqlite_sequence WHERE name IN ('meetings_meeting', 'meetings_talk_item') ORDER BY name")).toEqual([
      { name: "meetings_meeting", seq: 7 },
      { name: "meetings_talk_item", seq: 5 },
    ])
    // (The write runs the occurrences upkeep first, which makes the series' next dates: they get the first new ids.)
    expect((await cli(k, "meeting", "add", "Next board", "--about", "#BOARDB2", "--date", "2027-01-29", "--json")).json).toMatchObject({ kind: "board" })
    expect(all(k, "SELECT min(id) AS first FROM meetings_meeting WHERE id > 5")).toEqual([{ first: 8 }])
    expect((await cli(k, "talk", "add", "#BOARDB2", "Q1 priorities", "--json")).json.ref).toBe("T-6")

    // Renaming settles it: the notice is gone at the next start.
    expect((await cli(k, "board", "edit", "#BOARDB2", "--code", "MB")).out).toBe("#MB Management board\n")
    await close(k)
    const again = await boot(home)
    expect(again.plugins.find((p) => p.id === "meetings")!.notices).toEqual([notice("ABCDEFGHIJKLMNOB", "Programme", "ABCDEFGHIJKLMNOP")])
  })

  test("B3 by series: a board series moves with all its occurrences, a board occurrence of a project series alone; a project with other meetings keeps its open talk items", async () => {
    old = await makeTestKernel({ plugins: [meetingsV2, projects, people, actions], today: "2026-11-20" })
    for (const [code, name] of [["CRM", "CRM replatforming"], ["OPS", "Operations board"]]) await w(old, "projects", "addProject", { code, name })
    const run = (q: string, ...args: unknown[]) => old!.db.raw.prepare(q).run(args as any)
    const series = (id: number, project: number, kind: string) =>
      run(
        "INSERT INTO meetings_series (id, subject_type, subject_id, title, kind, rhythm, first_date, created_at, updated_at) VALUES (?, 'project', ?, 'S', ?, 'weekly on fri', '2026-11-27', ?, ?)",
        id, project, kind, T, T,
      )
    series(1, 1, "project") // CRM steering
    series(2, 2, "board") // the OPS board
    const meeting = (id: number, project: number, seriesId: number, kind: string, date: string) =>
      run(
        `INSERT INTO meetings_meeting (id, title, date, kind, status, notes, subject_type, subject_id, series_id, series_date, auto_close, created_at, updated_at)
         VALUES (?, 'M', ?, ?, 'planned', '', 'project', ?, ?, ?, 1, ?, ?)`,
        id, date, kind, project, seriesId, date, T, T,
      )
    meeting(1, 1, 1, "project", "2026-11-27")
    meeting(2, 1, 1, "board", "2026-12-04") // one board occurrence of the project series
    meeting(3, 2, 2, "board", "2026-11-27")
    meeting(4, 2, 2, "project", "2026-12-04") // one project occurrence of the board series
    const talk = (id: number, project: number) =>
      run(
        `INSERT INTO meetings_talk_item (id, subject_type, subject_id, text, added_date, position, status, created_at, updated_at)
         VALUES (?, 'project', ?, 'Item', '2026-11-01', 1, 'open', ?, ?)`,
        id, project, T, T,
      )
    talk(1, 1)
    talk(2, 2)
    await old.shutdown()

    const k = await boot(old.home)
    expect(all(k, "SELECT id, code, from_project_id FROM meetings_board ORDER BY id")).toEqual([
      { id: 1, code: "CRMB", from_project_id: 1 },
      { id: 2, code: "OPSB", from_project_id: 2 },
    ])
    expect(all(k, "SELECT id, kind, subject_type, subject_id, series_id FROM meetings_meeting WHERE id <= 4 ORDER BY id")).toEqual([
      { id: 1, kind: "project", subject_type: "project", subject_id: 1, series_id: 1 },
      { id: 2, kind: "board", subject_type: "board", subject_id: 1, series_id: 1 }, // alone, still dated by its series
      { id: 3, kind: "board", subject_type: "board", subject_id: 2, series_id: 2 },
      { id: 4, kind: "board", subject_type: "board", subject_id: 2, series_id: 2 }, // with its series: on a board, a board meeting
    ])
    expect(subjects(k, "series")).toEqual([
      { id: 1, subject_type: "project", subject_id: 1 },
      { id: 2, subject_type: "board", subject_id: 2 },
    ])
    // CRM still has its project series: its open item stays (and the notice says so); OPS has nothing left: it moves.
    expect(subjects(k, "talk_item")).toEqual([
      { id: 1, subject_type: "project", subject_id: 1 },
      { id: 2, subject_type: "board", subject_id: 2 },
    ])
    expect((await r(k, "agendaFor", { meeting: "M-3" })).items.map((t: any) => t.ref)).toEqual(["T-2"])
    expect(k.plugins.find((p) => p.id === "meetings")!.notices).toEqual([
      'board #CRMB "CRM replatforming" now holds the board meetings of project #CRM; open talk items stay on #CRM; rename it: ttybrain board edit #CRMB --code <CODE>',
      'board #OPSB "Operations board" now holds the board meetings of project #OPS; rename it: ttybrain board edit #OPSB --code <CODE>',
    ])
  })

  test("running the step again changes nothing", async () => {
    const { home } = await oldDatabase()
    const first = await boot(home)
    const after = { ...dump(first), subjects: [subjects(first, "meeting"), subjects(first, "series")], boards: all(first, "SELECT * FROM meetings_board ORDER BY id") }
    // Forget that it ran: the next start runs it once more.
    first.db.raw.prepare("DELETE FROM kernel_plugin_migration WHERE plugin = 'meetings' AND id = 'upgrade:boards-from-projects'").run([])
    await close(first)
    const second = await boot(home)
    expect(all(second, "SELECT id FROM kernel_plugin_migration WHERE plugin = 'meetings' AND id = 'upgrade:boards-from-projects'")).toHaveLength(1)
    expect({ ...dump(second), subjects: [subjects(second, "meeting"), subjects(second, "series")], boards: all(second, "SELECT * FROM meetings_board ORDER BY id") }).toEqual(after)
  })
})
