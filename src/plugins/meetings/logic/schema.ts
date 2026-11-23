// The meetings plugin's tables (plugin reference §3) and the TypeBox shapes of its records.
// 001: meeting, attendee, agenda_item. 002 (the meetings rework, design §5.1–5.2): every meeting may have a subject
// (a person or a project) and belong to a recurring `series`; kinds become one_on_one, project and board; the
// children no longer cascade (rule 6), so the meetings plugin deletes them itself. 003 (design §5.3): talk items, the
// things to raise with a person or about a project. 004 (design §5.3): the talk items a meeting kept open for next time
// when it was closed, so a held meeting still shows what it covered. 005: whether a held meeting closed itself (the
// `auto-close` upkeep), so closing it again can say so. 006 (design §5.7): boards, and `board` as a subject type of
// meetings, series and talk items.
import { sql, Type, type Kysely, type PluginContext, type Static } from "@ttybrain/api"

export const MEETING_KINDS = ["one_on_one", "project", "board"] as const
export const MEETING_STATUSES = ["planned", "held", "cancelled"] as const
export const SUBJECT_TYPES = ["person", "project", "board"] as const
// The subject types before 006 (the CHECKs of 002 and 003).
const SUBJECT_TYPES_002 = ["person", "project"] as const
export const TALK_STATUSES = ["open", "discussed", "dropped"] as const
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
  about: Opt, // the subject: @handle or #CODE (`—` once it is gone, `person:<id>` while no plugin registers the type); null before one is given
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

export const TalkStatus = Type.Union([Type.Literal("open"), Type.Literal("discussed"), Type.Literal("dropped")])
export const TalkRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  about: Text, // the subject: @handle or #CODE; `person:<id>` while its plugin is not loaded, `—` once it is gone
  text: Text,
  project: Opt, // the project tag: #CODE (`—` once it is gone), null for none
  added_date: Text,
  // While open: its rank in its group on the subject's list (the open items 1..k, the carried ones 1..c); null otherwise.
  position: Type.Union([Type.Integer(), Type.Null()]),
  carried: Type.Boolean(), // open, and added before the subject's last held meeting
  status: TalkStatus,
  meeting: Opt, // M-n it was discussed in
})
export type TalkRecord = Static<typeof TalkRecord>

// A board (design §5.7): its code (`#MB`), name and optional note. An archived one takes no new meetings, series or
// talk items until it is restored.
export const BoardRecord = Type.Object({
  ref: Text, // #CODE
  id: Type.Integer(),
  code: Text,
  name: Text,
  note: Opt,
  archived: Type.Boolean(),
})
export type BoardRecord = Static<typeof BoardRecord>

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
    .addColumn("subject_type", "text", (c) => c.notNull().check(inList("subject_type", SUBJECT_TYPES_002)))
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
    .addColumn("subject_type", "text", (c) => c.check(inList("subject_type", SUBJECT_TYPES_002))) // null: no subject yet
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

// Talk items. `id` is AUTOINCREMENT, like `meeting`'s: an id is never given again. `position` is the item's place on
// its subject's list while it is open (1..n, unique per subject; the open and carried groups share it), null once
// discussed or dropped; `last_position` keeps the place it had then, so reopening puts it back there. `meeting_id` is the
// meeting it was discussed in (no ON DELETE action, rule 6; meetings deletes only occurrences that hold nothing).
async function migration003(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("talk_item")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("subject_type", "text", (c) => c.notNull().check(inList("subject_type", SUBJECT_TYPES_002)))
    .addColumn("subject_id", "integer", (c) => c.notNull()) // soft reference to a people person or a projects project
    .addColumn("text", "text", (c) => c.notNull())
    .addColumn("project_id", "integer") // soft reference to a projects project: the tag
    .addColumn("added_date", "text", (c) => c.notNull())
    .addColumn("position", "integer")
    .addColumn("last_position", "integer") // the position it had when it was discussed or dropped
    .addColumn("status", "text", (c) => c.notNull().defaultTo("open").check(inList("status", TALK_STATUSES)))
    .addColumn("meeting_id", "integer", (c) => c.references("meeting.id"))
    .addColumn("status_date", "text") // the day it was discussed or dropped
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .addUniqueConstraint("talk_item_position", ["subject_type", "subject_id", "position"])
    .execute()
  await db.schema.createIndex("talk_item_project").on("talk_item").columns(["project_id", "status"]).execute()
  await db.schema.createIndex("talk_item_meeting").on("talk_item").column("meeting_id").execute()
}

