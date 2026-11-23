// The actions plugin's tui part: the Actions screen (slot 4), the Attention panels (overdue, due this week), the
// `action` record forms (the full form, then the due date and the links: Enter opens the first), and the Actions
// tab, one component, on every record type actions link to: a project (order 60), a person (50) and a board meeting
// (50, after its Export tab).
import { defineTui, type TuiContext } from "@ttybrain/api/tui"
import { ActionForm } from "./action-form"
import { ActionsScreen } from "./actions-screen"
import { DueForm } from "./due-form"
import { LinksForm } from "./links-form"
import { registerPanels } from "./panels"
import { openCount, RecordActions } from "./record-actions"

// Whether a meeting is a board meeting (the meetings view; a meeting it does not know keeps the tab).
async function isBoard(ui: TuiContext, ref: string): Promise<boolean> {
  const found = await ui.records.resolve(ref)
  if (!found) return true
  const m = await ui.data.selectFrom("meetings.meeting").select("kind").where("id", "=", found.id).executeTakeFirst()
  return m === undefined || m.kind === "board"
}

const TABS = [
  { type: "project", order: 60 },
  { type: "person", order: 50 },
  { type: "meeting", order: 50 },
]

export const actionsTui = defineTui({
  plugin: "actions",
  activate(ui) {
    ui.screen({
      id: "actions",
      title: "Actions",
      slot: 4,
      component: ActionsScreen,
      // The open actions.
      count: async () => Number(((await ui.data.selectFrom("action").where("status", "=", "open").select((eb: any) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()) as { n: unknown }).n),
    })
    registerPanels(ui)
    ui.recordForm("action", { id: "action", label: "Action", component: ActionForm })
    ui.recordForm("action", { id: "due", label: "Due date", component: DueForm }) // after the full form: Enter opens that one
    ui.recordForm("action", { id: "links", label: "Links", component: LinksForm })
    // The open actions linked to the record (a person's also the ones they own).
    for (const t of TABS)
      ui.recordTab(t.type, {
        id: "actions",
        title: "Actions",
        order: t.order,
        count: (recordRef) => openCount(ui, recordRef),
        // A meeting's only on a board meeting: the others show their agreed actions in the meeting itself (M11).
        ...(t.type === "meeting" ? { when: (recordRef: string) => isBoard(ui, recordRef) } : {}),
        component: RecordActions,
      })
  },
})

export default actionsTui
