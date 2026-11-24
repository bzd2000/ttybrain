// The one-time handover of the meetings plugin's boards to the boards plugin (plan ruling P2, Review Focus 1–3): a
// database as meetings 2.1.0 left it (boards in meetings_board, one made by the `boards-from-projects` step whose
// project kept its talk items, an archived one, a gap in the ids; board meetings, a series, talk items and action
// links pointing at them) is opened by this one: every board keeps its id and fields, everything that pointed at a
// board still does, meetings' copy is emptied, and the next board gets max(id)+1. With boards off, meetings is off
// too and the rows wait; with meetings off, boards shows none of them until they move; a clash leaves everything as
// it was and the move is retried at the next start.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { builtinPlugins } from "../../../../tests/builtins"
import { definePlugin } from "../../../kernel/api"
import { runCli } from "../../../kernel/cli/dispatch"
import { fixedClock } from "../../../kernel/clock"
import { bootKernel, type Kernel } from "../../../kernel/host"
import type { PluginDef } from "../../../kernel/plugin"
import { actions } from "../../actions/logic/index"
import { inbox } from "../../inbox/logic/index"
import { MIGRATIONS } from "../../meetings/logic/schema"
import { people } from "../../people/logic/index"
import { projects } from "../../projects/logic/index"
import { RESERVED } from "./handover"

let home: string
let open: Kernel[] = []
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ttybrain-boards-handover-"))
})
afterEach(async () => {
  for (const k of open.splice(0)) await k.shutdown()
  rmSync(home, { recursive: true, force: true })
})

