// The actions plugin's Attention panels: overdue actions (priority 10) and due this week (20), with the designs'
// column widths (growing for long codes and ids) and cyan project codes. They read through the same makeOverview the
// `overview` report sections use.
import { dueLabel, type Cell, type OverviewRow, type TuiContext } from "@ttybrain/api/tui"
import { makeOverview, type OverviewAction } from "../logic/overview"
import { makeStore } from "../logic/records"

const dash: Cell = { text: "—", tone: "muted" }
const project = (ref: string | null): Cell => (ref === null ? dash : { text: ref.slice(1), tone: "cyan" })
// Ids and codes start at the designs' widths and grow to their longest text (codes up to 16), so they stay whole.
// id, title, project, due.
const COLUMNS = [{ min: 5, max: 8 }, "grow", { min: 7, max: 16 }, 7] as const

export function registerPanels(ui: TuiContext): void {
  const overview = makeOverview(ui, makeStore(ui))

  const rows = (list: OverviewAction[], tone: Cell["tone"]): OverviewRow[] => {
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
    columns: [...COLUMNS],
    load: async () => rows(await overview.overdueActions(), "red"),
  })
  ui.overviewPanel({
    id: "due-this-week",
    title: "Due this week",
    priority: 20,
    empty: "Nothing due this week.",
    columns: [...COLUMNS],
    load: async () => rows(await overview.dueThisWeek(), undefined),
  })
}
