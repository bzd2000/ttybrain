// The Overview's project queries, shared by the `overview` report sections (report.ts) and the TUI panels
// (tui/panels.ts): one place decides what is needing attention, late or high-severity. The action sections and
// panels are the actions plugin's.
import { addDays, type PluginRuntime } from "@ttybrain/api"
import type { Items, MilestoneRecord, RiskRecord } from "./items"
import type { Store } from "./records"
import type { ProjectRecord } from "./schema"

export const ATTENTION_DAYS = 30 // a project without a health update for longer needs attention
export const MILESTONE_DAYS = 14 // the overview's milestone window
const HEALTH_RANK: Record<string, number> = { red: 0, amber: 1 }

export type OverviewRisk = { risk: RiskRecord; owner: string | null }

export function makeOverview(rt: PluginRuntime, store: Store, items: Items) {
  return {
    // Active projects (not on hold or closed) that are red, amber, or without a recent health update.
    async projectsNeedingAttention(): Promise<ProjectRecord[]> {
      const stale = addDays(rt.clock.today(), -ATTENTION_DAYS)
      return (await store.toProjects(await store.recordQuery().where("p.archived_at", "is", null).where("p.status", "=", "active").execute()))
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
