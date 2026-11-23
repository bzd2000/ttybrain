// Boards (design §5.7, plan rulings B2, B3): the board record (`#MB`), its CLI, the code namespace it shares with
// projects, boards as the subject of meetings, series and talk items, actions linked to a board, and `#CODE` that is a
// board where a project is needed (Review Focus 1–2).
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
import { actions } from "../../actions/logic/index"
import { people } from "../../people/logic/index"
import { projects } from "../../projects/logic/index"
import { meetings } from "./index"

let k: TestKernel | undefined
afterEach(async () => {
  await k?.cleanup()
  k = undefined
})

type Res = { code: number; out: string; err: string; json: any }
async function cli(...argv: string[]): Promise<Res> {
  let out = ""
  let err = ""
  const code = await runCli(argv, k!, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => "" })
  let json: any
  try {
    json = JSON.parse(out)
  } catch {}
  return { code, out, err, json }
}
async function ok(...argv: string[]) {
  const r = await cli(...argv)
  if (r.code !== 0) throw new Error(`ttybrain ${argv.join(" ")} → exit ${r.code}: ${r.out}${r.err}`)
  return r
}
const inCtx = <T>(fn: () => Promise<T>) => runWithContext(k!.context(), fn)
const api = (plugin: string) => k!.runtime(plugin)!.self() as { read: Record<string, (i: any) => Promise<any>>; write: Record<string, (i: any) => Promise<any>> }
const w = (op: string, input: unknown, plugin = "meetings") => inCtx(() => api(plugin).write[op]!(input))
const r = (op: string, input: unknown) => inCtx(() => api("meetings").read[op]!(input))
const d = (op: string, input: unknown, plugin = "meetings") => inCtx(() => k!.ops.describe(plugin, op, input))
const failure = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as { name: string; message: string; hint?: string; field?: string }
  }
  throw new Error("expected a failure")
}
const sql = (q: string) => k!.db.raw.prepare(q).all([])

async function boot() {
  k = await makeTestKernel({ plugins: [meetings, projects, people, actions] }) // today: Fri 2026-11-13
  await w("addPerson", { name: "Peter Janssens", handle: "peter" }, "people")
  await w("addPerson", { name: "Anna Peeters", handle: "anna" }, "people")
  await w("addProject", { code: "CRM", name: "CRM replatforming" }, "projects")
}

