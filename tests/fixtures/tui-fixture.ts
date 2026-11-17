// The fixture plugin `budget`, which proves the `field` and `listColumn` extension points (no built-in uses them).
// Logic: requires projects, owns `amount(project_id, eur)`, exposes getBudget/setBudget and registers the project
// field "budget" through them. TUI: a "Budget" column on the projects list, read through getBudget.
import { definePlugin, NotFoundError, Type, type PluginContext, type PluginDef } from "../../src/kernel/api"
import { defineTui, type TuiDef } from "../../src/kernel/tui/api"

const Ref = Type.String({ minLength: 1 })
const Value = Type.Union([Type.Number(), Type.Null()])

// The project id behind a ref (`#CRM`, `CRM`), through the kernel's record types (projects' own records).
async function projectId(ctx: Pick<PluginContext, "records">, ref: string): Promise<number> {
  const found = await ctx.records.resolve(ref.startsWith("#") ? ref : `#${ref}`)
  if (!found || found.type !== "project") throw new NotFoundError(`no project "${ref}"`)
  return found.id
}

export function budget(opts: { get?: string; set?: string } = {}): PluginDef {
  return definePlugin({
    id: "budget",
    name: "Budget",
    version: "1.0.0",
    apiVersion: 1,
    requires: { projects: "^1" },
    activate(ctx) {
      ctx.migration("001", async (db) => {
        await db.schema
          .createTable("amount")
          .addColumn("project_id", "integer", (c) => c.primaryKey())
          .addColumn("eur", "real", (c) => c.notNull())
          .execute()
      })
      ctx.expose({
        read: {
          getBudget: {
            input: Type.Object({ ref: Ref }),
            output: Type.Object({ value: Value }),
            run: async (i) => {
              const id = await projectId(ctx, i.ref)
              const row = await ctx.data.selectFrom("amount").select("eur").where("project_id", "=", id).executeTakeFirst()
              return { value: row ? Number(row.eur) : null }
            },
          },
        },
        write: {
          setBudget: {
            input: Type.Object({ ref: Ref, value: Value }),
            output: Type.Object({ ref: Type.String() }),
            describe: (i) => (i.value === null ? `~ budget of ${i.ref} cleared` : `~ budget of ${i.ref} = ${i.value}`),
            run: async (i) => {
              const id = await projectId(ctx, i.ref)
              const ref = await ctx.records.refOf("project", id)
              await ctx.data.deleteFrom("amount").where("project_id", "=", id).execute()
              if (i.value !== null) await ctx.data.insertInto("amount").values({ project_id: id, eur: i.value }).execute()
              return { ref }
            },
          },
        },
      })
      ctx.field("project", { name: "budget", label: "Budget", type: "number", get: opts.get ?? "getBudget", set: opts.set ?? "setBudget" })
    },
  })
}

export const budgetTui: TuiDef = defineTui({
  plugin: "budget",
  activate(ui) {
    ui.listColumn("projects", {
      id: "budget",
      title: "Budget",
      width: 8,
      value: async (ref) => {
        const { value } = await ui.self().read.getBudget!({ ref })
        return value === null ? null : String(value)
      },
    })
  },
})
