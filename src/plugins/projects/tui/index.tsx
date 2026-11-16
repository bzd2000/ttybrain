// The projects plugin's tui part: the Projects screen (slot 2) and the project's record forms (project, health).
import { defineTui } from "../../../kernel/tui/api"
import { HealthForm, InvolvementForm, ProjectForm } from "./forms"
import { makeStore } from "../logic/records"
import { ProjectContext } from "./project-context"
import { ProjectPeople } from "./project-people"
import { ProjectSummary } from "./project-summary"
import { ProjectsScreen } from "./projects-screen"

export const projectsTui = defineTui({
  plugin: "projects",
  activate(ui) {
    ui.screen({
      id: "projects",
      title: "Projects",
      slot: 2,
      component: ProjectsScreen,
      // The active, non-archived projects.
      count: async () => {
        const row = await ui.data
          .selectFrom("project")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("status", "=", "active")
          .where("archived_at", "is", null)
          .executeTakeFirstOrThrow()
        return Number(row.n)
      },
    })
    ui.recordForm("project", { id: "project", label: "Project", component: ProjectForm })
    ui.recordForm("project", { id: "health", label: "Health update", component: HealthForm })
    ui.recordForm("project", { id: "involvement", label: "Involvement", component: InvolvementForm })

    // The project's record tabs; the item tabs (orders 20-60) sit between Summary and People.
    ui.recordTab("project", { id: "summary", title: "Summary", order: 10, component: ProjectSummary })
    ui.recordTab("project", {
      id: "people",
      title: "People",
      order: 70,
      count: async (recordRef) => {
        const id = await makeStore(ui).projectId(recordRef)
        if (id === null) return null
        const row = await ui.data.selectFrom("involvement").select((eb) => eb.fn.countAll().as("n")).where("project_id", "=", id).executeTakeFirstOrThrow()
        return Number(row.n)
      },
      component: ProjectPeople,
    })
    ui.recordTab("project", { id: "context", title: "Context", order: 80, component: ProjectContext })
  },
})
