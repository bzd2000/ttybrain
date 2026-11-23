// `ttybrain meeting …`, `ttybrain meeting agenda <M-n> <verb> …` and `ttybrain meeting series <verb> …`. Reads go through
// the plugin's own store; writes only through ctx.self().write.*, so they are validated, transactional and recorded
// like any other caller's. The dispatcher has no nested verbs, so `agenda` and `series` are one command each: the
// first positionals name the meeting and the verb.
import { readFile } from "node:fs/promises"
import { addDays, currentContext, formatRef, formatTable, ValidationError, type FlagDef, type PluginContext } from "@ttybrain/api"
import type { Closed } from "./close"
import type { Store } from "./records"
import { KIND_INPUTS, type MeetingRecord, type SeriesRecord, type SubjectType, type TalkRecord } from "./schema"
import type { TalkList, Talks } from "./talk"

const text = (description: string, placeholder?: string): FlagDef => ({ type: "string", description, ...(placeholder ? { placeholder } : {}) })
const bool = (description: string): FlagDef => ({ type: "boolean", description })
const kindFlag: FlagDef = {
  type: "string",
  values: [...KIND_INPUTS],
  description: "one_on_one, project or board (steering and other mean project; default: one_on_one about a person, project about a project)",
}

const RECENT_DAYS = 30
const AGENDA_VERBS = ["add", "edit", "move", "remove"]
const SERIES_VERBS = ["add", "list", "edit", "end"]
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
  if (m.about) lines.push(`  about: ${m.about}`)
  if (m.series) lines.push(`  series: ${m.series}`)
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

// One subject's talk-list as text: a heading, then one line per item (its rank, ref, text, project tag or `—`, date
// added); the carried group under its own line, marked `↻` instead of numbered (as the talk mock). On a project's list,
// a person's item tagged with the project has no number (its place is on that person's list) and shows whose it is
// instead of the tag.
function talkBlock(about: string, list: TalkList): string {
  const row = (t: TalkRecord) => {
    const own = t.about === about
    const mark = !own ? "" : t.carried ? "↻" : `${t.position}.`
    return [mark, t.ref, t.text, own ? (t.project ?? "—") : t.about, t.added_date]
  }
  const open = list.open.map(row)
  const carried = list.carried.map(row)
  const widths = [0, 1, 2, 3].map((i) => Math.max(...[...open, ...carried].map((r) => r[i]!.length)))
  const format = (r: string[]) => `${r[0]!.padEnd(widths[0]!)} ${r[1]!.padEnd(widths[1]!)}  ${r[2]!.padEnd(widths[2]!)}  ${r[3]!.padEnd(widths[3]!)}  ${r[4]}`
  const head = `${about} · ${list.open.length} open${list.carried.length ? `, ${list.carried.length} carried` : ""}`
  const lines = [head, ...open.map(format)]
  if (carried.length) lines.push(`carried over from ${list.carriedFrom}`, ...carried.map(format))
  return lines.join("\n")
}

const line = (m: MeetingRecord) => `${m.ref} ${m.title} on ${m.date}`
const seriesLine = (s: SeriesRecord) => `${s.ref} ${s.title}: ${s.rhythm}${s.next ? `, next ${s.next}` : ""}${s.end_date ? `, until ${s.end_date}` : ""}`
const SUBJECT_USAGE = "usage: ttybrain meeting subject <M-n> <about>, or ttybrain meeting subject --all-without <about>"

