// The Overview's action queries, shared by the `overview` report sections (report.ts) and the TUI panels
// (tui/panels.ts): one place decides what is overdue and what is due this week.
import { weekEnd, type PluginRuntime } from "@ttybrain/api"
import type { ActionRecord, Store } from "./records"

// An open action with a due date; the owner is a name (people.person), `me` when empty.
export type OverviewAction = { a: ActionRecord; owner: string }

export function makeOverview(rt: PluginRuntime, store: Store) {
  // Open actions with a due date, on no project or an active one, oldest due first.
  const openActions = async (): Promise<OverviewAction[]> => {
    const rows = (await store.actionQuery().where("a.status", "=", "open").where("a.due_date", "is not", null).execute()).filter((r) => !store.archived(r))
    return rows
      .map((r: any) => ({ a: store.toAction(r), owner: r.owner_id === null ? "me" : r.owner_name === null ? `person:${r.owner_id}` : String(r.owner_name) }))
      .sort((x, y) => (x.a.due_date === y.a.due_date ? x.a.id - y.a.id : x.a.due_date! < y.a.due_date! ? -1 : 1))
  }

  return {
    async overdueActions(): Promise<OverviewAction[]> {
      const t = rt.clock.today()
      return (await openActions()).filter((x) => x.a.due_date! < t)
    },
    async dueThisWeek(): Promise<OverviewAction[]> {
      const t = rt.clock.today()
      const end = weekEnd(t)
      return (await openActions()).filter((x) => x.a.due_date! >= t && x.a.due_date! <= end)
    },
  }
}
