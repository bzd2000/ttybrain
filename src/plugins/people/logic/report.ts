// The "Stakeholders to contact" section of the overview report (registered by projects; sections may come first):
// the high-influence stakeholders without a note for staleContactDays, as the Attention panel lists them.
import type { PluginContext } from "@ttybrain/api"
import type { StaleRow } from "./ops"

export function registerReport(ctx: PluginContext): void {
  ctx.reportSection("overview", {
    id: "stakeholders-to-contact",
    order: 60,
    run: async () => {
      const rows: StaleRow[] = await ctx.self().read.staleStakeholders!({ days: ctx.config.staleContactDays, influence: "high" })
      return {
        title: "Stakeholders to contact",
        columns: ["person", "name", "influence", "last contact", "projects"],
        rows: rows.map((r) => ({
          person: r.ref,
          name: r.name,
          influence: r.influence,
          "last contact": r.last_contact,
          projects: r.projects.join(", "),
        })),
        empty: "No stakeholders to contact.",
      }
    },
  })
}
