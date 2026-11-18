// The inbox plugin's tables (design §5 Inbox) and the TypeBox shapes of its records.
import { sql, Type, type PluginContext, type Static } from "@pm/api"

export const STATUSES = ["new", "processed", "dismissed"] as const
export const PROCESSED_BY = ["cli", "you", "assistant"] as const

export const Status = Type.Union([Type.Literal("new"), Type.Literal("processed"), Type.Literal("dismissed")])
export const ProcessedBy = Type.Union([Type.Literal("cli"), Type.Literal("you"), Type.Literal("assistant")])
const Opt = Type.Union([Type.String(), Type.Null()])

export const ItemRecord = Type.Object({
  ref: Type.String(),
  id: Type.Integer(),
  text: Type.String(),
  captured_at: Type.String(),
  status: Status,
  summary: Opt,
  processed_at: Opt,
  processed_by: Type.Union([ProcessedBy, Type.Null()]),
  unresolved: Type.Array(Type.String()),
})
export type ItemRecord = Static<typeof ItemRecord>

const inList = (col: string, xs: readonly string[]) => sql.raw(`${col} in (${xs.map((x) => `'${x}'`).join(", ")})`)

export function registerSchema(ctx: PluginContext): void {
  ctx.migration("001", async (db) => {
    await db.schema
      .createTable("item")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("text", "text", (c) => c.notNull())
      .addColumn("captured_at", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull().defaultTo("new").check(inList("status", STATUSES)))
      .addColumn("summary", "text")
      .addColumn("processed_at", "text")
      .addColumn("processed_by", "text", (c) => c.check(sql`processed_by is null or processed_by in ('assistant', 'cli', 'you')`))
      .addColumn("unresolved_tags", "text", (c) => c.notNull().defaultTo("[]")) // JSON array of tags as written
      .execute()
    await db.schema.createIndex("item_status").on("item").column("status").execute()
    await db.schema
      .createTable("link")
      .addColumn("id", "integer", (c) => c.primaryKey())
      .addColumn("item_id", "integer", (c) => c.notNull().references("item.id"))
      .addColumn("record_type", "text", (c) => c.notNull()) // soft reference to a record of another plugin
      .addColumn("record_id", "integer", (c) => c.notNull())
      .execute()
    await db.schema.createIndex("link_item").on("link").column("item_id").execute()
  })
}
