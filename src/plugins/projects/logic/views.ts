// The published views: projects.project (with the computed health and next-milestone columns),
// projects.health_update and projects.involvement. They are a versioned contract; other plugins join them,
// never the tables. View queries take no bound parameters, so constants are literals (eb.lit / sql.lit).
import { sql, type ExpressionBuilder, type Kysely, type PluginContext } from "../../../kernel/api"

// A project's columns as the view publishes them, over the plugin's own tables. The store extends it with the
// columns that are not published (effort_note, context_updated_at), so records and the view never drift apart.
// Subqueries are built from the select callback's `eb` (not from `db`), so they share the outer query's scope and
// may reference its alias `p`.
export function projectQuery(db: Kysely<any>) {
  type Eb = ExpressionBuilder<any, any>
  const latestHealth = (eb: Eb, column: string, as: string) =>
    eb
      .selectFrom("health_update as h")
      .select(`h.${column}`)
      .whereRef("h.project_id", "=", "p.id")
      .orderBy("h.date", "desc")
      .orderBy("h.id", "desc")
      .limit(sql.lit(1))
      .as(as)
  const nextMilestone = (eb: Eb, column: string, as: string) =>
    eb
      .selectFrom("milestone as m")
      .select(`m.${column}`)
      .whereRef("m.project_id", "=", "p.id")
      .where("m.done_date", "is", null)
      .orderBy("m.due_date")
      .orderBy("m.id")
      .limit(sql.lit(1))
      .as(as)
  const openCount = (eb: Eb, table: "action" | "risk", as: string) =>
    eb
      .selectFrom(`${table} as x`)
      .select((e) => e.fn.countAll().as("n"))
      .whereRef("x.project_id", "=", "p.id")
      .where("x.status", "=", sql.lit("open"))
      .as(as)
  return db
    .selectFrom("project as p")
    .select([
      "p.id",
      "p.code",
      "p.name",
      "p.description",
      "p.status",
      "p.start_date",
      "p.end_date",
      "p.effort_estimate_days",
      (eb) => latestHealth(eb, "health", "health"),
      (eb) => latestHealth(eb, "comment", "health_comment"),
      (eb) => latestHealth(eb, "date", "health_date"),
      (eb) => nextMilestone(eb, "title", "next_milestone_title"),
      (eb) => nextMilestone(eb, "due_date", "next_milestone_due"),
      (eb) => openCount(eb, "action", "open_actions"),
      (eb) => openCount(eb, "risk", "open_risks"),
      (eb) => eb("p.archived_at", "is not", null).as("archived"),
    ])
}

export function registerViews(ctx: PluginContext): void {
  ctx.publish("project", {
    version: 1,
    columns: {
      id: "integer",
      code: "text",
      name: "text",
      description: "text",
      status: "text",
      start_date: "date",
      end_date: "date",
      effort_estimate_days: "real",
      health: "text",
      health_comment: "text",
      health_date: "date",
      next_milestone_title: "text",
      next_milestone_due: "date",
      open_actions: "integer",
      open_risks: "integer",
      archived: "boolean",
    },
    query: projectQuery,
  })

  ctx.publish("health_update", {
    version: 1,
    columns: { id: "integer", project_id: "integer", date: "date", health: "text", comment: "text" },
    query: (db) => db.selectFrom("health_update").select(["id", "project_id", "date", "health", "comment"]),
  })

  ctx.publish("involvement", {
    version: 1,
    columns: { project_id: "integer", person_id: "integer", role: "text" },
    query: (db) => db.selectFrom("involvement").select(["project_id", "person_id", "role"]),
  })
}
