// The people plugin's tui part. Phase 2 has only the Overview's "Stakeholders to contact" panel.
import { daysBetween, defineTui, type Cell } from "../../../kernel/tui/api"
import type { StaleRow } from "../logic/ops"

export const peopleTui = defineTui({
  plugin: "people",
  activate(ui) {
    const days = ui.config.staleContactDays
    ui.overviewPanel({
      id: "stakeholders-to-contact",
      title: "Stakeholders to contact",
      priority: 60,
      empty: "No stakeholders to contact.",
      footer: `last contact over ${days} days, high influence first`,
      load: async () => {
        const today = ui.clock.today()
        const rows: StaleRow[] = await ui.self().read.staleStakeholders!({ days })
        return rows.map((r) => {
          const level = `${r.influence ?? "–"}/${r.interest ?? "–"}`
          const cells: Cell[] = [
            { text: r.name },
            { text: r.projects.length > 0 ? `${level} · ${r.projects.join(", ")}` : level, tone: "muted" },
            { text: r.last_contact === null ? "never" : `${daysBetween(r.last_contact, today)}d`, tone: "amber" },
          ]
          return { ref: r.ref, cells }
        })
      },
    })
  },
})
