// Reports: a named report (registered by one plugin) is a list of sections (registered by any plugin) that
// return structured data. The kernel runs them in order and renders the result as Markdown, text or JSON.
import type { TSchema } from "typebox"
import Value from "typebox/value"
import { NotFoundError, suggest, ValidationError } from "./errors"

export type Cell = string | number | null
// A row's hint: an icon written before its first cell, and a tone (the TUI colours it; Markdown and text don't).
export type Mark = { icon?: string; tone?: "red" | "amber" | "green" | "muted" }
// `group` puts consecutive sections under one heading, `marks` (parallel to `rows`, `null` for none) gives rows
// their hints, and `text` is a Markdown paragraph after the table.
export type ReportSectionResult = {
  title: string
  columns: string[]
  rows: Array<Record<string, Cell>>
  empty: string
  note?: string
  group?: string
  marks?: Array<Mark | null>
  text?: string
}
// `prepare` (optional) turns the validated params into what the sections get (parsed dates, defaults, resolved
// refs). It runs once per report run, before any section; an error it throws fails the run (exit 1/2), unlike a
// section's, which becomes a note. A function `title` is called once with `prepare`'s output.
export type ReportDef = {
  id: string
  cliName: string
  title: string | ((input: any) => string | Promise<string>)
  params: TSchema
  describe: string
  prepare?: (params: any) => unknown | Promise<unknown>
}
// A section may return several sections (an array); they take its place in the report.
export type ReportSectionDef = { id: string; order: number; run(params: any): Promise<ReportSectionResult | ReportSectionResult[] | null> }
export type ReportResult = { title: string; sections: ReportSectionResult[] }

type Section = { reportId: string; plugin: string; def: ReportSectionDef }

// `ttybrain report <cliName>` turns params into flags, so they must not shadow the global flags or the report's --format.
const RESERVED_PARAMS = new Set(["json", "db", "from-inbox", "yes", "help", "format"])

export class ReportRegistry {
  private readonly reports = new Map<string, { def: ReportDef; plugin?: string }>()
  private sections: Section[] = [] // in registration order, which breaks ties in `order`

  // `plugin` lets the host remove a failed plugin's reports.
  report(def: ReportDef, plugin?: string): void {
    const props = Object.keys((def.params as { properties?: Record<string, unknown> }).properties ?? {})
    const reserved = props.find((p) => RESERVED_PARAMS.has(p))
    if (reserved) throw new ValidationError(`report "${def.id}": param "${reserved}" collides with the CLI flag --${reserved}`)
    if (this.reports.has(def.id)) throw new ValidationError(`report "${def.id}" is already registered`)
    const clash = [...this.reports.values()].find((r) => r.def.cliName === def.cliName)
    if (clash) throw new ValidationError(`report name "${def.cliName}" is already used by report "${clash.def.id}"`)
    this.reports.set(def.id, { def, plugin })
  }

  // Accepted before the report itself is registered (plugin load order); ignored if it never is (R3).
  section(reportId: string, plugin: string, def: ReportSectionDef): void {
    if (this.sections.some((s) => s.reportId === reportId && s.plugin === plugin && s.def.id === def.id))
      throw new ValidationError(`report section "${plugin}.${def.id}" is already registered for report "${reportId}"`)
    this.sections.push({ reportId, plugin, def })
  }

  list(): ReportDef[] {
    return [...this.reports.values()].map((r) => r.def)
  }

  // Sections run one after another in `order`. `null` (not applicable) is skipped; a throwing section, or one
  // whose result is not section-shaped (R17), becomes an error note and the report goes on. An array result is
  // spliced in place, each element checked on its own.
  async run(reportId: string, params: unknown): Promise<ReportResult> {
    const report = this.reports.get(reportId)?.def
    if (!report) throw new NotFoundError(`no report "${reportId}"`, { suggestions: suggest(reportId, [...this.reports.keys()]) })
    const [err] = Value.Errors(report.params, params)
    if (err) {
      const missing = err.keyword === "required" ? (err.params as { requiredProperties?: string[] }).requiredProperties?.[0] : undefined
      const field = missing ?? (err.instancePath.split("/").slice(1).join(".") || undefined)
      throw new ValidationError(`report ${reportId}: ${missing ? `${missing} is required` : `${field ?? "params"} ${err.message}`}`, { field })
    }
    const input = report.prepare ? await report.prepare(params) : params
    const title = typeof report.title === "function" ? await report.title(input) : report.title
    const mine = this.sections.filter((s) => s.reportId === reportId).sort((a, b) => a.def.order - b.def.order)
    const sections: ReportSectionResult[] = []
    for (const s of mine) {
      try {
        const result: unknown = await s.def.run(input)
        if (result === null || result === undefined) continue
        for (const one of Array.isArray(result) ? result : [result])
          sections.push(wellFormed(one) ? one : { title: s.def.id, columns: [], rows: [], empty: "", note: "error: malformed section result" })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        sections.push({ title: s.def.id, columns: [], rows: [], empty: "", note: `error: ${message}` })
      }
    }
    return { title, sections }
  }

