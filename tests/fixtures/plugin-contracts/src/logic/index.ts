// The `contracts` fixture plugin: an external plugin built with `pm plugin build` and loaded from a plugins folder
// or from npm (tests/external-plugin.test.ts, scripts/smoke-node.sh). It is source only: pm never imports it.
// It imports nothing but "@pm/api", owns `contract(id, project_id, title)`, publishes the view `contracts`,
// registers the record type `contract` (C-) and the commands `contract add <project> <title>` and `contract list`.
// The `// FAILURE:` lines are where the failure tests inject a throw into a copy.
import { definePlugin, formatRef, formatTable, NonBlank, NotFoundError, parseRef, Type, type PluginContext } from "@pm/api"
// FAILURE: import

// The project id behind a ref (`#CRM`, `CRM`), through the kernel's record types.
async function projectId(ctx: Pick<PluginContext, "records">, ref: string): Promise<number> {
  const found = await ctx.records.resolve(ref.startsWith("#") ? ref : `#${ref}`)
  if (!found || found.type !== "project") throw new NotFoundError(`no project "${ref}"`, { hint: 'run "pm project list"' })
  return found.id
}

export default definePlugin({
  id: "contracts",
  name: "Contracts",
  version: "0.1.0",
  apiVersion: 1,
  requires: { projects: "^1" },
  reads: { projects: "^1" },
  activate(ctx) {
    // FAILURE: activate
    ctx.migration("1-contract", async (db) => {
      await db.schema
        .createTable("contract")
        .addColumn("id", "integer", (c) => c.primaryKey())
        .addColumn("project_id", "integer", (c) => c.notNull())
        .addColumn("title", "text", (c) => c.notNull())
        .execute()
      // FAILURE: migration
    })

    ctx.publish("contracts", {
      version: 1,
      columns: { id: "integer", project_id: "integer", title: "text" },
      query: (db) => db.selectFrom("contract").select(["id", "project_id", "title"]),
    })

    const contractId = async (input: string): Promise<number | null> => {
      const id = parseRef(input, "C-")
      if (id === null) return null
      const row = await ctx.data.selectFrom("contract").select("id").where("id", "=", id).executeTakeFirst()
      return row ? Number(row.id) : null
    }
    ctx.recordType({
      name: "contract",
      prefix: "C-",
      resolve: contractId,
      label: async (id) => String((await ctx.data.selectFrom("contract").select("title").where("id", "=", id).executeTakeFirstOrThrow()).title),
      search: async (text, limit) => {
        const rows = await ctx.data.selectFrom("contract").select(["id", "title"]).where("title", "like", `%${text.trim()}%`).orderBy("id").limit(limit).execute()
        return rows.map((r) => ({ ref: formatRef("C-", Number(r.id)), label: String(r.title) }))
      },
    })

    ctx.expose({
      write: {
        addContract: {
          input: Type.Object({ project: NonBlank(), title: NonBlank() }),
          output: Type.Object({ ref: Type.String(), project: Type.String(), title: Type.String() }),
          describe: (i) => `+ contract "${i.title}" on ${i.project}`,
          run: async (i) => {
            const pid = await projectId(ctx, i.project)
            const row = await ctx.data.insertInto("contract").values({ project_id: pid, title: i.title }).returning("id").executeTakeFirstOrThrow()
            return { ref: formatRef("C-", Number(row.id)), project: await ctx.records.refOf("project", pid), title: i.title }
          },
        },
      },
    })

    ctx.command({
      thing: "contract",
      verb: "add",
      summary: "add a contract to a project",
      args: [
        { name: "project", required: true },
        { name: "title", required: true },
      ],
      run: async ({ args }) => {
        const c: { ref: string; project: string; title: string } = await ctx.self().write.addContract!({ project: args.project, title: args.title })
        return { json: c, text: `${c.ref} ${c.title}` }
      },
    })

    ctx.command({
      thing: "contract",
      verb: "list",
      summary: "list the contracts with their project",
      run: async () => {
        const rows = await ctx.data
          .selectFrom("contract as c")
          .innerJoin("projects.project as p", "p.id", "c.project_id")
          .select(["c.id", "p.code", "c.title"])
          .orderBy("c.id")
          .execute()
        const list = rows.map((r) => ({ ref: formatRef("C-", Number(r.id)), project: `#${r.code}`, title: String(r.title) }))
        return { json: list, text: list.length ? formatTable(["ref", "project", "title"], list) : "no contracts" }
      },
    })
  },
})
