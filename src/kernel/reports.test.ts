import { describe, expect, test } from "bun:test"
import Type from "typebox"
import { NotFoundError, ValidationError } from "./errors"
import { GuideRegistry } from "./guide"
import { renderReport, ReportRegistry, type ReportSectionResult } from "./reports"

const def = { id: "status", cliName: "status", title: "Status report", params: Type.Object({ project: Type.String() }), describe: "the prep block" }

const actions: ReportSectionResult = {
  title: "Open actions",
  columns: ["ref", "title", "due"],
  rows: [
    { ref: "A-1", title: "Send | contract", due: "2026-11-20" },
    { ref: "A-12", title: "Call Anna", due: null },
  ],
  empty: "no open actions",
}
const risks: ReportSectionResult = { title: "Risks", columns: ["ref", "title"], rows: [], empty: "no open risks", note: "since 2026-10-14" }

describe("ReportRegistry.run", () => {
  test("sections run in order; null sections are skipped", async () => {
    const reports = new ReportRegistry()
    reports.report(def)
    const seen: unknown[] = []
    reports.section("status", "projects", { id: "risks", order: 20, run: async () => risks })
    reports.section("status", "people", { id: "actions", order: 10, run: async (p) => (seen.push(p), actions) })
    reports.section("status", "people", { id: "na", order: 15, run: async () => null })
    const r = await reports.run("status", { project: "CRM" })
    expect(r).toEqual({ title: "Status report", sections: [actions, risks] })
    expect(seen).toEqual([{ project: "CRM" }])
  })

  test("a throwing section shows its error note and the other sections still render", async () => {
    const reports = new ReportRegistry()
    reports.report(def)
    reports.section("status", "projects", { id: "actions", order: 10, run: async () => actions })
    reports.section("status", "projects", { id: "health", order: 20, run: async () => Promise.reject(new Error("no such column: x")) })
    reports.section("status", "projects", { id: "risks", order: 30, run: async () => risks })
    const r = await reports.run("status", { project: "CRM" })
    expect(r.sections).toEqual([actions, { title: "health", columns: [], rows: [], empty: "", note: "error: no such column: x" }, risks])
    expect(renderReport(r, "md")).toBe(
      [
        "# Status report",
        "",
        "## Open actions",
        "",
        "| ref | title | due |",
        "| --- | --- | --- |",
        "| A-1 | Send \\| contract | 2026-11-20 |",
        "| A-12 | Call Anna |  |",
        "",
        "## health",
        "",
        "_error: no such column: x_",
        "",
        "## Risks",
        "",
        "_no open risks_",
        "",
        "_since 2026-10-14_",
        "",
      ].join("\n"),
    )
  })

  test("a malformed section result becomes an error note and the report goes on (R17)", async () => {
    const reports = new ReportRegistry()
    reports.report(def)
    const malformed = [{ title: 1, columns: [], rows: [] }, { title: "x", columns: "a", rows: [] }, { title: "x", columns: [], rows: {} }, "nope", { title: "x", columns: ["a"], rows: [null] }]
    malformed.forEach((m, i) => reports.section("status", "projects", { id: `bad${i}`, order: i, run: async () => m as any }))
    reports.section("status", "projects", { id: "risks", order: 10, run: async () => risks })
    const r = await reports.run("status", { project: "CRM" })
    const note = (id: string) => ({ title: id, columns: [], rows: [], empty: "", note: "error: malformed section result" })
    expect(r.sections).toEqual([note("bad0"), note("bad1"), note("bad2"), note("bad3"), note("bad4"), risks])
    expect(renderReport(r, "md")).toContain("## bad1\n\n_error: malformed section result_")
  })

  test("sections registered before their report count (R3); sections of a report that never registers are ignored", async () => {
    const reports = new ReportRegistry()
    reports.section("status", "people", { id: "actions", order: 10, run: async () => actions })
    reports.section("ghost", "people", { id: "x", order: 1, run: async () => actions })
    reports.report(def)
    expect((await reports.run("status", { project: "CRM" })).sections).toEqual([actions])
    const err = await reports.run("ghost", {}).catch((e) => e)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.message).toBe('no report "ghost"')
  })

  test("params are validated against the report's schema", async () => {
    const reports = new ReportRegistry()
    reports.report(def)
    const err = await reports.run("status", {}).catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.field).toBe("project")
  })

  test("param names that collide with the CLI's global flags or --format are rejected at registration", () => {
    const reports = new ReportRegistry()
    for (const name of ["json", "db", "from-inbox", "yes", "help", "format"]) {
      const err = (() => {
        try {
          reports.report({ ...def, id: `r-${name}`, cliName: `r-${name}`, params: Type.Object({ [name]: Type.Optional(Type.String()) }) })
        } catch (e) {
          return e
        }
      })() as ValidationError
      expect(err).toBeInstanceOf(ValidationError)
      expect(err.message).toBe(`report "r-${name}": param "${name}" collides with the CLI flag --${name}`)
    }
    expect(reports.list()).toEqual([])
    reports.report({ ...def, params: Type.Object({ project: Type.String(), since: Type.Optional(Type.String()) }) })
    expect(reports.list().map((d) => d.id)).toEqual(["status"])
  })

  test("prepare runs once before the sections; its result is what they get, and its errors propagate", async () => {
    const reports = new ReportRegistry()
    const seen: unknown[] = []
    let calls = 0
    reports.report({
      ...def,
      prepare: async (p: { project: string }) => {
        calls++
        if (p.project === "bad") throw new ValidationError("bad project", { field: "project" })
        return { project: p.project.toUpperCase(), since: "2026-10-14" }
      },
    })
    reports.section("status", "projects", { id: "a", order: 1, run: async (p) => (seen.push(p), actions) })
    reports.section("status", "projects", { id: "b", order: 2, run: async (p) => (seen.push(p), risks) })
    expect((await reports.run("status", { project: "crm" })).sections).toEqual([actions, risks])
    expect(calls).toBe(1)
    expect(seen).toEqual([
      { project: "CRM", since: "2026-10-14" },
      { project: "CRM", since: "2026-10-14" },
    ])
    const err = await reports.run("status", { project: "bad" }).catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toBe("bad project")
  })

  test("duplicates throw; remove(plugin) drops its reports and sections", async () => {
    const reports = new ReportRegistry()
    reports.report(def, "projects")
    expect(() => reports.report({ ...def, cliName: "other" })).toThrow(ValidationError)
    expect(() => reports.report({ ...def, id: "other" })).toThrow(ValidationError)
    reports.section("status", "people", { id: "a", order: 1, run: async () => actions })
    expect(() => reports.section("status", "people", { id: "a", order: 2, run: async () => actions })).toThrow(ValidationError)
    reports.section("status", "inbox", { id: "a", order: 2, run: async () => risks })
    reports.remove("people")
    expect((await reports.run("status", { project: "CRM" })).sections).toEqual([risks])
    expect(reports.list().map((d) => d.cliName)).toEqual(["status"])
    reports.remove("projects")
    expect(reports.list()).toEqual([])
  })
})

