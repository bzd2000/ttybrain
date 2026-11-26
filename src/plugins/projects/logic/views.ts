// The published views: projects.project (with the computed health and next-milestone columns),
// projects.health_update, projects.involvement and one per item table (milestone, deliverable, risk, decision).
// They are a versioned contract; other plugins join them, never the tables. projects.project version 2 has no
// open_actions: actions are the actions plugin's (actions.action). View queries take no bound parameters, so
// constants are literals (eb.lit / sql.lit).
import { sql, type ExpressionBuilder, type Kysely, type PluginContext } from "@ttybrain/api"

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
  const openCount = (eb: Eb, table: "risk", as: string) =>
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
      (eb) => openCount(eb, "risk", "open_risks"),
      (eb) => eb("p.archived_at", "is not", null).as("archived"),
    ])
}

export function registerViews(ctx: PluginContext): void {
  ctx.publish("project", {
    version: 2,
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

  // `late` uses SQLite's own date('now'): a view takes no injected clock. It is a display convenience; logic that
  // needs "today" (reports, tests) compares due_date with the context's today itself.
  ctx.publish("milestone", {
    version: 1,
    columns: { id: "integer", project_id: "integer", title: "text", due_date: "date", done_date: "date", late: "boolean" },
    query: (db) =>
      db
        .selectFrom("milestone as m")
        .select([
          "m.id",
          "m.project_id",
          "m.title",
          "m.due_date",
          "m.done_date",
          (eb) => eb.and([eb("m.done_date", "is", null), eb("m.due_date", "<", sql<string>`date('now')`)]).as("late"),
        ]),
  })

  ctx.publish("deliverable", {
    version: 1,
    columns: {
      id: "integer",
      project_id: "integer",
      title: "text",
      owner_id: "integer", // a person; null for me and for no owner
      owner_me: "boolean", // 1: owned by me (added in 2.1, compatible)
      due_date: "date",
      status: "text",
      status_changed_at: "text",
      milestone_id: "integer",
    },
    query: (db) =>
      db.selectFrom("deliverable").select(["id", "project_id", "title", "owner_id", "owner_me", "due_date", "status", "status_changed_at", "milestone_id"]),
  })

  ctx.publish("risk", {
    version: 1,
    columns: { id: "integer", project_id: "integer", type: "text", title: "text", severity: "text", owner_id: "integer", owner_me: "boolean", status: "text", closed_date: "date" },
    query: (db) => db.selectFrom("risk").select(["id", "project_id", "type", "title", "severity", "owner_id", "owner_me", "status", "closed_date"]),
  })

  ctx.publish("decision", {
    version: 1,
    columns: { id: "integer", project_id: "integer", date: "date", title: "text", decided_by: "text", meeting_id: "integer" },
    query: (db) => db.selectFrom("decision").select(["id", "project_id", "date", "title", "decided_by", "meeting_id"]),
  })
}
