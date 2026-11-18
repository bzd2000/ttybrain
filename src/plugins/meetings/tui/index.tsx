// The meetings plugin's tui part: the Meetings screen (slot 5), the meeting record view's Agenda and Prep tabs, and
// the meeting, agenda item and attendees forms.
import { defineTui } from "../../../kernel/tui/api"
import { makeStore } from "../logic/records"
import { AgendaTab } from "./agenda-tab"
import { AgendaItemForm, AttendeesForm, MeetingForm } from "./forms"
import { MeetingsScreen } from "./meetings-screen"
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
    ui.recordForm("meeting", { id: "meeting", label: "Meeting", component: MeetingForm })
    ui.recordForm("meeting", { id: "agenda-item", label: "Agenda item", component: AgendaItemForm })
    ui.recordForm("meeting", { id: "attendees", label: "Attendees", component: AttendeesForm })
  },
})
