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
  if (r.code !== 0) throw new Error(`pm ${argv.join(" ")} → exit ${r.code}: ${r.out}${r.err}`)
  return r
}
const api = () => k.ops.api("projects")!
const inCtx = <T>(fn: () => Promise<T>) => runWithContext(k.context(), fn)
// Runs ops as if today were `today` (seeding history through the ops themselves).
const onDay = <T>(today: string, fn: () => Promise<T>) => runWithContext({ actor: "me", today, now: `${today}T09:00:00` }, fn)
const status = (input: Record<string, unknown>) => inCtx(() => api().read.projectStatus!({ project: "CRM", since: "2026-10-14", ...input }))
const refs = (list: Array<{ ref: string }>) => list.map((r) => r.ref)

// A fixed dataset: today is 2026-11-13, since 2026-10-14 (today − 30).
async function seed() {
  await ok("project", "add", "CRM", "CRM replatforming")
  await ok("project", "add", "ERP", "ERP upgrade")
  await ok("person", "add", "Bob", "--team")
  await inCtx(() => api().write.setHealth!({ project: "CRM", health: "amber", comment: "Design slipping", date: "2026-10-01" }))
  // milestones: MS-1 done on since (in), MS-2 done the day before (out), MS-3 open and late, MS-4 due on today+60 (in), MS-5 the day after (out)
  await ok("milestone", "add", "CRM", "Kickoff", "--due", "2026-10-01")
  await ok("milestone", "add", "CRM", "Design", "--due", "2026-10-10")
  await ok("milestone", "add", "CRM", "Build", "--due", "2026-11-01")
  await ok("milestone", "add", "CRM", "Pilot", "--due", "2027-01-12")
  await ok("milestone", "add", "CRM", "Go-live", "--due", "2027-01-13")
  await ok("milestone", "done", "MS-1", "--date", "2026-10-14")
  await ok("milestone", "done", "MS-2", "--date", "2026-10-13")
  await ok("milestone", "add", "ERP", "Other project", "--due", "2026-11-20") // MS-6, another project
  // deliverables: D-1 due today+30 (in), D-2 the day after (out), D-3 delivered on 2026-10-01 (out), D-4 delivered today (in, changed since)
  await ok("deliverable", "add", "CRM", "Spec", "--due", "2026-12-13")
  await ok("deliverable", "add", "CRM", "Data model", "--due", "2026-12-14")
  await ok("deliverable", "add", "CRM", "Old report", "--due", "2026-11-20")
  await onDay("2026-10-01", () => api().write.setDeliverableStatus!({ ref: "D-3", status: "delivered" }))
  await ok("deliverable", "add", "CRM", "Mockups", "--due", "2026-12-31")
  await ok("deliverable", "status", "D-4", "delivered")
  // risks: R-1 low, R-2 high, R-3 medium, R-4 high but closed, R-5 high
  for (const [title, severity] of [
    ["Scope creep", "low"],
    ["Vendor delay", "high"],
    ["Key user leaves", "medium"],
    ["Old issue", "high"],
    ["Budget overrun", "high"],
  ])
    await ok("risk", "add", "CRM", title!, "--type", title === "Old issue" ? "issue" : "risk", "--severity", severity!)
  await ok("risk", "close", "R-4")
  // decisions: DE-1 on since (in), DE-2 the day before (out), DE-3 another project (out)
  await ok("decision", "add", "Pick vendor B", "--project", "CRM", "--date", "2026-10-14")
  await ok("decision", "add", "Use agile", "--project", "CRM", "--date", "2026-10-13")
  await ok("decision", "add", "Other", "--project", "ERP", "--date", "2026-11-01")
  // actions: A-1 overdue (in), A-2 due today (out), A-3 overdue but done (out), A-4 overdue on ERP (out), A-5 from M-4 (fromMeeting)
  await ok("action", "add", "Chase vendor", "--project", "CRM", "--due", "2026-11-01", "--owner", "bob")
  await ok("action", "add", "Due today", "--project", "CRM", "--due", "today")
  await ok("action", "add", "Done already", "--project", "CRM", "--due", "2026-11-02")
  await ok("action", "done", "A-3")
  await ok("action", "add", "ERP thing", "--project", "ERP", "--due", "2026-11-01")
  await ok("action", "add", "From the steering", "--project", "CRM", "--meeting", "M-4")
}

