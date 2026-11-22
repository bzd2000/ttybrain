// The handover of the actions this plugin used to own to the actions plugin (design 2026-11-20 §4). The rows stay
// in `action` (migration 001) until the actions plugin has imported them through the read `legacyActions` (its own
// data step); this step then deletes the rows it imported (each (id, updated_at) actions reports), so there is one
// copy. A row that does not match (an older build wrote it after the move, R4) is kept, and the step
// "actions-leftovers" names it in `ttybrain plugin list` until it is gone. Until then nothing in this plugin shows them.
// The emptied table is kept (plan ruling R2): a data step may not change the schema.
import { Type, ValidationError, type PluginContext } from "@ttybrain/api"

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
      // The highest id still in this plugin's action table (0 when empty); the actions plugin allocates above it.
      legacyMaxId: {
        input: Type.Object({}),
        output: Type.Object({ max: Type.Integer() }),
        run: async () => {
          const row = await ctx.data.selectFrom("action").select((eb) => eb.fn.max("id").as("m")).executeTakeFirst()
          return { max: Number(row?.m ?? 0) }
        },
      },
      // Every action row still in this plugin's table, every column, by id.
      legacyActions: {
        input: Type.Object({}),
        output: Type.Object({ actions: Type.Array(LegacyAction) }),
        run: async () => ({ actions: await ctx.data.selectFrom("action").selectAll().orderBy("id").execute() }),
      },
    },
  })

  type Imported = { imported: boolean; rows: Array<{ id: number; updated_at: string }> }
  const imported = async (): Promise<Imported | undefined> => {
    const read = ctx.read("actions")?.importedLegacy
    const out = read === undefined ? undefined : ((await read({})) as Imported)
    return out?.imported ? out : undefined
  }
  ctx.upgrade("actions-handover", async () => {
    const done = await imported()
    if (done === undefined) return "later"
    for (const r of done.rows) await ctx.data.deleteFrom("action").where("id", "=", r.id).where("updated_at", "=", r.updated_at).execute()
    return "done"
  })
  // Rows the handover did not take: named (as an error that keeps the step pending) rather than silently stranded.
  ctx.upgrade("actions-leftovers", async () => {
    if ((await imported()) === undefined) return "later"
    const left = await ctx.data.selectFrom("action").select("id").orderBy("id").execute()
    if (left.length === 0) return "done"
    const ids = left.map((r) => Number(r.id)).join(", ")
    throw new ValidationError(`the projects plugin's action table still holds rows the actions plugin did not take (id ${ids})`, {
      hint: "an older ttybrain wrote them after the actions moved; they are kept as they are (nothing shows them); report it",
    })
  })
}
