// Lookups shared by the operations and the commands (reading the plugin's own tables), and the record types
// `meeting` (M-) and `series` (S-). People (@handle) and projects (#CODE) are resolved through the kernel's record
// types; a subject (the person or project a meeting or series is about) is a soft reference shown through their views.
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
import type { AgendaItem, MeetingRecord, SeriesRecord, SubjectType } from "./schema"

// How many records a "did you mean" looks through (a person's whole team and stakeholders, every project).
const TAG_CANDIDATES = 1000
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

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
  // "Did you mean" candidates: every record the tag prefix completes to (`@` people, `#` projects), bare.
  async function tagCandidates(prefix: "@" | "#"): Promise<string[]> {
    return (await ctx.tags.suggest(prefix, TAG_CANDIDATES)).map((r) => r.ref.slice(prefix.length))
  }

  async function personId(handle: string): Promise<number> {
    const h = normalizeHandle(handle)
    const found = await ctx.records.resolve(`@${h}`)
    if (!found || found.type !== "person")
      throw new NotFoundError(`unknown person "${handle.trim()}"`, { suggestions: suggest(h, await tagCandidates("@")) })
    return found.id
  }

  async function projectId(code: string): Promise<number> {
    const c = normalizeCode(code)
    const found = await ctx.records.resolve(`#${c}`)
    if (!found || found.type !== "project") throw new NotFoundError(`unknown project "${c}"`, { suggestions: suggest(c, await tagCandidates("#")) })
    return found.id
  }

  // The display ref of a subject: `@handle`, `#CODE`, or `person:<id>` / `project:<id>` when it no longer resolves
  // (deleted, or its plugin is not loaded).
  async function subjectRef(type: SubjectType, id: number): Promise<string> {
    const row =
      type === "person"
        ? await unlessUnavailable(undefined as { v: unknown } | undefined, () => db.selectFrom("people.person").select("handle as v").where("id", "=", id).executeTakeFirst())
        : await unlessUnavailable(undefined as { v: unknown } | undefined, () => db.selectFrom("projects.project").select("code as v").where("id", "=", id).executeTakeFirst())
    return row ? `${type === "person" ? "@" : "#"}${row.v}` : `${type}:${id}`
  }

  // What a meeting or series is about: `@anna` or `anna` (a person), `#CRM` or `CRM` (a project). A bare word that
  // names both is refused.
  async function subject(input: string): Promise<Subject> {
    const s = input.trim()
    const handle = normalizeHandle(s)
    const code = normalizeCode(s)
    const person = async (): Promise<Subject | null> => {
      const found = await ctx.records.resolve(`@${handle}`)
      return found && found.type === "person" ? { type: "person", id: found.id, ref: `@${handle}` } : null
    }
    const project = async (): Promise<Subject | null> => {
      const found = await ctx.records.resolve(`#${code}`)
      return found && found.type === "project" ? { type: "project", id: found.id, ref: `#${code}` } : null
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
      if (!p) throw new NotFoundError(`unknown project "#${code}"`, { suggestions: near(code, await projects()) })
      return p
    }
    const p = await person()
    const q = await project()
    if (p && q) throw new ValidationError(`"${s}" is both a person and a project`, { field: "about", hint: `use @${handle} or #${code}` })
    if (p || q) return (p ?? q)!
    throw new NotFoundError(`unknown person or project "${s}"`, { suggestions: near(s, [...(await people()), ...(await projects())]) })
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

  // The id the next meeting gets (an integer primary key takes the highest id plus one), for the add line.
  async function nextMeetingId(): Promise<number> {
    const rows = await db.selectFrom("meeting").select("id").orderBy("id", "desc").limit(1).execute()
    return rows.length ? Number(rows[0]!.id) + 1 : 1
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
    nextMeetingId,
    nextSeriesId,
    heldMeetingsWith,
    unlessUnavailable,
    subject,
    subjectRef,
    seriesId,
    series,
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
}