// The talk items that were on a meeting's agenda and still open when it was closed (kept for next time), in agenda
// order. What was discussed in it is on the item itself (`talk_item.meeting_id`). No ON DELETE actions (rule 6); only
// held meetings have rows, and held meetings are never deleted.
async function migration004(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("talk_kept")
    .addColumn("meeting_id", "integer", (c) => c.notNull().references("meeting.id"))
    .addColumn("talk_id", "integer", (c) => c.notNull().references("talk_item.id"))
    .addColumn("position", "integer", (c) => c.notNull()) // its place on the agenda at close
    .addPrimaryKeyConstraint("talk_kept_pk", ["meeting_id", "talk_id"])
    .execute()
}

// `closed_itself` 1: the meeting was closed by the `auto-close` upkeep (0 for every meeting closed before, and for
// one closed by hand).
async function migration005(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("meeting").addColumn("closed_itself", "integer", (c) => c.notNull().defaultTo(0)).execute()
}

const SERIES_COLUMNS = ["id", "subject_type", "subject_id", "title", "kind", "rhythm", "first_date", "end_date", "created_at", "updated_at"] as const
const MEETING_COLUMNS_005 = [
  "id",
  "title",
  "date",
  "kind",
  "status",
  "since_date",
  "notes",
  "subject_type",
  "subject_id",
  "series_id",
  "series_date",
  "auto_close",
  "created_at",
  "updated_at",
  "closed_itself",
] as const
const TALK_COLUMNS = [
  "id",
  "subject_type",
  "subject_id",
  "text",
  "project_id",
  "added_date",
  "position",
  "last_position",
  "status",
  "meeting_id",
  "status_date",
  "created_at",
  "updated_at",
] as const

// A rule-6 rebuild of an own table (copy, drop, create, copy back with named columns). For an AUTOINCREMENT table the
// drop would reset its counter to the largest id left (rule 2), so the ids of deleted rows above it could come back.
// The counter cannot be read (plugins may not name sqlite_sequence), so it is measured: a probe row inserted before
// the drop gets the counter + 1, and is deleted again. After the copy back, a row with the old counter as its id is
// inserted and deleted (when that is above the largest id left), which sets the new counter to it: the next id is the
// one the table would have given before the rebuild.
async function rebuild(
  db: Kysely<any>,
  table: string,
  columns: readonly string[],
  create: () => Promise<void>,
  autoincrement?: { probe: Record<string, unknown> },
): Promise<void> {
  let high = 0
  if (autoincrement) {
    const res = await db.insertInto(table).values(autoincrement.probe).executeTakeFirstOrThrow()
    high = Number(res.insertId) - 1
    await db.deleteFrom(table).where("id", "=", Number(res.insertId)).execute()
  }
  let copy = db.schema.createTable(`${table}_copy`)
  for (const c of columns) copy = copy.addColumn(c, "blob") // no type affinity: values are copied back as they are
  await copy.execute()
  await db.insertInto(`${table}_copy`).columns([...columns]).expression(db.selectFrom(table).select([...columns])).execute()
  await db.schema.dropTable(table).execute()
  await create()
  await db.insertInto(table).columns([...columns]).expression(db.selectFrom(`${table}_copy`).select([...columns])).execute()
  await db.schema.dropTable(`${table}_copy`).execute()
  if (autoincrement) {
    const max = await db.selectFrom(table).select((eb) => eb.fn.max("id").as("m")).executeTakeFirst()
    if (high > Number(max?.m ?? 0)) {
      await db.insertInto(table).values({ ...autoincrement.probe, id: high }).execute()
      await db.deleteFrom(table).where("id", "=", high).execute()
    }
  }
}

