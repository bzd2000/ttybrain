// The published views: meetings.meeting, meetings.agenda_item, meetings.attendee, meetings.series and meetings.talk_item.
// They are a versioned contract; other plugins join them, never the tables.
import type { PluginContext } from "@ttybrain/api"

export function registerViews(ctx: PluginContext): void {
  // v2: kinds are one_on_one, project and board; the subject (a person or project id) and the series.
  ctx.publish("meeting", {
    version: 2,
    columns: { id: "integer", title: "text", date: "date", kind: "text", status: "text", subject_type: "text", subject_id: "integer", series_id: "integer" },
    query: (db) => db.selectFrom("meeting").select(["id", "title", "date", "kind", "status", "subject_type", "subject_id", "series_id"]),
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

  ctx.publish("series", {
    version: 1,
    columns: { id: "integer", subject_type: "text", subject_id: "integer", title: "text", kind: "text", rhythm: "text", first_date: "date", end_date: "date" },
    query: (db) => db.selectFrom("series").select(["id", "subject_type", "subject_id", "title", "kind", "rhythm", "first_date", "end_date"]),
  })

  ctx.publish("talk_item", {
    version: 1,
    columns: {
      id: "integer",
      subject_type: "text",
      subject_id: "integer",
      text: "text",
      project_id: "integer",
      added_date: "date",
      position: "integer",
      status: "text",
      meeting_id: "integer",
      status_date: "date",
    },
    query: (db) =>
      db.selectFrom("talk_item").select(["id", "subject_type", "subject_id", "text", "project_id", "added_date", "position", "status", "meeting_id", "status_date"]),
  })
}
