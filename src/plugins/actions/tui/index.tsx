// The actions plugin's tui part: the Actions screen (slot 4), the Attention panels (overdue, due this week), the
// `action` record forms (the full form, then the due date: Enter opens the first), and the Actions tabs on a project
// (order 60) and on a person (order 50).
import { defineTui } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import { ActionForm } from "./action-form"
import { ActionsScreen } from "./actions-screen"
import { DueForm } from "./due-form"
import { registerPanels } from "./panels"
import { PersonActions } from "./person-actions"
import { ProjectActions } from "./project-actions"

export const actionsTui = defineTui({
  plugin: "actions",
  activate(ui) {
    const n = async (q: any) => Number((await q.select((eb: any) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()).n)
    ui.screen({
      id: "actions",
      title: "Actions",
      slot: 4,
      component: ActionsScreen,
      // The open actions.
      count: () => n(ui.data.selectFrom("action").where("status", "=", "open")),
    })
    registerPanels(ui)
    ui.recordForm("action", { id: "action", label: "Action", component: ActionForm })
    ui.recordForm("action", { id: "due", label: "Due date", component: DueForm }) // after the full form: Enter opens that one

    // The actions linked to the project, all of them, as the tab lists them.
    ui.recordTab("project", {
      id: "actions",
      title: "Actions",
      order: 60,
      count: async (recordRef) => {
        const found = await ui.records.resolve(recordRef)
        return found === null || found.type !== "project" ? null : n(ui.data.selectFrom("action as a").where(makeStore(ui).linkedTo([found])))
      },
      component: ProjectActions,
    })
    // The open actions the person owns or that are linked to them.
    ui.recordTab("person", {
      id: "actions",
      title: "Actions",
      order: 50,
      count: async (recordRef) => {
        const store = makeStore(ui)
        const id = (await store.person(recordRef)).id
        const linked = store.linkedTo([{ type: "person", id }])
        return n(ui.data.selectFrom("action as a").where("a.status", "=", "open").where((eb: any) => eb.or([eb("a.owner_id", "=", id), linked(eb)])))
      },
      component: PersonActions,
    })
  },
})

export default actionsTui
