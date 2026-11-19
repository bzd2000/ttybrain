// `ttybrain inbox …`. Reads go through ctx.data and the exposed getItem; writes only through ctx.self().write.*.
import { formatTable, ValidationError, type PluginContext } from "@pm/api"
import type { ItemDetail } from "./ops"
import type { Store } from "./records"
import { PROCESSED_BY, type ItemRecord } from "./schema"

const row = (i: ItemRecord) => ({ ref: i.ref, captured: i.captured_at.slice(0, 10), status: i.status, text: i.text })

function detailText(d: ItemDetail): string {
  const lines = [`${d.ref} [${d.status}] ${d.text}`]
  if (d.summary) lines.push(`  summary: ${d.summary}`)
  if (d.links.length) lines.push(`  links: ${d.links.map((l) => `${l.ref} (${l.label})`).join(", ")}`)
  if (d.unresolved.length) lines.push(`  unresolved: ${d.unresolved.join(", ")}`)
  if (d.created.length) lines.push(`  created: ${d.created.map((c) => `${c.ref} (${c.label})`).join(", ")}`)
  return lines.join("\n")
}

export function registerCommands(ctx: PluginContext, store: Store): void {
  const write = () => ctx.self().write
  const one = (verb: "dismiss" | "reopen", summary: string) =>
    ctx.command({
      thing: "inbox",
      verb,
      summary,
      args: [{ name: "item", required: true }],
      run: async ({ args }) => {
        // A dismissal from the CLI is attributed to it, as `done` is by default.
        const i: ItemRecord = await write()[verb]!(verb === "dismiss" ? { ref: args.item, by: "cli" } : { ref: args.item })
        return { json: i, text: `${i.ref} ${i.status}` }
      },
    })

  ctx.command({
    thing: "inbox",
    verb: "add",
    summary: "capture a note; #project and @person tags link it",
    args: [{ name: "text", required: true, rest: true }],
    run: async ({ args }) => {
      const i: ItemRecord = await write().capture!({ text: (args.text as string[]).join(" ") })
      return { json: i, text: `${i.ref} ${i.text}` }
    },
  })

  ctx.command({
    thing: "inbox",
    verb: "list",
    summary: "list inbox items (default: new ones)",
    flags: {
      new: { type: "boolean", description: "new items only (the default)" },
      all: { type: "boolean", description: "all items, including processed and dismissed" },
    },
    run: async ({ flags }) => {
      if (flags.new && flags.all) throw new ValidationError("use --new or --all, not both", { field: "new" })
      let q = store.itemQuery()
      if (!flags.all) q = q.where("status", "=", "new")
      const rows = (await q.orderBy("id").execute()).map(store.toItem)
      return { json: rows, text: rows.length ? formatTable(["ref", "captured", "status", "text"], rows.map(row)) : "inbox is empty" }
    },
  })

  ctx.command({
    thing: "inbox",
    verb: "show",
    summary: "show an item with its links and what was created from it",
    args: [{ name: "item", required: true }],
    run: async ({ args }) => {
      const it = await store.item(String(args.item))
      const d: ItemDetail = await ctx.self().read.getItem!({ ref: it.ref })
      return { json: { ...it, links: d.links, created: d.created }, text: detailText(d) }
    },
  })

  ctx.command({
    thing: "inbox",
    verb: "edit",
    summary: "change an item's text (its tags are resolved again)",
    args: [
      { name: "item", required: true },
      { name: "text", required: true, rest: true },
    ],
    run: async ({ args }) => {
      const i: ItemRecord = await write().editItem!({ ref: args.item, text: (args.text as string[]).join(" ") })
      return { json: i, text: `${i.ref} ${i.text}` }
    },
  })

  ctx.command({
    thing: "inbox",
    verb: "done",
    summary: "mark an item processed, with a summary of what became of it",
    args: [{ name: "item", required: true }],
    flags: {
      summary: { type: "string", description: "what was done with the item", required: true, placeholder: "text" },
      by: { type: "string", values: [...PROCESSED_BY], description: "who processed it (default: cli)" },
    },
    run: async ({ args, flags }) => {
      const i: ItemRecord = await write().markProcessed!({ ref: args.item, summary: flags.summary, by: flags.by ?? "cli" })
      return { json: i, text: `${i.ref} processed` }
    },
  })

  one("dismiss", "dismiss an item without processing it")
  one("reopen", "make a processed or dismissed item new again")
}
