// The published views: meetings.meeting, meetings.agenda_item and meetings.attendee.
// They are a versioned contract; other plugins join them, never the tables.
import type { PluginContext } from "@pm/api"

export function registerViews(ctx: PluginContext): void {
  ctx.publish("meeting", {
    version: 1,
    columns: { id: "integer", title: "text", date: "date", kind: "text", status: "text" },
    query: (db) => db.selectFrom("meeting").select(["id", "title", "date", "kind", "status"]),
  })

  ctx.publish("agenda_item", {
    version: 1,
    columns: { id: "integer", meeting_id: "integer", position: "integer", text: "text", project_id: "integer", ask: "text" },
    query: (db) => db.selectFrom("agenda_item").select(["id", "meeting_id", "position", "text", "project_id", "ask"]),
  })

  ctx.publish("attendee", {
    version: 1,
    columns: { meeting_id: "integer", person_id: "integer" },
    query: (db) => db.selectFrom("attendee").select(["meeting_id", "person_id"]),
  })
}
