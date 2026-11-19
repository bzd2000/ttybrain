import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
import { people } from "../../people/logic/index"
import { projects } from "./index"

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
const rows = (table: string) => k.db.raw.prepare(`SELECT * FROM "projects_${table}" ORDER BY id`).all([]) as any[]
const viewRows = (name: string) => k.db.raw.prepare(`SELECT * FROM "projects__pub_${name}" ORDER BY 1`).all([]) as any[]

describe("projects: milestones, deliverables, risks, decisions", () => {
  beforeEach(async () => {
    k = await makeTestKernel({ plugins: [people, projects] })
    await ok("project", "add", "CRM", "CRM replatforming")
    await ok("person", "add", "Bob", "--team")
  })
  afterEach(async () => {
    await k.cleanup()
  })

  test("risk add → R-1, owner a soft reference, view row", async () => {
    const r = await ok("risk", "add", "CRM", "Vendor delay", "--type", "risk", "--severity", "high", "--owner", "bob", "--json")
    expect(r.json.ref).toBe("R-1")
    expect(r.json).toMatchObject({ project: "#CRM", type: "risk", title: "Vendor delay", severity: "high", owner: "@bob", status: "open", closed_date: null })
    expect(viewRows("risk")).toEqual([
      { id: 1, project_id: 1, type: "risk", title: "Vendor delay", severity: "high", owner_id: 1, status: "open", closed_date: null },
    ])
    expect((await ok("project", "show", "CRM", "--json")).json.open_risks).toBe(1)
    const c = await ok("risk", "close", "R-1", "--json")
    expect(c.json).toMatchObject({ status: "closed", closed_date: "2026-11-13" })
    expect((await ok("project", "show", "CRM", "--json")).json.open_risks).toBe(0)
    const e = await ok("risk", "edit", "r-1", "--severity", "low", "--mitigation", "Dual source", "--json")
    expect([e.json.severity, e.json.mitigation]).toEqual(["low", "Dual source"])
    expect((await ok("risk", "list", "CRM")).out).toContain("Vendor delay")
    expect((await ok("risk", "list", "--json")).json).toHaveLength(1)
    expect((await ok("risk", "delete", "R-1", "--yes", "--json")).json).toEqual({ ref: "R-1", deleted: true })
    expect(rows("risk")).toEqual([])
    expect((await run("risk", "delete", "R-1", "--yes", "--json")).code).toBe(2)
  })

  test("risk validation: blank title, unknown owner, bad severity", async () => {
    expect((await run("risk", "add", "CRM", "  ", "--type", "risk", "--severity", "high", "--json")).code).toBe(1)
    const o = await run("risk", "add", "CRM", "X", "--type", "risk", "--severity", "high", "--owner", "bo", "--json")
    expect(o.code).toBe(2)
    expect(o.json.error.hint).toBe('did you mean "bob"?')
    expect((await run("risk", "add", "CRM", "X", "--type", "risk", "--severity", "huge", "--json")).code).toBe(1)
    expect((await run("risk", "add", "NOPE", "X", "--type", "risk", "--severity", "low", "--json")).code).toBe(2)
  })

  test("deliverable status delivered sets delivered_date and status_changed_at", async () => {
    const d = await ok("deliverable", "add", "CRM", "Spec", "--owner", "bob", "--due", "2026-12-01", "--json")
    expect(d.json).toMatchObject({ ref: "D-1", status: "not_started", owner: "@bob", due_date: "2026-12-01", milestone: null })
    expect(rows("deliverable")[0].status_changed_at).toBe(null)
    const s = await ok("deliverable", "status", "D-1", "in_review", "--json")
    expect(s.json.status).toBe("in_review")
    expect(rows("deliverable")[0]).toMatchObject({ status: "in_review", status_changed_at: "2026-11-13T09:00:00", delivered_date: null })
    const r = await ok("deliverable", "status", "D-1", "delivered", "--json")
    expect(r.json).toMatchObject({ status: "delivered", delivered_date: "2026-11-13" })
    expect(rows("deliverable")[0]).toMatchObject({ delivered_date: "2026-11-13", status_changed_at: "2026-11-13T09:00:00" })
    expect(viewRows("deliverable")[0]).toEqual({
      id: 1,
      project_id: 1,
      title: "Spec",
      owner_id: 1,
      due_date: "2026-12-01",
      status: "delivered",
      status_changed_at: "2026-11-13T09:00:00",
      milestone_id: null,
    })
    expect((await run("deliverable", "status", "D-1", "bogus", "--json")).code).toBe(1)
    const back = await ok("deliverable", "status", "D-1", "in_progress", "--json")
    expect(back.json.delivered_date).toBe(null)
  })

  test("R19: an unchanged deliverable status is a no-op; closing a closed risk is refused", async () => {
    await ok("deliverable", "add", "CRM", "Spec")
    // set it on an earlier day, through the op, so a second write would show
    await runWithContext({ actor: "me", today: "2026-10-01", now: "2026-10-01T09:00:00" }, () =>
      k.ops.api("projects")!.write.setDeliverableStatus!({ ref: "D-1", status: "delivered" }),
    )
    const before = rows("deliverable")[0]
    expect(before).toMatchObject({ status: "delivered", delivered_date: "2026-10-01", status_changed_at: "2026-10-01T09:00:00" })
    const same = await ok("deliverable", "status", "D-1", "delivered", "--json")
    expect(same.json).toMatchObject({ ref: "D-1", status: "delivered", delivered_date: "2026-10-01", status_changed_at: "2026-10-01T09:00:00" })
    expect(rows("deliverable")[0]).toEqual(before)
    await ok("risk", "add", "CRM", "Vendor delay", "--type", "risk", "--severity", "high")
    await ok("risk", "close", "R-1", "--date", "2026-11-10")
    const again = await run("risk", "close", "R-1", "--json")
    expect(again.code).toBe(1)
    expect(again.json.error.message).toBe("R-1 is already closed")
    expect(rows("risk")[0].closed_date).toBe("2026-11-10")
  })

  test("milestone delete clears deliverables", async () => {
    await ok("milestone", "add", "CRM", "Design approved", "--due", "2026-12-15")
    await ok("deliverable", "add", "CRM", "Spec", "--milestone", "MS-1")
    expect(rows("deliverable")[0].milestone_id).toBe(1)
    expect((await run("milestone", "delete", "MS-1", "--json")).code).toBe(1) // destructive: needs --yes
    const del = await run("milestone", "delete", "MS-1", "--yes", "--json")
    expect(del.code).toBe(0)
    expect(del.json).toEqual({ ref: "MS-1", deleted: true })
    expect(rows("milestone")).toEqual([])
    expect(rows("deliverable")[0].milestone_id).toBe(null)
  })

  test("milestone: invalid date, done, edit, late (view and list)", async () => {
    const bad = await run("milestone", "add", "CRM", "Design approved", "--due", "2026-02-30", "--json")
    expect(bad.code).toBe(1)
    expect(bad.json.error.hint).toBeTruthy()
    expect(bad.json.error.message).toContain("2026-02-30")
    await ok("milestone", "add", "CRM", "Kickoff", "--due", "2020-01-01")
    const m = await ok("milestone", "add", "CRM", "Design approved", "--due", "2099-01-01", "--json")
    expect(m.json).toMatchObject({ ref: "MS-2", project: "#CRM", due_date: "2099-01-01", done_date: null })
    expect(viewRows("milestone").map((r) => [r.id, r.late])).toEqual([
      [1, 1],
      [2, 0],
    ])
    // The injected clock (2026-11-13) decides in the list, not SQLite's date('now').
    await ok("milestone", "edit", "MS-2", "--due", "2026-11-12", "--title", "Design signed off")
    const list = await ok("milestone", "list", "CRM", "--json")
    expect(list.json.map((r: any) => [r.ref, r.late])).toEqual([
      ["MS-1", true],
      ["MS-2", true],
    ])
    const done = await ok("milestone", "done", "MS-1", "--date", "2026-11-10", "--json")
    expect(done.json.done_date).toBe("2026-11-10")
    expect(viewRows("milestone")[0]).toMatchObject({ done_date: "2026-11-10", late: 0 })
    expect((await ok("project", "show", "CRM", "--json")).json.next_milestone_title).toBe("Design signed off")
    expect((await ok("milestone", "done", "MS-2", "--json")).json.done_date).toBe("2026-11-13")
  })

  test("archived project and archived owner are refused with a restore hint", async () => {
    await ok("risk", "add", "CRM", "Early", "--type", "issue", "--severity", "low")
    await ok("person", "add", "Anna")
    await ok("person", "archive", "anna")
    const owner = await run("deliverable", "add", "CRM", "Spec", "--owner", "anna", "--json")
    expect(owner.code).toBe(1)
    expect(owner.json.error.hint).toContain("restore it first")
    await ok("project", "archive", "CRM")
    for (const argv of [
      ["risk", "add", "CRM", "Vendor delay", "--type", "risk", "--severity", "high"],
      ["milestone", "add", "CRM", "M", "--due", "2026-12-01"],
      ["deliverable", "add", "CRM", "D"],
      ["decision", "add", "Pick", "--project", "CRM"],
      ["risk", "close", "R-1"],
      ["risk", "delete", "R-1", "--yes"],
    ]) {
      const r = await run(...argv, "--json")
      expect([argv.join(" "), r.code]).toEqual([argv.join(" "), 1])
      expect(r.json.error.hint).toContain("restore it first")
    }
  })

  test("decision add: soft meeting ref without a meetings plugin; project optional; DE- vs D-", async () => {
    const d = await ok("decision", "add", "Select vendor B", "--project", "CRM", "--meeting", "M-4", "--decided-by", "Steering committee", "--json")
    expect(d.json).toMatchObject({ ref: "DE-1", project: "#CRM", date: "2026-11-13", decided_by: "Steering committee", meeting: "M-4" })
    expect(rows("decision")[0].meeting_id).toBe(4)
    const free = await ok("decision", "add", "Use Bun", "--date", "2026-11-01", "--json")
    expect(free.json).toMatchObject({ ref: "DE-2", project: null, date: "2026-11-01", meeting: null })
    expect(viewRows("decision").map((r) => [r.id, r.project_id, r.meeting_id])).toEqual([
      [1, 1, 4],
      [2, null, null],
    ])
    await ok("deliverable", "add", "CRM", "Spec")
    expect(await k.records.label("DE-1")).toBe("Select vendor B")
    expect(await k.records.label("D-1")).toBe("Spec")
    expect(await k.records.resolveAny("DE-2")).toEqual({ type: "decision", id: 2 })
    expect(await k.records.resolveAny("D-1")).toEqual({ type: "deliverable", id: 1 })
    expect(await k.records.resolveAny("MS-9")).toBe(null)
    const e = await ok("decision", "edit", "DE-2", "--project", "CRM", "--title", "Use Node too", "--json")
    expect([e.json.project, e.json.title]).toEqual(["#CRM", "Use Node too"])
    expect((await ok("decision", "list", "CRM", "--json")).json).toHaveLength(2)
    expect((await run("decision", "add", "X", "--meeting", "nonsense", "--json")).code).toBe(1)
    await ok("decision", "delete", "DE-1", "--yes")
    expect(rows("decision")).toHaveLength(1)
  })

  test("deliverable edit and milestone link rules", async () => {
    await ok("project", "add", "ERP", "ERP")
    await ok("milestone", "add", "ERP", "Other", "--due", "2026-12-01")
    await ok("deliverable", "add", "CRM", "Spec", "--owner", "bob")
    const wrong = await run("deliverable", "edit", "D-1", "--milestone", "MS-1", "--json")
    expect(wrong.code).toBe(1)
    expect((await run("deliverable", "edit", "D-1", "--milestone", "MS-7", "--json")).code).toBe(2)
    await ok("milestone", "add", "CRM", "Mine", "--due", "2026-12-01")
    const e = await ok("deliverable", "edit", "D-1", "--milestone", "MS-2", "--owner", "", "--title", "Spec v2", "--json")
    expect(e.json).toMatchObject({ milestone: "MS-2", owner: null, title: "Spec v2" })
    expect((await ok("deliverable", "list", "CRM", "--status", "not_started", "--json")).json).toHaveLength(1)
    expect((await ok("deliverable", "list", "--milestone", "MS-2")).out).toContain("Spec v2")
    await ok("deliverable", "delete", "D-1", "--yes")
    expect(rows("deliverable")).toEqual([])
  })

  test("describe lines", async () => {
    await ok("milestone", "add", "CRM", "Kickoff", "--due", "2026-11-26")
    await ok("deliverable", "add", "CRM", "Spec")
    await ok("risk", "add", "CRM", "Vendor delay", "--type", "risk", "--severity", "high")
    const d = (op: string, input: unknown) => inCtx(() => k.ops.describe("projects", op, input))
    expect(await d("addRisk", { project: "CRM", title: "Vendor delay", type: "risk", severity: "high" })).toBe('+ risk "Vendor delay" (high)')
    expect(await d("addMilestone", { project: "CRM", title: "Kickoff", due: "2026-11-26" })).toBe('+ milestone "Kickoff" (due 2026-11-26)')
    expect(await d("editMilestone", { ref: "MS-1", due: "2026-12-10" })).toBe("~ MS-1 due 2026-11-26 → 2026-12-10")
    expect(await d("setDeliverableStatus", { ref: "D-1", status: "delivered" })).toBe("~ D-1 not_started → delivered")
    expect(await d("closeRisk", { ref: "R-1" })).toBe("~ R-1 closed")
    expect(await d("deleteRisk", { ref: "R-1" })).toBe('- risk R-1 "Vendor delay"')
    expect(await d("addDecision", { project: "CRM", title: "Select vendor B", meeting: "M-4" })).toBe('+ decision "Select vendor B" (CRM, M-4)')
  })
})
