// Lookups shared by the operations and the commands, and the record type `inbox_item` (I-).
import { formatRef, NotFoundError, parseRef, type PluginContext } from "../../../kernel/api"
import type { ItemRecord } from "./schema"

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

export type Store = ReturnType<typeof makeStore>

// Only `data` is used, so a TUI component can build one from its runtime.
export function makeStore(ctx: Pick<PluginContext, "data">) {
  const db = ctx.data

  const toItem = (r: any): ItemRecord => ({
    ref: formatRef("I-", Number(r.id)),
    id: Number(r.id),
    text: String(r.text),
    captured_at: String(r.captured_at),
    status: r.status,
    summary: str(r.summary),
    processed_at: str(r.processed_at),
    processed_by: str(r.processed_by) as ItemRecord["processed_by"],
    unresolved: JSON.parse(String(r.unresolved_tags ?? "[]")),
  })

  async function itemId(input: string): Promise<number | null> {
    const id = parseRef(input, "I-")
    if (id === null) return null
    const row = await db.selectFrom("item").select("id").where("id", "=", id).executeTakeFirst()
    return row ? Number(row.id) : null
  }

  async function item(input: string): Promise<ItemRecord> {
    const id = await itemId(input)
    if (id === null) {
      const n = parseRef(input, "I-")
      throw new NotFoundError(`unknown inbox item "${n === null ? input : formatRef("I-", n)}"`)
    }
    return toItem(await db.selectFrom("item").selectAll().where("id", "=", id).executeTakeFirstOrThrow())
  }

  const itemQuery = () => db.selectFrom("item").selectAll()

  return { toItem, itemId, item, itemQuery }
}

export function registerRecordTypes(ctx: PluginContext, store: Store): void {
  ctx.recordType({
    name: "inbox_item",
    prefix: "I-",
    resolve: (input) => store.itemId(input),
    label: async (id) => (await store.item(String(id))).text,
    search: async (text, limit) => {
      const rows = await ctx.data.selectFrom("item").select(["id", "text"]).where("text", "like", `%${text.trim()}%`).orderBy("id").limit(limit).execute()
      return rows.map((r) => ({ ref: formatRef("I-", Number(r.id)), label: String(r.text) }))
    },
  })
}