async function boot(plugins: PluginDef[], env: Record<string, string> = {}): Promise<Kernel> {
  const k = await bootKernel({ env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1", ...env }, plugins, clock: fixedClock("2026-11-20") })
  open.push(k)
  return k
}
async function close(k: Kernel): Promise<void> {
  open = open.filter((x) => x !== k)
  await k.shutdown()
}
async function cli(k: Kernel, ...argv: string[]): Promise<{ code: number; out: string; err: string; json: any }> {
  let out = ""
  let err = ""
  const code = await runCli(argv, k, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => "" })
  let json: any
  try {
    json = JSON.parse(out)
  } catch {
    json = undefined
  }
  return { code, out, err, json }
}
async function ok(k: Kernel, ...argv: string[]) {
  const r = await cli(k, ...argv)
  if (r.code !== 0) throw new Error(`ttybrain ${argv.join(" ")} → exit ${r.code}: ${r.out}${r.err}`)
  return r
}
const all = (k: Kernel, q: string) => k.db.raw.prepare(q).all([]) as any[]
const tables = (k: Kernel) => all(k, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%board%' ORDER BY name").map((r) => r.name)
const without = (...ids: string[]) => ({ TTYBRAIN_CONFIG_JSON: JSON.stringify({ plugins: { disabled: ids } }) })

// meetings 2.1.0 as far as its tables go (migrations 001 to 007), without its steps: the 2.1.0 database below is
// written as that version left it, `boards-from-projects` recorded as done.
const meetingsV21 = definePlugin({
  id: "meetings",
  name: "Meetings",
  version: "2.1.0",
  apiVersion: 1,
  activate: (ctx) => {
    for (const [id, up] of MIGRATIONS) if (id <= "007") ctx.migration(id, up)
  },
})

const T = "2026-10-01T09:00:00"
// The boards as meetings 2.1.0 had them: MB (with a note), CRMB (made from project CRM by the data step, which left
// CRM's open talk items on it: talk_stayed), OLD (archived), PROG (id 5: id 4 was never used by a board that is left).
const LEGACY = [
  { id: 1, code: "MB", name: "Management board", note: "Monthly, with the directors", archived_at: null, from_project_id: null, created_at: T, updated_at: "2026-10-05T10:00:00", talk_stayed: 0 },
  { id: 2, code: "CRMB", name: "CRM replatforming", note: null, archived_at: null, from_project_id: 1, created_at: T, updated_at: T, talk_stayed: 1 },
  { id: 3, code: "OLD", name: "Old board", note: null, archived_at: "2026-10-10T08:00:00", from_project_id: null, created_at: T, updated_at: "2026-10-10T08:00:00", talk_stayed: 0 },
  { id: 5, code: "PROG", name: "Programme board", note: null, archived_at: null, from_project_id: null, created_at: "2026-10-02T09:00:00", updated_at: "2026-10-02T09:00:00", talk_stayed: 0 },
]
const BOARD_COLUMNS = "id, code, name, note, archived_at, from_project_id, created_at, updated_at"
const LEGACY_ROWS = LEGACY.map(({ talk_stayed: _, ...b }) => b)
// What `board list --json` printed on meetings 2.1.0 for these boards (archived ones need --archived).
const LIST = [
  { ref: "#CRMB", id: 2, code: "CRMB", name: "CRM replatforming", note: null, archived: false },
  { ref: "#MB", id: 1, code: "MB", name: "Management board", note: "Monthly, with the directors", archived: false },
  { ref: "#PROG", id: 5, code: "PROG", name: "Programme board", note: null, archived: false },
]
const ARCHIVED = [{ ref: "#OLD", id: 3, code: "OLD", name: "Old board", note: null, archived: true }]

// People @peter 1 and @anna 2, project CRM 1; the boards; on MB a monthly series S-1 (its held M-1 with notes and
// attendees, a planned M-2) and a one-off M-3; T-1 discussed in M-1 and T-2 open on MB, T-3 open on OLD, T-4 open on
// CRM (the one that stayed); A-1 linked to MB and M-1, A-2 linked to OLD; an inbox origin on board MB.
async function legacyDatabase(): Promise<void> {
  const k = await boot([people, projects, actions, meetingsV21, inbox])
  await ok(k, "person", "add", "Peter Janssens", "--handle", "peter")
  await ok(k, "person", "add", "Anna Peeters", "--handle", "anna")
  await ok(k, "project", "add", "CRM", "CRM replatforming")
  const run = (q: string, ...args: unknown[]) => k.db.raw.prepare(q).run(args as any)
  for (const b of LEGACY)
    run(
      `INSERT INTO meetings_board (${BOARD_COLUMNS}, talk_stayed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.id, b.code, b.name, b.note, b.archived_at, b.from_project_id, b.created_at, b.updated_at, b.talk_stayed,
    )
  run("INSERT INTO meetings_series (id, subject_type, subject_id, title, kind, rhythm, first_date, created_at, updated_at) VALUES (1, 'board', 1, 'Board', 'board', 'monthly on the last fri', '2026-10-30', ?, ?)", T, T)
  run("INSERT INTO meetings_series_attendee (series_id, person_id) VALUES (1, 1), (1, 2)")
  const meeting = (id: number, title: string, date: string, status: string, seriesId: number | null, notes: string) =>
    run(
      `INSERT INTO meetings_meeting (id, title, date, kind, status, notes, subject_type, subject_id, series_id, series_date, auto_close, created_at, updated_at)
       VALUES (?, ?, ?, 'board', ?, ?, 'board', 1, ?, ?, 1, ?, ?)`,
      id, title, date, status, notes, seriesId, seriesId === null ? null : date, T, T,
    )
  meeting(1, "Board", "2026-10-30", "held", 1, "# Minutes\n\n- budget agreed\n")
  meeting(2, "Board", "2026-11-27", "planned", 1, "")
  meeting(3, "Extra board", "2026-12-11", "planned", null, "")
  run("INSERT INTO meetings_attendee (meeting_id, person_id) VALUES (1, 1), (1, 2)")
  const talk = (id: number, type: string, subject: number, text: string, position: number | null, status: string, meetingId: number | null) =>
    run(
      `INSERT INTO meetings_talk_item (id, subject_type, subject_id, text, added_date, position, status, meeting_id, status_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-10-20', ?, ?, ?, ?, ?, ?)`,
      id, type, subject, text, position, status, meetingId, status === "open" ? null : "2026-10-30", T, T,
    )
  talk(1, "board", 1, "Budget 2027", null, "discussed", 1)
  talk(2, "board", 1, "Hiring freeze impact", 1, "open", null)
  talk(3, "board", 3, "Archive the minutes", 1, "open", null)
  talk(4, "project", 1, "Data migration plan", 1, "open", null)
  run("INSERT INTO meetings_talk_kept (meeting_id, talk_id, position) VALUES (1, 2, 1)")
  await ok(k, "action", "add", "Send the budget") // A-1
  await ok(k, "action", "add", "Archive the board's minutes") // A-2
  run("INSERT INTO actions_link (action_id, record_type, record_id) VALUES (1, 'board', 1), (1, 'meeting', 1), (2, 'board', 3)")
  run("INSERT INTO kernel_record_origin VALUES ('board', 1, 'inbox', 'I-1', '2026-10-01T09:00:00')")
  run("INSERT INTO kernel_plugin_migration (plugin, id, applied_at) VALUES ('meetings', 'upgrade:boards-from-projects', ?)", T)
  await close(k)
}

// Everything that points at a board, as the database holds it.
const pointers = (k: Kernel) => ({
  meetings: all(k, "SELECT id, kind, subject_type, subject_id, series_id FROM meetings_meeting ORDER BY id"),
  series: all(k, "SELECT id, kind, subject_type, subject_id FROM meetings_series ORDER BY id"),
  talk: all(k, "SELECT id, subject_type, subject_id, position, status, meeting_id FROM meetings_talk_item ORDER BY id"),
  kept: all(k, "SELECT * FROM meetings_talk_kept"),
  links: all(k, "SELECT action_id, record_type, record_id FROM actions_link ORDER BY id"),
  origins: all(k, "SELECT * FROM kernel_record_origin WHERE record_type = 'board'"),
})
const NOTICE = 'board #CRMB "CRM replatforming" now holds the board meetings of project #CRM; open talk items stay on #CRM; rename it: ttybrain board edit #CRMB --code <CODE>'

describe("the boards handover", () => {
  test("Review Focus 1: every board keeps its id and fields, everything that pointed at a board still does, the next id is max+1", async () => {
    await legacyDatabase()
    const before = await boot([people, projects, actions, meetingsV21, inbox])
    const was = pointers(before)
    await close(before)

    const k = await boot(builtinPlugins)
    expect(k.plugins.map((p) => [p.id, p.status, p.error ?? null])).toEqual(builtinPlugins.map((p) => [p.id, "ok", null]))
    // One copy: the boards plugin's, every column as it was; meetings' table is empty (and kept).
    expect(all(k, `SELECT ${BOARD_COLUMNS} FROM boards_board ORDER BY id`)).toEqual(LEGACY_ROWS)
    expect(all(k, "SELECT * FROM meetings_board")).toEqual([])
    expect(all(k, "SELECT * FROM meetings_board_talk_stayed")).toEqual([{ board_id: 2 }])
    expect(all(k, "SELECT source, rows FROM boards_handover")).toEqual([{ source: "meetings", rows: 4 }])
    expect(pointers(k)).toEqual(was)
    expect(all(k, "PRAGMA foreign_key_check")).toEqual([])

    // The CLI shows them as before: board list (text and JSON), show, and what points at them.
    expect((await ok(k, "board", "list", "--json")).json).toEqual(LIST)
    expect((await ok(k, "board", "list", "--archived", "--json")).json).toEqual(ARCHIVED)
    expect((await ok(k, "board", "list")).out).toBe(
      ["code  name               note", "CRMB  CRM replatforming", "MB    Management board   Monthly, with the directors", "PROG  Programme board", ""].join("\n"),
    )
    expect((await ok(k, "board", "show", "#MB")).out).toBe(
      [
        "#MB Management board",
        "  note: Monthly, with the directors",
        "  series: S-1 Board: monthly on the last fri, next 2026-11-27",
        "  next: M-2 Board on 2026-11-27",
        "  talk: 1 open item",
        "",
      ].join("\n"),
    )
    expect((await ok(k, "meeting", "show", "M-1")).out).toContain("  kind: board\n  status: held\n  about: #MB\n  series: S-1\n")
    expect((await ok(k, "meeting", "series", "list", "--json")).json.map((s: any) => [s.ref, s.about])).toEqual([["S-1", "#MB"]])
    expect((await ok(k, "talk", "list", "#MB", "--json")).json.map((t: any) => t.ref)).toEqual(["T-2"])
    expect((await ok(k, "talk", "list", "#OLD", "--json")).json.map((t: any) => t.ref)).toEqual(["T-3"])
    expect((await ok(k, "action", "list", "--json")).json.map((a: any) => [a.ref, a.links.map((l: any) => l.ref)])).toEqual([
      ["A-1", ["#MB", "M-1"]],
      ["A-2", ["#OLD"]],
    ])
    expect((await ok(k, "action", "list", "--link", "#MB", "--json")).json.map((a: any) => a.ref)).toEqual(["A-1"])
    // The data step's notice still names the board it made, and what it decided about the talk items.
    expect(k.plugins.find((p) => p.id === "meetings")!.notices).toEqual([NOTICE])
    // An archived board still refuses what it refused.
    expect(await cli(k, "talk", "add", "#OLD", "Later")).toMatchObject({ code: 1, err: "error: #OLD is archived\nhint: restore it first: ttybrain board restore #OLD\n" })

    // Review Focus 3 on a moved board: the namespace holds both ways.
    expect(await cli(k, "project", "add", "MB", "Mobile")).toMatchObject({
      code: 3,
      err: 'error: code "MB" is already used by the board #MB\nhint: project and board codes share one namespace; choose another code\n',
    })
    expect(await cli(k, "board", "add", "CRM", "CRM board")).toMatchObject({
      code: 3,
      err: 'error: code "CRM" is already used by the project #CRM\nhint: project and board codes share one namespace; choose another code\n',
    })

    // The next board: max(id) + 1, and the counter is the table's own from now on.
    expect((await ok(k, "board", "add", "NEW", "New board", "--json")).json).toEqual({ ref: "#NEW", id: 6, code: "NEW", name: "New board", note: null, archived: false })
    expect(all(k, "SELECT seq FROM sqlite_sequence WHERE name = 'boards_board'")).toEqual([{ seq: 6 }])

    // Editing the board the step made settles its notice, as before.
    await ok(k, "board", "edit", "#CRMB", "--code", "CRMBOARD")
    await close(k)
    const again = await boot(builtinPlugins)
    expect(again.plugins.find((p) => p.id === "meetings")!.notices ?? []).toEqual([])
    // Nothing runs twice: the steps are done, the rows are where they were.
    expect(all(again, "SELECT plugin, id FROM kernel_plugin_migration WHERE id LIKE 'upgrade:%' AND plugin IN ('boards', 'meetings') ORDER BY plugin, id")).toEqual([
      { plugin: "boards", id: "upgrade:from-meetings" },
      { plugin: "meetings", id: "upgrade:boards-from-projects" },
      { plugin: "meetings", id: "upgrade:boards-handover" },
      { plugin: "meetings", id: "upgrade:boards-leftovers" },
    ])
    expect(all(again, "SELECT id, code FROM boards_board ORDER BY id")).toEqual([
      { id: 1, code: "MB" },
      { id: 2, code: "CRMBOARD" },
      { id: 3, code: "OLD" },
      { id: 5, code: "PROG" },
      { id: 6, code: "NEW" },
    ])
  })

  test("Review Focus 2: with boards off at the upgrade, meetings is off too and its boards wait; enabling boards moves them", async () => {
    await legacyDatabase()
    const off = await boot(builtinPlugins, without("boards"))
    expect(off.plugins.filter((p) => ["boards", "meetings"].includes(p.id)).map((p) => [p.id, p.status, p.error ?? null])).toEqual([
      ["boards", "disabled", null],
      ["meetings", "failed", 'requires "boards", which is disabled'],
    ])
    expect(all(off, `SELECT ${BOARD_COLUMNS} FROM meetings_board ORDER BY id`)).toEqual(LEGACY_ROWS)
    expect(tables(off)).toEqual(["meetings_board"]) // no boards table yet, and meetings' 008 has not run
    expect((await cli(off, "board", "list")).code).not.toBe(0)
    // The links still name the board (and the meeting): soft references while no plugin registers their types.
    expect((await ok(off, "action", "list", "--json")).json.map((a: any) => a.links.map((l: any) => l.ref))).toEqual([["board:1", "meeting:1"], ["board:3"]])
    await close(off)

    const k = await boot(builtinPlugins)
    expect(k.plugins.every((p) => p.status === "ok")).toBe(true)
    expect(all(k, `SELECT ${BOARD_COLUMNS} FROM boards_board ORDER BY id`)).toEqual(LEGACY_ROWS)
    expect(all(k, "SELECT * FROM meetings_board")).toEqual([])
    expect((await ok(k, "board", "list", "--json")).json).toEqual(LIST)
    expect((await ok(k, "action", "list", "--json")).json.map((a: any) => a.links.map((l: any) => l.ref))).toEqual([["#MB", "M-1"], ["#OLD"]])
  })

  test("with meetings off, boards shows none of meetings' boards and allocates above them; enabling meetings moves them, once", async () => {
    await legacyDatabase()
    const k = await boot(builtinPlugins, without("meetings"))
    expect(k.plugins.find((p) => p.id === "boards")).toMatchObject({ status: "ok" })
    expect((await ok(k, "board", "list")).out).toBe("no boards\n")
    expect(all(k, "SELECT id FROM kernel_plugin_migration WHERE plugin = 'boards' AND id LIKE 'upgrade:%'")).toEqual([]) // waiting
    // A board added meanwhile cannot take an id a moved board keeps.
    expect((await ok(k, "board", "add", "IT", "IT board", "--json")).json.id).toBe(RESERVED + 1)
    await close(k)

    const both = await boot(builtinPlugins)
    expect(both.plugins.every((p) => p.status === "ok" && p.error === undefined)).toBe(true)
    expect(all(both, "SELECT id, code FROM boards_board ORDER BY id")).toEqual([
      { id: 1, code: "MB" },
      { id: 2, code: "CRMB" },
      { id: 3, code: "OLD" },
      { id: 5, code: "PROG" },
      { id: RESERVED + 1, code: "IT" },
    ])
    expect(all(both, "SELECT * FROM meetings_board")).toEqual([])
    expect((await ok(both, "board", "list", "--json")).json.map((b: any) => b.ref)).toEqual(["#CRMB", "#IT", "#MB", "#PROG"])
    await close(both)
    const again = await boot(builtinPlugins)
    expect(all(again, "SELECT count(*) AS n FROM boards_board")).toEqual([{ n: 5 }])
  })

  test("a code taken meanwhile stops the move whole: nothing changes, it says why, and the move runs once the code is free", async () => {
    await legacyDatabase()
    const k = await boot(builtinPlugins, without("meetings"))
    await ok(k, "board", "add", "MB", "Another management board")
    await close(k)

    const clash = await boot(builtinPlugins)
    const boards = clash.plugins.find((p) => p.id === "boards")!
    expect(boards.status).toBe("ok")
    expect(boards.error).toBe(`data step "from-meetings" failed: cannot move the meetings plugin's boards: #MB is already taken in the boards plugin`)
    expect(boards.hint).toBe(
      "your data is untouched (the boards stay in the meetings plugin until they can move); give the board added since another code: ttybrain board edit <#CODE> --code <CODE>",
    )
    expect(all(clash, "SELECT id, code FROM boards_board")).toEqual([{ id: RESERVED + 1, code: "MB" }])
    expect(all(clash, "SELECT count(*) AS n FROM meetings_board")).toEqual([{ n: 4 }])
    expect(all(clash, "SELECT * FROM boards_handover")).toEqual([])
    await ok(clash, "board", "edit", "MB", "--code", "MB2")
    await close(clash)

    const moved = await boot(builtinPlugins)
    expect(moved.plugins.every((p) => p.status === "ok" && p.error === undefined)).toBe(true)
    expect(all(moved, "SELECT id, code FROM boards_board ORDER BY id").map((r) => r.code)).toEqual(["MB", "CRMB", "OLD", "PROG", "MB2"])
    expect(all(moved, "SELECT * FROM meetings_board")).toEqual([])
  })

  test("the counter starts past the highest board id meetings still names, so a deleted board's meetings are not re-pointed", async () => {
    await legacyDatabase()
    // Board 9 was deleted long ago (no row left), but a held meeting still names it.
    const old = await boot([people, projects, actions, meetingsV21, inbox])
    old.db.raw
      .prepare(
        `INSERT INTO meetings_meeting (id, title, date, kind, status, notes, subject_type, subject_id, series_id, series_date, auto_close, created_at, updated_at)
         VALUES (4, 'Gone board', '2026-09-25', 'board', 'held', '', 'board', 9, NULL, NULL, 1, ?, ?)`,
      )
      .run([T, T] as any)
    await close(old)

    const k = await boot(builtinPlugins)
    expect(k.plugins.map((p) => [p.id, p.status, p.error ?? null])).toEqual(builtinPlugins.map((p) => [p.id, "ok", null]))
    expect(all(k, `SELECT ${BOARD_COLUMNS} FROM boards_board ORDER BY id`)).toEqual(LEGACY_ROWS) // no placeholder left
    expect(all(k, "SELECT seq FROM sqlite_sequence WHERE name = 'boards_board'")).toEqual([{ seq: 9 }])
    expect((await ok(k, "board", "add", "NEW", "New board", "--json")).json.id).toBe(10)
    expect(all(k, "SELECT subject_type, subject_id FROM meetings_meeting WHERE id = 4")).toEqual([{ subject_type: "board", subject_id: 9 }])
    expect((await ok(k, "meeting", "show", "M-4")).out).not.toContain("#NEW")
  })

  test("a legacy board's code a project took meanwhile stops the move whole, with a hint naming both", async () => {
    await legacyDatabase()
    const off = await boot(builtinPlugins, without("boards"))
    await ok(off, "project", "add", "MB", "Mobile") // boards is off: nothing to check the code against
    await close(off)

    const clash = await boot(builtinPlugins)
    const boards = clash.plugins.find((p) => p.id === "boards")!
    expect(boards.status).toBe("ok")
    expect(boards.error).toBe(`data step "from-meetings" failed: cannot move the meetings plugin's boards: #MB is already used by the project #MB`)
    expect(boards.hint).toBe(
      'your data is untouched (the boards stay in the meetings plugin until they can move); the board #MB "Management board" and the project #MB "Mobile" have the same code, and project and board codes share one namespace: give the project another code: ttybrain project edit #MB --code <CODE>',
    )
    expect(all(clash, "SELECT * FROM boards_board")).toEqual([])
    expect(all(clash, "SELECT count(*) AS n FROM meetings_board")).toEqual([{ n: 4 }])
    expect(all(clash, "SELECT * FROM boards_handover")).toEqual([])
    expect(all(clash, "SELECT id FROM kernel_plugin_migration WHERE plugin = 'boards' AND id LIKE 'upgrade:%'")).toEqual([]) // pending
    await ok(clash, "project", "edit", "MB", "--code", "MOB")
    await close(clash)

    const moved = await boot(builtinPlugins)
    expect(moved.plugins.every((p) => p.status === "ok" && p.error === undefined)).toBe(true)
    expect(all(moved, `SELECT ${BOARD_COLUMNS} FROM boards_board ORDER BY id`)).toEqual(LEGACY_ROWS)
    expect(all(moved, "SELECT * FROM meetings_board")).toEqual([])
  })

  test("an id taken meanwhile stops the move whole, and the hint says the ids clash", async () => {
    await legacyDatabase()
    // A legacy board with an id above RESERVED: a board added while meetings is off takes the same id.
    const old = await boot([people, projects, actions, meetingsV21, inbox])
    old.db.raw.prepare(`INSERT INTO meetings_board (${BOARD_COLUMNS}, talk_stayed) VALUES (?, 'HIGH', 'High board', NULL, NULL, NULL, ?, ?, 0)`).run([RESERVED + 1, T, T] as any)
    await close(old)
    const k = await boot(builtinPlugins, without("meetings"))
    expect((await ok(k, "board", "add", "IT", "IT board", "--json")).json.id).toBe(RESERVED + 1)
    await close(k)

    const clash = await boot(builtinPlugins)
    const boards = clash.plugins.find((p) => p.id === "boards")!
    expect(boards.error).toBe(`data step "from-meetings" failed: cannot move the meetings plugin's boards: id ${RESERVED + 1} (#IT) is already taken in the boards plugin`)
    expect(boards.hint).toBe(
      "your data is untouched (the boards stay in the meetings plugin until they can move); a board added since has the id of one of them (the ids clash, not the codes), which should not happen: don't delete boards to make room, report it",
    )
    expect(all(clash, "SELECT id, code FROM boards_board")).toEqual([{ id: RESERVED + 1, code: "IT" }])
    expect(all(clash, "SELECT count(*) AS n FROM meetings_board")).toEqual([{ n: 5 }])
  })
})
