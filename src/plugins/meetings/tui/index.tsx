// The meetings plugin's tui part: the Meetings screen (slot 5), the Attention panel "Upcoming meetings · next 7 days",
// the meeting record view's Agenda, Prep, Notes and Export tabs, the meeting, agenda item, attendees and move forms,
// the new recurring meeting form (record type `series`) and the talk-item form (record type `talk_item`).
import { dayDate, defineTui } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import { AgendaTab } from "./agenda-tab"
import { ExportTab } from "./export-tab"
import { AgendaItemForm, AttendeesForm, MeetingForm, MoveForm, TalkForm } from "./forms"
import { MeetingsScreen } from "./meetings-screen"
import { registerPanels } from "./panels"
import { SERIES_TITLE, SeriesForm } from "./series-form"
import { NotesTab } from "./notes-tab"
import { PrepTab } from "./prep-tab"

export const meetingsTui = defineTui({
  plugin: "meetings",
  activate(ui) {
    ui.screen({
      id: "meetings",
      title: "Meetings",
      slot: 5,
      component: MeetingsScreen,
      records: ["meeting"],
      // The planned meetings.
      count: async () => {
        const row = await ui.data.selectFrom("meeting").select((eb) => eb.fn.countAll().as("n")).where("status", "=", "planned").executeTakeFirstOrThrow()
        return Number(row.n)
      },
    })
    const store = makeStore(ui)
    // The header crumb's muted tail: `Fri 4 Dec · 8 attendees`.
    ui.recordCrumb("meeting", {
      detail: async (ref) => {
        const m = await store.meeting(ref)
        const n = m.attendees.length
        return `${dayDate(m.date)} · ${n} attendee${n === 1 ? "" : "s"}`
      },
    })
    // The tabs, without counts (as the design draws them).
    ui.recordTab("meeting", { id: "agenda", title: "Agenda", order: 10, component: AgendaTab })
    ui.recordTab("meeting", { id: "prep", title: "Prep", order: 20, component: PrepTab })
    ui.recordTab("meeting", { id: "notes", title: "Notes", order: 30, component: NotesTab })
    ui.recordTab("meeting", { id: "export", title: "Export", order: 40, component: ExportTab })
    ui.recordForm("meeting", { id: "meeting", label: "Meeting", component: MeetingForm })
    ui.recordForm("meeting", { id: "agenda-item", label: "Agenda item", component: AgendaItemForm })
    ui.recordForm("meeting", { id: "attendees", label: "Attendees", component: AttendeesForm })
    ui.recordForm("meeting", { id: "move", label: "Move date", component: MoveForm })
    ui.recordForm("series", { id: "series", label: SERIES_TITLE, component: SeriesForm })
    ui.recordForm("talk_item", { id: "talk", label: "Talk item", component: TalkForm })
    registerPanels(ui)
  },
})

export default meetingsTui
