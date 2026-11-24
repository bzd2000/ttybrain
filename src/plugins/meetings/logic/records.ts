// Lookups shared by the operations and the commands (reading the plugin's own tables), and the record types
// `meeting` (M-), `series` (S-) and `talk_item` (T-) (the `board` type, `#CODE`, is in boards.ts). People (@handle) and
// projects (#CODE) are resolved through the kernel's record types; a subject (the person, project or board a meeting,
// series or talk item is about) is a person or project as a soft reference shown through their views, or a board of
// this plugin.
import {
  currentContext,
  formatRef,
  normalizeCode,
  normalizeHandle,
  NotFoundError,
  parseRef,
  suggest,
  ValidationError,
  ViewUnavailableError,
  type PluginContext,
  type PluginRuntime,
} from "@ttybrain/api"
import type { AgendaItem, BoardRecord, MeetingRecord, SeriesRecord, SubjectType } from "./schema"

// How many records a "did you mean" looks through (a person's whole team and stakeholders, every project).
const TAG_CANDIDATES = 1000
export const GONE = "—" // a soft reference whose record no longer exists
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
// Which type a `#CODE` is, as an error says it.
const NAMES: Record<string, string> = { project: "a project", board: "a board" }

export type Subject = { type: SubjectType; id: number; ref: string }
export type Store = ReturnType<typeof makeStore>

