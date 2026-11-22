// The published views, versioned contracts other plugins join (meetings' minutes and notes, people's follow-ups,
// projects' open-action counts), never the tables: actions.action (the actions) and actions.link (what each one is
// linked to: a record type name and that record's id, `id` giving the order the links were made in).
import type { PluginContext } from "@ttybrain/api"

export function registerViews(ctx: PluginContext): void {
  // No `overdue` column: that depends on "today", which a view can't take; consumers compare due_date with their own.
  // Version 2: project_id, for_person_id and meeting_id became links (actions.link).
  ctx.publish("action", {
    version: 2,
    columns: { id: "integer", title: "text", due_date: "date", status: "text", done_date: "date", owner_id: "integer" },
    query: (db) => db.selectFrom("action").select(["id", "title", "due_date", "status", "done_date", "owner_id"]),
  })
  ctx.publish("link", {
    version: 1,
    columns: { id: "integer", action_id: "integer", record_type: "text", record_id: "integer" },
    query: (db) => db.selectFrom("link").select(["id", "action_id", "record_type", "record_id"]),
  })
}
