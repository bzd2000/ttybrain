// The people plugin's tui part: the People screen (slot 3), the Overview's "Stakeholders to contact" panel and the person, note and goal forms.
import { daysBetween, defineTui, type Cell } from "../../../kernel/tui/api"
import type { StaleRow } from "../logic/ops"
import { GoalForm, NoteForm, PersonForm } from "./forms"
import { PeopleScreen } from "./people-screen"

export const peopleTui = defineTui({
  plugin: "people",
  activate(ui) {
    ui.screen({
      id: "people",
      title: "People",
      slot: 3,
      component: PeopleScreen,
      // The people who are not archived.
      count: async () => {
        const row = await ui.data.selectFrom("person").select((eb) => eb.fn.countAll().as("n")).where("archived_at", "is", null).executeTakeFirstOrThrow()
        return Number(row.n)
      },
    })
    ui.recordForm("person", { id: "person", label: "Person", component: PersonForm })
    ui.recordForm("note", { id: "note", label: "Note", component: NoteForm })
    ui.recordForm("goal", { id: "goal", label: "Goal", component: GoalForm })
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
