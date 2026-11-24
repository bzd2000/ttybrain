// The boards plugin's tui part: the board's crumb (`› BOARD Management board`, the code cyan as a project's), the
// board form (Code, Name, Note) and the board view's Summary tab, first (order 5). The meetings plugin adds the
// view's Meetings and Talk tabs and shows a board under its screen's chip (screen 5, its Boards panel).
import { defineTui } from "@ttybrain/api/tui"
import { BoardForm } from "./board-form"
import { BoardSummary } from "./board-summary"

export const boardsTui = defineTui({
  plugin: "boards",
  activate(ui) {
    ui.recordCrumb("board", { tone: "cyan" })
    ui.recordForm("board", { id: "board", label: "Board", component: BoardForm })
    ui.recordTab("board", { id: "summary", title: "Summary", order: 5, component: BoardSummary })
  },
})

export default boardsTui
