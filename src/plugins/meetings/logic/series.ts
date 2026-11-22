// Recurring series (design §5.2, rulings M1–M3). A series has a subject, a title, a kind, a rhythm (rhythm.ts), a
// first date, an optional end date and default attendees. Its occurrences are ordinary meetings made ahead for the
// next 8 weeks (today and the 55 days after it), each remembering the series date it was made for (`series_date`),
// so a skipped (cancelled) or moved one is never made again. The `occurrences` upkeep tops them up on every
// write-capable boot. Planned occurrences that carry nothing (no notes, agenda, linked actions or decisions, records
// made from them) are the only ones ever deleted: by a new rhythm, an end date, or `endSeries`.
import {
  addDays,
  currentContext,
  formatRef,
  NonBlank,
  parseDate,
  Type,
  ValidationError,
  type PluginContext,
  type Static,
} from "@ttybrain/api"
import type { Store, Subject } from "./records"
import { parseRhythm, rhythmDates, rhythmText } from "./rhythm"
import { KindInput, SeriesRecord, type MeetingKind, type SubjectType } from "./schema"

export const AHEAD_DAYS = 55 // occurrences are made for today and the 55 days after it: 8 weeks

const today = () => currentContext().today
const now = () => currentContext().now
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ""
const uniq = <T>(xs: T[]) => [...new Set(xs)]

// A date input (YYYY-MM-DD, today, +3d, wed, …) as ISO, its error naming the operation's field.
export function dateField(input: string, field: string): string {
  try {
    return parseDate(input, today())
  } catch (e) {
    if (e instanceof ValidationError) throw new ValidationError(e.message, { field, hint: e.hint })
    throw e
  }
}
// A date for a describe line: normalised when valid, as typed otherwise (describe never throws).
export function shownDate(input: string): string {
  try {
    return parseDate(input, today())
  } catch {
    return input.trim()
  }
}

// The kind a meeting or series gets: as given (`steering` and `other` mean project), else from its subject (a person:
// one_on_one, a project: project). A 1:1 needs a person; project and board need a project.
export function kindFor(subject: Pick<Subject, "type" | "ref">, given?: string): MeetingKind {
  const kind = given === undefined ? (subject.type === "person" ? "one_on_one" : "project") : normalizeKind(given)
  if (kind === "one_on_one" && subject.type !== "person") throw new ValidationError(`a 1:1 needs a person; ${subject.ref} is a project`, { field: "kind" })
  if (kind !== "one_on_one" && subject.type !== "project") throw new ValidationError(`a ${kind} meeting needs a project; ${subject.ref} is a person`, { field: "kind" })
  return kind
}
export const normalizeKind = (k: string): MeetingKind => (k === "steering" || k === "other" ? "project" : (k as MeetingKind))

const AddSeries = Type.Object({
  about: NonBlank(),
  title: NonBlank(),
  kind: Type.Optional(KindInput),
  every: NonBlank(),
  from: NonBlank(),
  until: Type.Optional(Type.String()),
  attendees: Type.Optional(Type.Array(NonBlank())),
})
const EditSeries = Type.Object({
  ref: NonBlank(),
  title: Type.Optional(NonBlank()),
  every: Type.Optional(NonBlank()),
  attendees: Type.Optional(Type.Array(NonBlank())),
  until: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})
const EndSeries = Type.Object({ ref: NonBlank(), on: Type.Optional(NonBlank()) })
type AddInput = Static<typeof AddSeries>
type EditInput = Static<typeof EditSeries>
type EndInput = Static<typeof EndSeries>

type SeriesRow = { id: number; subject_type: SubjectType; subject_id: number; title: string; kind: MeetingKind; rhythm: string; first_date: string; end_date: string | null }

export type Occurrences = ReturnType<typeof makeOccurrences>