// Boards (design §5.7), and `board` as a subject of meetings, series and talk items. The subject_type CHECKs of series,
// meeting and talk_item change, so the three are rebuilt (rule 6: series, then meeting, then talk_item, each with its
// indexes; their children reference them without an ON DELETE action, and foreign keys are checked at the
// migration's commit), keeping the meeting and talk_item counters (rebuild). `board.id` is AUTOINCREMENT too: a board
// is a subject by id. Codes are stored upper-case, one per board. `from_project_id` is the project whose board
// meetings the `boards-from-projects` step moved onto the board, until the board is first edited (the step's notice
// names it until then); null otherwise.
async function migration006(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("board")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("code", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("note", "text")
    .addColumn("archived_at", "text")
    .addColumn("from_project_id", "integer") // soft reference to a projects project
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute()
  await db.schema.createIndex("board_code").on("board").column("code").unique().execute()

  const T = "1970-01-01T00:00:00"
  await rebuild(db, "series", SERIES_COLUMNS, () =>
    db.schema
      .createTable("series")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("subject_type", "text", (c) => c.notNull().check(inList("subject_type", SUBJECT_TYPES)))
      .addColumn("subject_id", "integer", (c) => c.notNull()) // soft reference to a person, a project or a board
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("kind", "text", (c) => c.notNull().check(inList("kind", MEETING_KINDS)))
      .addColumn("rhythm", "text", (c) => c.notNull()) // the canonical phrase (rhythm.ts)
      .addColumn("first_date", "text", (c) => c.notNull())
      .addColumn("end_date", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute(),
  )
  await rebuild(
    db,
    "meeting",
    MEETING_COLUMNS_005,
    async () => {
      await db.schema
        .createTable("meeting")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("title", "text", (c) => c.notNull())
        .addColumn("date", "text", (c) => c.notNull())
        .addColumn("kind", "text", (c) => c.notNull().check(inList("kind", MEETING_KINDS)))
        .addColumn("status", "text", (c) => c.notNull().defaultTo("planned").check(inList("status", MEETING_STATUSES)))
        .addColumn("since_date", "text")
        .addColumn("notes", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("subject_type", "text", (c) => c.check(inList("subject_type", SUBJECT_TYPES))) // null: no subject yet
        .addColumn("subject_id", "integer") // soft reference to a person, a project or a board
        .addColumn("series_id", "integer", (c) => c.references("series.id")) // null: a one-off meeting
        .addColumn("series_date", "text") // the series date it was made for; kept when the meeting is moved
        .addColumn("auto_close", "integer", (c) => c.notNull().defaultTo(0)) // 1: closes itself 3 days after its date
        .addColumn("created_at", "text", (c) => c.notNull())
        .addColumn("updated_at", "text", (c) => c.notNull())
        .addColumn("closed_itself", "integer", (c) => c.notNull().defaultTo(0))
        .addUniqueConstraint("meeting_series_date", ["series_id", "series_date"])
        .execute()
      await db.schema.createIndex("meeting_date").on("meeting").column("date").execute()
      await db.schema.createIndex("meeting_subject").on("meeting").columns(["subject_type", "subject_id"]).execute()
    },
    { probe: { title: "probe", date: "1970-01-01", kind: "project", status: "cancelled", created_at: T, updated_at: T } },
  )
  await rebuild(
    db,
    "talk_item",
    TALK_COLUMNS,
    async () => {
      await db.schema
        .createTable("talk_item")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("subject_type", "text", (c) => c.notNull().check(inList("subject_type", SUBJECT_TYPES)))
        .addColumn("subject_id", "integer", (c) => c.notNull()) // soft reference to a person, a project or a board
        .addColumn("text", "text", (c) => c.notNull())
        .addColumn("project_id", "integer") // soft reference to a projects project: the tag
        .addColumn("added_date", "text", (c) => c.notNull())
        .addColumn("position", "integer")
        .addColumn("last_position", "integer")
        .addColumn("status", "text", (c) => c.notNull().defaultTo("open").check(inList("status", TALK_STATUSES)))
        .addColumn("meeting_id", "integer", (c) => c.references("meeting.id"))
        .addColumn("status_date", "text")
        .addColumn("created_at", "text", (c) => c.notNull())
        .addColumn("updated_at", "text", (c) => c.notNull())
        .addUniqueConstraint("talk_item_position", ["subject_type", "subject_id", "position"])
        .execute()
      await db.schema.createIndex("talk_item_project").on("talk_item").columns(["project_id", "status"]).execute()
      await db.schema.createIndex("talk_item_meeting").on("talk_item").column("meeting_id").execute()
    },
    { probe: { subject_type: "person", subject_id: 0, text: "probe", added_date: "1970-01-01", status: "dropped", created_at: T, updated_at: T } },
  )
}

// Whether the `boards-from-projects` step left the project's open talk items on it (it moved board meetings off a
// project that still had other meetings or series, and open items of its own): decided when the step ran, so the
// notice that names the board says so as long as it is shown, and only then (an item added to the project later
// does not change it). 0 for a board made any other way.
async function migration007(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("board").addColumn("talk_stayed", "integer", (c) => c.notNull().defaultTo(0)).execute()
}

// In order. Exported so that upgrade tests can build a database as an earlier version left it.
export const MIGRATIONS: ReadonlyArray<readonly [string, (db: Kysely<any>) => Promise<void>]> = [
  ["001", migration001],
  ["002", migration002],
  ["003", migration003],
  ["004", migration004],
  ["005", migration005],
  ["006", migration006],
  ["007", migration007],
]

export function registerSchema(ctx: PluginContext): void {
  for (const [id, up] of MIGRATIONS) ctx.migration(id, up)
}
