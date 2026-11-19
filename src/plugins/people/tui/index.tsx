// The people plugin's tui part: the People screen (slot 3), the person record view's tabs (Summary, Notes, and
// Goals for team members), the Overview's "Stakeholders to contact" panel and the person, note and goal forms.
import { daysBetween, defineTui, type Cell } from "@pm/api/tui"
import type { StaleRow } from "../logic/ops"
import { makeStore } from "../logic/records"
import { GoalForm, NoteForm, PersonForm } from "./forms"
import { PeopleScreen } from "./people-screen"
import { PersonGoals, PersonNotes, PersonSummary } from "./person-tabs"

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
    const store = makeStore(ui)
    ui.recordTab("person", { id: "summary", title: "Summary", order: 10, component: PersonSummary })
    ui.recordTab("person", {
      id: "notes",
      title: "Notes",
      order: 20,
      component: PersonNotes,
      count: async (ref) => {
        const p = await store.person(ref)
        const row = await ui.data.selectFrom("note").select((eb) => eb.fn.countAll().as("n")).where("person_id", "=", p.id).executeTakeFirstOrThrow()
        return Number(row.n)
      },
    })
    ui.recordTab("person", {
      id: "goals",
      title: "Goals",
      order: 30,
      component: PersonGoals,
      when: async (ref) => (await store.person(ref)).is_team,
      // The open goals.
      count: async (ref) => {
        const p = await store.person(ref)
        const row = await ui.data
          .selectFrom("goal")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("person_id", "=", p.id)
          .where("status", "=", "open")
          .executeTakeFirstOrThrow()
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
      footer: `last contact ${days}+ days ago, high influence first`,
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

export default peopleTui
