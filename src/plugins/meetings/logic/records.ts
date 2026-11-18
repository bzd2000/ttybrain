// Lookups shared by the operations and the commands (reading the plugin's own tables), and the record type
// `meeting` (M-). People (@handle) and projects (#CODE) are resolved through the kernel's record types.
import {
  formatRef,
  normalizeCode,
  normalizeHandle,
  NotFoundError,
  parseRef,
  ValidationError,
  ViewUnavailableError,
  type PluginContext,
  type PluginRuntime,
} from "../../../kernel/api"
import type { AgendaItem, MeetingRecord } from "./schema"

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

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

  async function meeting(input: string): Promise<MeetingRecord> {
    const n = parseRef(input, "M-")
    const row = n === null ? undefined : await db.selectFrom("meeting").selectAll().where("id", "=", n).executeTakeFirst()
    if (!row) throw new NotFoundError(`unknown meeting "${n === null ? input.trim() : formatRef("M-", n)}"`)
    const id = Number(row.id)
    const attendeeRows = await db.selectFrom("attendee").select("person_id").where("meeting_id", "=", id).execute()
    const handles =
      attendeeRows.length === 0
        ? []
        : await unlessUnavailable([] as Array<{ id: unknown; handle: unknown }>, () =>
            db
              .selectFrom("people.person")
              .select(["id", "handle"])
              .where("id", "in", attendeeRows.map((r) => Number(r.person_id)))
              .execute(),
          )
    const handleOf = new Map(handles.map((r) => [Number(r.id), `@${r.handle}`]))
    const attendees = attendeeRows.map((r) => handleOf.get(Number(r.person_id))).filter((h): h is string => h !== undefined).sort()
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
  async function personId(handle: string): Promise<number> {
    const h = normalizeHandle(handle)
    const found = await ctx.records.resolve(`@${h}`)
    if (!found || found.type !== "person") throw new NotFoundError(`unknown person "${handle.trim()}"`)
    return found.id
  }

  async function projectId(code: string): Promise<number> {
    const c = normalizeCode(code)
    const found = await ctx.records.resolve(`#${c}`)
    if (!found || found.type !== "project") throw new NotFoundError(`unknown project "${c}"`)
    return found.id
  }

  return { meetingId, meeting, openMeeting, personId, projectId, unlessUnavailable }
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
}
