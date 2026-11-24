// The one-time handover of the boards the meetings plugin used to own (meetings 2.1; plan ruling P2). meetings
// exposes its rows through the read `legacyBoards`; this step copies every one with the same id, code, name, note,
// archived_at, from_project_id and timestamps, records the import in `handover`, and meetings then empties its table
// once `importedLegacy` says so (meetings' own step). Each step is its own transaction, so at every commit there is one
// live copy: this import commits first, and meetings shows none of its rows meanwhile. The table is AUTOINCREMENT, so
// inserting the ids sets its counter: the next board gets the highest id + 1. Meetings, series, talk items and action
// links name a board by (`board`, id), and provenance by record type `board` and id: they all carry over unchanged.
import { currentContext, ValidationError, type PluginContext } from "@ttybrain/api"

const COLUMNS = ["id", "code", "name", "note", "archived_at", "from_project_id", "created_at", "updated_at"] as const
type LegacyBoard = Record<(typeof COLUMNS)[number], unknown>

// Boards added before the import with meetings unreadable (off at the upgrade) get ids above RESERVED (ops.ts), so the
// moved ids cannot be taken. Should an id or a code be taken anyway, nothing moves and nothing is changed.
export const RESERVED = 1_000_000
export function collision(what: string[]): ValidationError {
  return new ValidationError(`cannot move the meetings plugin's boards: ${what.join(", ")} ${what.length === 1 ? "is" : "are"} already taken in the boards plugin`, {
    hint: "your data is untouched (the boards stay in the meetings plugin until they can move); give the board added since another code: ttybrain board edit <#CODE> --code <CODE>",
  })
}

export const imported = async (ctx: PluginContext) =>
  (await ctx.data.selectFrom("handover").select("source").where("source", "=", "meetings").executeTakeFirst()) !== undefined

export function registerHandover(ctx: PluginContext): void {
  ctx.upgrade("from-meetings", async () => {
    // Without meetings the rows wait in its table; they move on a later start that has both plugins.
    const legacy = ctx.read("meetings")?.legacyBoards
    if (legacy === undefined) return "later"
    if (await imported(ctx)) return "done"
    const db = ctx.data
    const { boards } = (await legacy({})) as { boards: LegacyBoard[] }
    // Ids and codes are kept, so one that is already taken (a board added while meetings was off) stops the move whole.
    const taken: string[] = []
    for (const b of boards) {
      const id = await db.selectFrom("board").select("code").where("id", "=", Number(b.id)).executeTakeFirst()
      if (id) taken.push(`id ${b.id} (#${id.code})`)
      const code = await db.selectFrom("board").select("id").where("code", "=", String(b.code)).executeTakeFirst()
      if (code) taken.push(`#${b.code}`)
    }
    if (taken.length > 0) throw collision(taken)
    for (const b of boards) {
      await db.insertInto("board").values(Object.fromEntries(COLUMNS.map((c) => [c, b[c] ?? null]))).execute()
      await db.insertInto("handover_row").values({ source: "meetings", id: b.id, updated_at: b.updated_at }).execute()
    }
    await db.insertInto("handover").values({ source: "meetings", rows: boards.length, imported_at: currentContext().now }).execute()
    return "done"
  })
}
