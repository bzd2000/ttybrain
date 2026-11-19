// The projects plugin's tables (design §4 Projects, plugin reference §2) and the TypeBox shapes of its records.
// Migration 001 creates every table, including those whose operations come in later parts of the plugin.
import { sql, Type, type PluginContext, type Static } from "@ttybrain/api"

export const PROJECT_STATUSES = ["active", "on_hold", "closed"] as const
export const HEALTHS = ["green", "amber", "red"] as const
export const DELIVERABLE_STATUSES = ["not_started", "in_progress", "in_review", "delivered"] as const
export const RISK_TYPES = ["risk", "issue"] as const
export const SEVERITIES = ["low", "medium", "high"] as const
export const RISK_STATUSES = ["open", "closed"] as const
export const ACTION_STATUSES = ["open", "done", "cancelled"] as const

export const ProjectStatus = Type.Union([Type.Literal("active"), Type.Literal("on_hold"), Type.Literal("closed")])
export const Health = Type.Union([Type.Literal("green"), Type.Literal("amber"), Type.Literal("red")])
const Text = Type.String()
const Opt = Type.Union([Text, Type.Null()])

export const ProjectRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  code: Text,
  name: Text,
  description: Opt,
  status: ProjectStatus,
  start_date: Opt,
  end_date: Opt,
  effort_estimate_days: Type.Union([Type.Number(), Type.Null()]),
  effort_note: Opt,
  health: Type.Union([Health, Type.Null()]),
  health_comment: Opt,
  health_date: Opt,
  next_milestone_title: Opt,
  next_milestone_due: Opt,
  open_actions: Type.Integer(),
  open_risks: Type.Integer(),
  context_updated_at: Opt,
  archived: Type.Boolean(),
})
export type ProjectRecord = Static<typeof ProjectRecord>

export const InvolvementRecord = Type.Object({
  ref: Text, // the project's
  project: Text,
  person: Text,
  person_id: Type.Integer(),
  name: Text,
  role: Text,
})
export type InvolvementRecord = Static<typeof InvolvementRecord>

export const ContextRecord = Type.Object({ ref: Text, markdown: Opt, updatedAt: Opt })
export type ContextRecord = Static<typeof ContextRecord>

const inList = (col: string, xs: readonly string[]) => sql.raw(`${col} in (${xs.map((x) => `'${x}'`).join(", ")})`)

export function registerSchema(ctx: PluginContext): void {
  ctx.migration("001", async (db) => {
    await db.schema
      .createTable("project")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("code", "text", (c) => c.notNull().unique().check(sql`length(code) between 2 and 8 and code not glob '*[^A-Z0-9]*'`))
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("description", "text")
      .addColumn("context", "text")
      .addColumn("context_updated_at", "text")
      .addColumn("status", "text", (c) => c.notNull().defaultTo("active").check(inList("status", PROJECT_STATUSES)))
      .addColumn("start_date", "text")
      .addColumn("end_date", "text")
      .addColumn("effort_estimate_days", "real")
      .addColumn("effort_note", "text")
      .addColumn("archived_at", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()

    await db.schema
      .createTable("health_update")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("project_id", "integer", (c) => c.notNull().references("project.id"))
      .addColumn("date", "text", (c) => c.notNull())
      .addColumn("health", "text", (c) => c.notNull().check(inList("health", HEALTHS)))
      .addColumn("comment", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("health_update_project").on("health_update").columns(["project_id", "date"]).execute()

    await db.schema
      .createTable("milestone")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("project_id", "integer", (c) => c.notNull().references("project.id"))
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("due_date", "text", (c) => c.notNull())
      .addColumn("done_date", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("milestone_project").on("milestone").columns(["project_id", "due_date"]).execute()

    await db.schema
      .createTable("deliverable")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("project_id", "integer", (c) => c.notNull().references("project.id"))
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("owner_id", "integer") // soft reference to a people person
      .addColumn("due_date", "text")
      .addColumn("status", "text", (c) => c.notNull().defaultTo("not_started").check(inList("status", DELIVERABLE_STATUSES)))
      .addColumn("milestone_id", "integer", (c) => c.references("milestone.id"))
      .addColumn("delivered_date", "text")
      .addColumn("status_changed_at", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("deliverable_project").on("deliverable").column("project_id").execute()

    await db.schema
      .createTable("risk")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("project_id", "integer", (c) => c.notNull().references("project.id"))
      .addColumn("type", "text", (c) => c.notNull().check(inList("type", RISK_TYPES)))
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("description", "text")
      .addColumn("severity", "text", (c) => c.notNull().check(inList("severity", SEVERITIES)))
      .addColumn("owner_id", "integer") // soft reference to a people person
      .addColumn("mitigation", "text")
      .addColumn("status", "text", (c) => c.notNull().defaultTo("open").check(inList("status", RISK_STATUSES)))
      .addColumn("closed_date", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("risk_project").on("risk").columns(["project_id", "status"]).execute()

    await db.schema
      .createTable("decision")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("project_id", "integer", (c) => c.references("project.id")) // optional
      .addColumn("date", "text", (c) => c.notNull())
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("description", "text")
      .addColumn("decided_by", "text") // free text
      .addColumn("meeting_id", "integer") // soft reference to a meetings meeting
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("decision_project").on("decision").columns(["project_id", "date"]).execute()

    await db.schema
      .createTable("action")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("due_date", "text")
      .addColumn("status", "text", (c) => c.notNull().defaultTo("open").check(inList("status", ACTION_STATUSES)))
      .addColumn("done_date", "text")
      .addColumn("owner_id", "integer") // soft reference to a people person; null means you
      .addColumn("project_id", "integer", (c) => c.references("project.id")) // optional
      .addColumn("for_person_id", "integer") // soft reference to a people person
      .addColumn("meeting_id", "integer") // soft reference to a meetings meeting
      .addColumn("notes", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("action_project").on("action").columns(["project_id", "status"]).execute()
    await db.schema.createIndex("action_status").on("action").columns(["status", "due_date"]).execute()

    await db.schema
      .createTable("involvement")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("project_id", "integer", (c) => c.notNull().references("project.id"))
      .addColumn("person_id", "integer", (c) => c.notNull()) // soft reference to a people person
      .addColumn("role", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .addUniqueConstraint("involvement_unique", ["project_id", "person_id", "role"])
      .execute()
    await db.schema.createIndex("involvement_person").on("involvement").column("person_id").execute()
  })
}
