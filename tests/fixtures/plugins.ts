// Fixture plugins for the kernel host tests (and the Node boot check).
// `alpha` owns a table, a write and a read op, a record type, a command and a published view; the others
// are built around it.
import { definePlugin, Type, type PluginDef, type ViewDef } from "../../src/kernel/api"

export const itemView: ViewDef = {
  version: 1,
  columns: { id: "integer", title: "text" },
  query: (db) => db.selectFrom("item").select(["id", "title"]),
}

export function alpha(opts: { version?: string; log?: string[] } = {}): PluginDef {
  return definePlugin({
    id: "alpha",
    name: "Alpha",
    version: opts.version ?? "1.0.0",
    apiVersion: 1,
    activate(ctx) {
      opts.log?.push("alpha")
      ctx.migration("001", async (db) => {
        await db.schema
          .createTable("item")
          .addColumn("id", "integer", (c) => c.primaryKey())
          .addColumn("title", "text", (c) => c.notNull())
          .addColumn("created_at", "text", (c) => c.notNull())
          .addColumn("updated_at", "text", (c) => c.notNull())
          .execute()
      })
      ctx.publish("item", itemView)
      ctx.recordType({
        name: "alpha-item",
        prefix: "AL-",
        resolve: async (ref) => {
          const m = /^(?:AL-)?(\d+)$/i.exec(ref)
          if (!m) return null
          const row = await ctx.data.selectFrom("item").select("id").where("id", "=", Number(m[1])).executeTakeFirst()
          return row ? Number(row.id) : null
        },
        label: async (id) => String((await ctx.data.selectFrom("item").select("title").where("id", "=", id).executeTakeFirstOrThrow()).title),
        search: async () => [],
      })
      ctx.expose({
        read: {
          count: {
            input: Type.Object({}),
            output: Type.Object({ n: Type.Integer() }),
            run: async () => ({ n: Number((await ctx.data.selectFrom("item").select((e) => e.fn.countAll().as("n")).executeTakeFirstOrThrow()).n) }),
          },
        },
        write: {
          add: {
            input: Type.Object({ title: Type.String({ minLength: 1 }) }),
            output: Type.Object({ ref: Type.String(), id: Type.Integer() }),
            describe: (i) => `+ item "${i.title}"`,
            run: async (i) => {
              const now = ctx.clock.now()
              const r = await ctx.data.insertInto("item").values({ title: i.title, created_at: now, updated_at: now }).executeTakeFirstOrThrow()
              return { ref: `AL-${r.insertId}`, id: Number(r.insertId) }
            },
          },
        },
      })
      ctx.command({
        thing: "alpha",
        verb: "add",
        summary: "add an item",
        args: [{ name: "title", required: true }],
        run: async ({ args }) => {
          const out = await ctx.self().write.add!({ title: args.title })
          return { json: out, text: out.ref }
        },
      })
    },
  })
}

// Requires alpha and reads its view: a cross-plugin write through `use`, a cross-plugin read through the view.
export function beta(opts: { requires?: Record<string, string>; reads?: Record<string, string>; log?: string[] } = {}): PluginDef {
  return definePlugin({
    id: "beta",
    name: "Beta",
    version: "1.0.0",
    apiVersion: 1,
    requires: opts.requires ?? { alpha: "^1" },
    reads: opts.reads ?? { alpha: "^1" },
    activate(ctx) {
      opts.log?.push("beta")
      ctx.expose({
        read: {
          titles: {
            input: Type.Object({}),
            output: Type.Array(Type.String()),
            run: async () => (await ctx.data.selectFrom("alpha.item").select("title").orderBy("id").execute()).map((r) => String(r.title)),
          },
        },
        write: {
          addVia: {
            input: Type.Object({ title: Type.String() }),
            output: Type.Object({ ref: Type.String(), id: Type.Integer() }),
            describe: (i) => `+ item "${i.title}" via beta`,
            run: async (i) => ctx.use("alpha")!.write!.add!({ title: i.title }),
          },
        },
      })
    },
  })
}

// Reads alpha's view without requiring it.
export function reader(reads: Record<string, string>): PluginDef {
  return definePlugin({
    id: "reader",
    name: "Reader",
    version: "1.0.0",
    apiVersion: 1,
    reads,
    activate(ctx) {
      ctx.expose({
        read: {
          titles: {
            input: Type.Object({}),
            output: Type.Array(Type.String()),
            run: async () => (await ctx.data.selectFrom("alpha.item").select("title").orderBy("id").execute()).map((r) => String(r.title)),
          },
        },
      })
    },
  })
}

// A plugin with nothing but its id, version, requirements and (optionally) a body.
export function bare(
  id: string,
  opts: { version?: string; requires?: Record<string, string>; apiVersion?: number; log?: string[]; activate?: PluginDef["activate"] } = {},
): PluginDef {
  return definePlugin({
    id,
    name: id,
    version: opts.version ?? "1.0.0",
    apiVersion: (opts.apiVersion ?? 1) as 1,
    requires: opts.requires,
    activate(ctx) {
      opts.log?.push(id)
      return opts.activate?.(ctx)
    },
  })
}

// Registers a command, an op, a record type, a tag type, a report, a guide section and an event handler, then throws.
export function broken(opts: { requires?: Record<string, string>; seen?: string[] } = {}): PluginDef {
  return definePlugin({
    id: "broken",
    name: "Broken",
    version: "1.0.0",
    apiVersion: 1,
    requires: opts.requires,
    activate(ctx) {
      ctx.command({ thing: "broken", verb: "go", summary: "never available", run: async () => ({ json: null, text: "" }) })
      ctx.expose({ read: { ping: { input: Type.Object({}), output: Type.String(), run: async () => "pong" } } })
      ctx.recordType({ name: "broken-thing", prefix: "BR-", resolve: async () => 1, label: async () => "x", search: async () => [] })
      ctx.tagType({ prefix: "$", recordType: "broken-thing", resolve: async () => 1 })
      ctx.report({ id: "broken", cliName: "broken", title: "Broken", params: Type.Object({}), describe: "never" })
      ctx.reportSection("overview", { id: "broken", order: 1, run: async () => null })
      ctx.guideSection({ title: "Broken", markdown: "never shown" })
      ctx.publish("thing", itemView)
      ctx.on("record.changed", () => opts.seen?.push("broken"))
      throw new Error("boom")
    },
  })
}
