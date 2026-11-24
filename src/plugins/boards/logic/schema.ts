// The boards plugin's tables. `board` (design §5.7) has the columns meetings' board had (meetings 006), but
// `talk_stayed`, which only meetings' notice reads (it stays there). `id` is AUTOINCREMENT: a board is the subject of
// meetings, series and talk items and the target of links by id, so an id is never given again. Codes are stored
// upper-case, one per board. `from_project_id` is the project a board was made from (meetings' `boards-from-projects`
// step, through addBoard's `fromProject`), until the board is first edited or archived. The handover (handover.ts)
// keeps each moved row's id: `handover` records which plugin's legacy rows were imported, and `handover_row` each
// imported (id, updated_at), so that plugin drops exactly those rows of its copy.
import { Type, type PluginContext, type Static } from "@ttybrain/api"

const Text = Type.String()
const Opt = Type.Union([Text, Type.Null()])

// A board: its code (`#MB`), name and optional note. An archived one takes no new meetings, series or talk items
// until it is restored.
export const BoardRecord = Type.Object({
  ref: Text, // #CODE
  id: Type.Integer(),
  code: Text,
  name: Text,
  note: Opt,
  archived: Type.Boolean(),
})
export type BoardRecord = Static<typeof BoardRecord>

export function registerSchema(ctx: PluginContext): void {
  ctx.migration("001", async (db) => {
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
}