  remove(pluginId: string): void {
    for (const [id, r] of this.reports) if (r.plugin === pluginId) this.reports.delete(id)
    this.sections = this.sections.filter((s) => s.plugin !== pluginId)
  }
}

// The shape the renderers rely on: a string title, a column array, an array of row objects and, when present,
// a string group and text and one mark (an object or null) per row.
function wellFormed(r: unknown): r is ReportSectionResult {
  if (typeof r !== "object" || r === null) return false
  const x = r as Record<string, unknown>
  return (
    typeof x.title === "string" &&
    Array.isArray(x.columns) &&
    Array.isArray(x.rows) &&
    x.rows.every((row) => typeof row === "object" && row !== null) &&
    (x.group === undefined || typeof x.group === "string") &&
    (x.text === undefined || typeof x.text === "string") &&
    (x.marks === undefined || (Array.isArray(x.marks) && x.marks.length === x.rows.length && x.marks.every((m) => typeof m === "object")))
  )
}

const cell = (v: Cell | undefined): string => (v === null || v === undefined ? "" : String(v))
const mdCell = (v: Cell | undefined) => cell(v).replace(/\r?\n/g, " ").replace(/\|/g, "\\|")
const hasTable = (s: ReportSectionResult) => s.rows.length > 0 && s.columns.length > 0
// The cells of row `i`, with its mark's icon (if any) before the first one.
function rowCells(s: ReportSectionResult, i: number, render: (v: Cell | undefined) => string): string[] {
  const icon = s.marks?.[i]?.icon
  return s.columns.map((c, j) => (j === 0 && icon ? `${icon} ${render(s.rows[i]![c])}` : render(s.rows[i]![c])))
}
// The group heading due before each section: at a group's first section and at each change of group.
const groupHeadings = (r: ReportResult): Array<string | undefined> =>
  r.sections.map((s, i) => (s.group !== undefined && s.group !== r.sections[i - 1]?.group ? s.group : undefined))

function md(r: ReportResult): string {
  const blocks = [`# ${r.title}`]
  const headings = groupHeadings(r)
  r.sections.forEach((s, i) => {
    const group = headings[i]
    if (group !== undefined) blocks.push(`## ${group}`)
    blocks.push(`${s.group !== undefined ? "###" : "##"} ${s.title}`)
    if (hasTable(s)) {
      const row = (cells: string[]) => `| ${cells.join(" | ")} |`
      blocks.push([row(s.columns.map((c) => mdCell(c))), row(s.columns.map(() => "---")), ...s.rows.map((_, j) => row(rowCells(s, j, mdCell)))].join("\n"))
    } else if (s.empty) blocks.push(`_${s.empty}_`)
    if (s.text) blocks.push(s.text)
    if (s.note) blocks.push(`_${s.note}_`)
  })
  return blocks.join("\n\n") + "\n"
}

function text(r: ReportResult): string {
  const blocks = [r.title]
  const headings = groupHeadings(r)
  r.sections.forEach((s, i) => {
    const group = headings[i]
    if (group !== undefined) blocks.push(group)
    const lines = [s.title]
    if (hasTable(s)) {
      const table = [s.columns, ...s.rows.map((_, j) => rowCells(s, j, (v) => cell(v).replace(/\r?\n/g, " ")))]
      const widths = s.columns.map((_, i) => Math.max(...table.map((t) => t[i]!.length)))
      for (const t of table) lines.push(t.map((v, i) => v.padEnd(widths[i]!)).join("  ").trimEnd())
    } else if (s.empty) lines.push(s.empty)
    if (s.text) lines.push(s.text)
    if (s.note) lines.push(s.note)
    blocks.push(lines.join("\n"))
  })
  return blocks.join("\n\n") + "\n"
}

export function renderReport(r: ReportResult, format: "md" | "text" | "json"): string {
  if (format === "md") return md(r)
  if (format === "text") return text(r)
  return JSON.stringify(r, null, 2)
}
