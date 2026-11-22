// The projects plugin's Attention panels: projects needing attention, late and upcoming milestones, high risks and
// issues, with the designs' column widths (growing for long codes and ids) and cyan project codes. They read through
// the same makeOverview the `overview` report uses. The action panels (priorities 10 and 20) are the actions plugin's.
import { daysBetween, dueLabel, shortDate, type Cell, type OverviewRow, type TuiContext } from "@ttybrain/api/tui"
import { makeItems } from "../logic/items"
import { ATTENTION_DAYS, makeOverview, MILESTONE_DAYS } from "../logic/overview"
import { makeStore } from "../logic/records"

const code = (text: string): Cell => ({ text, tone: "cyan" })
// Ids and codes start at the designs' widths and grow to their longest text (codes up to 16), so they stay whole.
const ID = { min: 5, max: 8 }
const CODE = (min: number) => ({ min, max: 16 })

export function registerPanels(ui: TuiContext): void {
  const store = makeStore(ui)
  const overview = makeOverview(ui, store, makeItems(ui, store))
  ui.overviewPanel({
    id: "projects-needing-attention",
    title: "Projects needing attention",
    priority: 30,
    empty: "No project needs attention.",
    count: false,
    columns: [2, CODE(6), "grow", 12],
    load: async () => {
      const today = ui.clock.today()
      return (await overview.projectsNeedingAttention()).map((p): OverviewRow => {
        const days = p.health_date === null ? null : daysBetween(p.health_date, today)
        const age = days === null ? "never" : `${days}d ago`
        // Without a health, or one older than the report's window, the row says so (a muted ○) instead of showing
        // the comment.
        const stale = p.health === null || days === null || days > ATTENTION_DAYS
        const tone = stale ? "muted" : p.health === "red" ? "red" : p.health === "amber" ? "amber" : "green"
        const dot: Cell = { text: stale ? "○" : "●", tone }
        return {
          ref: p.ref,
          cells: [
            dot,
            code(p.code),
            stale ? { text: "Health not updated", tone: "muted" } : { text: p.health_comment ?? "" },
            stale ? { text: age, tone: "amber" } : { text: `upd ${age}`, tone: "muted" },
          ],
        }
      })
    },
  })
  ui.overviewPanel({
    id: "milestones",
    // The late ones (counted in the title), then the next 14 days' under a sub-heading.
    title: "Late milestones",
    priority: 40,
    empty: "No late milestones and none in the next 14 days.",
    columns: [CODE(6), "grow", 8],
    load: async () => {
      const today = ui.clock.today()
      return (await overview.milestones()).map((m): OverviewRow => {
        const late = m.due_date < today
        return {
          ref: m.ref,
          cells: [code(m.project.slice(1)), { text: m.title }, late ? { text: dueLabel(m.due_date, today), tone: "red" } : { text: shortDate(m.due_date) }],
          ...(!late && { group: `Next ${MILESTONE_DAYS} days` }),
        }
      })
    },
  })
  ui.overviewPanel({
    id: "high-risks",
    title: "High risks & issues",
    priority: 50,
    empty: "No open high-severity risks or issues.",
    // id, project, title, type.
    columns: [ID, CODE(6), "grow", 6],
    load: async () =>
      (await overview.highRisks()).map(({ risk }): OverviewRow => ({
        ref: risk.ref,
        cells: [{ text: risk.ref, tone: "muted" }, code(risk.project.slice(1)), { text: risk.title }, { text: risk.type, tone: "red" }],
      })),
  })
}
