// A board's view (design §5.7, plan ruling B4; no mock draws it): a record view of the type `board`, opened from
// screen 5's Boards panel or any `#CODE` of a board, under screen 5's chip, its crumb `› BOARD Management board`
// with the code cyan as a project's. Two tabs without counts, laid out as a project's:
// - Meetings: a panel per series (`Board · monthly, last Fri`: Next, With, "To talk about · n" and the board's
//   talk-list), then "Past meetings"; no Prep (a board has no status of its own), so on the right "Your actions for
//   BOARD" (owner me, linked to the board or one of its meetings), as a person's Meetings tab has.
// - Talk: the board's talk-list, as a project's Talk tab (a board's items take no project tag, so it has no
//   Project/From column).
// Keys as on those tabs: t to talk (also the record key on every tab), N a series, n a one-off meeting, Enter open,
// Esc back. A board meeting opened from here shows its crumb under the board's (index.tsx, `under`).
import type { TuiContext } from "@ttybrain/api/tui"
import { SubjectTalk } from "./person-talk"
import { SubjectMeetings } from "./project-meetings"

export const BoardMeetings = SubjectMeetings
export const BoardTalk = SubjectTalk

export function registerBoardView(ui: TuiContext): void {
  ui.recordCrumb("board", { tone: "cyan" })
  ui.recordTab("board", { id: "meetings", title: "Meetings", order: 10, component: BoardMeetings })
  ui.recordTab("board", { id: "talk", title: "Talk", order: 20, component: BoardTalk })
}
