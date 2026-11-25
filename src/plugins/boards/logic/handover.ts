// The one-time handover of the boards the meetings plugin used to own (meetings 2.1; plan ruling P2). meetings
// exposes its rows through the read `legacyBoards`; this step copies every one with the same id, code, name, note,
// archived_at, from_project_id and timestamps, records the import in `handover`, and meetings then empties its table
// once `importedLegacy` says so (meetings' own step). Each step is its own transaction, so at every commit there is one
// live copy: this import commits first, and meetings shows none of its rows meanwhile. The table is AUTOINCREMENT, so
// inserting the ids sets its counter, and the step moves it past the highest board id meetings still names: the next
// board gets the higher of the two + 1. Meetings, series, talk items and action links name a board by (`board`, id),
// and provenance by record type `board` and id: they all carry over unchanged.
import { currentContext, ValidationError, ViewUnavailableError, type PluginContext } from "@ttybrain/api"

const COLUMNS = ["id", "code", "name", "note", "archived_at", "from_project_id", "created_at", "updated_at"] as const
type LegacyBoard = Record<(typeof COLUMNS)[number], unknown>

// Boards added before the import with meetings unreadable (off at the upgrade) get ids above RESERVED (ops.ts), so the
// moved ids cannot be taken. Should an id or a code be taken anyway (a board added since, or a project given a moved
// board's code while boards was off: one namespace), nothing moves and nothing is changed; the hint says what to do
// about each kind of clash.
export const RESERVED = 1_000_000
const UNTOUCHED = "your data is untouched (the boards stay in the meetings plugin until they can move)"
export type Clashes = {
  ids: Array<{ id: number; code: string }> // a moved board's id, and the code of the board that has it
  codes: string[] // a moved board's code another board has
  projects: Array<{ code: string; board: string; project: string }> // a moved board's code a project has, both names
}
export function collision(c: Clashes): ValidationError {
  const list = (items: string[], one: string, many: string) => `${items.join(", ")} ${items.length === 1 ? one : many}`
  const taken = [...c.ids.map((x) => `id ${x.id} (#${x.code})`), ...c.codes.map((x) => `#${x}`)]
  const what = [
    ...(taken.length > 0 ? [list(taken, "is already taken in the boards plugin", "are already taken in the boards plugin")] : []),
    ...(c.projects.length === 0
      ? []
      : [list(c.projects.map((x) => `#${x.code}`), `is already used by the project #${c.projects[0]!.code}`, "are already used by projects")]),
  ]
  const hints = [
    UNTOUCHED,
    ...(c.ids.length > 0 ? ["a board added since has the id of one of them (the ids clash, not the codes), which should not happen: don't delete boards to make room, report it"] : []),
    ...(c.codes.length > 0 ? ["give the board added since another code: ttybrain board edit <#CODE> --code <CODE>"] : []),
    ...c.projects.map(
      (x) =>
        `the board #${x.code} "${x.board}" and the project #${x.code} "${x.project}" have the same code, and project and board codes share one namespace: give the project another code: ttybrain project edit #${x.code} --code <CODE>`,
    ),
  ]
  return new ValidationError(`cannot move the meetings plugin's boards: ${what.join("; ")}`, { hint: hints.join("; ") })
}

// The name of the project with that code (undefined: none, or projects cannot be read).
async function projectNamed(ctx: PluginContext, code: string): Promise<string | undefined> {
  try {
    const row = await ctx.data.selectFrom("projects.project").select("name").where("code", "=", code).executeTakeFirst()
    return row === undefined ? undefined : String(row.name)
  } catch (e) {
    if (!(e instanceof ViewUnavailableError)) throw e
    return undefined
  }
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
    // Ids and codes are kept, so one that is already taken (a board added while meetings was off, or a project given
    // the code while boards was off) stops the move whole.
    const clashes: Clashes = { ids: [], codes: [], projects: [] }
    for (const b of boards) {
      const id = await db.selectFrom("board").select("code").where("id", "=", Number(b.id)).executeTakeFirst()
      if (id) clashes.ids.push({ id: Number(b.id), code: String(id.code) })
      const code = await db.selectFrom("board").select("id").where("code", "=", String(b.code)).executeTakeFirst()
      if (code) clashes.codes.push(String(b.code))
      const project = await projectNamed(ctx, String(b.code))
      if (project !== undefined) clashes.projects.push({ code: String(b.code), board: String(b.name), project })
    }
    if (clashes.ids.length + clashes.codes.length + clashes.projects.length > 0) throw collision(clashes)
    for (const b of boards) {
      await db.insertInto("board").values(Object.fromEntries(COLUMNS.map((c) => [c, b[c] ?? null]))).execute()
      await db.insertInto("handover_row").values({ source: "meetings", id: b.id, updated_at: b.updated_at }).execute()
    }
    // The counter goes past the highest board id meetings still names (a board deleted long ago may be the subject
    // of meetings, series or talk items), so a new board never takes it: a row at that id, inserted and deleted again
    // in this step, moves an AUTOINCREMENT counter (it never goes back).
    const named = Number(((await ctx.read("meetings")!.legacyMaxId!({})) as { max: number }).max)
    const own = Number((await db.selectFrom("board").select((eb) => eb.fn.max("id").as("m")).executeTakeFirst())?.m ?? 0)
    if (named > own) {
      const t = currentContext().now
      await db.insertInto("board").values({ id: named, code: `-${named}`, name: "-", note: null, archived_at: null, from_project_id: null, created_at: t, updated_at: t }).execute()
      await db.deleteFrom("board").where("id", "=", named).execute()
    }
    await db.insertInto("handover").values({ source: "meetings", rows: boards.length, imported_at: currentContext().now }).execute()
    return "done"
  })
}
