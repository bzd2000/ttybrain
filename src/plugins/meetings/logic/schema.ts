// The meetings plugin's tables (plugin reference §3) and the TypeBox shapes of its records.
// 001: meeting, attendee, agenda_item. 002 (the meetings rework, design §5.1–5.2): every meeting may have a subject
// (a person or a project) and belong to a recurring `series`; kinds become one_on_one, project and board; the
// children no longer cascade (rule 6), so the meetings plugin deletes them itself.
import { sql, Type, type Kysely, type PluginContext, type Static } from "@ttybrain/api"

export const MEETING_KINDS = ["one_on_one", "project", "board"] as const
export const MEETING_STATUSES = ["planned", "held", "cancelled"] as const
export const SUBJECT_TYPES = ["person", "project"] as const
// Kinds as given (CLI, operations): `steering` and `other`, the kinds before 002, are aliases of `project`.
export const KIND_INPUTS = [...MEETING_KINDS, "steering", "other"] as const
// How a kind reads on screen.
export const KIND_LABELS: Record<(typeof MEETING_KINDS)[number], string> = { one_on_one: "1:1", project: "project", board: "board" }

export const MeetingKind = Type.Union([Type.Literal("one_on_one"), Type.Literal("project"), Type.Literal("board")])
export const KindInput = Type.Union(KIND_INPUTS.map((k) => Type.Literal(k)))
export const MeetingStatus = Type.Union([Type.Literal("planned"), Type.Literal("held"), Type.Literal("cancelled")])
export type MeetingKind = Static<typeof MeetingKind>
export type SubjectType = (typeof SUBJECT_TYPES)[number]
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
  about: Opt, // the subject: @handle or #CODE (`person:<id>` when it no longer resolves); null before one is given
  series: Opt, // S-n, for an occurrence of a series
})
export type MeetingRecord = Static<typeof MeetingRecord>

export const SeriesRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  title: Text,
  kind: MeetingKind,
  about: Text,
  rhythm: Text, // the canonical phrase: `every 2 weeks on wed`
  first_date: Text,
  end_date: Opt,
  attendees: Type.Array(Text), // @handles, by name
  next: Opt, // the next planned occurrence from today
})
export type SeriesRecord = Static<typeof SeriesRecord>

const inList = (col: string, xs: readonly string[]) => sql.raw(`${col} in (${xs.map((x) => `'${x}'`).join(", ")})`)

// 001 as meetings 1.0.0 shipped it (kept as is: applied databases have it; the upgrade test builds one with it).
export async function migration001(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("meeting")
    .addColumn("id", "integer", (c) => c.primaryKey())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("date", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull().check(inList("kind", ["board", "steering", "other"])))
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
}

const MEETING_COLUMNS = ["id", "title", "date", "kind", "status", "since_date", "notes", "created_at", "updated_at"] as const
const ATTENDEE_COLUMNS = ["meeting_id", "person_id"] as const
const AGENDA_COLUMNS = ["id", "meeting_id", "position", "text", "project_id", "ask"] as const

