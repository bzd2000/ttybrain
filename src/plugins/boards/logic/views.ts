// The published view boards.board: a versioned contract other plugins join, never the table. Meetings shows a board
// subject's code through it, and projects keeps its codes apart from these.
import type { PluginContext } from "@ttybrain/api"

export function registerViews(ctx: PluginContext): void {
  // v1 (design §5.7): the columns meetings.board v1 had.
  ctx.publish("board", {
    version: 1,
    columns: { id: "integer", code: "text", name: "text", archived_at: "text" },
    query: (db) => db.selectFrom("board").select(["id", "code", "name", "archived_at"]),
  })
}
