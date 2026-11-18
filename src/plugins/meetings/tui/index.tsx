// The meetings plugin's tui part: the Meetings screen (slot 5), the meeting record view's Agenda, Prep, Notes and
// Export tabs, and the meeting, agenda item and attendees forms.
import { defineTui } from "../../../kernel/tui/api"
import { makeStore } from "../logic/records"
import { AgendaTab } from "./agenda-tab"
import { ExportTab } from "./export-tab"
import { AgendaItemForm, AttendeesForm, MeetingForm } from "./forms"
import { MeetingsScreen } from "./meetings-screen"
import { loggedCount, NotesTab } from "./notes-tab"
import { PrepTab } from "./prep-tab"

export const meetingsTui = defineTui({
  plugin: "meetings",
  activate(ui) {
    ui.screen({
      id: "meetings",
      title: "Meetings",
      slot: 5,
      component: MeetingsScreen,
      // The planned meetings.
      count: async () => {
        const row = await ui.data.selectFrom("meeting").select((eb) => eb.fn.countAll().as("n")).where("status", "=", "planned").executeTakeFirstOrThrow()
        return Number(row.n)
      },
    })
    const store = makeStore(ui)
    // The Agenda tab counts the agenda items.
    ui.recordTab("meeting", { id: "agenda", title: "Agenda", order: 10, component: AgendaTab, count: async (ref) => (await store.meeting(ref)).agenda.length })
    ui.recordTab("meeting", { id: "prep", title: "Prep", order: 20, component: PrepTab })
    // The Notes tab counts the actions and decisions logged in the meeting.
    ui.recordTab("meeting", { id: "notes", title: "Notes", order: 30, component: NotesTab, count: (ref) => loggedCount(ui, store, ref) })
    ui.recordTab("meeting", { id: "export", title: "Export", order: 40, component: ExportTab })
    ui.recordForm("meeting", { id: "meeting", label: "Meeting", component: MeetingForm })
    ui.recordForm("meeting", { id: "agenda-item", label: "Agenda item", component: AgendaItemForm })
    ui.recordForm("meeting", { id: "attendees", label: "Attendees", component: AttendeesForm })
  },
})