export function makeStore(ctx: PluginRuntime) {
  const db = ctx.data

  // Reads of the people and projects views; without those plugins there is nothing to show.
  async function unlessUnavailable<T>(empty: T, read: () => Promise<T>): Promise<T> {
    try {
      return await read()
    } catch (e) {
      if (e instanceof ViewUnavailableError) return empty
      throw e
    }
  }

  async function meetingId(input: string): Promise<number | null> {
    const id = parseRef(input, "M-")
    if (id === null) return null
    const row = await db.selectFrom("meeting").select("id").where("id", "=", id).executeTakeFirst()
    return row ? Number(row.id) : null
  }

  // The @handles of people by id, sorted; ids that no longer resolve are left out.
  async function handlesOf(ids: number[]): Promise<string[]> {
    if (ids.length === 0) return []
    const rows = await unlessUnavailable([] as Array<{ id: unknown; handle: unknown }>, () =>
      db.selectFrom("people.person").select(["id", "handle"]).where("id", "in", ids).execute(),
    )
    const handleOf = new Map(rows.map((r) => [Number(r.id), `@${r.handle}`]))
    return ids.map((id) => handleOf.get(id)).filter((h): h is string => h !== undefined).sort()
  }

  async function meeting(input: string): Promise<MeetingRecord> {
    const n = parseRef(input, "M-")
    const row = n === null ? undefined : await db.selectFrom("meeting").selectAll().where("id", "=", n).executeTakeFirst()
    if (!row) throw new NotFoundError(`unknown meeting "${n === null ? input.trim() : formatRef("M-", n)}"`)
    const id = Number(row.id)
    const attendeeRows = await db.selectFrom("attendee").select("person_id").where("meeting_id", "=", id).execute()
    const attendees = await handlesOf(attendeeRows.map((r) => Number(r.person_id)))
    const items = await db.selectFrom("agenda_item").selectAll().where("meeting_id", "=", id).orderBy("position").execute()
    const projectIds = [...new Set(items.filter((i) => i.project_id !== null).map((i) => Number(i.project_id)))]
    const codes =
      projectIds.length === 0
        ? []
        : await unlessUnavailable([] as Array<{ id: unknown; code: unknown }>, () =>
            db.selectFrom("projects.project").select(["id", "code"]).where("id", "in", projectIds).execute(),
          )
    const codeOf = new Map(codes.map((r) => [Number(r.id), `#${r.code}`]))
    const agenda: AgendaItem[] = items.map((i) => ({
      position: Number(i.position),
      text: String(i.text),
      project: i.project_id === null ? null : (codeOf.get(Number(i.project_id)) ?? null),
      project_id: i.project_id === null ? null : Number(i.project_id),
      ask: str(i.ask),
    }))
    return {
      ref: formatRef("M-", id),
      id,
      title: String(row.title),
      date: String(row.date),
      kind: row.kind as MeetingRecord["kind"],
      status: row.status as MeetingRecord["status"],
      since_date: str(row.since_date),
      notes: String(row.notes),
      attendees,
      agenda,
      about: row.subject_type === null ? null : await subjectRef(row.subject_type as SubjectType, Number(row.subject_id)),
      series: row.series_id === null ? null : formatRef("S-", Number(row.series_id)),
    }
  }

  // A meeting that may be changed: not cancelled, and not held unless the caller says so.
  async function openMeeting(input: string, opts: { allowHeld?: boolean } = {}): Promise<MeetingRecord> {
    const m = await meeting(input)
    if (m.status === "cancelled") throw new ValidationError(`${m.ref} is cancelled`)
    if (m.status === "held" && !opts.allowHeld) throw new ValidationError(`${m.ref} is held`)
    return m
  }

  // Soft references, resolved through the kernel's record types (the plugins may not be loaded).
  // "Did you mean" candidates: every record the tag prefix completes to (`@` people, `#` projects and boards), bare.
  async function tagCandidates(prefix: "@" | "#"): Promise<string[]> {
    return (await ctx.tags.suggest(prefix, TAG_CANDIDATES)).map((r) => r.ref.slice(prefix.length))
  }
  // The project codes alone, from projects.project (none while projects is not loaded).
  const projectCodes = async () =>
    (await unlessUnavailable([] as Array<{ code: unknown }>, () => db.selectFrom("projects.project").select("code").orderBy("code").execute())).map((r) => String(r.code))

  // `#CODE` that names a record of another type than the one wanted (a board where a project is needed): that error,
  // else undefined. A code two types both know (a data error) throws the kernel's ValidationError.
  async function otherType(code: string, wanted: string, hint: string): Promise<ValidationError | undefined> {
    const found = await ctx.records.resolve(`#${code}`)
    if (!found || found.type === wanted) return undefined
    return new ValidationError(`#${code} is ${NAMES[found.type] ?? `a ${found.type}`}, not ${NAMES[wanted] ?? `a ${wanted}`}`, { hint })
  }

  // ---- boards (this plugin's own): by code only, never by id (codes have a letter, so `#12` is never a board).
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
  async function board(input: string): Promise<BoardRecord> {
    const code = normalizeCode(input)
    const id = await boardCodeId(code)
    if (id !== null) return boardById(id)
    throw (
      (await otherType(code, "board", 'run "ttybrain board list" for the board codes')) ??
      new NotFoundError(`unknown board "${code}"`, { suggestions: suggest(code, await boardCodes()) })
    )
  }
  const archivedBoard = (b: Pick<BoardRecord, "ref">) => new ValidationError(`${b.ref} is archived`, { hint: `restore it first: ttybrain board restore ${b.ref}` })
  // A board that may take new meetings, series and talk items (and edits): not archived.
  async function activeBoard(input: string): Promise<BoardRecord> {
    const b = await board(input)
    if (b.archived) throw archivedBoard(b)
    return b
  }

  async function personId(handle: string): Promise<number> {
    const h = normalizeHandle(handle)
    const found = await ctx.records.resolve(`@${h}`)
    if (!found || found.type !== "person")
      throw new NotFoundError(`unknown person "${handle.trim()}"`, { suggestions: suggest(h, await tagCandidates("@")) })
    return found.id
  }

  // A project by code; a board's code is refused as such (`hint` says what to do instead).
  async function projectId(code: string, hint = 'run "ttybrain project list" for the project codes'): Promise<number> {
    const c = normalizeCode(code)
    const found = await ctx.records.resolve(`#${c}`, { type: "project" })
    if (found && found.type === "project") return found.id
    throw (await otherType(c, "project", hint)) ?? new NotFoundError(`unknown project "${c}"`, { suggestions: suggest(c, await projectCodes()) })
  }

  // The display ref of a subject or project tag, through the people and projects views: `@handle`, `#CODE`; `—` when
  // the record is gone; `person:<id>` / `project:<id>` while no plugin registers the type (as actions' links show). A
  // board's code from the own table.
  async function subjectRef(type: SubjectType, id: number): Promise<string> {
    if (type === "board") {
      const b = await db.selectFrom("board").select("code").where("id", "=", id).executeTakeFirst()
      return b ? `#${b.code}` : GONE
    }
    const row =
      type === "person"
        ? await unlessUnavailable(undefined as { v: unknown } | undefined, () => db.selectFrom("people.person").select("handle as v").where("id", "=", id).executeTakeFirst())
        : await unlessUnavailable(undefined as { v: unknown } | undefined, () => db.selectFrom("projects.project").select("code as v").where("id", "=", id).executeTakeFirst())
    if (row) return `${type === "person" ? "@" : "#"}${row.v}`
    return ctx.records.hasType(type) ? GONE : `${type}:${id}`
  }

  // What a meeting, series or talk item is about: `@anna` or `anna` (a person), `#CRM` or `CRM` (a project or a board:
  // they share one namespace of codes). A bare word that names a person and a code is refused.
  async function subject(input: string): Promise<Subject> {
    const s = input.trim()
    const handle = normalizeHandle(s)
    const code = normalizeCode(s)
    const person = async (): Promise<Subject | null> => {
      const found = await ctx.records.resolve(`@${handle}`)
      return found && found.type === "person" ? { type: "person", id: found.id, ref: `@${handle}` } : null
    }
    const project = async (): Promise<Subject | null> => {
      const found = await ctx.records.resolve(`#${code}`, { type: "project" })
      if (found && found.type === "project") return { type: "project", id: found.id, ref: `#${code}` }
      const b = await boardCodeId(code)
      return b === null ? null : { type: "board", id: b, ref: `#${code}` }
    }
    const people = async () => (await tagCandidates("@")).map((h) => `@${h}`)
    const projects = async () => (await tagCandidates("#")).map((c) => `#${c}`)
    // Suggestions keep their prefix: `did you mean "@anna"?`
    const near = (word: string, refs: string[]) => {
      const hits = suggest(word, refs.map((r) => r.slice(1)))
      return hits.map((h) => refs.find((r) => r.slice(1) === h)!)
    }
    if (s.startsWith("@")) {
      const p = await person()
      if (!p) throw new NotFoundError(`unknown person "@${handle}"`, { suggestions: near(handle, await people()) })
      return p
    }
    if (s.startsWith("#")) {
      const p = await project()
      if (!p) throw new NotFoundError(`unknown project or board "#${code}"`, { suggestions: near(code, await projects()) })
      return p
    }
    const p = await person()
    const q = await project()
    if (p && q) throw new ValidationError(`"${s}" is both a person and ${NAMES[q.type]}`, { field: "about", hint: `use @${handle} or #${code}` })
    if (p || q) return (p ?? q)!
    throw new NotFoundError(`unknown person, project or board "${s}"`, { suggestions: near(s, [...(await people()), ...(await projects())]) })
  }

  // A subject that may take a new meeting, series or talk item: an archived board takes none.
  async function activeSubject(input: string): Promise<Subject> {
    const s = await subject(input)
    if (s.type === "board" && (await boardById(s.id)).archived) throw archivedBoard(s)
    return s
  }

  async function seriesId(input: string): Promise<number | null> {
    const id = parseRef(input, "S-")
    if (id === null) return null
    const row = await db.selectFrom("series").select("id").where("id", "=", id).executeTakeFirst()
    return row ? Number(row.id) : null
  }

  async function series(input: string): Promise<SeriesRecord> {
    const n = parseRef(input, "S-")
    const row = n === null ? undefined : await db.selectFrom("series").selectAll().where("id", "=", n).executeTakeFirst()
    if (!row) throw new NotFoundError(`unknown series "${n === null ? input.trim() : formatRef("S-", n)}"`, { hint: 'run "ttybrain meeting series list"' })
    const id = Number(row.id)
    const people = await db.selectFrom("series_attendee").select("person_id").where("series_id", "=", id).execute()
    const next = await db
      .selectFrom("meeting")
      .select("date")
      .where("series_id", "=", id)
      .where("status", "=", "planned")
      .where("date", ">=", currentContext().today)
      .orderBy("date")
      .limit(1)
      .executeTakeFirst()
    return {
      ref: formatRef("S-", id),
      id,
      title: String(row.title),
      kind: row.kind as SeriesRecord["kind"],
      about: await subjectRef(row.subject_type as SubjectType, Number(row.subject_id)),
      rhythm: String(row.rhythm),
      first_date: String(row.first_date),
      end_date: str(row.end_date),
      attendees: await handlesOf(people.map((r) => Number(r.person_id))),
      next: next ? String(next.date) : null,
    }
  }

  async function talkId(input: string): Promise<number | null> {
    const id = parseRef(input, "T-")
    if (id === null) return null
    const row = await db.selectFrom("talk_item").select("id").where("id", "=", id).executeTakeFirst()
    return row ? Number(row.id) : null
  }

  async function nextSeriesId(): Promise<number> {
    const rows = await db.selectFrom("series").select("id").orderBy("id", "desc").limit(1).execute()
    return rows.length ? Number(rows[0]!.id) + 1 : 1
  }

  // Held meetings with an agenda item for the project, most recent first (same date: highest id first).
  async function heldMeetingsWith(projectId: number): Promise<Array<{ id: number; title: string; date: string }>> {
    const rows = await db
      .selectFrom("meeting as m")
      .select(["m.id", "m.title", "m.date"])
      .where("m.status", "=", "held")
      .where((eb) => eb.exists(eb.selectFrom("agenda_item as a").select("a.id").whereRef("a.meeting_id", "=", "m.id").where("a.project_id", "=", projectId)))
      .orderBy("m.date", "desc")
      .orderBy("m.id", "desc")
      .execute()
    return rows.map((r) => ({ id: Number(r.id), title: String(r.title), date: String(r.date) }))
  }

  return {
    meetingId,
    meeting,
    openMeeting,
    personId,
    projectId,
    nextSeriesId,
    heldMeetingsWith,
    unlessUnavailable,
    subject,
    activeSubject,
    subjectRef,
    otherType,
    boardCodeId,
    boardById,
    boardCodes,
    board,
    activeBoard,
    seriesId,
    series,
    talkId,
  }
}