// Subjects, kinds and series. `attendee` and `agenda_item` referenced `meeting` with ON DELETE CASCADE, which a drop
// of `meeting` would fire, so they are kept in copies and dropped first; then `meeting` is rebuilt (copy, drop,
// create, copy back with named columns, kinds remapped: board stays, steering and other become project), and the
// children are recreated without an ON DELETE action and copied back. `meeting.id` is AUTOINCREMENT from here on, so
// the id of a deleted occurrence is never given again (the copy back sets the counter to the highest id). Existing
// meetings get no subject and never close themselves (auto_close 0). Foreign keys are checked at the migration's commit.
async function migration002(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("series")
    .addColumn("id", "integer", (c) => c.primaryKey())
    .addColumn("subject_type", "text", (c) => c.notNull().check(inList("subject_type", SUBJECT_TYPES)))
    .addColumn("subject_id", "integer", (c) => c.notNull()) // soft reference to a people person or a projects project
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull().check(inList("kind", MEETING_KINDS)))
    .addColumn("rhythm", "text", (c) => c.notNull()) // the canonical phrase (rhythm.ts)
    .addColumn("first_date", "text", (c) => c.notNull())
    .addColumn("end_date", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute()
  await db.schema
    .createTable("series_attendee")
    .addColumn("series_id", "integer", (c) => c.notNull().references("series.id"))
    .addColumn("person_id", "integer", (c) => c.notNull()) // soft reference to a people person
    .addPrimaryKeyConstraint("series_attendee_pk", ["series_id", "person_id"])
    .execute()

  await db.schema.createTable("attendee_copy").addColumn("meeting_id", "integer").addColumn("person_id", "integer").execute()
  await db.insertInto("attendee_copy").columns([...ATTENDEE_COLUMNS]).expression(db.selectFrom("attendee").select([...ATTENDEE_COLUMNS])).execute()
  await db.schema
    .createTable("agenda_item_copy")
    .addColumn("id", "integer")
    .addColumn("meeting_id", "integer")
    .addColumn("position", "integer")
    .addColumn("text", "text")
    .addColumn("project_id", "integer")
    .addColumn("ask", "text")
    .execute()
  await db.insertInto("agenda_item_copy").columns([...AGENDA_COLUMNS]).expression(db.selectFrom("agenda_item").select([...AGENDA_COLUMNS])).execute()
  await db.schema.dropTable("attendee").execute()
  await db.schema.dropTable("agenda_item").execute()

  let copy = db.schema.createTable("meeting_copy")
  for (const c of MEETING_COLUMNS) copy = copy.addColumn(c, c === "id" ? "integer" : "text")
  await copy.execute()
  await db.insertInto("meeting_copy").columns([...MEETING_COLUMNS]).expression(db.selectFrom("meeting").select([...MEETING_COLUMNS])).execute()
  await db.updateTable("meeting_copy").set({ kind: "project" }).where("kind", "in", ["steering", "other"]).execute()
  await db.schema.dropTable("meeting").execute()
  await db.schema
    .createTable("meeting")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement()) // ids are never reused: refs, provenance, change sets and drafts keep meaning one meeting
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("date", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull().check(inList("kind", MEETING_KINDS)))
    .addColumn("status", "text", (c) => c.notNull().defaultTo("planned").check(inList("status", MEETING_STATUSES)))
    .addColumn("since_date", "text")
    .addColumn("notes", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("subject_type", "text", (c) => c.check(inList("subject_type", SUBJECT_TYPES))) // null: no subject yet
    .addColumn("subject_id", "integer") // soft reference to a people person or a projects project
    .addColumn("series_id", "integer", (c) => c.references("series.id")) // null: a one-off meeting
    .addColumn("series_date", "text") // the series date it was made for; kept when the meeting is moved
    .addColumn("auto_close", "integer", (c) => c.notNull().defaultTo(0)) // 1: closes itself 3 days after its date
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addUniqueConstraint("meeting_series_date", ["series_id", "series_date"])
    .execute()
  await db.insertInto("meeting").columns([...MEETING_COLUMNS]).expression(db.selectFrom("meeting_copy").select([...MEETING_COLUMNS])).execute()
  await db.schema.dropTable("meeting_copy").execute()
  await db.schema.createIndex("meeting_date").on("meeting").column("date").execute()
  await db.schema.createIndex("meeting_subject").on("meeting").columns(["subject_type", "subject_id"]).execute()

  await db.schema
    .createTable("attendee")
    .addColumn("meeting_id", "integer", (c) => c.notNull().references("meeting.id"))
    .addColumn("person_id", "integer", (c) => c.notNull()) // soft reference to a people person
    .addPrimaryKeyConstraint("attendee_pk", ["meeting_id", "person_id"])
    .execute()
  await db.insertInto("attendee").columns([...ATTENDEE_COLUMNS]).expression(db.selectFrom("attendee_copy").select([...ATTENDEE_COLUMNS])).execute()
  await db.schema.dropTable("attendee_copy").execute()
  await db.schema
    .createTable("agenda_item")
    .addColumn("id", "integer", (c) => c.primaryKey())
    .addColumn("meeting_id", "integer", (c) => c.notNull().references("meeting.id"))
    .addColumn("position", "integer", (c) => c.notNull())
    .addColumn("text", "text", (c) => c.notNull())
    .addColumn("project_id", "integer") // soft reference to a projects project
    .addColumn("ask", "text")
    .addUniqueConstraint("agenda_item_position", ["meeting_id", "position"])
    .execute()
  await db.insertInto("agenda_item").columns([...AGENDA_COLUMNS]).expression(db.selectFrom("agenda_item_copy").select([...AGENDA_COLUMNS])).execute()
  await db.schema.dropTable("agenda_item_copy").execute()
}

export function registerSchema(ctx: PluginContext): void {
  ctx.migration("001", migration001)
  ctx.migration("002", migration002)
}
