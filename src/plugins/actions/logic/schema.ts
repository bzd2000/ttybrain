// The actions plugin's tables. `action` has the columns actions had in the projects plugin (projects_action), so the
// handover (handover.ts) copies each row as it is, with its id: `project_id`, `for_person_id` and `meeting_id` are
// soft references (plain integers) to other plugins' records. `handover` records which plugin's legacy rows were
// imported, so that plugin can drop its copy.
import { sql, type PluginContext } from "@ttybrain/api"

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
  })
}
