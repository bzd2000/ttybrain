// The actions plugin's tables. `action` (001) started with the columns actions had in the projects plugin
// (projects_action), `project_id`, `for_person_id` and `meeting_id` among them; 002 turned those three into rows of
// `link`: an action links to any record by (record_type, record_id), a soft reference to another plugin's record, in
// the order the links were made (`id`). The handover (handover.ts) keeps each moved row's id. `handover` records
// which plugin's legacy rows were imported, and `handover_row` each imported (id, updated_at), so that plugin drops
// exactly those rows of its copy.
import { sql, type PluginContext, type Kysely } from "@ttybrain/api"

export const ACTION_STATUSES = ["open", "done", "cancelled"] as const

const inList = (col: string, xs: readonly string[]) => sql.raw(`${col} in (${xs.map((x) => `'${x}'`).join(", ")})`)

export function registerSchema(ctx: PluginContext): void {
  ctx.migration("001", async (db) => {
    await db.schema
      .createTable("action")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("due_date", "text")
      .addColumn("status", "text", (c) => c.notNull().defaultTo("open").check(inList("status", ACTION_STATUSES)))
      .addColumn("done_date", "text")
      .addColumn("owner_id", "integer") // soft reference to a people person; null means you
      .addColumn("project_id", "integer") // soft reference to a projects project
      .addColumn("for_person_id", "integer") // soft reference to a people person
      .addColumn("meeting_id", "integer") // soft reference to a meetings meeting
      .addColumn("notes", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("action_project").on("action").columns(["project_id", "status"]).execute()
    await db.schema.createIndex("action_status").on("action").columns(["status", "due_date"]).execute()

    await db.schema
      .createTable("handover")
      .addColumn("source", "text", (c) => c.primaryKey()) // the plugin the rows came from
      .addColumn("rows", "integer", (c) => c.notNull())
      .addColumn("imported_at", "text", (c) => c.notNull())
      .execute()
    await db.schema
      .createTable("handover_row")
      .addColumn("source", "text", (c) => c.notNull())
      .addColumn("id", "integer", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("handover_row_pk", ["source", "id"])
      .execute()
  })

  // Links instead of the three columns. `link` references `action` with no ON DELETE action (rule 6), so `action`
  // can be rebuilt under it: the links are copied first, then `action` is rebuilt without the columns (copy, drop,
  // create, copy back; foreign keys are checked at the migration's commit).
  ctx.migration("002", async (db) => {
    await db.schema
      .createTable("link")
      .addColumn("id", "integer", (c) => c.primaryKey()) // the order links were made in
      .addColumn("action_id", "integer", (c) => c.notNull().references("action.id"))
      .addColumn("record_type", "text", (c) => c.notNull()) // a record type name: project, person, meeting, …
      .addColumn("record_id", "integer", (c) => c.notNull()) // soft reference to that record
      .addUniqueConstraint("link_unique", ["action_id", "record_type", "record_id"])
      .execute()
    await db.schema.createIndex("link_record").on("link").columns(["record_type", "record_id"]).execute()
    for (const [type, column] of [
      ["project", "project_id"],
      ["person", "for_person_id"],
      ["meeting", "meeting_id"],
    ] as const)
      await db
        .insertInto("link")
        .columns(["action_id", "record_type", "record_id"])
        .expression(db.selectFrom("action").select((eb) => ["id", eb.val(type).as("record_type"), column]).where(column, "is not", null).orderBy("id"))
        .execute()

    const keep = ["id", "title", "due_date", "status", "done_date", "owner_id", "notes", "created_at", "updated_at"] as const
    await createAction(db, "action_copy")
    await db.insertInto("action_copy").columns([...keep]).expression(db.selectFrom("action").select([...keep])).execute()
    await db.schema.dropTable("action").execute()
    await createAction(db, "action")
    // Named columns, not `select *`: between two identical tables SQLite would copy the rows wholesale (its transfer
    // optimisation), skipping the foreign-key bookkeeping that clears the drop's deferred violations on `link`.
    await db.insertInto("action").columns([...keep]).expression(db.selectFrom("action_copy").select([...keep])).execute()
    await db.schema.dropTable("action_copy").execute()
    await db.schema.createIndex("action_status").on("action").columns(["status", "due_date"]).execute()
  })
}

// `action` as of 002: no link columns.
async function createAction(db: Kysely<any>, name: string): Promise<void> {
  await db.schema
    .createTable(name)
    .addColumn("id", "integer", (c) => c.primaryKey())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("due_date", "text")
    .addColumn("status", "text", (c) => c.notNull().defaultTo("open").check(inList("status", ACTION_STATUSES)))
    .addColumn("done_date", "text")
    .addColumn("owner_id", "integer") // soft reference to a people person; null means you
    .addColumn("notes", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute()
}