describe("ttybrain board", () => {
  test("board add, list, show, edit, archive and restore, with --json", async () => {
    await boot()
    expect(await d("addBoard", { code: "#mb", name: " Management board " })).toBe('+ board MB "Management board"')
    expect(await ok("board", "add", "mb", "Management board", "--note", "Monthly, with the directors")).toMatchObject({ out: "#MB Management board\n", err: "" })
    const added = (await ok("board", "add", "IT2", "IT board", "--json")).json
    expect(added).toEqual({ ref: "#IT2", id: 2, code: "IT2", name: "IT board", note: null, archived: false })
    expect((await ok("board", "list")).out).toBe(["code  name              note", "IT2   IT board", "MB    Management board  Monthly, with the directors", ""].join("\n"))
    expect((await ok("board", "list", "--json")).json.map((b: any) => b.ref)).toEqual(["#IT2", "#MB"])

    await ok("meeting", "series", "add", "#MB", "Board", "--every", "monthly on the last fri", "--from", "today", "--attendees", "peter,anna")
    await ok("talk", "add", "#MB", "Budget 2027 first view")
    expect((await ok("board", "show", "#MB")).out).toBe(
      [
        "#MB Management board",
        "  note: Monthly, with the directors",
        "  series: S-1 Board: monthly on the last fri, next 2026-11-27",
        "  next: M-1 Board on 2026-11-27",
        "  talk: 1 open item",
        "",
      ].join("\n"),
    )
    expect((await ok("board", "show", "mb", "--json")).json).toEqual({
      ref: "#MB",
      id: 1,
      code: "MB",
      name: "Management board",
      note: "Monthly, with the directors",
      archived: false,
      series: ["S-1"],
      next: "M-1",
      talk: 1,
    })
    expect((await ok("board", "show", "IT2")).out).toBe("#IT2 IT board\n")

    expect(await d("editBoard", { board: "#MB", code: "mgmt", name: "Mgmt board" })).toBe("~ MB code → MGMT, name")
    expect((await ok("board", "edit", "#MB", "--code", "mgmt", "--name", "Mgmt board", "--no-note")).out).toBe("#MGMT Mgmt board\n")
    // Everything follows the board by id.
    expect((await ok("meeting", "show", "M-1")).out).toContain("  kind: board\n  status: planned\n  about: #MGMT\n")
    expect((await ok("talk", "list", "#MGMT", "--json")).json.map((t: any) => [t.ref, t.about])).toEqual([["T-1", "#MGMT"]])
    expect((await cli("board", "show", "#MB")).err).toBe('error: unknown board "MB"\nhint: did you mean "MGMT", "IT2"?\n')

    expect(await d("archiveBoard", { board: "MGMT" })).toBe("~ MGMT archived")
    expect((await ok("board", "archive", "#MGMT")).out).toBe("#MGMT archived\n")
    expect((await ok("board", "list")).out).toBe(["code  name      note", "IT2   IT board", ""].join("\n"))
    expect((await ok("board", "list", "--archived")).out).toBe(["code  name        note", "MGMT  Mgmt board", ""].join("\n"))
    expect((await ok("board", "show", "MGMT")).out.split("\n")[0]).toBe("#MGMT Mgmt board (archived)")
    // An archived board takes no new meetings, series or talk items (and no edits) until it is restored.
    const archived = 'error: #MGMT is archived\nhint: restore it first: ttybrain board restore #MGMT\n'
    expect(await cli("meeting", "add", "Extra board", "--about", "#MGMT", "--date", "2026-12-04")).toMatchObject({ code: 1, err: archived })
    expect(await cli("meeting", "series", "add", "#MGMT", "B", "--every", "weekly on mon", "--from", "mon")).toMatchObject({ code: 1, err: archived })
    expect(await cli("talk", "add", "#MGMT", "Later")).toMatchObject({ code: 1, err: archived })
    expect(await cli("board", "edit", "#MGMT", "--name", "x")).toMatchObject({ code: 1, err: archived })
    expect((await ok("board", "restore", "#MGMT")).out).toBe("#MGMT restored\n")
    expect((await ok("talk", "add", "#MGMT", "Later")).out).toBe("T-2 added to #MGMT's talk-list at 2\n")
  })

  test("codes: 2–16 letters or digits with at least one letter, upper-cased; one board per code", async () => {
    await boot()
    for (const bad of ["M", "12", "M B", "ABCDEFGHIJKLMNOPQ"]) {
      const e = await cli("board", "add", bad, "x")
      expect([e.code, e.err]).toEqual([1, `error: invalid board code "${bad.toUpperCase()}"\nhint: 2–16 letters or digits with at least one letter, e.g. MB\n`])
    }
    await ok("board", "add", "MB", "Management board")
    expect(await cli("board", "add", "mb", "Again")).toMatchObject({ code: 3, err: 'error: board "MB" already exists\nhint: choose another code\n' })
    await ok("board", "add", "IT", "IT board")
    expect(await cli("board", "edit", "IT", "--code", "#mb")).toMatchObject({ code: 3, err: 'error: board "MB" already exists\nhint: choose another code\n' })
    expect((await ok("board", "edit", "IT", "--code", "it")).out).toBe("#IT IT board\n") // its own code is no change
    // Resolved by code only: a board has no number of its own.
    expect(await inCtx(() => k!.runtime("meetings")!.records.resolve("#1", { type: "board" }))).toBeNull()
    expect(await inCtx(() => k!.runtime("meetings")!.records.resolve("#MB"))).toEqual({ type: "board", id: 1 })
    expect(await inCtx(() => k!.runtime("meetings")!.records.label("#MB"))).toBe("Management board")
  })

  test("B2 / Review Focus 2: project and board codes share one namespace, on add and on rename, case-insensitive", async () => {
    await boot()
    await ok("board", "add", "MB", "Management board")
    const used = (what: string, code: string) => `error: code "${code}" is already used by the ${what} #${code}\nhint: project and board codes share one namespace; choose another code\n`
    expect(await cli("project", "add", "mb", "Mobile")).toMatchObject({ code: 3, err: used("board", "MB") })
    expect(await cli("project", "edit", "CRM", "--code", "Mb")).toMatchObject({ code: 3, err: used("board", "MB") })
    expect(await cli("board", "add", "crm", "CRM board")).toMatchObject({ code: 3, err: used("project", "CRM") })
    expect(await cli("board", "edit", "MB", "--code", "#crm")).toMatchObject({ code: 3, err: used("project", "CRM") })
    // Nothing changed.
    expect(sql("SELECT code, name FROM projects_project ORDER BY id")).toEqual([{ code: "CRM", name: "CRM replatforming" }])
    expect(sql("SELECT code, name FROM meetings_board ORDER BY id")).toEqual([{ code: "MB", name: "Management board" }])
    // The view projects reads.
    expect(sql('SELECT * FROM "meetings__pub_board"')).toEqual([{ id: 1, code: "MB", name: "Management board", archived_at: null }])
  })

  test("Review Focus 1: a board where a project is needed is refused as a board", async () => {
    await boot()
    await ok("board", "add", "MB", "Management board")
    const show = await cli("project", "show", "#MB")
    expect([show.code, show.err]).toEqual([1, 'error: #MB is a board, not a project\nhint: run "ttybrain project list" for the project codes\n'])
    expect((await cli("project", "edit", "MB", "--name", "x")).err.split("\n")[0]).toBe("error: #MB is a board, not a project")
    const action = await cli("action", "add", "Send the pack", "--project", "MB")
    expect([action.code, action.err]).toEqual([1, "error: #MB is a board, not a project\nhint: link the action to it instead: --link #MB\n"])
    const tag = await cli("talk", "add", "@anna", "Budget", "--project", "MB")
    expect([tag.code, tag.err]).toEqual([1, "error: #MB is a board, not a project\nhint: a talk item's project tag needs a project\n"])
    const agenda = await cli("meeting", "add", "Steering", "--about", "#CRM", "--date", "2026-12-04", "--projects", "CRM,MB")
    expect([agenda.code, agenda.err.split("\n")[0]]).toEqual([1, "error: #MB is a board, not a project"])
    const note = await failure(w("addNote", { person: "@anna", kind: "interaction", text: "Ship", project: "MB" }, "people"))
    expect([note.name, note.message, note.hint]).toEqual(["ValidationError", "#MB is a board, not a project", 'run "ttybrain project list" for the project codes'])
    const notes = await cli("note", "list", "--project", "MB")
    expect([notes.code, notes.err]).toEqual([1, 'error: #MB is a board, not a project\nhint: run "ttybrain project list" for the project codes\n'])
    // And the reverse: a project where a board is needed.
    const board = await cli("board", "show", "#CRM")
    expect([board.code, board.err]).toEqual([1, 'error: #CRM is a project, not a board\nhint: run "ttybrain board list" for the board codes\n'])
    // An unknown code names both.
    expect((await cli("meeting", "add", "x", "--about", "#NOPE", "--date", "today")).err.split("\n")[0]).toBe('error: unknown project or board "#NOPE"')
  })
})

