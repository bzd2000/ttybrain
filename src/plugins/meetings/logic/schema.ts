// The meetings plugin's tables (plugin reference §3) and the TypeBox shapes of its records.
import { sql, Type, type PluginContext, type Static } from "@pm/api"

export const MEETING_KINDS = ["board", "steering", "other"] as const
export const MEETING_STATUSES = ["planned", "held", "cancelled"] as const

export const MeetingKind = Type.Union([Type.Literal("board"), Type.Literal("steering"), Type.Literal("other")])
export const MeetingStatus = Type.Union([Type.Literal("planned"), Type.Literal("held"), Type.Literal("cancelled")])
const Text = Type.String()
const Opt = Type.Union([Text, Type.Null()])

export const AgendaItem = Type.Object({
  position: Type.Integer(),
  text: Text,
  project: Opt, // #CODE
  project_id: Type.Union([Type.Integer(), Type.Null()]),
  ask: Opt,
})
export type AgendaItem = Static<typeof AgendaItem>

export const MeetingRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  title: Text,
  date: Text,
  kind: MeetingKind,
  status: MeetingStatus,
  since_date: Opt,
  notes: Text,
  attendees: Type.Array(Text), // @handles, by name
  agenda: Type.Array(AgendaItem),
})
export type MeetingRecord = Static<typeof MeetingRecord>

const inList = (col: string, xs: readonly string[]) => sql.raw(`${col} in (${xs.map((x) => `'${x}'`).join(", ")})`)

export function registerSchema(ctx: PluginContext): void {
  ctx.migration("001", async (db) => {
    await db.schema
      .createTable("meeting")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("date", "text", (c) => c.notNull())
      .addColumn("kind", "text", (c) => c.notNull().check(inList("kind", MEETING_KINDS)))
      .addColumn("status", "text", (c) => c.notNull().defaultTo("planned").check(inList("status", MEETING_STATUSES)))
      .addColumn("since_date", "text")
      .addColumn("notes", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("meeting_date").on("meeting").column("date").execute()
    await db.schema
      .createTable("attendee")
      .addColumn("meeting_id", "integer", (c) => c.notNull().references("meeting.id").onDelete("cascade"))
      .addColumn("person_id", "integer", (c) => c.notNull()) // soft reference to a people record
      .addPrimaryKeyConstraint("attendee_pk", ["meeting_id", "person_id"])
      .execute()
    await db.schema
      .createTable("agenda_item")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("meeting_id", "integer", (c) => c.notNull().references("meeting.id").onDelete("cascade"))
      .addColumn("position", "integer", (c) => c.notNull())
      .addColumn("text", "text", (c) => c.notNull())
      .addColumn("project_id", "integer") // soft reference to a projects record
      .addColumn("ask", "text")
      .addUniqueConstraint("agenda_item_position", ["meeting_id", "position"])
      .execute()
  })
}
