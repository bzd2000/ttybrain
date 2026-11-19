// The published views: people.person (with the computed last_contact), people.note and people.goal.
// They are a versioned contract; other plugins join them, never the tables.
import type { PluginContext } from "@ttybrain/api"

export function registerViews(ctx: PluginContext): void {
  ctx.publish("person", {
    version: 1,
    columns: {
      id: "integer",
      handle: "text",
      name: "text",
      organisation: "text",
      job_title: "text",
      email: "text",
      is_team: "boolean",
      is_stakeholder: "boolean",
      influence: "text",
      interest: "text",
      last_contact: "date",
      archived: "boolean",
    },
    query: (db) =>
      db
        .selectFrom("person as p")
        .select([
          "p.id",
          "p.handle",
          "p.name",
          "p.organisation",
          "p.job_title",
          "p.email",
          "p.is_team",
          "p.is_stakeholder",
          "p.influence",
          "p.interest",
          (eb) =>
            eb
              .selectFrom("note")
              .whereRef("note.person_id", "=", "p.id")
              .select((e) => e.fn.max("date").as("d"))
              .as("last_contact"),
          (eb) => eb("p.archived_at", "is not", null).as("archived"),
        ]),
  })

  ctx.publish("note", {
    version: 1,
    columns: { id: "integer", person_id: "integer", project_id: "integer", kind: "text", date: "date", text: "text" },
    query: (db) => db.selectFrom("note").select(["id", "person_id", "project_id", "kind", "date", "text"]),
  })

  ctx.publish("goal", {
    version: 1,
    columns: { id: "integer", person_id: "integer", title: "text", target_date: "date", status: "text" },
    query: (db) => db.selectFrom("goal").select(["id", "person_id", "title", "target_date", "status"]),
  })
}
