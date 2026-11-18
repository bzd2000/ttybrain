// `pm meeting …` and `pm meeting agenda <M-n> <verb> …`. Reads go through the plugin's own store; writes only
// through ctx.self().write.*, so they are validated, transactional and recorded like any other caller's.
// The dispatcher has no nested verbs, so `agenda` is one command: first positional the meeting, second the verb.
import { readFile } from "node:fs/promises"
import { addDays, currentContext, formatRef, formatTable, ValidationError, type FlagDef, type PluginContext } from "../../../kernel/api"
import type { Store } from "./records"
import { MEETING_KINDS, type MeetingRecord } from "./schema"

const text = (description: string, placeholder?: string): FlagDef => ({ type: "string", description, ...(placeholder ? { placeholder } : {}) })
const bool = (description: string): FlagDef => ({ type: "boolean", description })
const kindFlag: FlagDef = { type: "string", values: [...MEETING_KINDS], description: "board, steering or other (default other)" }

const RECENT_DAYS = 30
const AGENDA_VERBS = ["add", "edit", "move", "remove"]
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
const code = (project: string | null) => (project === null ? "" : project.replace(/^#/, ""))

// Exactly one of `--x` / `--no-x` at most; undefined when neither is given.
function exclusive(flags: Record<string, unknown>, name: string, no: string): void {
  if (flags[name] !== undefined && flags[no]) throw new ValidationError(`use --${name} or --${no}, not both`, { field: name })
}

function position(input: string | undefined, what: string): number {
  const n = Number(input)
  if (input === undefined || input.trim() === "" || !Number.isInteger(n) || n < 1) throw new ValidationError(`${what} must be a position (1, 2, …), not "${input ?? ""}"`, { field: what })
  return n
}

function meetingText(m: MeetingRecord): string {
  const lines = [`${m.ref} ${m.title}`, `  date: ${m.date}`, `  kind: ${m.kind}`, `  status: ${m.status}`]
  if (m.since_date) lines.push(`  since: ${m.since_date}`)
  if (m.attendees.length) lines.push(`  attendees: ${m.attendees.join(", ")}`)
  const blocks = [lines.join("\n")]
  if (m.agenda.length)
    blocks.push(
      `Agenda\n${m.agenda.map((a) => `${a.position}. ${a.text}${a.project ? ` [${code(a.project)}]` : ""}${a.ask ? ` — ask: ${a.ask}` : ""}`).join("\n")}`,
    )
  if (m.notes.trim() !== "") blocks.push(`Notes\n${m.notes.replace(/\n+$/, "")}`)
  return blocks.join("\n\n")
}

const line = (m: MeetingRecord) => `${m.ref} ${m.title} on ${m.date}`

export function registerCommands(ctx: PluginContext, store: Store): void {
  const write = () => ctx.self().write

  ctx.command({
    thing: "meeting",
    verb: "list",
    summary: `list meetings: planned ones, and those held or cancelled in the last ${RECENT_DAYS} days`,
    flags: { all: bool("every meeting") },
    run: async ({ flags }) => {
      const since = addDays(currentContext().today, -RECENT_DAYS)
      let q = ctx.data.selectFrom("meeting").select("id")
      if (!flags.all) q = q.where((eb) => eb.or([eb("status", "=", "planned"), eb("date", ">=", since)]))
      const ids = await q.orderBy("date").orderBy("id").execute()
      const meetings: MeetingRecord[] = []
      for (const r of ids) meetings.push(await store.meeting(formatRef("M-", Number(r.id))))
      const rows = meetings.map((m) => ({
        ref: m.ref,
        date: m.date,
        title: m.title,
        kind: m.kind,
        status: m.status,
        attendees: m.attendees.join(", "),
        projects: [...new Set(m.agenda.map((a) => code(a.project)).filter(Boolean))].join(", "),
      }))
      return { json: meetings, text: rows.length ? formatTable(["ref", "date", "title", "kind", "status", "attendees", "projects"], rows) : "no meetings" }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "show",
    summary: "show a meeting with its attendees, agenda and notes",
    args: [{ name: "meeting", required: true }],
    run: async ({ args }) => {
      const m = await store.meeting(String(args.meeting))
      return { json: m, text: meetingText(m) }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "add",
    summary: "add a meeting; each project in --projects gets a status item on the agenda",
    args: [{ name: "title", required: true }],
    flags: {
      date: { type: "date", description: "the meeting date", required: true },
      kind: kindFlag,
      attendees: { type: "list", description: "attendee handles", placeholder: "a,b" },
      projects: { type: "list", description: "project codes to prepare", placeholder: "CRM,ERP" },
      since: { type: "date", description: "prepare from this date (default: the last meeting covering the project)" },
    },
    run: async ({ args, flags }) => {
      const m: MeetingRecord = await write().addMeeting!({
        title: args.title,
        date: flags.date,
        ...(flags.kind !== undefined ? { kind: flags.kind } : {}),
        ...(flags.attendees !== undefined ? { attendees: flags.attendees } : {}),
        ...(flags.projects !== undefined ? { projects: flags.projects } : {}),
        ...(flags.since !== undefined ? { sinceDate: flags.since } : {}),
      })
      return { json: m, text: line(m) }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "edit",
    summary: "change a meeting's title, date, kind or since date",
    args: [{ name: "meeting", required: true }],
    flags: {
      title: text("the title", "title"),
      date: { type: "date", description: "the meeting date" },
      kind: kindFlag,
      since: { type: "date", description: "prepare from this date" },
      "no-since": bool("prepare from the last meeting again"),
    },
    run: async ({ args, flags }) => {
      exclusive(flags, "since", "no-since")
      const m: MeetingRecord = await write().editMeeting!({
        ref: args.meeting,
        ...(flags.title !== undefined ? { title: flags.title } : {}),
        ...(flags.date !== undefined ? { date: flags.date } : {}),
        ...(flags.kind !== undefined ? { kind: flags.kind } : {}),
        ...(flags.since !== undefined ? { sinceDate: flags.since } : flags["no-since"] ? { sinceDate: null } : {}),
      })
      return { json: m, text: line(m) }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "cancel",
    summary: "cancel a planned meeting",
    args: [{ name: "meeting", required: true }],
    run: async ({ args }) => {
      const m: MeetingRecord = await write().cancelMeeting!({ ref: args.meeting })
      return { json: m, text: `${m.ref} cancelled` }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "close",
    summary: "mark a meeting held and say how many actions and decisions came from it",
    args: [{ name: "meeting", required: true }],
    run: async ({ args }) => {
      const m: MeetingRecord & { logged: { actions: number; decisions: number } } = await write().closeMeeting!({ ref: args.meeting })
      return { json: m, text: `${m.ref} held\nlogged: ${plural(m.logged.actions, "action")}, ${plural(m.logged.decisions, "decision")}` }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "attendees",
    summary: "replace the attendees of a meeting",
    args: [
      { name: "meeting", required: true },
      { name: "people", required: true },
    ],
    run: async ({ args }) => {
      const people = String(args.people)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
      const m: MeetingRecord = await write().setAttendees!({ meeting: args.meeting, people })
      return { json: m, text: `${m.ref} attendees ${m.attendees.join(" ") || "(none)"}` }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "notes",
    summary: "print a meeting's notes, or replace them from a file or stdin (-)",
    args: [{ name: "meeting", required: true }],
    flags: { file: text("replace the notes with this file, or - for stdin", "path|-") },
    run: async ({ args, flags, readStdin }) => {
      if (flags.file === undefined) {
        const m = await store.meeting(String(args.meeting))
        return { json: { ref: m.ref, notes: m.notes }, text: m.notes === "" ? `no notes for ${m.ref}` : m.notes }
      }
      const file = String(flags.file)
      let markdown: string
      if (file === "-") markdown = await readStdin()
      else {
        try {
          markdown = await readFile(file, "utf8")
        } catch {
          throw new ValidationError(`cannot read "${file}"`, { field: "file" })
        }
      }
      const m: MeetingRecord = await write().setNotes!({ meeting: args.meeting, markdown })
      return { json: m, text: `${m.ref} notes updated` }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "agenda",
    summary: "change a meeting's agenda: pm meeting agenda <M-n> add|edit|move|remove …",
    args: [
      { name: "meeting", required: true },
      { name: "verb", required: true },
      { name: "rest", rest: true },
    ],
    flags: {
      project: text("the project the item is about", "code"),
      "no-project": bool("edit: not about a project"),
      ask: text("what you want from the room", "text"),
      "no-ask": bool("edit: clear the ask"),
      at: { type: "number", description: "add: insert at this position (default: last)" },
      text: text("edit: the new text", "text"),
    },
    run: async ({ args, flags }) => {
      const meeting = String(args.meeting)
      const verb = String(args.verb)
      const rest = (args.rest as string[] | undefined) ?? []
      if (!AGENDA_VERBS.includes(verb))
        throw new ValidationError(`unknown agenda verb "${verb}"`, { field: "verb", hint: `use ${AGENDA_VERBS.join(", ")}` })
      const only = (allowed: string[]) => {
        for (const f of ["project", "no-project", "ask", "no-ask", "at", "text"])
          if (flags[f] !== undefined && flags[f] !== false && !allowed.includes(f)) throw new ValidationError(`--${f} does not apply to "agenda ${verb}"`, { field: f })
      }
      const arity = (names: string[]) => {
        if (rest.length < names.length) throw new ValidationError(`missing argument <${names[rest.length]}>`, { field: names[rest.length]!, hint: `usage: pm meeting agenda <meeting> ${verb} ${names.map((n) => `<${n}>`).join(" ")}` })
        if (rest.length > names.length) throw new ValidationError(`unexpected argument "${rest[names.length]}"`)
      }
      let m: MeetingRecord
      switch (verb) {
        case "add": {
          only(["project", "ask", "at"])
          arity(["text"])
          m = await write().addAgendaItem!({
            meeting,
            text: rest[0],
            ...(flags.project !== undefined ? { project: flags.project } : {}),
            ...(flags.ask !== undefined ? { ask: flags.ask } : {}),
            ...(flags.at !== undefined ? { position: flags.at } : {}),
          })
          const item = flags.at !== undefined ? Number(flags.at) : m.agenda.length
          return { json: m, text: `${m.ref} item ${item} "${rest[0]!.trim()}"` }
        }
        case "edit": {
          only(["project", "no-project", "ask", "no-ask", "text"])
          arity(["item"])
          exclusive(flags, "project", "no-project")
          exclusive(flags, "ask", "no-ask")
          const item = position(rest[0], "item")
          m = await write().editAgendaItem!({
            meeting,
            item,
            ...(flags.text !== undefined ? { text: flags.text } : {}),
            ...(flags.project !== undefined ? { project: flags.project } : flags["no-project"] ? { project: null } : {}),
            ...(flags.ask !== undefined ? { ask: flags.ask } : flags["no-ask"] ? { ask: null } : {}),
          })
          return { json: m, text: `${m.ref} item ${item} "${m.agenda.find((a) => a.position === item)?.text ?? ""}"` }
        }
        case "move": {
          only([])
          arity(["item", "to"])
          const item = position(rest[0], "item")
          const to = position(rest[1], "to")
          m = await write().moveAgendaItem!({ meeting, item, to })
          return { json: m, text: `${m.ref} item ${item} → ${to}` }
        }
        default: {
          only([])
          arity(["item"])
          const item = position(rest[0], "item")
          m = await write().removeAgendaItem!({ meeting, item })
          return { json: m, text: `${m.ref} item ${item} removed` }
        }
      }
    },
  })
}
