// The projects plugin's Overview panels: overdue actions, due this week, projects needing attention, late and
// upcoming milestones, high risks and issues. They read through the same makeOverview the `overview` report uses.
import { daysBetween, dueLabel, shortDate, type Cell, type OverviewRow, type TuiContext } from "@ttybrain/api/tui"
import { makeItems } from "../logic/items"
import { ATTENTION_DAYS, makeOverview, type OverviewAction } from "../logic/overview"
import { makeStore } from "../logic/records"

const dash: Cell = { text: "—", tone: "muted" }
const project = (ref: string | null): Cell => (ref === null ? dash : { text: ref.slice(1), tone: "accent" })

export function registerPanels(ui: TuiContext): void {
  const store = makeStore(ui)
  const overview = makeOverview(ui, store, makeItems(ui, store))

  const actionRows = (list: OverviewAction[], tone: Cell["tone"]): OverviewRow[] => {
    const today = ui.clock.today()
    return list.map(({ a }) => ({
      ref: a.ref,
      cells: [{ text: a.ref, tone: "muted" }, { text: a.title }, project(a.project), { text: dueLabel(a.due_date, today), tone }],
    }))
  }

  ui.overviewPanel({
    id: "overdue-actions",
    title: "Overdue actions",
    priority: 10,
    empty: "No overdue actions.",
    load: async () => actionRows(await overview.overdueActions(), "red"),
  })
  ui.overviewPanel({
    id: "due-this-week",
    title: "Due this week",
    priority: 20,
    empty: "Nothing due this week.",
    load: async () => actionRows(await overview.dueThisWeek(), undefined),
  })
  ui.overviewPanel({
    id: "projects-needing-attention",
    title: "Projects needing attention",
    priority: 30,
    empty: "No project needs attention.",
    load: async () => {
      const today = ui.clock.today()
      return (await overview.projectsNeedingAttention()).map((p): OverviewRow => {
        const tone = p.health === "red" ? "red" : p.health === "amber" ? "amber" : p.health === "green" ? "green" : "muted"
        const dot: Cell = { text: p.health === null ? "○" : "●", tone }
        const days = p.health_date === null ? null : daysBetween(p.health_date, today)
        const age = days === null ? "never" : `${days}d ago`
        // Without a health, or one older than the report's window, the row says so instead of showing the comment.
        const stale = p.health === null || days === null || days > ATTENTION_DAYS
        return {
          ref: p.ref,
          cells: [
            dot,
            { text: p.code, tone: "accent" },
            stale ? { text: "Health not updated", tone: "muted" } : { text: p.health_comment ?? "" },
            stale ? { text: age, tone: "amber" } : { text: `upd ${age}`, tone: "muted" },
          ],
        }
      })
    },
  })
  ui.overviewPanel({
    id: "milestones",
    title: "Late milestones · next 14 days",
    priority: 40,
    empty: "No late milestones and none in the next 14 days.",
    load: async () => {
      const today = ui.clock.today()
      return (await overview.milestones()).map((m): OverviewRow => ({
        ref: m.ref,
        cells: [
          { text: m.project.slice(1), tone: "accent" },
          { text: m.title },
          m.due_date < today ? { text: dueLabel(m.due_date, today), tone: "red" } : { text: shortDate(m.due_date) },
        ],
      }))
    },
  })
  ui.overviewPanel({
    id: "high-risks",
    title: "High risks & issues",
    priority: 50,
    empty: "No open high-severity risks or issues.",
    load: async () =>
      (await overview.highRisks()).map(({ risk }): OverviewRow => ({
        ref: risk.ref,
        cells: [{ text: risk.ref, tone: "muted" }, { text: risk.title }, { text: risk.project.slice(1), tone: "accent" }, { text: risk.type, tone: "red" }],
      })),
  })
}
