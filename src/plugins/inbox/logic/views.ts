// The published view inbox.item (a versioned contract; other plugins join it, never the tables).
import type { PluginContext } from "@pm/api"

export function registerViews(ctx: PluginContext): void {
  ctx.publish("item", {
    version: 1,
    columns: { id: "integer", text: "text", captured_at: "text", status: "text", summary: "text", processed_at: "text", processed_by: "text" },
    query: (db) => db.selectFrom("item").select(["id", "text", "captured_at", "status", "summary", "processed_at", "processed_by"]),
  })
}
