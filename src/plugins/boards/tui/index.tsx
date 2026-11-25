// The boards plugin's tui part: the Boards screen (slot 7; an open board shows its chip), the board's crumb
// (`› BOARD Management board`, the code cyan as a project's), the board form (Code, Name, Note) and the board view's
// Summary tab, first (order 5). The meetings plugin adds the view's Meetings and Talk tabs.
import { defineTui } from "@ttybrain/api/tui"
import { BoardForm } from "./board-form"
import { BoardSummary } from "./board-summary"
import { BoardsScreen } from "./boards-screen"

export const boardsTui = defineTui({
  plugin: "boards",
  activate(ui) {
    ui.screen({
      id: "boards",
      title: "Boards",
      slot: 7,
      component: BoardsScreen,
      records: ["board"],
      // The boards that are not archived.
      count: async () => {
        const row = await ui.data.selectFrom("board").select((eb) => eb.fn.countAll().as("n")).where("archived_at", "is", null).executeTakeFirstOrThrow()
        return Number(row.n)
      },
    })
    ui.recordCrumb("board", { tone: "cyan" })
    ui.recordForm("board", { id: "board", label: "Board", component: BoardForm })
    ui.recordTab("board", { id: "summary", title: "Summary", order: 5, component: BoardSummary })
  },
})

export default boardsTui
