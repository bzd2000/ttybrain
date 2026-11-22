// The published view actions.action: a versioned contract other plugins join (meetings' minutes and notes, people's
// follow-ups, projects' open-action counts), never the table.
import type { PluginContext } from "@ttybrain/api"

export function registerViews(ctx: PluginContext): void {
  // No `overdue` column: that depends on "today", which a view can't take; consumers compare due_date with their own.
  ctx.publish("action", {
    version: 1,
    columns: {
      id: "integer",
      title: "text",
      due_date: "date",
      status: "text",
      done_date: "date",
      owner_id: "integer",
      project_id: "integer",
      for_person_id: "integer",
      meeting_id: "integer",
    },
    query: (db) =>
      db.selectFrom("action").select(["id", "title", "due_date", "status", "done_date", "owner_id", "project_id", "for_person_id", "meeting_id"]),
  })
}
