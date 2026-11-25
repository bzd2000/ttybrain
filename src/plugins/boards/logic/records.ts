// Lookups shared by the operations and the commands (reading the plugin's own table), and the `board` record type
// (`#MB`) with its `#` tag type, both sharing the prefix with projects (kernel: a shared prefix). A board resolves by
// code only, never by id: codes have a letter, so `#12` stays a project's number.
import { normalizeCode, NotFoundError, suggest, ValidationError, type PluginContext, type PluginRuntime } from "@ttybrain/api"
import type { BoardRecord } from "./schema"

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
// Which type a `#CODE` is, as an error says it.
const NAMES: Record<string, string> = { project: "a project", board: "a board" }

export type Store = ReturnType<typeof makeStore>

export function makeStore(ctx: PluginRuntime) {
  const db = ctx.data

  const toBoard = (r: Record<string, unknown>): BoardRecord => ({
    ref: `#${r.code}`,
    id: Number(r.id),
    code: String(r.code),
    name: String(r.name),
    note: str(r.note),
    archived: r.archived_at !== null,
  })
  const boardRow = () => db.selectFrom("board").select(["id", "code", "name", "note", "archived_at"])
  async function boardCodeId(input: string): Promise<number | null> {
    const row = await db.selectFrom("board").select("id").where("code", "=", normalizeCode(input)).executeTakeFirst()
    return row ? Number(row.id) : null
  }
  async function boardById(id: number): Promise<BoardRecord> {
    const row = await boardRow().where("id", "=", id).executeTakeFirst()
    if (!row) throw new NotFoundError(`no board with id ${id}`)
    return toBoard(row)
  }
  async function boardCodes(): Promise<string[]> {
    return (await db.selectFrom("board").select("code").orderBy("code").execute()).map((r) => String(r.code))
  }
  // `#CODE` that names a record of another type (a project where a board is needed): that error, else undefined. A
  // code two types both know (a data error) throws the kernel's ValidationError.
  async function otherType(code: string, hint: string): Promise<ValidationError | undefined> {
    const found = await ctx.records.resolve(`#${code}`)
    if (!found || found.type === "board") return undefined
    return new ValidationError(`#${code} is ${NAMES[found.type] ?? `a ${found.type}`}, not a board`, { hint })
  }
  async function board(input: string): Promise<BoardRecord> {
    const code = normalizeCode(input)
    const id = await boardCodeId(code)
    if (id !== null) return boardById(id)
    throw (
      (await otherType(code, 'run "ttybrain board list" for the board codes')) ??
      new NotFoundError(`unknown board "${code}"`, { suggestions: suggest(code, await boardCodes()) })
    )
  }
  // A board that may take edits: not archived.
  async function activeBoard(input: string): Promise<BoardRecord> {
    const b = await board(input)
    if (b.archived) throw new ValidationError(`${b.ref} is archived`, { hint: `restore it first: ttybrain board restore ${b.ref}` })
    return b
  }

  return { boardCodeId, boardById, boardCodes, board, activeBoard }
}

export function registerRecordTypes(ctx: PluginContext, store: Store): void {
  ctx.recordType({
    name: "board",
    prefix: "#",
    sharedPrefix: true,
    resolve: (input) => store.boardCodeId(input),
    label: async (id) => (await store.boardById(id)).name,
    ref: async (id) => (await store.boardById(id)).ref,
    search: async (text, limit) => {
      const like = `%${text.trim().replace(/^#/, "")}%`
      const rows = await ctx.data
        .selectFrom("board")
        .select(["code", "name"])
        .where((eb) => eb.or([eb("name", "like", like), eb("code", "like", like)]))
        .where("archived_at", "is", null)
        .orderBy("code")
        .limit(limit)
        .execute()
      return rows.map((r) => ({ ref: `#${r.code}`, label: String(r.name) }))
    },
  })
  ctx.tagType({ prefix: "#", recordType: "board", sharedPrefix: true, resolve: (token) => store.boardCodeId(token) })
}