describe("renderReport", () => {
  const r = { title: "Status report", sections: [actions, risks] }

  test("md: one table section and one empty section", () => {
    expect(renderReport(r, "md")).toBe(`# Status report

## Open actions

| ref | title | due |
| --- | --- | --- |
| A-1 | Send \\| contract | 2026-11-20 |
| A-12 | Call Anna |  |

## Risks

_no open risks_

_since 2026-10-14_
`)
  })

  test("text: the same structure, columns padded", () => {
    expect(renderReport(r, "text")).toBe(`Status report

Open actions
ref   title            due
A-1   Send | contract  2026-11-20
A-12  Call Anna

Risks
no open risks
since 2026-10-14
`)
  })

  test("json", () => {
    expect(renderReport(r, "json")).toBe(JSON.stringify(r, null, 2))
  })
})

describe("embeddable reports", () => {
  const section = (title: string, extra: Partial<ReportSectionResult> = {}): ReportSectionResult => ({
    title,
    columns: ["ref", "title"],
    rows: [{ ref: "MS-1", title: "Outline approved" }],
    empty: "none",
    ...extra,
  })

  test("a section may return several sections, in place", async () => {
    const reports = new ReportRegistry()
    reports.report(def)
    reports.section("status", "projects", { id: "first", order: 10, run: async () => actions })
    reports.section("status", "meetings", { id: "many", order: 20, run: async () => [section("A"), { title: 1 } as any, section("B")] })
    reports.section("status", "meetings", { id: "none", order: 25, run: async () => [] })
    reports.section("status", "projects", { id: "last", order: 30, run: async () => risks })
    const r = await reports.run("status", { project: "CRM" })
    expect(r.sections).toEqual([actions, section("A"), { title: "many", columns: [], rows: [], empty: "", note: "error: malformed section result" }, section("B"), risks])
  })

  test("md groups sections under ## group with ### titles", () => {
    const r = {
      title: "Board pack",
      sections: [
        section("Attendees", { columns: ["who"], rows: [{ who: "@peter" }] }),
        section("Milestones", { group: "CRM CRM rollout · since 2026-10-14" }),
        section("Risks", { group: "CRM CRM rollout · since 2026-10-14", rows: [], empty: "no open risks" }),
        section("Milestones", { group: "ERP ERP upgrade · since 2026-10-28", rows: [{ ref: "MS-4", title: "Go-live" }] }),
        section("Ask", { group: "ERP ERP upgrade · since 2026-10-28", columns: ["#", "Ask"], rows: [{ "#": 2, Ask: "Release contingency" }] }),
      ],
    }
    expect(renderReport(r, "md")).toBe(`# Board pack

## Attendees

| who |
| --- |
| @peter |

## CRM CRM rollout · since 2026-10-14

### Milestones

| ref | title |
| --- | --- |
| MS-1 | Outline approved |

### Risks

_no open risks_

## ERP ERP upgrade · since 2026-10-28

### Milestones

| ref | title |
| --- | --- |
| MS-4 | Go-live |

### Ask

| # | Ask |
| --- | --- |
| 2 | Release contingency |
`)
    expect(renderReport(r, "text")).toBe(`Board pack

Attendees
who
@peter

CRM CRM rollout · since 2026-10-14

Milestones
ref   title
MS-1  Outline approved

Risks
no open risks

ERP ERP upgrade · since 2026-10-28

Milestones
ref   title
MS-4  Go-live

Ask
#  Ask
2  Release contingency
`)
  })

  test("a group heading repeats after an ungrouped section breaks the run", () => {
    const r = { title: "T", sections: [section("A", { group: "G" }), section("B", { rows: [] }), section("C", { group: "G", rows: [] })] }
    expect(renderReport(r, "md")).toBe("# T\n\n## G\n\n### A\n\n| ref | title |\n| --- | --- |\n| MS-1 | Outline approved |\n\n## B\n\n_none_\n\n## G\n\n### C\n\n_none_\n")
  })

  test("marks prefix the first cell in md and text, and json keeps them", async () => {
    const milestones: ReportSectionResult = {
      title: "Milestones",
      columns: ["ref", "title"],
      rows: [
        { ref: "MS-1", title: "Outline approved" },
        { ref: "MS-12", title: "Go-live" },
        { ref: "MS-3", title: "Training" },
      ],
      empty: "no milestones",
      marks: [{ icon: "✓", tone: "green" }, { icon: "○" }, null],
    }
    const reports = new ReportRegistry()
    reports.report(def)
    reports.section("status", "projects", { id: "ms", order: 1, run: async () => milestones })
    const r = await reports.run("status", { project: "CRM" })
    expect(r.sections).toEqual([milestones])
    expect(renderReport(r, "md")).toBe(`# Status report

## Milestones

| ref | title |
| --- | --- |
| ✓ MS-1 | Outline approved |
| ○ MS-12 | Go-live |
| MS-3 | Training |
`)
    expect(renderReport(r, "text")).toBe(`Status report

Milestones
ref      title
✓ MS-1   Outline approved
○ MS-12  Go-live
MS-3     Training
`)
    const grouped = { title: "T", sections: [{ ...milestones, group: "CRM", text: "Ask: more budget." }] }
    expect(JSON.parse(renderReport(grouped, "json"))).toEqual(grouped)
    expect(renderReport(grouped, "json")).toBe(JSON.stringify(grouped, null, 2))
  })

  test("marks of the wrong length make the section an error note", async () => {
    const reports = new ReportRegistry()
    reports.report(def)
    reports.section("status", "projects", { id: "short", order: 1, run: async () => section("A", { marks: [] }) })
    reports.section("status", "projects", { id: "long", order: 2, run: async () => section("B", { marks: [null, { icon: "✓" }] }) })
    reports.section("status", "projects", { id: "notarray", order: 3, run: async () => section("C", { marks: "✓" as any }) })
    reports.section("status", "projects", { id: "ok", order: 4, run: async () => section("D", { marks: [{ icon: "✓" }] }) })
    const r = await reports.run("status", { project: "CRM" })
    const note = (id: string) => ({ title: id, columns: [], rows: [], empty: "", note: "error: malformed section result" })
    expect(r.sections).toEqual([note("short"), note("long"), note("notarray"), section("D", { marks: [{ icon: "✓" }] })])
  })

  test("a text paragraph renders after the table", () => {
    const r = {
      title: "Minutes",
      sections: [
        section("Decisions", { text: "Budget **approved** for Q1.", note: "since 2026-10-14" }),
        section("Notes", { columns: [], rows: [], empty: "", text: "Peter will follow up.\n\nNext meeting in March." }),
        section("Risks", { rows: [], empty: "no open risks", text: "Watch the vendor." }),
      ],
    }
    expect(renderReport(r, "md")).toBe(`# Minutes

## Decisions

| ref | title |
| --- | --- |
| MS-1 | Outline approved |

Budget **approved** for Q1.

_since 2026-10-14_

## Notes

Peter will follow up.

Next meeting in March.

## Risks

_no open risks_

Watch the vendor.
`)
    expect(renderReport(r, "text")).toBe(`Minutes

Decisions
ref   title
MS-1  Outline approved
Budget **approved** for Q1.
since 2026-10-14

Notes
Peter will follow up.

Next meeting in March.

Risks
no open risks
Watch the vendor.
`)
  })

  test("title may be a function of the prepared params", async () => {
    const reports = new ReportRegistry()
    const seen: unknown[] = []
    reports.report({
      ...def,
      prepare: (p: { project: string }) => ({ code: p.project.toUpperCase() }),
      title: async (input: { code: string }) => (seen.push(input), `Status ${input.code}`),
    })
    reports.section("status", "projects", { id: "a", order: 1, run: async () => risks })
    expect(await reports.run("status", { project: "crm" })).toEqual({ title: "Status CRM", sections: [risks] })
    expect(seen).toEqual([{ code: "CRM" }])
    reports.report({ ...def, id: "plain", cliName: "plain", title: (input: { project: string }) => `Plain ${input.project}` })
    expect((await reports.run("plain", { project: "ERP" })).title).toBe("Plain ERP")
  })
})

