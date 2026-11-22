// The handover of the actions this plugin used to own to the actions plugin (design 2026-11-20 §4). The rows stay
// in `action` (migration 001) until the actions plugin has imported them through the read `legacyActions` (its own
// data step); this step then deletes the rows it imported (ids up to the last one imported), so there is one copy. Until then nothing in this plugin shows them.
// The emptied table is kept (plan ruling R2): a data step may not change the schema.
import { Type, type PluginContext } from "@ttybrain/api"

const Opt = Type.Union([Type.String(), Type.Null()])
const OptId = Type.Union([Type.Integer(), Type.Null()])
const LegacyAction = Type.Object({
  id: Type.Integer(),
  title: Type.String(),
  due_date: Opt,
  status: Type.String(),
  done_date: Opt,
  owner_id: OptId,
  project_id: OptId,
  for_person_id: OptId,
  meeting_id: OptId,
  notes: Opt,
  created_at: Type.String(),
  updated_at: Type.String(),
})

export function registerHandover(ctx: PluginContext): void {
  ctx.expose({
    read: {
      // Every action row still in this plugin's table, every column, by id.
      legacyActions: {
        input: Type.Object({}),
        output: Type.Object({ actions: Type.Array(LegacyAction) }),
        run: async () => ({ actions: await ctx.data.selectFrom("action").selectAll().orderBy("id").execute() }),
      },
    },
  })

  ctx.upgrade("actions-handover", async () => {
    const actions = ctx.read("actions")?.importedLegacy
    const done = actions === undefined ? undefined : ((await actions({})) as { imported: boolean; lastId: number | null })
    if (done === undefined || !done.imported) return "later"
    if (done.lastId !== null) await ctx.data.deleteFrom("action").where("id", "<=", done.lastId).execute()
    return "done"
  })
}
