// The meetings plugin's tui part: the Meetings screen (slot 5) and the meeting, agenda item and attendees forms.
// MeetingForm is registered first, so opening a meeting without record tabs falls back to it.
import { defineTui } from "../../../kernel/tui/api"
import { AgendaItemForm, AttendeesForm, MeetingForm } from "./forms"
import { MeetingsScreen } from "./meetings-screen"

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
    ui.recordForm("meeting", { id: "meeting", label: "Meeting", component: MeetingForm })
    ui.recordForm("meeting", { id: "agenda-item", label: "Agenda item", component: AgendaItemForm })
    ui.recordForm("meeting", { id: "attendees", label: "Attendees", component: AttendeesForm })
  },
})
