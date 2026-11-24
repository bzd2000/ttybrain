// Boards are the boards plugin's (meetings 3.0.0; plan ruling P1): it owns the `board` records (`#MB`), their table,
// commands and the boards.board view, which this plugin reads. Here, what meetings keeps of them:
// - the read `boardActivity`: a board's series, next meeting and open talk items (boards' `board show`);
// - the handover of the boards this plugin owned in 2.1 (ruling P2): the reads `legacyBoards` and `legacyMaxId`, and
//   the steps `boards-handover` (empty the own `board` table once boards has imported it) and `boards-leftovers`;
// - the one-time `boards-from-projects` data step, which makes its boards through boards' addBoard, and the notice
//   that names what it made.
import { currentContext, formatRef, Type, ValidationError, type PluginContext } from "@ttybrain/api"
import { seriesLine } from "./commands"
import type { Store } from "./records"

const Opt = Type.Union([Type.String(), Type.Null()])
const OptId = Type.Union([Type.Integer(), Type.Null()])
const LegacyBoard = Type.Object({
  id: Type.Integer(),
  code: Type.String(),
  name: Type.String(),
  note: Opt,
  archived_at: Opt,
  from_project_id: OptId,
  created_at: Type.String(),
  updated_at: Type.String(),
})

export function registerBoards(ctx: PluginContext, store: Store): void {
  const db = ctx.data
  ctx.expose({
    read: {
      // A board's series, its next planned meeting from today and its open talk items, by the board's id.
      boardActivity: {
        input: Type.Object({ board: Type.Integer() }),
        output: Type.Object({
          series: Type.Array(Type.Object({ ref: Type.String(), line: Type.String() })),
          next: Type.Union([Type.Object({ ref: Type.String(), title: Type.String(), date: Type.String() }), Type.Null()]),
          talk: Type.Integer(),
        }),
        run: async (i: { board: number }) => {
          const ids = await db.selectFrom("series").select("id").where("subject_type", "=", "board").where("subject_id", "=", i.board).orderBy("id").execute()
          const series = []
          for (const s of ids) {
            const rec = await store.series(formatRef("S-", Number(s.id)))
            series.push({ ref: rec.ref, line: seriesLine(rec) })
          }
          const next = await db
            .selectFrom("meeting")
            .select(["id", "title", "date"])
            .where("subject_type", "=", "board")
            .where("subject_id", "=", i.board)
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
            .where("subject_id", "=", i.board)
            .where("status", "=", "open")
            .executeTakeFirstOrThrow()
          return {
            series,
            next: next ? { ref: formatRef("M-", Number(next.id)), title: String(next.title), date: String(next.date) } : null,
            talk: Number(open.n),
          }
        },
      },
      // The highest board id this plugin knows (0 when none): of its board table, and of the boards its meetings,
      // series and talk items name (a board deleted long ago may still be named). The boards plugin allocates above
      // it, so no new board takes an id something here already points at.
      legacyMaxId: {
        input: Type.Object({}),
        output: Type.Object({ max: Type.Integer() }),
        run: async () => {
          let max = Number((await db.selectFrom("board").select((eb) => eb.fn.max("id").as("m")).executeTakeFirst())?.m ?? 0)
          for (const table of ["meeting", "series", "talk_item"] as const) {
            const row = await db.selectFrom(table).select((eb) => eb.fn.max("subject_id").as("m")).where("subject_type", "=", "board").executeTakeFirst()
            max = Math.max(max, Number(row?.m ?? 0))
          }
          return { max }
        },
      },
      // Every board row still in this plugin's table, by id (talk_stayed is not a board's: it stays, migration 008).
      legacyBoards: {
        input: Type.Object({}),
        output: Type.Object({ boards: Type.Array(LegacyBoard) }),
        run: async () => ({
          boards: await db.selectFrom("board").select(["id", "code", "name", "note", "archived_at", "from_project_id", "created_at", "updated_at"]).orderBy("id").execute(),
        }),
      },
    },
  })

  type Imported = { imported: boolean; rows: Array<{ id: number; updated_at: string }> }
  const imported = async (): Promise<Imported | undefined> => {
    const read = ctx.read("boards")?.importedLegacy
    const out = read === undefined ? undefined : ((await read({})) as Imported)
    return out?.imported ? out : undefined
  }
  // The rows boards imported go (each (id, updated_at) it reports); the emptied table stays (no DDL in a step).
  ctx.upgrade("boards-handover", async () => {
    const done = await imported()
    if (done === undefined) return "later"
    for (const r of done.rows) await db.deleteFrom("board").where("id", "=", r.id).where("updated_at", "=", r.updated_at).execute()
    return "done"
  })
  // Rows the handover did not take: named (as an error that keeps the step pending) rather than silently stranded.
  ctx.upgrade("boards-leftovers", async () => {
    if ((await imported()) === undefined) return "later"
    const left = await db.selectFrom("board").select("id").orderBy("id").execute()
    if (left.length === 0) return "done"
    throw new ValidationError(`the meetings plugin's board table still holds rows the boards plugin did not take (id ${left.map((r) => Number(r.id)).join(", ")})`, {
      hint: "an older ttybrain wrote them after the boards moved; they are kept as they are (nothing shows them); report it",
    })
  })

  registerBoardsFromProjects(ctx, store)
}

