// The operations: addBoard, editBoard, archiveBoard and restoreBoard (each with its change line), and the reads
// `importedLegacy` (the handover, handover.ts) and `madeFromProjects` (the boards a project's board meetings were
// moved to, until each is first edited or archived: meetings names them in its notice). Board codes and project codes
// are one namespace: a code a project has is refused here (through projects.project), and projects refuses a board's
// (through boards.board).
import { ConflictError, currentContext, isValidCode, NonBlank, normalizeCode, NotFoundError, Type, ValidationError, ViewUnavailableError, type PluginContext, type Static } from "@ttybrain/api"
import { imported, RESERVED } from "./handover"
import type { Store } from "./records"
import { BoardRecord } from "./schema"

const AddBoard = Type.Object({
  code: NonBlank(),
  name: NonBlank(),
  note: Type.Optional(Type.String()),
  fromProject: Type.Optional(NonBlank()), // the project (`#CRM`) the board is made from, as meetings' data step does
})
const EditBoard = Type.Object({
  board: NonBlank(),
  code: Type.Optional(NonBlank()), // a new code: everything follows the board by id
  name: Type.Optional(NonBlank()),
  note: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})
const BoardRef = Type.Object({ board: NonBlank() })
type AddInput = Static<typeof AddBoard>
type EditInput = Static<typeof EditBoard>

const CODE_HINT = "2–16 letters or digits with at least one letter, e.g. MB"
export const NAMESPACE_HINT = "project and board codes share one namespace; choose another code"
const now = () => currentContext().now
// A code as given (`#mb` → `MB`): what the ops validate and store, and what their change lines show.
const codeInput = (input: string) => input.trim().replace(/^#/, "").toUpperCase()
// At least one letter: a board resolves by code only, and `#12` stays a project's number.
export const isBoardCode = (c: string) => isValidCode(c) && /[A-Z]/.test(c)
const clean = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim())

