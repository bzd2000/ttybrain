import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
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
  if (r.code !== 0) throw new Error(`pm ${argv.join(" ")} → exit ${r.code}: ${r.out}${r.err}`)
  return r
}
const inCtx = <T>(fn: () => Promise<T>) => runWithContext(k!.context(), fn)
const api = (plugin: string) => k!.runtime(plugin)!.self() as { read: Record<string, (i: any) => Promise<any>>; write: Record<string, (i: any) => Promise<any>> }
const w = (plugin: string, op: string, input: unknown) => inCtx(() => api(plugin).write[op]!(input))
const read = (op: string, input: unknown) => inCtx(() => api("meetings").read[op]!(input))

const ASK = "Approve 2-week shift of design milestone"

// The mockup meeting (M-2, Steering committee Q4 on 2026-12-04) and the held SteerCo Q3 (M-1) before it.
// Today is 2026-11-13; CRM's since is M-1's date, 2026-10-28.
async function seed() {
  k = await makeTestKernel({ plugins: [meetings, projects, people] })
  await w("people", "addPerson", { name: "Peter Janssens", handle: "peter" })
  await w("people", "addPerson", { name: "Marie Dubois", handle: "marie" })
  await w("projects", "addProject", { code: "CRM", name: "CRM replatforming" })
  await w("meetings", "addMeeting", { title: "SteerCo Q3", date: "2026-10-28", kind: "steering", projects: ["CRM"] }) // M-1
  await w("projects", "setHealth", { project: "CRM", health: "amber", comment: "Design slipping 2 weeks", date: "2026-11-02" })
  await w("projects", "addMilestone", { project: "CRM", title: "Design approved", due: "2026-12-10" }) // MS-1
  await w("projects", "addRisk", { project: "CRM", title: "Budget overrun ~12%", type: "issue", severity: "high" }) // R-1
  await w("projects", "addAction", { title: "Send revised budget to Peter", project: "CRM", due: "2026-11-10" }) // A-1, overdue
  await w("projects", "addAction", { title: "Share integration specs", project: "CRM", meeting: "M-1" }) // A-2, from M-1
  await w("meetings", "closeMeeting", { ref: "M-1" })
  await w("meetings", "addMeeting", { title: "Steering committee Q4", date: "2026-12-04", kind: "steering", attendees: ["peter", "marie"] }) // M-2
  await w("meetings", "addAgendaItem", { meeting: "M-2", text: "Minutes & open actions" })
  await w("meetings", "addAgendaItem", { meeting: "M-2", text: "CRM status", project: "CRM", ask: ASK })
  await w("meetings", "addAgendaItem", { meeting: "M-2", text: "AOB" })
}

const ATTENDEES_AND_AGENDA = [
  "## Attendees",
  "",
  "| Name | Handle |",
  "| --- | --- |",
  "| Marie Dubois | @marie |",
  "| Peter Janssens | @peter |",
  "",
  "## Agenda",
  "",
  "| # | Item | Project | Ask |",
  "| --- | --- | --- | --- |",
  "| 1 | Minutes & open actions |  |  |",
  `| 2 | CRM status | CRM | ${ASK} |`,
  "| 3 | AOB |  |  |",
]