describe("boards as subjects", () => {
  test("kind board ⇔ a board subject: --about #MB gives kind board; project or 1:1 on a board is refused", async () => {
    await boot()
    await ok("board", "add", "MB", "Management board")
    const m = (await ok("meeting", "add", "Board", "--about", "#MB", "--date", "2026-11-27", "--json")).json
    expect([m.ref, m.kind, m.about]).toEqual(["M-1", "board", "#MB"])
    expect((await ok("meeting", "add", "Board 2", "--about", "mb", "--date", "2026-12-18", "--json")).json.kind).toBe("board") // a bare code
    const project = await failure(w("addMeeting", { about: "#MB", title: "x", date: "today", kind: "project" }))
    expect([project.name, project.message, project.field]).toEqual(["ValidationError", "a project meeting needs a project; #MB is a board", "kind"])
    const one = await failure(w("addMeeting", { about: "#MB", title: "x", date: "today", kind: "one_on_one" }))
    expect([one.message, one.field]).toEqual(["a 1:1 needs a person; #MB is a board", "kind"])
    const person = await failure(w("addMeeting", { about: "@anna", title: "x", date: "today", kind: "board" }))
    const HINT = "make it about a board (#MB); add one: ttybrain board add <CODE> <name>"
    expect([person.message, person.field, person.hint]).toEqual(["a board meeting needs a board; @anna is a person", "kind", HINT])
    // Kind board needs a board: on a project it is refused too (meeting, series, an edit of the kind, a new subject).
    const onProject = await failure(w("addMeeting", { about: "#CRM", title: "x", date: "today", kind: "board" }))
    expect([onProject.name, onProject.message, onProject.field, onProject.hint]).toEqual(["ValidationError", "a board meeting needs a board; #CRM is a project", "kind", HINT])
    const series = await failure(w("addSeries", { about: "#CRM", title: "x", kind: "board", every: "weekly on fri", from: "today" }))
    expect([series.message, series.hint]).toEqual(["a board meeting needs a board; #CRM is a project", HINT])
    const moved = await failure(w("setSubject", { meeting: "M-1", about: "#CRM", kind: "board" }))
    expect([moved.message, moved.hint]).toEqual(["a board meeting needs a board; #CRM is a project", HINT])
    expect(sql("SELECT kind, subject_type FROM meetings_meeting WHERE id = 1")).toEqual([{ kind: "board", subject_type: "board" }])
    const edit = await failure(w("editMeeting", { ref: "M-1", kind: "project" }))
    expect(edit.message).toBe("a project meeting needs a project; #MB is a board")
    await ok("meeting", "add", "Steering", "--about", "#CRM", "--date", "2026-12-04")
    // `meeting subject` on a meeting that has a subject keeps its kind: a board needs --kind board, nothing silently re-kinds.
    const toBoard = await cli("meeting", "subject", "M-3", "#MB")
    expect([toBoard.code, toBoard.err]).toEqual([1, "error: M-3 is a project meeting; #MB would make it a board meeting\nhint: to change its kind too: ttybrain meeting subject M-3 #MB --kind board\n"])
    expect((await ok("meeting", "subject", "M-3", "#MB", "--kind", "board")).out).toBe("M-3 about #MB (board)\n")
    // And back: a mistake is undone with --kind; without it a board meeting refuses a person or project.
    const toPerson = await cli("meeting", "subject", "M-3", "@anna")
    expect([toPerson.code, toPerson.err]).toEqual([1, "error: M-3 is a board meeting; @anna would make it a 1:1 meeting\nhint: to change its kind too: ttybrain meeting subject M-3 @anna --kind one_on_one\n"])
    expect(sql("SELECT kind, subject_type FROM meetings_meeting WHERE id = 3")).toEqual([{ kind: "board", subject_type: "board" }])
    const wrong = await cli("meeting", "subject", "M-3", "@anna", "--kind", "project")
    expect([wrong.code, wrong.err.split("\n")[0]]).toEqual([1, "error: a project meeting needs a project; @anna is a person"])
    expect((await ok("meeting", "subject", "M-3", "#CRM", "--kind", "project")).out).toBe("M-3 about #CRM (project)\n")
    expect((await ok("meeting", "subject", "M-3", "#MB", "--kind", "board")).out).toBe("M-3 about #MB (board)\n")
    // In bulk: a project meeting and board meetings without a subject; each ref takes only those that fit.
    k!.db.raw.prepare("UPDATE meetings_meeting SET subject_type = NULL, subject_id = NULL WHERE id IN (2, 3)").run([])
    k!.db.raw.prepare("UPDATE meetings_meeting SET kind = 'project' WHERE id = 2").run([])
    const bulk = await cli("meeting", "subject", "--all-without", "#CRM", "--json")
    expect([bulk.code, bulk.json.meetings.map((m: any) => m.ref), bulk.json.skipped]).toEqual([0, ["M-2"], 1])
    expect(bulk.json.reason).toBe("1 board meeting (they need a board; #CRM is a project)")
    k!.db.raw.prepare("UPDATE meetings_meeting SET subject_type = NULL, subject_id = NULL, kind = 'project' WHERE id = 2").run([])
    expect((await ok("meeting", "subject", "--all-without", "#MB")).out).toBe(
      "M-3 about #MB (board)\nskipped 1 meeting that is not a board meeting (a board is only the subject of board meetings)\n",
    )
    const noBoard = await cli("meeting", "subject", "--all-without", "#MB") // M-2 (a project meeting) is the only one left
    expect([noBoard.code, noBoard.err.split("\n")[0]]).toEqual([1, "error: no meeting without a subject fits #MB: 1 meeting that is not a board meeting (a board is only the subject of board meetings)"])
    expect((await ok("meeting", "subject", "--all-without", "#CRM")).out).toBe("M-2 about #CRM (project)\n")
    k!.db.raw.prepare("UPDATE meetings_meeting SET subject_type = NULL, subject_id = NULL WHERE id = 3").run([])
    const nofit = await cli("meeting", "subject", "--all-without", "#CRM")
    expect([nofit.code, nofit.err.split("\n")[0]]).toEqual([1, "error: no meeting without a subject fits #CRM: 1 board meeting (they need a board; #CRM is a project)"])
    const withKind = await cli("meeting", "subject", "--all-without", "#MB", "--kind", "board")
    expect(withKind.code).toBe(1)
    expect((await ok("meeting", "subject", "--all-without", "#MB")).out).toBe("M-3 about #MB (board)\n")
    await ok("meeting", "add", "Steering 2", "--about", "#CRM", "--date", "2026-12-11")
    const kind = await failure(w("editMeeting", { ref: "M-4", kind: "board" }))
    expect(kind.message).toBe("a board meeting needs a board; #CRM is a project")
    const cmd = await cli("meeting", "add", "x", "--about", "#CRM", "--kind", "board", "--date", "today")
    expect([cmd.code, cmd.err]).toEqual([1, `error: a board meeting needs a board; #CRM is a project\nhint: ${HINT}\n`])
  })

  test("a board series makes its occurrences; upcoming and meeting list show the board", async () => {
    await boot()
    await ok("board", "add", "MB", "Management board")
    const s = (await ok("meeting", "series", "add", "#MB", "Board", "--every", "monthly on the last fri", "--from", "today", "--json")).json
    expect(s).toMatchObject({ ref: "S-1", kind: "board", about: "#MB", rhythm: "monthly on the last fri", next: "2026-11-27" })
    expect(sql("SELECT id, date, kind, subject_type, subject_id, series_id FROM meetings_meeting ORDER BY id")).toEqual([
      { id: 1, date: "2026-11-27", kind: "board", subject_type: "board", subject_id: 1, series_id: 1 },
      { id: 2, date: "2026-12-25", kind: "board", subject_type: "board", subject_id: 1, series_id: 1 },
    ])
    expect((await r("upcoming", { from: "today", to: "+30d" })).meetings.map((m: any) => [m.ref, m.about, m.kind])).toEqual([["M-1", "#MB", "board"]])
    expect((await ok("meeting", "series", "list")).out).toContain("S-1  Board  #MB    board  monthly on the last fri")
  })

  test("an archived board's series make no new meetings until it is restored", async () => {
    await boot()
    await ok("board", "add", "MB", "Management board")
    await ok("meeting", "series", "add", "#MB", "Board", "--every", "monthly on the last fri", "--from", "today")
    const dates = () => sql("SELECT date FROM meetings_meeting WHERE series_id = 1 ORDER BY date").map((r: any) => r.date)
    expect(dates()).toEqual(["2026-11-27", "2026-12-25"])
    await ok("board", "archive", "MB")
    await ok("meeting", "series", "edit", "S-1", "--every", "weekly on fri")
    expect(dates()).toEqual(["2026-11-27", "2026-12-25"])
    await ok("board", "restore", "MB")
    await ok("meeting", "series", "edit", "S-1", "--title", "Weekly board")
    expect(dates()).toEqual(["2026-11-13", "2026-11-20", "2026-11-27", "2026-12-04", "2026-12-11", "2026-12-18", "2026-12-25", "2027-01-01"])
  })

  test("a board's talk-list, and its meetings' agenda: the board's items only (no project tags merged)", async () => {
    await boot()
    await ok("board", "add", "MB", "Management board")
    await ok("meeting", "add", "Board", "--about", "#MB", "--date", "2026-11-27", "--projects", "CRM")
    expect((await ok("talk", "add", "#MB", "Hiring freeze impact")).out).toBe("T-1 added to #MB's talk-list at 1\n")
    await ok("talk", "add", "mb", "Security awareness sponsor")
    await ok("talk", "add", "@anna", "Budget", "--project", "CRM")
    await ok("talk", "add", "#CRM", "Not the board's")
    const tag = await cli("talk", "add", "#MB", "Tagged", "--project", "CRM")
    expect([tag.code, tag.err.split("\n")[0]]).toEqual([1, "error: a project tag is for a person's item; #MB's own items are on its meetings already"])
    expect((await ok("talk", "list", "#MB")).out).toBe(
      ["#MB · 2 open", "1. T-1  Hiring freeze impact        —  2026-11-13", "2. T-2  Security awareness sponsor  —  2026-11-13", ""].join("\n"),
    )
    expect((await r("agendaFor", { meeting: "M-1" })).items.map((t: any) => t.ref)).toEqual(["T-1", "T-2"])
    // Taken onto the agenda (M8): discussed in the board meeting, off its talk-list.
    expect((await ok("talk", "done", "T-1", "--meeting", "M-1")).out).toBe("T-1 discussed in M-1\n")
    expect(await cli("talk", "done", "T-3", "--meeting", "M-1")).toMatchObject({ code: 1, err: "error: T-3 is not on M-1's agenda\n" })
    expect((await r("agendaFor", { meeting: "M-1" })).items.map((t: any) => t.ref)).toEqual(["T-2"])
    // Every list: people, then projects, then boards.
    expect((await ok("talk", "list")).out.split("\n").filter((l) => l.includes(" · "))).toEqual(["@anna · 1 open", "#CRM · 1 open", "#MB · 1 open"])
    // Closed: the unticked item is kept for next time.
    expect((await ok("meeting", "close", "M-1")).out).toBe("Board closed · 1 discussed, 1 kept for next time\n")
    // The board pack and the minutes work for a board's meeting as before.
    expect((await ok("report", "board", "M-1")).out).toContain("CRM replatforming status")
    expect((await ok("report", "minutes", "M-1")).code).toBe(0)
  })

  test("actions: --link #MB links the board (record_type board); an agreed action links the meeting and its board", async () => {
    await boot()
    await ok("board", "add", "MB", "Management board")
    await ok("meeting", "add", "Board", "--about", "#MB", "--date", "2026-11-27")
    const a = (await ok("action", "add", "Draft 2027 budget", "--link", "#MB", "--json")).json
    expect(a.links).toEqual([{ type: "board", id: 1, ref: "#MB" }])
    expect(sql("SELECT record_type, record_id FROM actions_link")).toEqual([{ record_type: "board", record_id: 1 }])
    expect(await r("agreeLinks", { meeting: "M-1" })).toEqual(["M-1", "#MB"])
    expect((await ok("action", "add", "Send the pack", "--link", "M-1", "--link", "#MB", "--json")).json.links.map((l: any) => l.ref)).toEqual(["M-1", "#MB"])
    expect((await ok("action", "list", "--json")).json.map((x: any) => x.links.map((l: any) => l.ref))).toEqual([["#MB"], ["M-1", "#MB"]])
    // An archived board takes no new links.
    await ok("board", "archive", "MB")
    expect(await cli("action", "add", "Later", "--link", "#MB")).toMatchObject({ code: 1, err: "error: #MB is archived\nhint: restore it first: ttybrain board restore #MB\n" })
  })
})
