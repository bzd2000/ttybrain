// The projects plugin's tui part: the Projects screen (slot 2) and the project's record forms (project, health).
import { defineTui } from "../../../kernel/tui/api"
import { ActionsScreen } from "./actions-screen"
import { DueForm } from "./due-form"
import { HealthForm, InvolvementForm, ProjectForm } from "./forms"
import { makeStore } from "../logic/records"
import { FORM_LABELS, ITEM_FORMS } from "./item-forms"
import { ITEM_KINDS, ItemTab } from "./item-tab"
import { KINDS } from "../logic/items"
import { ProjectContext } from "./project-context"
import { ProjectPeople } from "./project-people"
import { ProjectSummary } from "./project-summary"
import { registerPanels } from "./panels"
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
    ui.screen({
      id: "actions",
      title: "Actions",
      slot: 4,
      component: ActionsScreen,
      // The open actions.
      count: async () => {
        const row = await ui.data.selectFrom("action").select((eb) => eb.fn.countAll().as("n")).where("status", "=", "open").executeTakeFirstOrThrow()
        return Number(row.n)
      },
    })
    registerPanels(ui)
    ui.recordForm("project", { id: "project", label: "Project", component: ProjectForm })
    ui.recordForm("project", { id: "health", label: "Health update", component: HealthForm })
    ui.recordForm("project", { id: "involvement", label: "Involvement", component: InvolvementForm })

    for (const kind of KINDS) ui.recordForm(kind, { id: kind, label: FORM_LABELS[kind], component: ITEM_FORMS[kind] })

    ui.recordForm("action", { id: "due", label: "Due date", component: DueForm }) // after the full form: Enter opens that one

    // The project's record tabs; the item tabs (orders 20-60) sit between Summary and People.
    ui.recordTab("project", { id: "summary", title: "Summary", order: 10, component: ProjectSummary })
    // The item tabs; each count is the project's open items (decisions: all).
    const itemTab = (id: string, order: number, open: (id: number) => Promise<number>) => {
      const config = ITEM_KINDS[id]!
      ui.recordTab("project", {
        id,
        title: config.title,
        order,
        count: async (recordRef) => {
          const pid = await makeStore(ui).projectId(recordRef)
          return pid === null ? null : open(pid)
        },
        component: (p) => <ItemTab recordRef={p.recordRef} config={config} />,
      })
    }
    const n = async (q: any) => Number((await q.select((eb: any) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()).n)
    itemTab("milestones", 20, (pid) => n(ui.data.selectFrom("milestone").where("project_id", "=", pid).where("done_date", "is", null)))
    itemTab("deliverables", 30, (pid) => n(ui.data.selectFrom("deliverable").where("project_id", "=", pid).where("status", "<>", "delivered")))
    itemTab("risks", 40, (pid) => n(ui.data.selectFrom("risk").where("project_id", "=", pid).where("status", "=", "open")))
    itemTab("decisions", 50, (pid) => n(ui.data.selectFrom("decision").where("project_id", "=", pid)))
    itemTab("actions", 60, (pid) => n(ui.data.selectFrom("action").where("project_id", "=", pid).where("status", "=", "open")))
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
