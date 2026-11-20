// The Overview's project queries, shared by the `overview` report sections (report.ts) and the TUI panels
// (tui/panels.ts): one place decides what is overdue, due this week, needing attention, late or high-severity.
import { addDays, weekEnd, type PluginRuntime } from "@ttybrain/api"
import type { ActionRecord, Items, MilestoneRecord, RiskRecord } from "./items"
import type { Store } from "./records"
import type { ProjectRecord } from "./schema"

export const ATTENTION_DAYS = 30 // a project without a health update for longer needs attention
export const MILESTONE_DAYS = 14 // the overview's milestone window
const HEALTH_RANK: Record<string, number> = { red: 0, amber: 1 }

// An open action with a due date; the owner is a name (people.person), `me` when empty.
export type OverviewAction = { a: ActionRecord; owner: string }
export type OverviewRisk = { risk: RiskRecord; owner: string | null }

export function makeOverview(rt: PluginRuntime, store: Store, items: Items) {
  // Open actions with a due date, on no project or an active one, oldest due first.
  const openActions = async (): Promise<OverviewAction[]> => {
    const rows = await items.actionQuery().where("a.status", "=", "open").where("a.due_date", "is not", null).where("p.archived_at", "is", null).execute()
    return rows
      .map((r) => ({ a: items.toAction(r), owner: r.owner_id === null ? "me" : r.owner_name === null ? `person:${r.owner_id}` : String(r.owner_name) }))
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
    // Active projects (not on hold or closed) that are red, amber, or without a recent health update.
    async projectsNeedingAttention(): Promise<ProjectRecord[]> {
      const stale = addDays(rt.clock.today(), -ATTENTION_DAYS)
      return (await store.recordQuery().where("p.archived_at", "is", null).where("p.status", "=", "active").execute())
        .map(store.toProject)
        .filter((p) => p.health === "red" || p.health === "amber" || p.health_date === null || p.health_date < stale)
        .sort((a, b) => (HEALTH_RANK[a.health ?? ""] ?? 2) - (HEALTH_RANK[b.health ?? ""] ?? 2) || a.code.localeCompare(b.code))
    },
    // Not done, due within MILESTONE_DAYS (late ones included), by due date.
    async milestones(): Promise<MilestoneRecord[]> {
      const rows = await items
        .milestoneQuery()
        .where("m.done_date", "is", null)
        .where("m.due_date", "<=", addDays(rt.clock.today(), MILESTONE_DAYS))
        .where("p.archived_at", "is", null)
        .orderBy("m.due_date")
        .orderBy("m.id")
        .execute()
      return rows.map(items.toMilestone)
    },
    async highRisks(): Promise<OverviewRisk[]> {
      const rows = await items
        .riskQuery()
        .select("pp.name as owner_name")
        .where("r.status", "=", "open")
        .where("r.severity", "=", "high")
        .where("p.archived_at", "is", null)
        .orderBy("r.id")
        .execute()
      return rows.map((r) => {
        const risk = items.toRisk(r)
        return { risk, owner: r.owner_name === null ? risk.owner : String(r.owner_name) }
      })
    },
  }
}
