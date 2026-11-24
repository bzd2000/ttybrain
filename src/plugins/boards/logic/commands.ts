// The `ttybrain board` commands: add, list [--archived], show, edit [--name --code --note --no-note], archive and
// restore, each with --json. `show` adds the board's series, next meeting and open talk items, which are the meetings
// plugin's (its read `boardActivity`; without meetings there is none to show).
import { formatTable, ValidationError, type FlagDef, type PluginContext } from "@ttybrain/api"
import type { Store } from "./records"
import type { BoardRecord } from "./schema"

type Activity = { series: Array<{ ref: string; line: string }>; next: { ref: string; title: string; date: string } | null; talk: number }
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

export function registerCommands(ctx: PluginContext, store: Store): void {
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
      const read = ctx.read("meetings")?.boardActivity
      const a: Activity = read === undefined ? { series: [], next: null, talk: 0 } : ((await read({ board: b.id })) as Activity)
      const lines = [head(b)]
      if (b.note) lines.push(`  note: ${b.note}`)
      for (const s of a.series) lines.push(`  series: ${s.line}`)
      if (a.next) lines.push(`  next: ${a.next.ref} ${a.next.title} on ${a.next.date}`)
      if (a.talk > 0) lines.push(`  talk: ${plural(a.talk, "open item")}`)
      return { json: { ...b, series: a.series.map((s) => s.ref), next: a.next?.ref ?? null, talk: a.talk }, text: lines.join("\n") }
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
