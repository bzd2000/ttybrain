// Generic links (design 2026-11-20 §4): an action links to any record (a project, a person, a meeting, …). The
// `--project`, `--for` and `--meeting` flags stay as shorthand, `--json` keeps the fields they gave (from the first
// link of that type) next to a new `links` array; `action show|link|unlink` and `--link` on add/edit/list. A linked
// record that no longer resolves shows its stored ref, or `—` (plan Review Focus 4).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
import { boards } from "../../boards/logic/index"
import { meetings } from "../../meetings/logic/index"
import { people } from "../../people/logic/index"
import { projects } from "../../projects/logic/index"
import { actions } from "./index"

let k: TestKernel

async function cli(argv: string[]): Promise<{ code: number; out: string; err: string; json: any }> {
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
const run = (...argv: string[]) => cli(argv)
async function ok(...argv: string[]) {
  const r = await cli(argv)
  if (r.code !== 0) throw new Error(`ttybrain ${argv.join(" ")} → exit ${r.code}: ${r.out}${r.err}`)
  return r
}
const inCtx = <T>(fn: () => Promise<T>) => runWithContext(k.context(), fn)
const raw = (sql: string) => k.db.raw.prepare(sql).all([]) as any[]
const links = () => raw("SELECT action_id, record_type, record_id FROM actions_link ORDER BY id")
const refs = (json: any[]) => json.map((a) => a.ref)

const CRM = { type: "project", id: 1, ref: "#CRM" }
const ERP = { type: "project", id: 2, ref: "#ERP" }
const PETER = { type: "person", id: 1, ref: "@peter" }
const BOB = { type: "person", id: 2, ref: "@bob" }
const M1 = { type: "meeting", id: 1, ref: "M-1" }

beforeEach(async () => {
  k = await makeTestKernel({ plugins: [people, projects, boards, meetings, actions] })
  await ok("project", "add", "CRM", "CRM replatforming")
  await ok("project", "add", "ERP", "ERP upgrade")
  await ok("person", "add", "Peter Stone", "--handle", "peter", "--stakeholder")
  await ok("person", "add", "Bob Smith", "--handle", "bob", "--team")
  await ok("meeting", "add", "SteerCo Q4", "--about", "CRM", "--date", "2026-11-20")
})
afterEach(async () => {
  await k.cleanup()
})

describe("actions: links", () => {
  test("--link (repeatable) links any record; the JSON keeps project / for / meeting from the first link of each type", async () => {
    const a = await ok("action", "add", "Send roadmap", "--link", "#CRM", "--link", "@peter", "--link", "M-1", "--link", "ERP", "--json")
    expect(a.json).toEqual({
      ref: "A-1",
      id: 1,
      title: "Send roadmap",
      due_date: null,
      status: "open",
      done_date: null,
      owner_id: null,
      owner: null,
      project_id: 1,
      project: "#CRM",
      for_person_id: 1,
      for: "@peter",
      meeting_id: 1,
      meeting: "M-1",
      notes: null,
      links: [CRM, PETER, M1, ERP],
    })
    expect(links()).toEqual([
      { action_id: 1, record_type: "project", record_id: 1 },
      { action_id: 1, record_type: "person", record_id: 1 },
      { action_id: 1, record_type: "meeting", record_id: 1 },
      { action_id: 1, record_type: "project", record_id: 2 },
    ])
    // The published views: actions.action without the three columns, actions.link one row per link.
    expect(raw("SELECT * FROM actions__pub_action")).toEqual([{ id: 1, title: "Send roadmap", due_date: null, status: "open", done_date: null, owner_id: null }])
    expect(raw("SELECT action_id, record_type, record_id FROM actions__pub_link ORDER BY id")).toEqual(links())
  })

  test("--project, --for and --meeting are shorthand for links: the same record either way", async () => {
    const short = await ok("action", "add", "Send roadmap", "--project", "CRM", "--for", "peter", "--meeting", "M-1", "--json")
    const long = await ok("action", "add", "Send roadmap", "--link", "#CRM", "--link", "@peter", "--link", "M-1", "--json")
    expect({ ...long.json, ref: "A-1", id: 1 }).toEqual(short.json)
    expect(short.json.links).toEqual([CRM, PETER, M1])
    // Shorthand first, then the links; a record given twice is linked once.
    const both = await ok("action", "add", "Both", "--link", "#ERP", "--project", "CRM", "--link", "CRM", "--json")
    expect([both.json.project, both.json.links]).toEqual(["#CRM", [CRM, ERP]])
    const d = (op: string, input: unknown) => inCtx(() => k.ops.describe("actions", op, input))
    expect(await d("addAction", { title: "Spec", owner: "bob", project: "CRM", links: ["ERP", "M-1"] })).toBe('+ action "Spec" (@bob, CRM, #ERP, M-1)')
    expect(await d("addAction", { title: "Spec", links: ["#NOPE"] })).toBe('+ action "Spec" (@me, #NOPE)')
  })

  test("an unknown or unusable ref is a validation error with a hint", async () => {
    const r = await run("action", "add", "X", "--link", "#NOPE", "--json")
    expect(r.code).toBe(1)
    expect(r.json.error).toEqual({
      code: "validation",
      message: 'unknown record "#NOPE"',
      hint: "link a record by its ref: a project (#CRM), a board (#MB), a person (@anna), a meeting (M-4)",
      field: "links",
    })
    expect((await run("action", "add", "X", "--link", "M-9", "--json")).json.error.message).toBe('unknown record "M-9"')
    expect((await run("action", "add", "X", "--link", "", "--json")).json.error.field).toBe("links")
    await ok("person", "archive", "peter")
    const archived = await run("action", "add", "X", "--link", "@peter", "--json")
    expect([archived.code, archived.json.error.hint]).toEqual([1, "restore it first: ttybrain person restore @peter"])
    await ok("project", "archive", "ERP")
    expect((await run("action", "add", "X", "--link", "#ERP", "--json")).json.error.hint).toBe("restore it first: ttybrain project restore ERP")
    expect(raw("SELECT count(*) AS n FROM actions_action")).toEqual([{ n: 0 }])
    // The shorthands keep their own errors: an unknown project is not found (exit 2).
    expect((await run("action", "add", "X", "--project", "NOPE", "--json")).code).toBe(2)
  })

  test("action show <A-n>: the action with its links", async () => {
    await ok("action", "add", "Send roadmap", "--owner", "bob", "--due", "fri", "--project", "CRM", "--link", "@peter", "--notes", "v2 deck")
    const s = await ok("action", "show", "A-1")
    expect(s.out).toBe(["A-1 Send roadmap", "  status: open", "  owner: @bob", "  due: 2026-11-20", "  links: #CRM, @peter", "  notes: v2 deck", ""].join("\n"))
    expect((await ok("action", "show", "1", "--json")).json).toMatchObject({ ref: "A-1", owner: "@bob", links: [CRM, PETER] })
    await ok("action", "done", "A-1", "--date", "2026-11-12")
    expect((await ok("action", "show", "A-1")).out).toContain("  status: done (2026-11-12)\n")
    expect((await run("action", "show", "A-9", "--json")).code).toBe(2)
  })

  test("action link / unlink; already linked and not linked are validation errors; describe lines", async () => {
    await ok("action", "add", "Send roadmap", "--project", "CRM") // A-1
    const l = await ok("action", "link", "A-1", "@bob", "--json")
    expect(l.json.links).toEqual([CRM, BOB])
    expect((await ok("action", "link", "A-1", "ERP")).out).toBe("A-1 linked to #ERP\n")
    const twice = await run("action", "link", "A-1", "#crm", "--json")
    expect([twice.code, twice.json.error.message]).toEqual([1, "A-1 is already linked to #CRM"])
    expect((await ok("action", "unlink", "A-1", "#CRM")).out).toBe("A-1 unlinked from #CRM\n")
    expect((await ok("action", "show", "A-1", "--json")).json).toMatchObject({ project_id: 2, project: "#ERP", links: [BOB, ERP] })
    const none = await run("action", "unlink", "A-1", "M-1", "--json")
    expect([none.code, none.json.error.message]).toEqual([1, "A-1 is not linked to M-1"])
    expect((await run("action", "link", "A-1", "A-1", "--json")).json.error.message).toBe("A-1 cannot be linked to itself")
    expect((await run("action", "link", "A-9", "#CRM", "--json")).code).toBe(2)
    const d = (op: string, input: unknown) => inCtx(() => k.ops.describe("actions", op, input))
    expect(await d("linkAction", { ref: "1", to: "crm" })).toBe("~ A-1 link #CRM")
    expect(await d("unlinkAction", { ref: "A-1", to: "@bob" })).toBe("~ A-1 unlink @bob")
    expect(await d("editAction", { ref: "A-1", title: "x", links: ["#CRM"] })).toBe("~ A-1 title, links")
  })

  test("edit: a shorthand replaces the links of its type (empty clears them); --link replaces every link", async () => {
    await ok("action", "add", "Send roadmap", "--link", "#CRM", "--link", "#ERP", "--link", "@peter", "--link", "M-1") // A-1
    expect((await ok("action", "edit", "A-1", "--project", "ERP", "--json")).json.links).toEqual([ERP, PETER, M1])
    expect((await ok("action", "edit", "A-1", "--for", "", "--meeting", "", "--json")).json).toMatchObject({ for: null, for_person_id: null, meeting: null, links: [ERP] })
    const e = await ok("action", "edit", "A-1", "--link", "@bob", "--link", "#CRM", "--json")
    expect([e.json.links, e.json.project, e.json.for]).toEqual([[BOB, CRM], "#CRM", "@bob"])
    expect((await ok("action", "edit", "A-1", "--project", "", "--json")).json).toMatchObject({ project: null, project_id: null, links: [BOB] })
    // Through the operation: `links: []` clears every link.
    expect((await inCtx(() => k.ops.api("actions")!.write.editAction!({ ref: "A-1", links: [] }))).links).toEqual([])
    expect(links()).toEqual([])
  })

  test("list: --link keeps actions linked to any of the records; --project, --for, --meeting match any link of their type", async () => {
    await ok("action", "add", "One", "--project", "CRM") // A-1
    await ok("action", "add", "Two", "--link", "#ERP", "--link", "#CRM") // A-2: CRM is its second project
    await ok("action", "add", "Three", "--for", "peter", "--meeting", "M-1") // A-3
    await ok("action", "add", "Four") // A-4
    expect(refs((await ok("action", "list", "--link", "#CRM", "--json")).json)).toEqual(["A-1", "A-2"])
    expect(refs((await ok("action", "list", "--link", "#ERP", "--link", "@peter", "--json")).json)).toEqual(["A-2", "A-3"])
    expect(refs((await ok("action", "list", "--project", "CRM", "--json")).json)).toEqual(["A-1", "A-2"])
    expect(refs((await ok("action", "list", "--project", "CRM", "--link", "#ERP", "--json")).json)).toEqual(["A-2"])
    expect(refs((await ok("action", "list", "--for", "peter", "--json")).json)).toEqual(["A-3"])
    expect(refs((await ok("action", "list", "--meeting", "M-1", "--json")).json)).toEqual(["A-3"])
    // The same error as add and edit give.
    const unknown = await run("action", "list", "--link", "#NOPE", "--json")
    expect([unknown.code, unknown.json.error]).toEqual([1, (await run("action", "add", "X", "--link", "#NOPE", "--json")).json.error])
    expect((await run("action", "edit", "A-1", "--link", "#NOPE", "--json")).json.error).toEqual(unknown.json.error)
    // The text list keeps its columns: the first project and the first person linked.
    expect((await ok("action", "list", "--link", "#ERP")).out).toContain("A-2  Two    #ERP")
  })

  test("a linked record that is gone: the action stays, its link shows the stored ref (M-1) or —", async () => {
    await ok("project", "add", "TMP", "Short-lived")
    await ok("person", "add", "Gone Person", "--handle", "gone")
    await ok("action", "add", "Linked to gone things", "--link", "#TMP", "--link", "@gone", "--link", "M-1", "--link", "#CRM") // A-1
    // As if the records were removed (a purge, an older build): nothing tells the actions plugin.
    k.db.raw.exec("DELETE FROM projects_project WHERE code = 'TMP'; DELETE FROM people_person WHERE handle = 'gone'; DELETE FROM meetings_meeting WHERE id = 1")
    const a = (await ok("action", "show", "A-1", "--json")).json
    expect(a).toMatchObject({ project_id: 3, project: null, for_person_id: 3, for: "person:3", meeting_id: 1, meeting: "M-1" })
    expect(a.links).toEqual([{ type: "project", id: 3, ref: "—" }, { type: "person", id: 3, ref: "—" }, M1, CRM])
    expect((await ok("action", "show", "A-1")).out).toContain("  links: —, —, M-1, #CRM\n")
    expect(refs((await ok("action", "list", "--json")).json)).toEqual(["A-1"])
    // Still writable; a gone link is dropped with its stored ref or `<type>:<id>`, never by `—`.
    const dash = await run("action", "unlink", "A-1", "—", "--json")
    expect([dash.code, dash.json.error.message]).toEqual([1, "A-1 is not linked to —"])
    await ok("action", "unlink", "A-1", "M-1")
    await ok("action", "unlink", "A-1", "project:3")
    expect((await ok("action", "edit", "A-1", "--for", "", "--json")).json.links).toEqual([CRM])
    // The project-status and overview reports run.
    expect((await run("report", "status", "CRM", "--previous-meeting", "M-1", "--format", "json")).code).toBe(0)
    expect((await run("report", "overview", "--format", "json")).code).toBe(0)
  })

  test("archived projects: an action is frozen and hidden only when every project it is linked to is archived", async () => {
    await ok("action", "add", "Mixed", "--link", "#CRM", "--link", "#ERP", "--due", "2026-11-01") // A-1: one live, one archived
    await ok("action", "add", "All archived", "--link", "#ERP", "--due", "2026-11-01") // A-2
    await ok("action", "add", "No project", "--due", "2026-11-01") // A-3
    await ok("project", "archive", "ERP")
    const overdue = async () =>
      (await ok("report", "overview", "--format", "json")).json.sections.find((s: any) => s.title === "Overdue actions").rows.map((r: any) => r.ID)
    // Mixed: visible and editable; keeping the archived link in a --link list is fine.
    expect(await overdue()).toEqual(["A-1", "A-3"])
    expect((await ok("action", "edit", "A-1", "--title", "Mixed v2", "--json")).json.title).toBe("Mixed v2")
    expect((await ok("action", "link", "A-1", "@bob", "--json")).json.links).toEqual([CRM, ERP, BOB])
    expect((await ok("action", "edit", "A-1", "--link", "#ERP", "--link", "#CRM", "--json")).json.links).toEqual([ERP, CRM])
    // All archived: every write but unlink is refused.
    for (const argv of [
      ["action", "done", "A-2"],
      ["action", "edit", "A-2", "--title", "x"],
      ["action", "link", "A-2", "@bob"],
    ]) {
      const r = await run(...argv, "--json")
      expect([argv.join(" "), r.code, r.json.error.hint]).toEqual([argv.join(" "), 1, "restore it first: ttybrain project restore ERP"])
    }
    // A new link to an archived project is refused.
    const link = await run("action", "link", "A-3", "#ERP", "--json")
    expect([link.code, link.json.error.message, link.json.error.hint]).toEqual([1, "#ERP is archived", "restore it first: ttybrain project restore ERP"])
    // Unlinking is always allowed: from the mixed one, and from the all-archived one (which then has no project).
    expect((await ok("action", "unlink", "A-1", "#ERP", "--json")).json.links).toEqual([CRM])
    expect((await ok("action", "unlink", "A-2", "#ERP", "--json")).json.links).toEqual([])
    expect(await overdue()).toEqual(["A-1", "A-2", "A-3"])
    expect((await ok("action", "done", "A-2", "--json")).json.status).toBe("done")
  })

  test("readers: meetings' close count, minutes and the person's follow-ups go through the links", async () => {
    await ok("action", "add", "From the meeting", "--link", "M-1", "--link", "#ERP", "--link", "#CRM") // A-1
    await ok("action", "add", "For Peter", "--link", "@bob", "--link", "@peter") // A-2: Peter is the second person
    await ok("action", "add", "Unrelated") // A-3
    const minutes = (await ok("report", "minutes", "M-1", "--format", "json")).json
    const section = minutes.sections.find((s: any) => s.title === "Actions")
    expect(section.rows).toEqual([{ ID: "A-1", Action: "From the meeting", Owner: "@me", Due: null, Project: "ERP" }])
    expect((await ok("meeting", "close", "M-1", "--json")).json.logged).toEqual({ actions: 1, decisions: 0 })
    expect((await ok("project", "show", "CRM", "--json")).json.open_actions).toBe(1)
    expect((await ok("project", "show", "ERP", "--json")).json.open_actions).toBe(1)
  })
})
