// Boards (design §5.7, plan rulings B2, B3): a board such as `#MB` "Management board" is the subject of board meetings
// and series, has a talk-list and actions linked to it. Here: the `board` record type and `#` tag (sharing the prefix
// with projects), the operations addBoard, editBoard, archiveBoard and restoreBoard, the `ttybrain board` commands,
// the one-time `boards-from-projects` data step and the notice that names what it made. Board codes and project codes
// are one namespace: each owner refuses the other's codes (this plugin through projects.project, projects through
// meetings.board).
import {
  ConflictError,
  currentContext,
  formatRef,
  formatTable,
  isValidCode,
  NonBlank,
  Type,
  ValidationError,
  ViewUnavailableError,
  type FlagDef,
  type PluginContext,
  type Static,
} from "@ttybrain/api"
import { seriesLine } from "./commands"
import type { Store } from "./records"
import { BoardRecord } from "./schema"

const AddBoard = Type.Object({ code: NonBlank(), name: NonBlank(), note: Type.Optional(Type.String()) })
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
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

export function registerBoards(ctx: PluginContext, store: Store): void {
  const db = ctx.data

  function code(input: string): string {
    const c = codeInput(input)
    if (!isBoardCode(c)) throw new ValidationError(`invalid board code "${c}"`, { field: "code", hint: CODE_HINT })
    return c
  }
  // A code no other board (but `own`) and no project has.
  async function free(c: string, own?: number): Promise<void> {
    const b = await store.boardCodeId(c)
    if (b !== null && b !== own) throw new ConflictError(`board "${c}" already exists`, { hint: "choose another code" })
    let project: unknown
    try {
      project = await db.selectFrom("projects.project").select("id").where("code", "=", c).executeTakeFirst()
    } catch (e) {
      if (!(e instanceof ViewUnavailableError)) throw e
    }
    if (project) throw new ConflictError(`code "${c}" is already used by the project #${c}`, { hint: NAMESPACE_HINT })
  }
  const label = async (input: string) => {
    const id = await store.boardCodeId(input)
    return id === null ? codeInput(input) : (await store.boardById(id)).code
  }

  ctx.expose({
    write: {
      addBoard: {
        input: AddBoard,
        output: BoardRecord,
        describe: (i: AddInput) => `+ board ${codeInput(i.code)} "${i.name.trim()}"`,
        run: async (i: AddInput) => {
          const c = code(i.code)
          await free(c)
          const t = now()
          const res = await db
            .insertInto("board")
            .values({ code: c, name: i.name.trim(), note: clean(i.note) ?? null, archived_at: null, from_project_id: null, created_at: t, updated_at: t })
            .executeTakeFirstOrThrow()
          return store.boardById(Number(res.insertId))
        },
      },
      // Any edit also settles the board the data step made (its notice is gone).
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

  // `#MB`, sharing the `#` prefix with projects (kernel: a shared prefix); by code only.
  ctx.recordType({
    name: "board",
    prefix: "#",
    sharedPrefix: true,
    resolve: (input) => store.boardCodeId(input),
    label: async (id) => (await store.boardById(id)).name,
    ref: async (id) => (await store.boardById(id)).ref,
    search: async (text, limit) => {
      const like = `%${text.trim().replace(/^#/, "")}%`
      const rows = await db
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

  registerBoardCommands(ctx, store)
  registerBoardsFromProjects(ctx, store)
}

function registerBoardCommands(ctx: PluginContext, store: Store): void {
  const write = () => ctx.self().write
  const db = ctx.data
  const text = (description: string, placeholder: string): FlagDef => ({ type: "string", description, placeholder })
  const head = (b: BoardRecord) => `${b.ref} ${b.name}${b.archived ? " (archived)" : ""}`

  ctx.command({
    thing: "board",
    verb: "add",
    summary: "add a board (its code is shared with projects: no project may have it)",
    args: [
      { name: "code", required: true },
      { name: "name", required: true },
    ],
    flags: { note: text("a note on the board", "text") },
    run: async ({ args, flags }) => {
      const b: BoardRecord = await write().addBoard!({ code: args.code, name: args.name, ...(flags.note !== undefined ? { note: flags.note } : {}) })
      return { json: b, text: `${b.ref} ${b.name}` }
    },
  })

  ctx.command({
    thing: "board",
    verb: "list",
    summary: "list the boards",
    flags: { archived: { type: "boolean", description: "archived boards only" } },
    run: async ({ flags }) => {
      const rows = await db.selectFrom("board").select("id").where("archived_at", flags.archived ? "is not" : "is", null).orderBy("code").execute()
      const boards: BoardRecord[] = []
      for (const r of rows) boards.push(await store.boardById(Number(r.id)))
      return {
        json: boards,
        text: boards.length ? formatTable(["code", "name", "note"], boards.map((b) => ({ code: b.code, name: b.name, note: b.note ?? "" }))) : "no boards",
      }
    },
  })

  ctx.command({
    thing: "board",
    verb: "show",
    summary: "show a board with its series, its next meeting and its open talk items",
    args: [{ name: "board", required: true }],
    run: async ({ args }) => {
      const b = await store.board(String(args.board))
      const seriesIds = await db.selectFrom("series").select("id").where("subject_type", "=", "board").where("subject_id", "=", b.id).orderBy("id").execute()
      const series = []
      for (const s of seriesIds) series.push(await store.series(formatRef("S-", Number(s.id))))
      const next = await db
        .selectFrom("meeting")
        .select(["id", "title", "date"])
        .where("subject_type", "=", "board")
        .where("subject_id", "=", b.id)
        .where("status", "=", "planned")
        .where("date", ">=", currentContext().today)
        .orderBy("date")
        .orderBy("id")
        .limit(1)
        .executeTakeFirst()
      const open = await db
        .selectFrom("talk_item")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("subject_type", "=", "board")
        .where("subject_id", "=", b.id)
        .where("status", "=", "open")
        .executeTakeFirstOrThrow()
      const talk = Number(open.n)
      const lines = [head(b)]
      if (b.note) lines.push(`  note: ${b.note}`)
      for (const s of series) lines.push(`  series: ${seriesLine(s)}`)
      if (next) lines.push(`  next: ${formatRef("M-", Number(next.id))} ${next.title} on ${next.date}`)
      if (talk > 0) lines.push(`  talk: ${plural(talk, "open item")}`)
      return { json: { ...b, series: series.map((s) => s.ref), next: next ? formatRef("M-", Number(next.id)) : null, talk }, text: lines.join("\n") }
    },
  })

  ctx.command({
    thing: "board",
    verb: "edit",
    summary: "change a board's name or note; --code renames it (its meetings, series, talk items and links follow)",
    args: [{ name: "board", required: true }],
    flags: {
      name: text("the board name", "name"),
      code: text("a new code (2–16 letters or digits, at least one letter)", "code"),
      note: text("a note on the board", "text"),
      "no-note": { type: "boolean", description: "remove the note" },
    },
    run: async ({ args, flags }) => {
      if (flags.note !== undefined && flags["no-note"]) throw new ValidationError("use --note or --no-note, not both", { field: "note" })
      const b: BoardRecord = await write().editBoard!({
        board: args.board,
        ...(flags.name !== undefined ? { name: flags.name } : {}),
        ...(flags.code !== undefined ? { code: flags.code } : {}),
        ...(flags.note !== undefined ? { note: flags.note } : flags["no-note"] ? { note: null } : {}),
      })
      return { json: b, text: head(b) }
    },
  })

  for (const [verb, op, summary] of [
    ["archive", "archiveBoard", "archive a board: it takes no new meetings, series or talk items and its series make no new meetings, until restored (boards are never deleted)"],
    ["restore", "restoreBoard", "restore an archived board"],
  ] as const) {
    ctx.command({
      thing: "board",
      verb,
      summary,
      args: [{ name: "board", required: true }],
      run: async ({ args }) => {
        const b: BoardRecord = await write()[op]!({ board: args.board })
        return { json: b, text: `${b.ref} ${verb}d` }
      },
    })
  }
}

// B3: before boards existed, a board meeting was about a project (such as BOARD). For every project that is the
// subject of a board-kind series or meeting, one board is made with the project's name and the code `<CODE>B` (the
// project keeps `<CODE>`: codes are one namespace; the code is cut to fit 16 characters, with a digit added while it is
// taken). What moves to it:
// - each board-kind series, with all its occurrences (whatever kind one was given: on a board, it is a board meeting);
// - each board-kind meeting outside such a series (a one-off, or one occurrence of a project series), alone;
// - the project's open talk items, in their order, when nothing else is left on the project (no other meeting or
//   series): they were the board's talk-list. Otherwise they stay on the project, and the notice says so.
// Ids, notes, agendas, attendees, talk items discussed or kept in a meeting, linked actions: all stay as they are.
// The project keeps its code and everything else. Returns the boards made.
export async function boardsFromProjects(ctx: PluginContext): Promise<Array<{ board: string; project: string; talk: boolean }>> {
  const db = ctx.data
  const boardSeries = (pid?: number) => {
    let q = db.selectFrom("series").select(["id", "subject_id"]).where("kind", "=", "board").where("subject_type", "=", "project")
    if (pid !== undefined) q = q.where("subject_id", "=", pid)
    return q.execute()
  }
  const boardMeetings = () => db.selectFrom("meeting").select("subject_id").where("kind", "=", "board").where("subject_type", "=", "project").execute()
  const ids = [...new Set([...(await boardSeries()), ...(await boardMeetings())].map((r) => Number(r.subject_id)))].sort((a, b) => a - b)
  const made: Array<{ board: string; project: string; talk: boolean }> = []
  for (const pid of ids) {
    const p = await db.selectFrom("projects.project").select(["code", "name"]).where("id", "=", pid).executeTakeFirst()
    if (!p) continue // a project that is gone: its meetings stay as they are
    const project = String(p.code)
    const taken = async (c: string) =>
      (await db.selectFrom("board").select("id").where("code", "=", c).executeTakeFirst()) !== undefined ||
      (await db.selectFrom("projects.project").select("id").where("code", "=", c).executeTakeFirst()) !== undefined
    let c = `${project.slice(0, 15)}B` // the code is cut, not the B (cut off, it would be the project's own code)
    for (let n = 2; await taken(c); n++) c = `${project.slice(0, 16 - 1 - String(n).length)}B${n}`
    const t = currentContext().now
    const res = await db
      .insertInto("board")
      .values({ code: c, name: String(p.name), note: null, archived_at: null, from_project_id: pid, created_at: t, updated_at: t })
      .executeTakeFirstOrThrow()
    const bid = Number(res.insertId)
    const onBoard = { subject_type: "board", subject_id: bid }
    const series = (await boardSeries(pid)).map((s) => Number(s.id))
    if (series.length > 0) {
      await db.updateTable("meeting").set({ ...onBoard, kind: "board" }).where("series_id", "in", series).execute()
      await db.updateTable("series").set(onBoard).where("id", "in", series).execute()
    }
    await db.updateTable("meeting").set(onBoard).where("kind", "=", "board").where("subject_type", "=", "project").where("subject_id", "=", pid).execute()
    // Nothing else left on the project: its open talk items were the board's (positions are kept: the board is new).
    const left = async (table: "meeting" | "series") =>
      (await db.selectFrom(table).select("id").where("subject_type", "=", "project").where("subject_id", "=", pid).executeTakeFirst()) !== undefined
    const talk = !(await left("meeting")) && !(await left("series"))
    if (talk) await db.updateTable("talk_item").set(onBoard).where("subject_type", "=", "project").where("subject_id", "=", pid).where("status", "=", "open").execute()
    else {
      const open = await db.selectFrom("talk_item").select("id").where("subject_type", "=", "project").where("subject_id", "=", pid).where("status", "=", "open").executeTakeFirst()
      if (open) await db.updateTable("board").set({ talk_stayed: 1 }).where("id", "=", bid).execute()
    }
    made.push({ board: `#${c}`, project: `#${project}`, talk })
  }
  return made
}

function registerBoardsFromProjects(ctx: PluginContext, store: Store): void {
  ctx.upgrade("boards-from-projects", async () => {
    await boardsFromProjects(ctx)
    return "done"
  })
  // Until such a board is first edited (or archived): named, so the user can give it a better code; and, when the
  // step left the project's open talk items on it (decided then: `talk_stayed`), that they stayed there.
  ctx.notices(async () => {
    const rows = await ctx.data.selectFrom("board").select(["id", "from_project_id", "talk_stayed"]).where("from_project_id", "is not", null).orderBy("code").execute()
    const lines: string[] = []
    for (const r of rows) {
      const b = await store.boardById(Number(r.id))
      const pid = Number(r.from_project_id)
      const project = await store.subjectRef("project", pid)
      const known = project.startsWith("#")
      const stay = known && Number(r.talk_stayed) === 1 ? `; open talk items stay on ${project}` : ""
      lines.push(`board ${b.ref} "${b.name}" now holds the board meetings of ${known ? `project ${project}` : "a project"}${stay}; rename it: ttybrain board edit ${b.ref} --code <CODE>`)
    }
    return lines
  })
}
