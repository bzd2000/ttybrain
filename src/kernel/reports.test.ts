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

describe("GuideRegistry", () => {
  test("header, kernel conventions, then sections in plugin load order and then order", () => {
    const guide = new GuideRegistry()
    guide.section("people", { title: "People", markdown: "Use `pm person list`.\n", order: 20 })
    guide.section("projects", { title: "Projects", markdown: "Use `pm project list`.", order: 1 })
    guide.section("people", { title: "Notes", markdown: "Concern → stakeholder note.", order: 10 })
    const out = guide.render("0.1.0")
    expect(out.startsWith("# pm: guide for agents\n\nThis is pm 0.1.0, a personal tool")).toBe(true)
    for (const s of ["`--json`", "Exit codes", "`YYYY-MM-DD`", "`#CRM`", "`@anna`", "`A-12`", "`--from-inbox I-<n>`", "ask the user"])
      expect(out).toContain(s)
    const headings = out.split("\n").filter((l) => l.startsWith("## "))
    expect(headings).toEqual(["## Conventions", "## Notes", "## People", "## Projects"])
    expect(out).toContain("## Notes\n\nConcern → stakeholder note.\n\n## People\n\nUse `pm person list`.\n\n## Projects\n\nUse `pm project list`.\n")
    expect(out.endsWith("Use `pm project list`.\n")).toBe(true)
  })

  test("remove(plugin) drops its sections", () => {
    const guide = new GuideRegistry()
    guide.section("people", { title: "People", markdown: "x" })
    guide.remove("people")
    expect(guide.render("0.1.0")).not.toContain("## People")
  })
})