export function registerRecordTypes(ctx: PluginContext, store: Store): void {
  ctx.recordType({
    name: "meeting",
    prefix: "M-",
    resolve: (input) => store.meetingId(input),
    label: async (id) => (await store.meeting(formatRef("M-", id))).title,
    search: async (text, limit) => {
      const rows = await ctx.data
        .selectFrom("meeting")
        .select(["id", "title"])
        .where("title", "like", `%${text.trim()}%`)
        .orderBy("date", "desc")
        .orderBy("id", "desc")
        .limit(limit)
        .execute()
      return rows.map((r) => ({ ref: formatRef("M-", Number(r.id)), label: String(r.title) }))
    },
  })
  ctx.recordType({
    name: "series",
    prefix: "S-",
    resolve: (input) => store.seriesId(input),
    label: async (id) => (await store.series(formatRef("S-", id))).title,
    search: async (text, limit) => {
      const rows = await ctx.data.selectFrom("series").select(["id", "title"]).where("title", "like", `%${text.trim()}%`).orderBy("id").limit(limit).execute()
      return rows.map((r) => ({ ref: formatRef("S-", Number(r.id)), label: String(r.title) }))
    },
  })
  // A talk item (M12): labelled and searched by its text.
  ctx.recordType({
    name: "talk_item",
    prefix: "T-",
    resolve: (input) => store.talkId(input),
    label: async (id) => String((await ctx.data.selectFrom("talk_item").select("text").where("id", "=", id).executeTakeFirstOrThrow()).text),
    search: async (text, limit) => {
      const rows = await ctx.data.selectFrom("talk_item").select(["id", "text"]).where("text", "like", `%${text.trim()}%`).orderBy("id").limit(limit).execute()
      return rows.map((r) => ({ ref: formatRef("T-", Number(r.id)), label: String(r.text) }))
    },
  })
}
