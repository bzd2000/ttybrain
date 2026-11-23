// The actions plugin's Attention panels: overdue actions (priority 10) and due this week (20), with the designs'
// column widths (growing for long codes and ids). The third column is the action's first project or person link (the
// 2026-11-20 home design): a project's code (cyan) or a person's first name (magenta), `—` without one. They read through the same makeOverview the
// `overview` report sections use.
import { dueLabel, type Cell, type OverviewRow, type TuiContext } from "@ttybrain/api/tui"
import { makeOverview, type OverviewAction } from "../logic/overview"
import { makeStore } from "../logic/records"

const dash: Cell = { text: "—", tone: "muted" }
// The people's names by id, through the people view (empty while that plugin is off).
async function namesOf(ui: TuiContext, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map()
  try {
    const rows = await ui.data.selectFrom("people.person").select(["id", "name"]).where("id", "in", ids).execute()
    return new Map(rows.map((r) => [Number(r.id), String(r.name)]))
  } catch {
    return new Map()
  }
}
// Ids and codes start at the designs' widths and grow to their longest text (codes up to 16), so they stay whole.
// id, title, project, due.
const COLUMNS = [{ min: 5, max: 10 }, "grow", { min: 7, max: 16 }, 7] as const

export function registerPanels(ui: TuiContext): void {
  const overview = makeOverview(ui, makeStore(ui))

  const rows = async (list: OverviewAction[], tone: Cell["tone"]): Promise<OverviewRow[]> => {
    const today = ui.clock.today()
    const first = list.map(({ a }) => a.links.find((l) => l.type === "project" || l.type === "person"))
    const names = await namesOf(ui, first.flatMap((l) => (l?.type === "person" ? [l.id] : [])))
    const linked = (l: (typeof first)[number]): Cell => {
      if (l === undefined) return dash
      if (l.type === "project") return l.ref.startsWith("#") ? { text: l.ref.slice(1), tone: "cyan" } : dash
      const name = names.get(l.id)
      return name === undefined ? dash : { text: name.split(/\s+/)[0]!, tone: "magenta" }
    }
    return list.map(({ a }, i) => ({
      ref: a.ref,
      cells: [{ text: a.ref, tone: "muted" }, { text: a.title }, linked(first[i]), { text: dueLabel(a.due_date, today), tone }],
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