describe("projects: projectStatus and the project-status report", () => {
  beforeEach(async () => {
    k = await makeTestKernel({ plugins: [people, projects] })
    await seed()
  })
  afterEach(async () => {
    await k.cleanup()
  })

  test("projectStatus with since 2026-10-14: the exact ids in each bucket", async () => {
    const s = await status({})
    expect(s.project).toEqual({
      ref: "#CRM",
      name: "CRM replatforming",
      health: "amber",
      healthComment: "Design slipping",
      healthDate: "2026-10-01",
      healthStale: true,
    })
    expect(refs(s.milestones.completed)).toEqual(["MS-1"])
    expect(refs(s.milestones.upcoming)).toEqual(["MS-3", "MS-4"])
    expect(s.milestones.upcoming.map((m: any) => m.late)).toEqual([true, false])
    expect(refs(s.deliverables)).toEqual(["D-1", "D-4"])
    expect(refs(s.risks)).toEqual(["R-2", "R-5", "R-3", "R-1"])
    expect(refs(s.decisions)).toEqual(["DE-1"])
    expect(refs(s.actions.overdue)).toEqual(["A-1"])
    expect(s.actions.fromMeeting).toEqual([])
    expect(refs((await status({ previousMeeting: "M-4" })).actions.fromMeeting)).toEqual(["A-5"])
  })

  test("since and reference move the windows; health is fresh once updated on or after since", async () => {
    // the D-4 status change (today) is before since 2026-11-14; D-1 is still due within 30 days
    expect(refs((await status({ since: "2026-11-14" })).deliverables)).toEqual(["D-1"])
    // reference 2026-11-14 → upcoming milestones up to 2027-01-13; deliverables up to 2026-12-14
    const later = await status({ reference: "2026-11-14" })
    expect(refs(later.milestones.upcoming)).toEqual(["MS-3", "MS-4", "MS-5"])
    expect(refs(later.deliverables)).toEqual(["D-1", "D-2", "D-4"])
    expect(refs(later.actions.overdue)).toEqual(["A-1", "A-2"])
    await inCtx(() => api().write.setHealth!({ project: "CRM", health: "green", date: "2026-10-14" }))
    expect((await status({})).project).toMatchObject({ health: "green", healthDate: "2026-10-14", healthComment: null, healthStale: false })
    const none = await inCtx(() => api().read.projectStatus!({ project: "ERP", since: "2026-10-14" }))
    expect(none.project).toMatchObject({ ref: "#ERP", health: null, healthDate: null, healthStale: true })
    const bad = await status({ since: "someday" }).catch((e) => e)
    expect([bad.code, bad.field]).toEqual(["validation", "since"])
    expect((await status({ project: "NOPE" }).catch((e) => e)).code).toBe("not_found")
  })

  test("project-status takes reference and previousMeeting", async () => {
    await inCtx(() => api().write.addAction!({ title: "From M-1", project: "CRM", meeting: "M-1" }))
    await ok("milestone", "add", "CRM", "Far away", "--due", "2027-01-20") // MS-7
    const rowsOf = (j: any, title: string) => j.sections.find((s: any) => s.title === title).rows
    const plain = (await ok("report", "status", "CRM", "--json")).json
    expect(rowsOf(plain, "Actions").map((x: any) => x.ID)).toEqual(["A-1"])
    expect(rowsOf(plain, "Milestones").map((x: any) => x.ID)).not.toContain("MS-7")
    const prep = (await ok("report", "status", "CRM", "--reference", "2026-12-04", "--previous-meeting", "M-1", "--json")).json
    expect(rowsOf(prep, "Actions").map((x: any) => [x.ID, x.Why])).toEqual([["A-1", "overdue"], ["A-2", "overdue"], ["A-6", "previous meeting"]])
    expect(rowsOf(prep, "Milestones").map((x: any) => x.ID)).toContain("MS-7")
    expect((await run("report", "status", "CRM", "--reference", "someday", "--json")).json.error.field).toBe("reference")
    expect((await run("report", "status", "CRM", "--previous-meeting", "X-1", "--json")).code).toBe(1)
  })

  test("status sections carry marks", async () => {
    const md = (await ok("report", "status", "CRM", "--format", "md")).out
    expect(md).toMatch(/^\| ✓ MS-1 /m)
    expect(md).toMatch(/^\| ○ MS-3 /m)
    expect(md).toMatch(/^\| ▲ R-2 /m)
    const json = (await ok("report", "status", "CRM", "--json")).json
    const marks = (title: string) => json.sections.find((s: any) => s.title === title).marks
    expect(marks("Health")).toEqual([{ icon: "●", tone: "amber" }])
    expect(marks("Milestones")).toEqual([{ icon: "✓" }, { icon: "○", tone: "red" }, { icon: "○" }])
    expect(marks("Deliverables")).toEqual([{ icon: "○" }, { icon: "✓" }])
    expect(marks("Risks & issues")).toEqual([{ icon: "▲", tone: "red" }, { icon: "▲", tone: "red" }, { icon: "▲" }, { icon: "▲" }])
    expect(marks("Actions")).toEqual([{ icon: "!", tone: "red" }])
  })

  test("report status CRM --format md: sections in order, the stale-health note", async () => {
    const r = await ok("report", "status", "CRM", "--format", "md")
    expect(r.out).toContain("## Risks & issues")
    expect(r.out).toContain("⚠ health not updated since 2026-10-14")
    const titles = [...r.out.matchAll(/^## (.+)$/gm)].map((m) => m[1])
    expect(titles).toEqual(["Health", "Milestones", "Deliverables", "Risks & issues", "Decisions", "Actions"])
    const json = (await ok("report", "status", "CRM", "--json")).json
    const risks = json.sections.find((s: any) => s.title === "Risks & issues")
    expect(risks.rows.map((x: any) => x.ID)).toEqual(["R-2", "R-5", "R-3", "R-1"])
    const health = json.sections[0]
    expect(health.note).toBe("⚠ health not updated since 2026-10-14")
    expect(health.rows).toEqual([{ Project: "#CRM", Name: "CRM replatforming", Health: "amber", Date: "2026-10-01", Comment: "Design slipping" }])
    // --since narrows; it is parsed like any date; a bad one or an unknown project fails the command
    const since = (await ok("report", "status", "CRM", "--since", "2026-10-01", "--json")).json
    expect(since.sections[0].note).toBeUndefined()
    const bad = await run("report", "status", "CRM", "--since", "someday", "--json")
    expect(bad.code).toBe(1)
    expect(bad.json.error.field).toBe("since")
    expect((await run("report", "status", "NOPE", "--json")).code).toBe(2)
  })
})

describe("projects: the overview report", () => {
  beforeEach(async () => {
    k = await makeTestKernel({ plugins: [people, projects] })
  })
  afterEach(async () => {
    await k.cleanup()
  })

  test("report overview --json with people and projects loaded: section titles in order", async () => {
    const r = await ok("report", "overview", "--json")
    expect(r.json.title).toBe("Overview")
    expect(r.json.sections.map((s: any) => s.title)).toEqual([
      "Overdue actions",
      "Due this week",
      "Projects needing attention",
      "Late milestones and next 14 days",
      "High risks & issues",
      "Stakeholders to contact",
    ])
  })

  test("overview rows: overdue, this week (to Sunday), attention, milestones, high risks; owners by name, me when empty", async () => {
    await seed()
    await ok("project", "add", "OPS", "Ops tooling")
    await ok("project", "edit", "OPS", "--health", "green") // fresh and green: not listed
    await ok("action", "add", "Book room", "--due", "sun") // A-6: 2026-11-15
    await ok("action", "add", "Next monday", "--due", "mon") // A-7: 2026-11-16, not this week
    const r = (await ok("report", "overview", "--json")).json
    const section = (title: string) => r.sections.find((s: any) => s.title === title)
    expect(section("Overdue actions").columns).toEqual(["ID", "Action", "Project", "Owner", "Due"])
    expect(section("Overdue actions").rows).toEqual([
      { ID: "A-1", Action: "Chase vendor", Project: "CRM", Owner: "Bob", Due: "2026-11-01" },
      { ID: "A-4", Action: "ERP thing", Project: "ERP", Owner: "me", Due: "2026-11-01" },
    ])
    expect(section("Due this week").rows.map((x: any) => x.ID)).toEqual(["A-2", "A-6"])
    expect(section("Projects needing attention").rows.map((x: any) => [x.Project, x.Health])).toEqual([
      ["CRM", "amber"],
      ["ERP", "not set"],
    ])
    expect(section("Late milestones and next 14 days").rows.map((x: any) => [x.ID, x.Late])).toEqual([
      ["MS-3", "late"],
      ["MS-6", ""],
    ])
    expect(section("High risks & issues").rows.map((x: any) => x.ID)).toEqual(["R-2", "R-5"])
    await ok("project", "archive", "ERP")
    const after = (await ok("report", "overview", "--json")).json
    expect(after.sections.find((s: any) => s.title === "Overdue actions").rows.map((x: any) => x.ID)).toEqual(["A-1"])
    expect(after.sections.find((s: any) => s.title === "Projects needing attention").rows.map((x: any) => x.Project)).toEqual(["CRM"])
    expect((await ok("report", "overview", "--format", "text")).out).toContain("Overdue actions\nID")
  })
})
