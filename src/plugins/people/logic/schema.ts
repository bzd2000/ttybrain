// The people plugin's tables (design §4 People) and the TypeBox shapes of its records.
import { sql, Type, type PluginContext, type Static } from "@ttybrain/api"

export const LEVELS = ["low", "high"] as const
export const NOTE_KINDS = ["one_on_one", "interaction"] as const
export const GOAL_STATUSES = ["open", "achieved", "dropped"] as const

export const Level = Type.Union([Type.Literal("low"), Type.Literal("high")])
export const NoteKind = Type.Union([Type.Literal("one_on_one"), Type.Literal("interaction")])
export const GoalStatus = Type.Union([Type.Literal("open"), Type.Literal("achieved"), Type.Literal("dropped")])
const Text = Type.String()
const Opt = Type.Union([Text, Type.Null()])

export const PersonRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  handle: Text,
  name: Text,
  organisation: Opt,
  job_title: Opt,
  email: Opt,
  phone: Opt,
  is_team: Type.Boolean(),
  is_stakeholder: Type.Boolean(),
  influence: Type.Union([Level, Type.Null()]),
  interest: Type.Union([Level, Type.Null()]),
  last_contact: Opt,
  archived: Type.Boolean(),
})
export type PersonRecord = Static<typeof PersonRecord>

export const NoteRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  person: Text,
  person_id: Type.Integer(),
  project_id: Type.Union([Type.Integer(), Type.Null()]),
  kind: NoteKind,
  date: Text,
  text: Text,
})
export type NoteRecord = Static<typeof NoteRecord>

export const GoalRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  person: Text,
  person_id: Type.Integer(),
  title: Text,
  target_date: Opt,
  status: GoalStatus,
  notes: Opt,
})
export type GoalRecord = Static<typeof GoalRecord>

const inList = (col: string, xs: readonly string[]) => sql.raw(`${col} in (${xs.map((x) => `'${x}'`).join(", ")})`)

export function registerSchema(ctx: PluginContext): void {
  ctx.migration("001", async (db) => {
    await db.schema
      .createTable("person")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("handle", "text", (c) => c.notNull().unique().check(sql`handle <> '' and handle not glob '*[^a-z0-9-]*'`))
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("organisation", "text")
      .addColumn("job_title", "text")
      .addColumn("email", "text")
      .addColumn("phone", "text")
      .addColumn("is_team", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("is_stakeholder", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("influence", "text", (c) => c.check(inList("influence", LEVELS)))
      .addColumn("interest", "text", (c) => c.check(inList("interest", LEVELS)))
      .addColumn("archived_at", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema
      .createTable("note")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("person_id", "integer", (c) => c.notNull().references("person.id"))
      .addColumn("project_id", "integer") // soft reference to a projects record
      .addColumn("kind", "text", (c) => c.notNull().check(inList("kind", NOTE_KINDS)))
      .addColumn("date", "text", (c) => c.notNull())
      .addColumn("text", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("note_person").on("note").columns(["person_id", "date"]).execute()
    await db.schema
      .createTable("goal")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("person_id", "integer", (c) => c.notNull().references("person.id"))
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("target_date", "text")
      .addColumn("status", "text", (c) => c.notNull().defaultTo("open").check(inList("status", GOAL_STATUSES)))
      .addColumn("notes", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("goal_person").on("goal").column("person_id").execute()
  })
}
