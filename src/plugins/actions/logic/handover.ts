// The one-time handover of the actions the projects plugin used to own (design §4, "Moving existing actions").
// projects exposes its rows through the read `legacyActions`; this step copies every one with the same id and
// timestamps, records the import in `handover`, and projects then empties its table once `importedLegacy` says so
// (projects' own step). Each step is its own transaction, so at every commit there is one live copy: this import
// commits first, and projects shows none of its rows meanwhile. Provenance (kernel_record_origin, record type
// "action") and change-set history name the same refs, so they carry over unchanged.
import { currentContext, formatRef, ValidationError, type PluginContext } from "@ttybrain/api"

const COLUMNS = ["id", "title", "due_date", "status", "done_date", "owner_id", "project_id", "for_person_id", "meeting_id", "notes", "created_at", "updated_at"] as const
type LegacyAction = Record<(typeof COLUMNS)[number], unknown>

// Actions added before the import (projects off at the upgrade) get ids above RESERVED (ops.ts), so the moved ids
// cannot be taken. Should one be taken anyway, nothing moves and nothing is changed: deleting an action would also
// erase the origins the moved one with that id carries, so the hint says not to.
export const RESERVED = 1_000_000
export function collision(refs: string[]): ValidationError {
  const one = refs.length === 1
  return new ValidationError(`cannot move the projects plugin's actions: ${refs.join(", ")} ${one ? "already exists" : "already exist"} in the actions plugin`, {
    hint: "this should not happen; your data is untouched (the actions stay in the projects plugin until they can move). Don't delete actions to make room: report it",
  })
}

export function registerHandover(ctx: PluginContext): void {
  ctx.upgrade("from-projects", async () => {
    // Without projects the rows wait in its table; they move on a later start that has both plugins.
    const legacy = ctx.read("projects")?.legacyActions
    if (legacy === undefined) return "later"
    const db = ctx.data
    if (await db.selectFrom("handover").select("source").where("source", "=", "projects").executeTakeFirst()) return "done"
    const { actions } = (await legacy({})) as { actions: LegacyAction[] }
    // Ids are kept, so one that is already taken (an action added while projects was off) stops the move whole.
    const ids = actions.map((a) => Number(a.id))
    const taken = new Set<number>()
    for (let i = 0; i < ids.length; i += 500)
      for (const r of await db.selectFrom("action").select("id").where("id", "in", ids.slice(i, i + 500)).execute()) taken.add(Number(r.id))
    if (taken.size > 0) throw collision([...taken].sort((a, b) => a - b).map((n) => formatRef("A-", n)))
    for (const a of actions) {
      await db.insertInto("action").values(Object.fromEntries(COLUMNS.map((c) => [c, a[c] ?? null]))).execute()
      await db.insertInto("handover_row").values({ source: "projects", id: a.id, updated_at: a.updated_at }).execute()
    }
    await db.insertInto("handover").values({ source: "projects", rows: actions.length, imported_at: currentContext().now }).execute()
    return "done"
  })
}