export function makeOccurrences(ctx: PluginContext, store: Store) {
  const db = ctx.data

  async function rows(seriesId?: number): Promise<SeriesRow[]> {
    let q = db.selectFrom("series").select(["id", "subject_type", "subject_id", "title", "kind", "rhythm", "first_date", "end_date"]).orderBy("id")
    if (seriesId !== undefined) q = q.where("id", "=", seriesId)
    return (await q.execute()).map((r) => ({
      id: Number(r.id),
      subject_type: r.subject_type as SubjectType,
      subject_id: Number(r.subject_id),
      title: String(r.title),
      kind: r.kind as MeetingKind,
      rhythm: String(r.rhythm),
      first_date: String(r.first_date),
      end_date: r.end_date === null ? null : String(r.end_date),
    }))
  }

  const seriesAttendees = async (seriesId: number) =>
    (await db.selectFrom("series_attendee").select("person_id").where("series_id", "=", seriesId).execute()).map((r) => Number(r.person_id))

  // The series' dates from today to 55 days ahead.
  const window = (s: SeriesRow) => rhythmDates(parseRhythm(s.rhythm), s.first_date, today(), addDays(today(), AHEAD_DAYS), s.end_date)

  // Makes the missing occurrences of one series (or of all of them) for the window. Returns how many it made.
  async function topUp(seriesId?: number): Promise<number> {
    let made = 0
    for (const s of await rows(seriesId)) {
      const dates = window(s)
      if (dates.length === 0) continue
      const have = new Set((await db.selectFrom("meeting").select("series_date").where("series_id", "=", s.id).execute()).map((r) => String(r.series_date)))
      const people = await seriesAttendees(s.id)
      for (const date of dates.filter((d) => !have.has(d))) {
        const t = now()
        const res = await db
          .insertInto("meeting")
          .values({
            title: s.title,
            date,
            kind: s.kind,
            status: "planned",
            since_date: null,
            notes: "",
            subject_type: s.subject_type,
            subject_id: s.subject_id,
            series_id: s.id,
            series_date: date,
            auto_close: 1,
            created_at: t,
            updated_at: t,
          })
          .executeTakeFirstOrThrow()
        for (const person_id of people) await db.insertInto("attendee").values({ meeting_id: Number(res.insertId), person_id }).execute()
        made++
      }
    }
    return made
  }

  // A meeting that carries nothing: no notes, no agenda, nothing linked to it or made from it.
  async function empty(meetingId: number, notes: string): Promise<boolean> {
    if (notes.trim() !== "") return false
    if (await db.selectFrom("agenda_item").select("id").where("meeting_id", "=", meetingId).executeTakeFirst()) return false
    const linked = await store.unlessUnavailable(undefined as unknown, () =>
      db.selectFrom("actions.link").select("action_id").where("record_type", "=", "meeting").where("record_id", "=", meetingId).executeTakeFirst(),
    )
    if (linked) return false
    const decided = await store.unlessUnavailable(undefined as unknown, () => db.selectFrom("projects.decision").select("id").where("meeting_id", "=", meetingId).executeTakeFirst())
    if (decided) return false
    return (await ctx.provenance.createdFrom("meeting", formatRef("M-", meetingId))).length === 0
  }

  // Deletes the planned occurrences of a series that `which` picks and that carry nothing (children first: they do
  // not cascade).
  async function removePlanned(seriesId: number, which: (m: { date: string; series_date: string }) => boolean): Promise<void> {
    const planned = await db.selectFrom("meeting").select(["id", "date", "series_date", "notes"]).where("series_id", "=", seriesId).where("status", "=", "planned").execute()
    for (const m of planned) {
      const id = Number(m.id)
      if (!which({ date: String(m.date), series_date: String(m.series_date) }) || !(await empty(id, String(m.notes)))) continue
      await db.deleteFrom("attendee").where("meeting_id", "=", id).execute()
      await db.deleteFrom("agenda_item").where("meeting_id", "=", id).execute()
      await db.deleteFrom("meeting").where("id", "=", id).execute()
    }
  }

  return { rows, topUp, removePlanned, window }
}

