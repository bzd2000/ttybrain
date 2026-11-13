// Reports: a named report (registered by one plugin) is a list of sections (registered by any plugin) that
// return structured data. The kernel runs them in order and renders the result as Markdown, text or JSON.
import type { TSchema } from "typebox"
import Value from "typebox/value"
import { NotFoundError, suggest, ValidationError } from "./errors"

export type Cell = string | number | null
export type ReportSectionResult = { title: string; columns: string[]; rows: Array<Record<string, Cell>>; empty: string; note?: string }
export type ReportDef = { id: string; cliName: string; title: string; params: TSchema; describe: string }
export type ReportSectionDef = { id: string; order: number; run(params: any): Promise<ReportSectionResult | null> }
export type ReportResult = { title: string; sections: ReportSectionResult[] }

type Section = { reportId: string; plugin: string; def: ReportSectionDef }

export class ReportRegistry {
  private readonly reports = new Map<string, { def: ReportDef; plugin?: string }>()
  private sections: Section[] = [] // in registration order, which breaks ties in `order`

  // `plugin` lets the host remove a failed plugin's reports.
  report(def: ReportDef, plugin?: string): void {
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
  // whose result is not section-shaped (R17), becomes an error note and the report goes on.
  async run(reportId: string, params: unknown): Promise<ReportResult> {
    const report = this.reports.get(reportId)?.def
    if (!report) throw new NotFoundError(`no report "${reportId}"`, { suggestions: suggest(reportId, [...this.reports.keys()]) })
    const [err] = Value.Errors(report.params, params)
    if (err) {
      const missing = err.keyword === "required" ? (err.params as { requiredProperties?: string[] }).requiredProperties?.[0] : undefined
      const field = missing ?? (err.instancePath.split("/").slice(1).join(".") || undefined)
      throw new ValidationError(`report ${reportId}: ${missing ? `${missing} is required` : `${field ?? "params"} ${err.message}`}`, { field })
    }
    const mine = this.sections.filter((s) => s.reportId === reportId).sort((a, b) => a.def.order - b.def.order)
    const sections: ReportSectionResult[] = []
    for (const s of mine) {
      try {
        const result: unknown = await s.def.run(params)
        if (result === null || result === undefined) continue
        sections.push(wellFormed(result) ? result : { title: s.def.id, columns: [], rows: [], empty: "", note: "error: malformed section result" })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        sections.push({ title: s.def.id, columns: [], rows: [], empty: "", note: `error: ${message}` })
      }
    }
    return { title: report.title, sections }
  }

  remove(pluginId: string): void {
    for (const [id, r] of this.reports) if (r.plugin === pluginId) this.reports.delete(id)
    this.sections = this.sections.filter((s) => s.plugin !== pluginId)
  }
}

// The shape the renderers rely on: a string title, a column array and an array of row objects.
function wellFormed(r: unknown): r is ReportSectionResult {
  if (typeof r !== "object" || r === null) return false
  const x = r as Record<string, unknown>
  return (
    typeof x.title === "string" &&
    Array.isArray(x.columns) &&
    Array.isArray(x.rows) &&
    x.rows.every((row) => typeof row === "object" && row !== null)
  )
}

const cell = (v: Cell | undefined): string => (v === null || v === undefined ? "" : String(v))
const mdCell = (v: Cell | undefined) => cell(v).replace(/\r?\n/g, " ").replace(/\|/g, "\\|")
const hasTable = (s: ReportSectionResult) => s.rows.length > 0 && s.columns.length > 0

function md(r: ReportResult): string {
  const blocks = [`# ${r.title}`]
  for (const s of r.sections) {
    blocks.push(`## ${s.title}`)
    if (hasTable(s)) {
      const row = (cells: string[]) => `| ${cells.join(" | ")} |`
      blocks.push(
        [row(s.columns.map((c) => mdCell(c))), row(s.columns.map(() => "---")), ...s.rows.map((x) => row(s.columns.map((c) => mdCell(x[c]))))].join(
          "\n",
        ),
      )
    } else if (s.empty) blocks.push(`_${s.empty}_`)
    if (s.note) blocks.push(`_${s.note}_`)
  }
  return blocks.join("\n\n") + "\n"
}

function text(r: ReportResult): string {
  const blocks = [r.title]
  for (const s of r.sections) {
    const lines = [s.title]
    if (hasTable(s)) {
      const table = [s.columns, ...s.rows.map((x) => s.columns.map((c) => cell(x[c]).replace(/\r?\n/g, " ")))]
      const widths = s.columns.map((_, i) => Math.max(...table.map((t) => t[i]!.length)))
      for (const t of table) lines.push(t.map((v, i) => v.padEnd(widths[i]!)).join("  ").trimEnd())
    } else if (s.empty) lines.push(s.empty)
    if (s.note) lines.push(s.note)
    blocks.push(lines.join("\n"))
  }
  return blocks.join("\n\n") + "\n"
}

export function renderReport(r: ReportResult, format: "md" | "text" | "json"): string {
  if (format === "md") return md(r)
  if (format === "text") return text(r)
  return JSON.stringify(r, null, 2)
}
