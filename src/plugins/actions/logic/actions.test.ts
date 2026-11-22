import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { formatTable } from "../../../kernel/api"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
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
const api = () => k.ops.api("actions")!
const inCtx = <T>(fn: () => Promise<T>) => runWithContext(k.context(), fn)
const rows = (table: string) => k.db.raw.prepare(`SELECT * FROM "actions_${table}" ORDER BY id`).all([]) as any[]
const viewRows = (name: string) => k.db.raw.prepare(`SELECT * FROM "actions__pub_${name}" ORDER BY 1`).all([]) as any[]
const COLUMNS = ["ref", "title", "project", "owner", "for", "due", "status"]

describe("actions", () => {
  beforeEach(async () => {
    k = await makeTestKernel({ plugins: [people, projects, actions] })
    await ok("project", "add", "CRM", "CRM replatforming")
    await ok("person", "add", "Peter Stone", "--handle", "peter", "--stakeholder")
    await ok("person", "add", "Bob", "--team")
  })
  afterEach(async () => {
    await k.cleanup()
  })

  test("action list --overdue --json returns only open actions due before 2026-11-13", async () => {
    await ok("action", "add", "Call vendor", "--due", "2026-11-01", "--project", "CRM") // A-1 overdue
    await ok("action", "add", "Old and done", "--due", "2026-11-02") // A-2 done
    await ok("action", "add", "Due today", "--due", "today") // A-3 not overdue
    await ok("action", "add", "No date") // A-4
    await ok("action", "add", "Old and cancelled", "--due", "2026-11-03") // A-5 cancelled
    await ok("action", "add", "Chase invoice", "--due", "2026-11-12", "--owner", "bob") // A-6 overdue
    await ok("action", "done", "A-2")
    await ok("action", "cancel", "A-5")
    const r = await ok("action", "list", "--overdue", "--json")
    expect(r.json.map((a: any) => [a.ref, a.due_date, a.status])).toEqual([
      ["A-1", "2026-11-01", "open"],
      ["A-6", "2026-11-12", "open"],
    ])
    expect((await ok("action", "list", "--open", "--json")).json.map((a: any) => a.ref)).toEqual(["A-1", "A-6", "A-3", "A-4"])
    expect((await ok("action", "list", "--owner", "bob", "--json")).json.map((a: any) => a.ref)).toEqual(["A-6"])
    expect((await ok("action", "list", "--owner", "me", "--open", "--json")).json.map((a: any) => a.ref)).toEqual(["A-1", "A-3", "A-4"])
    expect((await ok("action", "list", "--project", "CRM", "--json")).json.map((a: any) => a.ref)).toEqual(["A-1"])
    expect((await run("action", "list", "--project", "NOPE", "--json")).code).toBe(2)
  })

  test('action add "Send roadmap" --for peter --due fri → 2026-11-20, owner null; the text list shows me', async () => {
    const a = await ok("action", "add", "Send roadmap", "--for", "peter", "--due", "fri", "--json")
    expect(a.json).toEqual({
      ref: "A-1",
      id: 1,
      title: "Send roadmap",
      due_date: "2026-11-20",
      status: "open",
      done_date: null,
      owner_id: null,
      owner: null,
      project_id: null,
      project: null,
      for_person_id: 1,
      for: "@peter",
      meeting_id: null,
      meeting: null,
      notes: null,
    })
    expect(viewRows("action")).toEqual([
      { id: 1, title: "Send roadmap", due_date: "2026-11-20", status: "open", done_date: null, owner_id: null, project_id: null, for_person_id: 1, meeting_id: null },
    ])
    await ok("action", "add", "Call vendor", "--due", "2026-11-01", "--project", "CRM", "--owner", "bob") // A-2: overdue
    await ok("action", "add", "Book room", "--due", "sun") // A-3: 2026-11-15, this week
    await ok("action", "add", "Draft plan", "--due", "2026-12-01") // A-4: later
    await ok("action", "add", "Read spec") // A-5: no date
    const row = (ref: string, title: string, project: string, owner: string, forp: string, due: string) => ({ ref, title, project, owner, for: forp, due, status: "open" })
    const list = await ok("action", "list")
    expect(list.out).toBe(
      [
        "Overdue",
        formatTable(COLUMNS, [row("A-2", "Call vendor", "#CRM", "@bob", "", "2026-11-01")]),
        "",
        "This week",
        formatTable(COLUMNS, [row("A-3", "Book room", "", "me", "", "2026-11-15")]),
        "",
        "Next week",
        formatTable(COLUMNS, [row("A-1", "Send roadmap", "", "me", "@peter", "2026-11-20")]),
        "",
        "Later",
        formatTable(COLUMNS, [row("A-4", "Draft plan", "", "me", "", "2026-12-01")]),
        "",
        "No date",
        formatTable(COLUMNS, [row("A-5", "Read spec", "", "me", "", "")]),
      ].join("\n") + "\n",
    )
    expect((await ok("action", "list", "--for", "peter", "--json")).json.map((a: any) => a.ref)).toEqual(["A-1"])
  })

  test("edit, done, cancel, delete; status rules", async () => {
    await ok("action", "add", "Send roadmap", "--owner", "bob", "--notes", "v2 deck")
    const e = await ok("action", "edit", "A-1", "--title", "Send roadmap v2", "--owner", "", "--due", "2026-11-30", "--project", "CRM", "--json")
    expect(e.json).toMatchObject({ title: "Send roadmap v2", owner_id: null, owner: null, due_date: "2026-11-30", project: "#CRM", notes: "v2 deck" })
    expect((await ok("project", "show", "CRM", "--json")).json.open_actions).toBe(1)
    const d = await ok("action", "done", "1", "--date", "2026-11-12", "--json")
    expect(d.json).toMatchObject({ ref: "A-1", status: "done", done_date: "2026-11-12" })
    expect((await ok("project", "show", "CRM", "--json")).json.open_actions).toBe(0)
    const again = await run("action", "done", "A-1", "--json")
    expect(again.code).toBe(1)
    expect(again.json.error.message).toBe("A-1 is already done")
    await ok("action", "add", "Book room")
    const c = await ok("action", "cancel", "A-2", "--json")
    expect(c.json).toMatchObject({ status: "cancelled", done_date: null })
    expect((await run("action", "cancel", "A-2", "--json")).json.error.message).toBe("A-2 is already cancelled")
    expect((await run("action", "delete", "A-2", "--json")).code).toBe(1) // needs --yes
    expect((await ok("action", "delete", "A-2", "--yes", "--json")).json).toEqual({ ref: "A-2", deleted: true })
    expect(rows("action").map((r) => r.id)).toEqual([1])
    expect((await run("action", "edit", "A-9", "--title", "x", "--json")).code).toBe(2)
  })

  test("validation: blank title, unknown and archived people, archived project, meetings without a meetings plugin", async () => {
    expect((await run("action", "add", "  ", "--json")).code).toBe(1)
    const who = await run("action", "add", "X", "--owner", "bo", "--json")
    expect(who.code).toBe(2)
    expect(who.json.error.hint).toContain('"bob"')
    expect((await run("action", "add", "X", "--due", "2026-02-30", "--json")).json.error.field).toBe("due")
    await ok("person", "archive", "peter")
    const archived = await run("action", "add", "X", "--for", "peter", "--json")
    expect(archived.code).toBe(1)
    expect(archived.json.error.hint).toContain("restore it first")
    const m = await ok("action", "add", "Follow up", "--meeting", "M-4", "--json")
    expect([m.json.meeting_id, m.json.meeting]).toEqual([4, "M-4"])
    expect((await ok("action", "list", "--meeting", "M-4", "--json")).json.map((a: any) => a.ref)).toEqual(["A-1"])
    await ok("action", "add", "On CRM", "--project", "CRM")
    await ok("project", "archive", "CRM")
    for (const argv of [
      ["action", "add", "Y", "--project", "CRM"],
      ["action", "done", "A-2"],
      ["action", "edit", "A-2", "--title", "Z"],
    ]) {
      const r = await run(...argv, "--json")
      expect([argv.join(" "), r.code]).toEqual([argv.join(" "), 1])
      expect(r.json.error.hint).toContain("restore it first")
    }
  })

  test("record type A-, describe lines", async () => {
    await ok("action", "add", "Send roadmap", "--for", "peter", "--due", "fri")
    expect(await k.records.resolveAny("A-1")).toEqual({ type: "action", id: 1 })
    expect(await k.records.label("A-1")).toBe("Send roadmap")
    const d = (op: string, input: unknown) => inCtx(() => k.ops.describe("actions", op, input))
    expect(await d("addAction", { title: "Tell Peter", forPerson: "peter", due: "fri" })).toBe('+ action "Tell Peter" (me, for @peter, due 2026-11-20)')
    expect(await d("addAction", { title: "Spec", owner: "bob", project: "CRM" })).toBe('+ action "Spec" (@bob, CRM)')
    expect(await d("editAction", { ref: "A-1", title: "x", due: "mon" })).toBe("~ A-1 title, due")
    expect(await d("completeAction", { ref: "A-1" })).toBe("~ A-1 done")
    expect(await d("cancelAction", { ref: "A-1" })).toBe("~ A-1 cancelled")
    expect(await d("deleteAction", { ref: "A-1" })).toBe('- action A-1 "Send roadmap"')
    const out = await inCtx(() => api().write.addAction!({ title: "Via op", owner: "me" }))
    expect([out.ref, out.owner_id]).toEqual(["A-2", null])
  })
})