export function registerOps(ctx: PluginContext, store: Store): void {
  const db = ctx.data

  function code(input: string): string {
    const c = codeInput(input)
    if (!isBoardCode(c)) throw new ValidationError(`invalid board code "${c}"`, { field: "code", hint: CODE_HINT })
    return c
  }
  // A project of projects.project by code (null while projects cannot be read).
  async function project(c: string): Promise<{ id: unknown } | undefined | null> {
    try {
      return await db.selectFrom("projects.project").select("id").where("code", "=", c).executeTakeFirst()
    } catch (e) {
      if (!(e instanceof ViewUnavailableError)) throw e
      return null
    }
  }
  // A code no other board (but `own`) and no project has.
  async function free(c: string, own?: number): Promise<void> {
    const b = await store.boardCodeId(c)
    if (b !== null && b !== own) throw new ConflictError(`board "${c}" already exists`, { hint: "choose another code" })
    if (await project(c)) throw new ConflictError(`code "${c}" is already used by the project #${c}`, { hint: NAMESPACE_HINT })
  }
  const label = async (input: string) => {
    const id = await store.boardCodeId(input)
    return id === null ? codeInput(input) : (await store.boardById(id)).code
  }
  // Until the meetings plugin's boards are imported, a new board's id goes on from the higher of our own maximum and
  // the highest id still waiting in meetings; only when meetings cannot be read (off, out of range) is it above
  // RESERVED, so it cannot take an id a moved board keeps. After the import, the table's own counter.
  async function newId(): Promise<number | undefined> {
    if (await imported(ctx)) return undefined
    const row = await db.selectFrom("board").select((eb) => eb.fn.max("id").as("m")).executeTakeFirst()
    const own = Number(row?.m ?? 0)
    const legacyMax = ctx.read("meetings")?.legacyMaxId
    if (legacyMax === undefined) return Math.max(own, RESERVED) + 1
    return Math.max(own, Number(((await legacyMax({})) as { max: number }).max)) + 1
  }

  ctx.expose({
    read: {
      // Whether the meetings plugin's boards were imported, and each imported (id, updated_at): meetings deletes
      // exactly those rows of its copy.
      importedLegacy: {
        input: Type.Object({}),
        output: Type.Object({ imported: Type.Boolean(), rows: Type.Array(Type.Object({ id: Type.Integer(), updated_at: Type.String() })) }),
        run: async () => {
          if (!(await imported(ctx))) return { imported: false, rows: [] }
          const rows = await db.selectFrom("handover_row").select(["id", "updated_at"]).where("source", "=", "meetings").orderBy("id").execute()
          return { imported: true, rows: rows.map((r) => ({ id: Number(r.id), updated_at: String(r.updated_at) })) }
        },
      },
      // The boards made from a project (addBoard's `fromProject`) and not edited or archived since, by code.
      madeFromProjects: {
        input: Type.Object({}),
        output: Type.Object({ boards: Type.Array(Type.Object({ id: Type.Integer(), project_id: Type.Integer() })) }),
        run: async () => {
          const rows = await db.selectFrom("board").select(["id", "from_project_id"]).where("from_project_id", "is not", null).orderBy("code").execute()
          return { boards: rows.map((r) => ({ id: Number(r.id), project_id: Number(r.from_project_id) })) }
        },
      },
    },
    write: {
      addBoard: {
        input: AddBoard,
        output: BoardRecord,
        describe: (i: AddInput) => `+ board ${codeInput(i.code)} "${i.name.trim()}"`,
        run: async (i: AddInput) => {
          const c = code(i.code)
          await free(c)
          let from: number | null = null
          if (i.fromProject !== undefined) {
            const pc = normalizeCode(i.fromProject)
            const p = await project(pc)
            if (!p) throw new NotFoundError(`unknown project "${pc}"`)
            from = Number(p.id)
          }
          const t = now()
          const id = await newId()
          const res = await db
            .insertInto("board")
            .values({ ...(id === undefined ? {} : { id }), code: c, name: i.name.trim(), note: clean(i.note) ?? null, archived_at: null, from_project_id: from, created_at: t, updated_at: t })
            .executeTakeFirstOrThrow()
          return store.boardById(id ?? Number(res.insertId))
        },
      },
      // Any edit also settles a board made from a project (meetings' notice about it is gone).
      editBoard: {
        input: EditBoard,
        output: BoardRecord,
        describe: async (i: EditInput) => {
          const current = await label(i.board)
          const renamed = i.code === undefined ? undefined : codeInput(i.code)
          const fields = [
            ...(renamed !== undefined && renamed !== current ? [`code → ${renamed}`] : []),
            ...(["name", "note"] as const).filter((f) => i[f] !== undefined),
          ]
          return `~ ${current} ${fields.length ? fields.join(", ") : "(no change)"}`
        },
        run: async (i: EditInput) => {
          const b = await store.activeBoard(i.board)
          const c = i.code === undefined ? b.code : code(i.code)
          if (c !== b.code) await free(c, b.id)
          const set: Record<string, unknown> = { from_project_id: null, updated_at: now() }
          if (c !== b.code) set.code = c
          if (i.name !== undefined) set.name = i.name.trim()
          if (i.note !== undefined) set.note = clean(i.note)
          await db.updateTable("board").set(set).where("id", "=", b.id).execute()
          return store.boardById(b.id)
        },
      },
      archiveBoard: {
        input: BoardRef,
        output: BoardRecord,
        describe: async (i: { board: string }) => `~ ${await label(i.board)} archived`,
        run: async (i: { board: string }) => {
          const b = await store.board(i.board)
          if (!b.archived) await db.updateTable("board").set({ archived_at: now(), from_project_id: null, updated_at: now() }).where("id", "=", b.id).execute()
          return store.boardById(b.id)
        },
      },
      restoreBoard: {
        input: BoardRef,
        output: BoardRecord,
        describe: async (i: { board: string }) => `~ ${await label(i.board)} restored`,
        run: async (i: { board: string }) => {
          const b = await store.board(i.board)
          if (b.archived) await db.updateTable("board").set({ archived_at: null, updated_at: now() }).where("id", "=", b.id).execute()
          return store.boardById(b.id)
        },
      },
    },
  })
}