describe("GuideRegistry", () => {
  test("header, kernel conventions, then sections in plugin load order and then order", () => {
    const guide = new GuideRegistry()
    guide.section("people", { title: "People", markdown: "Use `ttybrain person list`.\n", order: 20 })
    guide.section("projects", { title: "Projects", markdown: "Use `ttybrain project list`.", order: 1 })
    guide.section("people", { title: "Notes", markdown: "Concern → stakeholder note.", order: 10 })
    const out = guide.render("0.1.0")
    expect(out.startsWith("# ttybrain: guide for agents\n\nThis is ttybrain 0.1.0, a personal tool")).toBe(true)
    for (const s of ["`--json`", "Exit codes", "`YYYY-MM-DD`", "`#CRM`", "`@anna`", "`A-12`", "`--from-inbox I-<n>`", "ask the user"])
      expect(out).toContain(s)
    const headings = out.split("\n").filter((l) => l.startsWith("## "))
    expect(headings).toEqual(["## Conventions", "## Notes", "## People", "## Projects"])
    expect(out).toContain("## Notes\n\nConcern → stakeholder note.\n\n## People\n\nUse `ttybrain person list`.\n\n## Projects\n\nUse `ttybrain project list`.\n")
    expect(out.endsWith("Use `ttybrain project list`.\n")).toBe(true)
  })

  test("remove(plugin) drops its sections", () => {
    const guide = new GuideRegistry()
    guide.section("people", { title: "People", markdown: "x" })
    guide.remove("people")
    expect(guide.render("0.1.0")).not.toContain("## People")
  })
})