export function registerSeries(ctx: PluginContext, store: Store, occurrences: Occurrences): void {
  const db = ctx.data

  async function people(handles: string[]): Promise<number[]> {
    const ids: number[] = []
    for (const h of handles) ids.push(await store.personId(h))
    return uniq(ids)
  }
  async function setAttendees(seriesId: number, ids: number[]): Promise<void> {
    await db.deleteFrom("series_attendee").where("series_id", "=", seriesId).execute()
    for (const person_id of ids) await db.insertInto("series_attendee").values({ series_id: seriesId, person_id }).execute()
  }
  const rhythmOf = (text: string) => rhythmText(parseRhythm(text))
  const shownRhythm = (text: string) => {
    try {
      return rhythmOf(text)
    } catch {
      return text.trim()
    }
  }
  function endFor(until: string, first: string): string {
    const end = dateField(until, "until")
    if (end < first) throw new ValidationError(`until ${end} is before the first date ${first}`, { field: "until" })
    return end
  }
  // The planned occurrences from today on, the ones a series edit reaches.
  const ahead = async (seriesId: number) =>
    (await db.selectFrom("meeting").select("id").where("series_id", "=", seriesId).where("status", "=", "planned").where("date", ">=", currentContext().today).execute()).map((r) =>
      Number(r.id),
    )

  ctx.expose({
    write: {
      addSeries: {
        input: AddSeries,
        output: SeriesRecord,
        describe: async (i: AddInput) => `+ series ${formatRef("S-", await store.nextSeriesId())} "${i.title.trim()}" ${shownRhythm(i.every)} from ${shownDate(i.from)}`,
        run: async (i: AddInput) => {
          const subject = await store.subject(i.about)
          const kind = kindFor(subject, i.kind)
          const rhythm = rhythmOf(i.every)
          const first = dateField(i.from, "from")
          const end = blank(i.until) ? null : endFor(i.until!, first)
          const ids = i.attendees === undefined ? (subject.type === "person" ? [subject.id] : []) : await people(i.attendees)
          const t = now()
          const res = await db
            .insertInto("series")
            .values({ subject_type: subject.type, subject_id: subject.id, title: i.title.trim(), kind, rhythm, first_date: first, end_date: end, created_at: t, updated_at: t })
            .executeTakeFirstOrThrow()
          const id = Number(res.insertId)
          await setAttendees(id, ids)
          await occurrences.topUp(id)
          return store.series(formatRef("S-", id))
        },
      },
      editSeries: {
        input: EditSeries,
        output: SeriesRecord,
        describe: async (i: EditInput) => {
          let s: SeriesRecord | undefined
          try {
            s = await store.series(i.ref)
          } catch {}
          const changes = [
            i.title === undefined ? undefined : `title "${i.title.trim()}"`,
            i.every === undefined ? undefined : `rhythm ${shownRhythm(i.every)}`,
            i.attendees === undefined ? undefined : "attendees",
            i.until === undefined ? undefined : `until ${blank(i.until) ? "none" : shownDate(i.until!)}`,
          ].filter((c) => c !== undefined)
          return `~ ${s?.ref ?? i.ref.trim()} ${changes.length ? changes.join(", ") : "(no change)"}`
        },
        run: async (i: EditInput) => {
          const s = await store.series(i.ref)
          const set: Record<string, unknown> = { updated_at: now() }
          if (i.title !== undefined) set.title = i.title.trim()
          if (i.every !== undefined) set.rhythm = rhythmOf(i.every)
          if (i.until !== undefined) set.end_date = blank(i.until) ? null : endFor(i.until!, s.first_date)
          await db.updateTable("series").set(set).where("id", "=", s.id).execute()
          if (i.attendees !== undefined) await setAttendees(s.id, await people(i.attendees))
          const reach = await ahead(s.id)
          if (reach.length > 0) {
            if (i.title !== undefined) await db.updateTable("meeting").set({ title: i.title.trim(), updated_at: now() }).where("id", "in", reach).execute()
            if (i.attendees !== undefined) {
              const ids = await people(i.attendees)
              for (const id of reach) {
                await db.deleteFrom("attendee").where("meeting_id", "=", id).execute()
                for (const person_id of ids) await db.insertInto("attendee").values({ meeting_id: id, person_id }).execute()
              }
            }
          }
          const [row] = await occurrences.rows(s.id)
          if (i.every !== undefined) {
            const dates = new Set(occurrences.window(row!))
            await occurrences.removePlanned(s.id, (m) => m.date >= currentContext().today && m.date === m.series_date && !dates.has(m.series_date))
          }
          if (row!.end_date !== null) {
            const end = row!.end_date
            await occurrences.removePlanned(s.id, (m) => m.date > end)
          }
          await occurrences.topUp(s.id)
          return store.series(s.ref)
        },
      },
      endSeries: {
        input: EndSeries,
        output: SeriesRecord,
        describe: async (i: EndInput) => {
          let ref = i.ref.trim()
          try {
            ref = (await store.series(i.ref)).ref
          } catch {}
          return `~ ${ref} ends ${shownDate(i.on ?? "today")}`
        },
        run: async (i: EndInput) => {
          const s = await store.series(i.ref)
          const on = dateField(i.on ?? "today", "on")
          await db.updateTable("series").set({ end_date: on, updated_at: now() }).where("id", "=", s.id).execute()
          await occurrences.removePlanned(s.id, (m) => m.date > on)
          return store.series(s.ref)
        },
      },
    },
  })

  // On every write-capable boot (M1): the occurrences for the coming 8 weeks, future dates only.
  ctx.upkeep("occurrences", async () => {
    await occurrences.topUp()
  })
}