// B3: before boards existed, a board meeting was about a project (such as BOARD). For every project that is the
// subject of a board-kind series or meeting, one board is made (boards' addBoard, from the project) with the project's
// name and the code `<CODE>B` (the project keeps `<CODE>`: codes are one namespace; the code is cut to fit 16
// characters, with a digit added while it is taken). What moves to it:
// - each board-kind series, with all its occurrences (whatever kind one was given: on a board, it is a board meeting);
// - each board-kind meeting outside such a series (a one-off, or one occurrence of a project series), alone;
// - the project's open talk items, in their order, when nothing else is left on the project (no other meeting or
//   series): they were the board's talk-list. Otherwise they stay on the project (`board_talk_stayed`), and the
//   notice says so.
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
      (await db.selectFrom("boards.board").select("id").where("code", "=", c).executeTakeFirst()) !== undefined ||
      (await db.selectFrom("projects.project").select("id").where("code", "=", c).executeTakeFirst()) !== undefined
    let c = `${project.slice(0, 15)}B` // the code is cut, not the B (cut off, it would be the project's own code)
    for (let n = 2; await taken(c); n++) c = `${project.slice(0, 16 - 1 - String(n).length)}B${n}`
    const board = (await ctx.use("boards")!.write.addBoard!({ code: c, name: String(p.name), fromProject: `#${project}` })) as { id: number }
    const onBoard = { subject_type: "board", subject_id: board.id }
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
      if (open) await db.insertInto("board_talk_stayed").values({ board_id: board.id }).execute()
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
  // Until such a board is first edited (or archived; boards' madeFromProjects): named, so the user can give it a
  // better code; and, when the step left the project's open talk items on it (decided then: `board_talk_stayed`),
  // that they stayed there.
  ctx.notices(async () => {
    const read = ctx.read("boards")?.madeFromProjects
    if (read === undefined) return []
    const { boards } = (await read({})) as { boards: Array<{ id: number; project_id: number }> }
    const lines: string[] = []
    for (const r of boards) {
      const b = await store.boardById(r.id)
      if (b === null) continue
      const project = await store.subjectRef("project", r.project_id)
      const known = project.startsWith("#")
      const stayed = known && (await ctx.data.selectFrom("board_talk_stayed").select("board_id").where("board_id", "=", r.id).executeTakeFirst()) !== undefined
      const stay = stayed ? `; open talk items stay on ${project}` : ""
      lines.push(`board ${b.ref} "${b.name}" now holds the board meetings of ${known ? `project ${project}` : "a project"}${stay}; rename it: ttybrain board edit ${b.ref} --code <CODE>`)
    }
    return lines
  })
}