describe("meetings reports", () => {
  test("board pack for the mockup meeting", async () => {
    await seed()
    const r = await ok("report", "board", "M-2")
    expect(r.out).toBe(
      [
        "# Steering committee Q4 · 2026-12-04",
        "",
        ...ATTENDEES_AND_AGENDA,
        "",
        "## CRM CRM replatforming · since 2026-10-28",
        "",
        "### Health",
        "",
        "| Project | Name | Health | Date | Comment |",
        "| --- | --- | --- | --- | --- |",
        "| ● #CRM | CRM replatforming | amber | 2026-11-02 | Design slipping 2 weeks |",
        "",
        "### Milestones",
        "",
        "| ID | Milestone | Due | Done | Late |",
        "| --- | --- | --- | --- | --- |",
        "| ○ MS-1 | Design approved | 2026-12-10 |  |  |",
        "",
        "### Deliverables",
        "",
        "_No deliverables changed since 2026-10-28 or due in the next 30 days._",
        "",
        "### Risks & issues",
        "",
        "| ID | Type | Severity | Title | Owner | Mitigation |",
        "| --- | --- | --- | --- | --- | --- |",
        "| ▲ R-1 | issue | high | Budget overrun ~12% |  |  |",
        "",
        "### Decisions",
        "",
        "_No decisions since 2026-10-28._",
        "",
        "### Actions",
        "",
        "| ID | Action | Owner | Due | Why |",
        "| --- | --- | --- | --- | --- |",
        "| ! A-1 | Send revised budget to Peter | me | 2026-11-10 | overdue |",
        "| ! A-2 | Share integration specs | me |  | previous meeting |",
        "",
        "### Ask",
        "",
        "| # | Ask |",
        "| --- | --- |",
        `| 2 | ${ASK} |`,
        "",
      ].join("\n"),
    )
  })

  test("board pack of a meeting without projects", async () => {
    await seed()
    await w("meetings", "addMeeting", { title: "Team sync", date: "2026-11-20", attendees: ["peter"] }) // M-3
    await w("meetings", "addAgendaItem", { meeting: "M-3", text: "AOB", ask: "Anything else?" })
    expect((await ok("report", "board", "M-3")).out).toBe(
      [
        "# Team sync · 2026-11-20",
        "",
        "## Attendees",
        "",
        "| Name | Handle |",
        "| --- | --- |",
        "| Peter Janssens | @peter |",
        "",
        "## Agenda",
        "",
        "| # | Item | Project | Ask |",
        "| --- | --- | --- | --- |",
        "| 1 | AOB |  | Anything else? |",
        "",
      ].join("\n"),
    )
    await w("meetings", "addMeeting", { title: "Empty", date: "2026-11-21" }) // M-4
    expect((await ok("report", "board", "M-4")).out).toBe(
      ["# Empty · 2026-11-21", "", "## Attendees", "", "_No attendees._", "", "## Agenda", "", "_No agenda yet._", ""].join("\n"),
    )
  })

  test("minutes list notes, decisions and actions linked to the meeting", async () => {
    await seed()
    await w("meetings", "setAttendees", { meeting: "M-1", people: ["peter"] })
    await w("meetings", "setNotes", { meeting: "M-1", markdown: "Design re-planned.\n\n- budget to follow" })
    await w("projects", "addDecision", { title: "Phase 1 excludes marketing automation", project: "CRM", date: "2026-10-28", meeting: "M-1" }) // DE-1
    await w("projects", "addDecision", { title: "Not from this meeting", project: "CRM", date: "2026-10-28" }) // DE-2
    await w("projects", "addAction", { title: "Book the venue", owner: "peter", due: "2026-11-20", meeting: "M-1" }) // A-3, no project
    expect((await ok("report", "minutes", "M-1")).out).toBe(
      [
        "# Minutes · SteerCo Q3 · 2026-10-28",
        "",
        "## Attendees",
        "",
        "| Name | Handle |",
        "| --- | --- |",
        "| Peter Janssens | @peter |",
        "",
        "## Notes",
        "",
        "Design re-planned.\n\n- budget to follow",
        "",
        "## Decisions",
        "",
        "| ID | Decision | Project | Date |",
        "| --- | --- | --- | --- |",
        "| DE-1 | Phase 1 excludes marketing automation | CRM | 2026-10-28 |",
        "",
        "## Actions",
        "",
        "| ID | Action | Owner | Due | Project |",
        "| --- | --- | --- | --- | --- |",
        "| A-2 | Share integration specs | me |  | CRM |",
        "| A-3 | Book the venue | @peter | 2026-11-20 |  |",
        "",
      ].join("\n"),
    )
    expect((await ok("report", "minutes", "M-2")).out).toBe(
      [
        "# Minutes · Steering committee Q4 · 2026-12-04",
        "",
        "## Attendees",
        "",
        "| Name | Handle |",
        "| --- | --- |",
        "| Marie Dubois | @marie |",
        "| Peter Janssens | @peter |",
        "",
        "## Notes",
        "",
        "_No notes._",
        "",
        "## Decisions",
        "",
        "_No decisions._",
        "",
        "## Actions",
        "",
        "_No actions._",
        "",
      ].join("\n"),
    )
  })

  test("prep gives one entry per agenda item; items of one project share the sections", async () => {
    await seed()
    await w("meetings", "addAgendaItem", { meeting: "M-2", text: "CRM budget", project: "CRM", ask: "Release contingency" })
    const prep = await read("prep", { meeting: "M-2" })
    expect(prep.map((p: any) => [p.position, p.text, p.project, p.ask])).toEqual([
      [1, "Minutes & open actions", null, null],
      [2, "CRM status", "#CRM", ASK],
      [3, "AOB", null, null],
      [4, "CRM budget", "#CRM", "Release contingency"],
    ])
    expect(prep[0].since).toBeNull()
    expect(prep[0].sections).toEqual([])
    expect(prep[1].since).toEqual({ since: "2026-10-28", source: "previous", previous: { ref: "M-1", title: "SteerCo Q3", date: "2026-10-28" } })
    expect(prep[1].sections.map((s: any) => s.title)).toEqual(["Health", "Milestones", "Deliverables", "Risks & issues", "Decisions", "Actions"])
    expect(prep[1].sections.every((s: any) => s.group === undefined)).toBe(true)
    expect(prep[1].sections.find((s: any) => s.title === "Actions").rows.map((x: any) => [x.ID, x.Why])).toEqual([
      ["A-1", "overdue"],
      ["A-2", "previous meeting"],
    ])
    expect(prep[3].sections).toBe(prep[1].sections)
    expect(prep[3].since).toEqual(prep[1].since)
    // the board pack lists the project once, with both asks
    const md = (await ok("report", "board", "M-2")).out
    expect(md.match(/^## CRM /gm)).toHaveLength(1)
    expect(md).toContain(`| # | Ask |\n| --- | --- |\n| 2 | ${ASK} |\n| 4 | Release contingency |\n`)
  })

  test("report board --format json keeps groups and marks", async () => {
    await seed()
    const r = JSON.parse((await ok("report", "board", "M-2", "--format", "json")).out)
    expect(r.title).toBe("Steering committee Q4 · 2026-12-04")
    const group = "CRM CRM replatforming · since 2026-10-28"
    expect(r.sections.map((s: any) => [s.title, s.group ?? null])).toEqual([
      ["Attendees", null],
      ["Agenda", null],
      ["Health", group],
      ["Milestones", group],
      ["Deliverables", group],
      ["Risks & issues", group],
      ["Decisions", group],
      ["Actions", group],
      ["Ask", group],
    ])
    const marks = (title: string) => r.sections.find((s: any) => s.title === title).marks
    expect(marks("Health")).toEqual([{ icon: "●", tone: "amber" }])
    expect(marks("Risks & issues")).toEqual([{ icon: "▲", tone: "red" }])
    expect(marks("Actions")).toEqual([{ icon: "!", tone: "red" }, { icon: "!" }])
    // the report read renders the same through ctx.reports.render
    const viaOp = await read("report", { meeting: "M-2", kind: "board", format: "json" })
    expect(viaOp.title).toBe("Steering committee Q4 · 2026-12-04")
    expect(JSON.parse(viaOp.text)).toEqual(r)
    const minutes = await read("report", { meeting: "2", kind: "minutes", format: "text" })
    expect(minutes.title).toBe("Minutes · Steering committee Q4 · 2026-12-04")
    expect(minutes.text.startsWith("Minutes · Steering committee Q4 · 2026-12-04\n\nAttendees\nName            Handle\n")).toBe(true)
  })

  test("unknown meeting exits 2", async () => {
    await seed()
    for (const kind of ["board", "minutes"]) {
      const r = await cli("report", kind, "M-9", "--json")
      expect(r.code).toBe(2)
      expect(r.json.error.message).toBe('unknown meeting "M-9"')
    }
    const e = await read("report", { meeting: "M-9", kind: "board", format: "md" }).catch((x) => x)
    expect(e.code).toBe("not_found")
    expect((await read("prep", { meeting: "M-9" }).catch((x) => x)).code).toBe("not_found")
  })
})
