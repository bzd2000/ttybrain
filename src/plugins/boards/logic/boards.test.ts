// Boards (design §5.7; moved from the meetings plugin, plan ruling P1): the board record (`#MB`), its CLI, the code
// namespace it shares with projects (Review Focus 3), and `#CODE` that is a board where a project is needed (and the
// reverse).
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
import { actions } from "../../actions/logic/index"
import { people } from "../../people/logic/index"
import { projects } from "../../projects/logic/index"
import { meetings } from "../../meetings/logic/index"
import { boards } from "./index"

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
const w = (op: string, input: unknown, plugin = "boards") => inCtx(() => api(plugin).write[op]!(input))
const d = (op: string, input: unknown, plugin = "boards") => inCtx(() => k!.ops.describe(plugin, op, input))
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
  k = await makeTestKernel({ plugins: [meetings, projects, people, actions, boards] }) // today: Fri 2026-11-13
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
    expect(sql("SELECT code, name FROM boards_board ORDER BY id")).toEqual([{ code: "MB", name: "Management board" }])
    // The view projects reads.
    expect(sql('SELECT * FROM "boards__pub_board"')).toEqual([{ id: 1, code: "MB", name: "Management board", archived_at: null }])
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