export function registerCommands(ctx: PluginContext, store: Store, talks: Talks): void {
  const write = () => ctx.self().write

  ctx.command({
    thing: "talk",
    verb: "add",
    summary: "add an item to a person's or project's talk-list; --project also puts a person's item on that project's meetings",
    args: [
      { name: "about", required: true },
      { name: "text", required: true },
    ],
    flags: { project: text("tag it with a project", "code") },
    run: async ({ args, flags }) => {
      const t: TalkRecord = await write().addTalk!({ about: args.about, text: args.text, ...(flags.project !== undefined ? { project: flags.project } : {}) })
      return { json: t, text: `${t.ref} added to ${t.about}'s talk-list at ${t.position}` }
    },
  })

  ctx.command({
    thing: "talk",
    verb: "list",
    summary: "show the open talk items: of one person or project (a project's include people's items tagged with it), or of everyone",
    args: [{ name: "about" }],
    run: async ({ args }) => {
      if (args.about !== undefined) {
        const subject = await store.subject(String(args.about))
        const list = await talks.list(subject)
        const items = [...list.open, ...list.carried]
        return { json: items, text: items.length ? talkBlock(subject.ref, list) : `no open talk items for ${subject.ref}` }
      }
      const subjects = await ctx.data.selectFrom("talk_item").select(["subject_type", "subject_id"]).distinct().where("status", "=", "open").execute()
      const blocks: Array<{ about: string; type: SubjectType; list: TalkList }> = []
      for (const s of subjects) {
        const list = await talks.list({ type: s.subject_type as SubjectType, id: Number(s.subject_id) }, { own: true })
        blocks.push({ about: [...list.open, ...list.carried][0]!.about, type: s.subject_type as SubjectType, list })
      }
      // People, then projects, each by ref; those that no longer resolve last.
      const key = (b: (typeof blocks)[number]) => `${b.about === "—" ? 1 : 0}${b.type === "person" ? 0 : 1}${b.about}`
      blocks.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
      return {
        json: blocks.flatMap((b) => [...b.list.open, ...b.list.carried]),
        text: blocks.length ? blocks.map((b) => talkBlock(b.about, b.list)).join("\n\n") : "no open talk items",
      }
    },
  })

  ctx.command({
    thing: "talk",
    verb: "done",
    summary: "mark a talk item discussed, in a meeting it is on (--meeting) or elsewhere",
    args: [{ name: "item", required: true }],
    flags: { meeting: text("the meeting it was discussed in", "M-n") },
    run: async ({ args, flags }) => {
      const t: TalkRecord = await write().discussTalk!({ ref: args.item, ...(flags.meeting !== undefined ? { meeting: flags.meeting } : {}) })
      return { json: t, text: `${t.ref} discussed${t.meeting ? ` in ${t.meeting}` : ""}` }
    },
  })

  ctx.command({
    thing: "talk",
    verb: "drop",
    summary: "take a talk item off its list without discussing it",
    args: [{ name: "item", required: true }],
    run: async ({ args }) => {
      const t: TalkRecord = await write().dropTalk!({ ref: args.item })
      return { json: t, text: `${t.ref} dropped` }
    },
  })

  ctx.command({
    thing: "talk",
    verb: "reopen",
    summary: "put a discussed or dropped talk item back on its list, near the place it had",
    args: [{ name: "item", required: true }],
    run: async ({ args }) => {
      const t: TalkRecord = await write().reopenTalk!({ ref: args.item })
      return { json: t, text: `${t.ref} reopened at ${t.position}` }
    },
  })

  ctx.command({
    thing: "talk",
    verb: "move",
    summary: "move a talk item to another place within its group on the list (the open items, or the carried ones)",
    args: [{ name: "item", required: true }],
    flags: { to: { type: "number", description: "the new place in its group (1 is first)", required: true } },
    run: async ({ args, flags }) => {
      const t: TalkRecord = await write().moveTalk!({ ref: args.item, to: flags.to })
      return { json: t, text: `${t.ref} moved to ${t.position}` }
    },
  })

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
        about: m.about ?? "—",
        series: m.series ?? "",
      }))
      return {
        json: meetings,
        text: rows.length ? formatTable(["ref", "date", "title", "kind", "status", "attendees", "projects", "about", "series"], rows) : "no meetings",
      }
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
    summary: "add a one-off meeting about a person or project; each project in --projects gets a status item on the agenda",
    args: [{ name: "title", required: true }],
    flags: {
      about: { type: "string", description: "who or what the meeting is about: a person or a project", placeholder: "@handle|#CODE", required: true },
      date: { type: "date", description: "the meeting date", required: true },
      kind: kindFlag,
      attendees: { type: "list", description: "attendee handles", placeholder: "a,b" },
      projects: { type: "list", description: "project codes to prepare", placeholder: "CRM,ERP" },
      since: { type: "date", description: "prepare from this date (default: the last meeting covering the project)" },
    },
    run: async ({ args, flags }) => {
      const m: MeetingRecord = await write().addMeeting!({
        about: flags.about,
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
    verb: "skip",
    summary: "skip a planned meeting (of a series: that date only)",
    args: [{ name: "meeting", required: true }],
    run: async ({ args }) => {
      const m: MeetingRecord = await write().skipMeeting!({ ref: args.meeting })
      return { json: m, text: `${m.ref} skipped (${m.date})` }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "move",
    summary: "move a planned meeting to another date (of a series: that date only)",
    args: [{ name: "meeting", required: true }],
    flags: { to: { type: "date", description: "the new date", required: true } },
    run: async ({ args, flags }) => {
      const m: MeetingRecord = await write().moveMeeting!({ ref: args.meeting, to: flags.to })
      return { json: m, text: `${m.ref} moved to ${m.date}` }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "subject",
    summary: "say who or what a meeting is about: ttybrain meeting subject <M-n> <about>, or --all-without <about> for every meeting without one",
    // Both positionals are optional to the dispatcher: with --all-without the only one is <about>.
    args: [{ name: "meeting" }, { name: "about" }],
    flags: { "all-without": bool("every meeting that has no subject yet (then give only <about>)") },
    run: async ({ args, flags }) => {
      if (flags["all-without"]) {
        if (args.about !== undefined) throw new ValidationError(`unexpected argument "${args.about}"`, { hint: SUBJECT_USAGE })
        if (args.meeting === undefined) throw new ValidationError("missing argument <about>", { field: "about", hint: SUBJECT_USAGE })
        const out: { meetings: MeetingRecord[] } = await write().setSubject!({ allWithout: true, about: args.meeting })
        const changed = out.meetings
        return { json: changed, text: changed.length ? changed.map((m) => `${m.ref} about ${m.about} (${m.kind})`).join("\n") : "no meetings without a subject" }
      }
      if (args.meeting === undefined) throw new ValidationError("missing argument <meeting>", { field: "meeting", hint: SUBJECT_USAGE })
      if (args.about === undefined) throw new ValidationError("missing argument <about>", { field: "about", hint: SUBJECT_USAGE })
      const m: MeetingRecord = await write().setSubject!({ meeting: args.meeting, about: args.about })
      return { json: m, text: `${m.ref} about ${m.about} (${m.kind})` }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "series",
    summary: "recurring meetings: ttybrain meeting series add <about> <title> --every <rhythm> | list | edit <S-n> | end <S-n>",
    args: [
      { name: "verb", required: true },
      { name: "rest", rest: true },
    ],
    flags: {
      every: text("add, edit: the rhythm: weekly on mon, every 2 weeks on wed, monthly on the 4th tue, monthly on the last fri, monthly on day 15", "rhythm"),
      from: { type: "date", description: "add: the first date (default today)" },
      until: { type: "date", description: "add, edit: the last date" },
      "no-until": bool("edit: no last date"),
      kind: kindFlag,
      attendees: { type: "list", description: "add, edit: the attendee handles (add: default the person it is about)", placeholder: "a,b" },
      title: text("edit: the new title", "title"),
      on: { type: "date", description: "end: the last date (default today)" },
    },
    run: async ({ args, flags }) => {
      const verb = String(args.verb)
      const rest = (args.rest as string[] | undefined) ?? []
      if (!SERIES_VERBS.includes(verb)) throw new ValidationError(`unknown series verb "${verb}"`, { field: "verb", hint: `use ${SERIES_VERBS.join(", ")}` })
      const only = (allowed: string[]) => {
        for (const f of ["every", "from", "until", "no-until", "kind", "attendees", "title", "on"])
          if (flags[f] !== undefined && flags[f] !== false && !allowed.includes(f)) throw new ValidationError(`--${f} does not apply to "series ${verb}"`, { field: f })
      }
      const arity = (names: string[]) => {
        if (rest.length < names.length)
          throw new ValidationError(`missing argument <${names[rest.length]}>`, { field: names[rest.length]!, hint: `usage: ttybrain meeting series ${verb} ${names.map((n) => `<${n}>`).join(" ")}` })
        if (rest.length > names.length) throw new ValidationError(`unexpected argument "${rest[names.length]}"`)
      }
      switch (verb) {
        case "add": {
          only(["every", "from", "until", "kind", "attendees"])
          arity(["about", "title"])
          if (flags.every === undefined) throw new ValidationError("--every is required", { field: "every", hint: "e.g. --every \"2 weeks on wed\"" })
          const s: SeriesRecord = await write().addSeries!({
            about: rest[0],
            title: rest[1],
            every: flags.every,
            from: flags.from ?? "today",
            ...(flags.until !== undefined ? { until: flags.until } : {}),
            ...(flags.kind !== undefined ? { kind: flags.kind } : {}),
            ...(flags.attendees !== undefined ? { attendees: flags.attendees } : {}),
          })
          return { json: s, text: seriesLine(s) }
        }
        case "list": {
          only([])
          arity([])
          const ids = await ctx.data.selectFrom("series").select("id").orderBy("id").execute()
          const all: SeriesRecord[] = []
          for (const r of ids) all.push(await store.series(formatRef("S-", Number(r.id))))
          const rows = all.map((s) => ({ ref: s.ref, title: s.title, about: s.about, kind: s.kind, rhythm: s.rhythm, next: s.next ?? "", ends: s.end_date ?? "" }))
          return { json: all, text: rows.length ? formatTable(["ref", "title", "about", "kind", "rhythm", "next", "ends"], rows) : "no series" }
        }
        case "edit": {
          only(["every", "until", "no-until", "attendees", "title"])
          arity(["series"])
          exclusive(flags, "until", "no-until")
          const s: SeriesRecord = await write().editSeries!({
            ref: rest[0],
            ...(flags.title !== undefined ? { title: flags.title } : {}),
            ...(flags.every !== undefined ? { every: flags.every } : {}),
            ...(flags.attendees !== undefined ? { attendees: flags.attendees } : {}),
            ...(flags.until !== undefined ? { until: flags.until } : flags["no-until"] ? { until: null } : {}),
          })
          return { json: s, text: seriesLine(s) }
        }
        default: {
          only(["on"])
          arity(["series"])
          const s: SeriesRecord = await write().endSeries!({ ref: rest[0], ...(flags.on !== undefined ? { on: flags.on } : {}) })
          return { json: s, text: `${s.ref} ${s.title} ends ${s.end_date}` }
        }
      }
    },
  })

  ctx.command({
    thing: "meeting",
    verb: "close",
    summary: "mark a meeting held: unticked talk items stay for next time, a 1:1's notes go on the person",
    args: [{ name: "meeting", required: true }],
    run: async ({ args }) => {
      const m: Closed = await write().closeMeeting!({ ref: args.meeting })
      return { json: m, text: m.message }
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
    summary: "change a meeting's agenda: ttybrain meeting agenda <M-n> add|edit|move|remove …",
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
        if (rest.length < names.length) throw new ValidationError(`missing argument <${names[rest.length]}>`, { field: names[rest.length]!, hint: `usage: ttybrain meeting agenda <meeting> ${verb} ${names.map((n) => `<${n}>`).join(" ")}` })
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
