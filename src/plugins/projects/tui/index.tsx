// The projects plugin's tui part: the Projects screen (slot 2) and the project's record forms (project, health).
import { defineTui } from "../../../kernel/tui/api"
import { HealthForm, ProjectForm } from "./forms"
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
  },
})
