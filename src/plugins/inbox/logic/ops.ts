// The exposed operations (plugin reference §4): getItem reads; capture, editItem, markProcessed, dismiss and
// reopen write. Tags are resolved only through ctx.tags, so the inbox knows nothing about projects or people.
import { currentContext, NonBlank, parseTags, Type, type PluginContext, type Static } from "../../../kernel/api"
import type { Store } from "./records"
import { ItemRecord, ProcessedBy } from "./schema"

const Ref = NonBlank()
const Capture = Type.Object({ text: NonBlank(), context: Type.Optional(Type.String()) })
const Edit = Type.Object({ ref: Ref, text: NonBlank() })
const Mark = Type.Object({ ref: Ref, summary: NonBlank(), by: ProcessedBy })
const ItemRef = Type.Object({ ref: Ref })
// `by` (optional): who dismissed it, kept in processed_by (the TUI passes "you", the CLI "cli"); without it
// processed_by is null (keeping an earlier value would attribute the dismissal to whoever processed the item).
const Dismiss = Type.Object({ ref: Ref, by: Type.Optional(ProcessedBy) })
const Labelled = Type.Object({ ref: Type.String(), label: Type.String() })
const ItemDetail = Type.Object({
  ref: Type.String(),
  text: Type.String(),
  status: Type.String(),
  summary: Type.Union([Type.String(), Type.Null()]),
  links: Type.Array(Labelled),
  unresolved: Type.Array(Type.String()),
  created: Type.Array(Labelled),
})
export type ItemDetail = Static<typeof ItemDetail>

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function registerOps(ctx: PluginContext, store: Store): void {
  const db = ctx.data
  const now = () => currentContext().now

  // Replace an item's links and unresolved tags by what its text names now.
  async function retag(id: number, text: string): Promise<void> {
    const { links, unresolved } = await ctx.tags.resolve(text)
    await db.deleteFrom("link").where("item_id", "=", id).execute()
    for (const l of links) await db.insertInto("link").values({ item_id: id, record_type: l.recordType, record_id: l.recordId }).execute()
    await db.updateTable("item").set({ unresolved_tags: JSON.stringify(unresolved) }).where("id", "=", id).execute()
  }

  const label = async (type: string, id: number): Promise<{ ref: string; label: string }> => {
    const ref = await ctx.records.refOf(type, id)
    try {
      return { ref, label: await ctx.records.label(ref) }
    } catch {
      return { ref, label: ref } // the record is gone or its plugin is disabled
    }
  }

  const refOf = async (ref: string) => {
    const id = await store.itemId(ref)
    return id === null ? ref.trim().toUpperCase() : `I-${id}`
  }

  ctx.expose({
    read: {
      getItem: {
        input: ItemRef,
        output: ItemDetail,
        toolDescription: "One inbox item: its text, status, summary, the records its tags link to, unresolved tags and the records created from it.",
        run: async (i: { ref: string }): Promise<ItemDetail> => {
          const it = await store.item(i.ref)
          const rows = await db.selectFrom("link").select(["record_type", "record_id"]).where("item_id", "=", it.id).orderBy("id").execute()
          const links = await Promise.all(rows.map((r) => label(String(r.record_type), Number(r.record_id))))
          const made = await ctx.provenance.createdFrom("inbox", it.ref)
          const created = await Promise.all(made.map((c) => label(c.recordType, c.recordId)))
          return { ref: it.ref, text: it.text, status: it.status, summary: it.summary, links, unresolved: it.unresolved, created }
        },
      },
    },
    write: {
      capture: {
        input: Capture,
        output: ItemRecord,
        describe: async (i: Static<typeof Capture>) => `+ inbox item "${clip(i.text.trim())}"`,
        run: async (i: Static<typeof Capture>) => {
          let text = i.text.trim()
          const context = i.context?.trim()
          if (context && !parseTags(text).some((t) => t.raw.toLowerCase() === context.toLowerCase())) text = `${text} ${context}`
          const res = await db.insertInto("item").values({ text, captured_at: now(), status: "new", unresolved_tags: "[]" }).executeTakeFirstOrThrow()
          const id = Number(res.insertId)
          await retag(id, text)
          return store.item(String(id))
        },
      },
      editItem: {
        input: Edit,
        output: ItemRecord,
        describe: async (i: Static<typeof Edit>) => `~ ${await refOf(i.ref)} text`,
        run: async (i: Static<typeof Edit>) => {
          const it = await store.item(i.ref)
          const text = i.text.trim()
          await db.updateTable("item").set({ text }).where("id", "=", it.id).execute()
          await retag(it.id, text)
          return store.item(String(it.id))
        },
      },
      markProcessed: {
        input: Mark,
        output: ItemRecord,
        describe: async (i: Static<typeof Mark>) => `~ ${await refOf(i.ref)} processed by ${i.by}`,
        run: async (i: Static<typeof Mark>) => {
          const it = await store.item(i.ref)
          await db.updateTable("item").set({ status: "processed", summary: i.summary.trim(), processed_at: now(), processed_by: i.by }).where("id", "=", it.id).execute()
          return store.item(String(it.id))
        },
      },
      dismiss: {
        input: Dismiss,
        output: ItemRecord,
        describe: async (i: Static<typeof Dismiss>) => `~ ${await refOf(i.ref)} dismissed`,
        run: async (i: Static<typeof Dismiss>) => {
          const it = await store.item(i.ref)
          // Without `by`, nobody is recorded as having dismissed it.
          await db.updateTable("item").set({ status: "dismissed", processed_at: now(), processed_by: i.by ?? null }).where("id", "=", it.id).execute()
          return store.item(String(it.id))
        },
      },
      reopen: {
        input: ItemRef,
        output: ItemRecord,
        describe: async (i: { ref: string }) => `~ ${await refOf(i.ref)} reopened`,
        run: async (i: { ref: string }) => {
          const it = await store.item(i.ref)
          await db.updateTable("item").set({ status: "new", summary: null, processed_at: null, processed_by: null }).where("id", "=", it.id).execute()
          return store.item(String(it.id))
        },
      },
    },
  })
}
