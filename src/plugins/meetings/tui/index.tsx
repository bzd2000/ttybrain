// The meetings plugin's tui part: the Meetings screen (slot 5), the Attention panel "Upcoming meetings · next 7 days",
// a 1:1 or project meeting's in-progress view (its only view, ruling M11) and a board meeting's Agenda, Prep, Notes
// and Export tabs, a person's Talk (order 12) and Meetings (15) tabs, a project's Meetings (72) and Talk (75) tabs,
// the meeting, agenda item, attendees and move forms, the new recurring meeting form (record type `series`), the
// talk-item form (record type `talk_item`) and quick capture's route to a talk-list (`talk @anna …`).
import { dayDate, defineTui } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import { AgendaTab } from "./agenda-tab"
import { ExportTab } from "./export-tab"
import { AgendaItemForm, AttendeesForm, MeetingForm, MoveForm } from "./forms"
import { TalkForm } from "./talk-form"
import { MeetingsScreen } from "./meetings-screen"
import { registerPanels } from "./panels"
import { SERIES_TITLE, SeriesForm } from "./series-form"
import { NotesTab } from "./notes-tab"
import { PrepTab } from "./prep-tab"
import { MeetingView, statusTail } from "./meeting-view"
import { PersonMeetings } from "./person-meetings"
import { PersonTalk } from "./person-talk"
import { ProjectMeetings } from "./project-meetings"
import { ProjectTalk } from "./project-talk"
import { meetingName } from "./subject"
import { registerTalkCapture } from "./talk-capture"

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
    // The header crumb's muted tail: `Fri 4 Dec · 8 attendees` (`Mon 9 Nov · held · 2 attendees` once it is not planned). Opened from what it is about (a person's or project's
    // view): `› Anna Peeters › 1:1 Mon 23 Nov`, `› BOARD Management board › Board Fri 27 Nov`.
    const same = async (a: string, b: string) => {
      const [x, y] = await Promise.all([ui.records.resolve(a), ui.records.resolve(b)])
      return x !== null && y !== null && x.type === y.type && x.id === y.id
    }
    ui.recordCrumb("meeting", {
      detail: async (ref) => {
        const m = await store.meeting(ref)
        const n = m.attendees.length
        return `${dayDate(m.date)}${statusTail(m.status)} · ${n} attendee${n === 1 ? "" : "s"}`
      },
      under: async (ref, parent) => {
        const m = await store.meeting(ref)
        return m.about !== null && (await same(m.about, parent)) ? `${meetingName(m)} ${dayDate(m.date)}${statusTail(m.status)}` : null
      },
    })
    const isBoard = async (ref: string) => (await store.meeting(ref)).kind === "board"
    const notBoard = async (ref: string) => !(await isBoard(ref))
    // A 1:1 or project meeting: the meeting in progress, alone (no tab row). A board meeting: its tabs, without
    // counts (as the designs draw them).
    ui.recordTab("meeting", { id: "meeting", title: "Meeting", order: 5, bare: true, when: notBoard, component: MeetingView })
    ui.recordTab("meeting", { id: "agenda", title: "Agenda", order: 10, when: isBoard, component: AgendaTab })
    ui.recordTab("meeting", { id: "prep", title: "Prep", order: 20, when: isBoard, component: PrepTab })
    ui.recordTab("meeting", { id: "notes", title: "Notes", order: 30, when: isBoard, component: NotesTab })
    ui.recordTab("meeting", { id: "export", title: "Export", order: 40, when: isBoard, component: ExportTab })
    // A person's and a project's: Talk counts the open items (not the carried ones), Meetings has no count.
    const open = async (ref: string) => ((await ui.self().read.talkList!({ about: ref })) as { open: unknown[] }).open.length
    ui.recordTab("person", { id: "talk", title: "Talk", order: 12, count: open, component: PersonTalk })
    ui.recordTab("person", { id: "meetings", title: "Meetings", order: 15, component: PersonMeetings })
    ui.recordTab("project", { id: "meetings", title: "Meetings", order: 72, component: ProjectMeetings })
    ui.recordTab("project", { id: "talk", title: "Talk", order: 75, count: open, component: ProjectTalk })
    // M9: `t` on any tab of a person or project adds to its talk-list (the talk form, the subject filled in).
    for (const type of ["person", "project"])
      ui.recordKey(type, {
        key: "t",
        label: "to talk",
        run: async (ref, { overlay }) => {
          const found = await ui.records.resolve(ref)
          if (!found) return
          const about = await ui.records.refOf(found.type, found.id)
          await overlay.openForm("talk_item", "talk", { prefill: { about }, draftFor: about })
        },
      })
    ui.recordForm("meeting", { id: "meeting", label: "Meeting", component: MeetingForm })
    ui.recordForm("meeting", { id: "agenda-item", label: "Agenda item", component: AgendaItemForm })
    ui.recordForm("meeting", { id: "attendees", label: "Attendees", component: AttendeesForm })
    ui.recordForm("meeting", { id: "move", label: "Move date", component: MoveForm })
    ui.recordForm("series", { id: "series", label: SERIES_TITLE, component: SeriesForm })
    ui.recordForm("talk_item", { id: "talk", label: "Talk item", component: TalkForm })
    registerPanels(ui)
    registerTalkCapture(ui)
  },
})

export default meetingsTui
