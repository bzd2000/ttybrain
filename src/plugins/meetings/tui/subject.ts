// What a person's or project's Talk and Meetings tabs show about their meetings (the 2026-11-20 `talk` and `project`
// designs): the subject itself, its talk-list, its next and last meeting, its series, its past meetings with what
// came out of them, and the open actions around it. Read through the plugin's own reads and tables and the people,
// projects and actions views; a plugin that is not loaded shows nothing for its part.
import { addDays, dayDate, shortDate, type Cell, type CellPart, type useRuntime } from "@ttybrain/api/tui"
import { makeStore, type Subject } from "../logic/records"
import { parseRhythm, rhythmLabel } from "../logic/rhythm"
import { KIND_LABELS, type MeetingKind, type SeriesRecord, type TalkRecord } from "../logic/schema"
import type { TalkList } from "../logic/talk"
import type { MyAction } from "./upcoming"

type Runtime = ReturnType<typeof useRuntime>
export type MeetingRow = { ref: string; id: number; title: string; date: string; kind: MeetingKind; series: number | null }
export type Last = MeetingRow & { discussed: number; carried: number }
export type Past = MeetingRow & { actions: number; decisions: number }
export type Person = { id: number; name: string; first: string; stakeholder: boolean; team: boolean }

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
// The Monday of a date's week.
const mondayOf = (iso: string) => addDays(iso, -((DAYS.indexOf(dayDate(iso).slice(0, 3)) + 6) % 7))

// When a talk item was added, as the Talk tab's Added column reads: `today`, a day of this week (`Tue`), else the
// date (`2 Nov`).
export function addedLabel(date: string, today: string): string {
  if (date === today) return "today"
  if (date < today && date >= mondayOf(today)) return dayDate(date).slice(0, 3)
  return shortDate(date)
}

// How a meeting reads after a date or in a sentence: a 1:1 as `1:1`, the others by their title.
export const meetingName = (m: { kind: MeetingKind; title: string }) => (m.kind === "one_on_one" ? KIND_LABELS.one_on_one : m.title)

// `Peter J.` for a stakeholder (magenta), a team member's first name in plain text, as the `project` design's With.
export function personCell(p: Person): CellPart {
  if (p.stakeholder && !p.team) {
    const [first, ...rest] = p.name.split(/\s+/)
    const last = rest.at(-1)
    return { text: last === undefined ? first! : `${first} ${last.slice(0, 1)}.`, tone: "magenta" }
  }
  return { text: p.first }
}

// A muted `—`.
export const DASH: Cell = { text: "—", tone: "muted" }

const toRow = (r: Record<string, unknown>): MeetingRow => ({
  ref: `M-${Number(r.id)}`,
  id: Number(r.id),
  title: String(r.title),
  date: String(r.date),
  kind: r.kind as MeetingKind,
  series: r.series_id === null ? null : Number(r.series_id),
})

export function makeSubjects(rt: Runtime) {
  const db = rt.data
  const store = makeStore(rt)
  const read = (op: string) => rt.self().read[op]! as (input: Record<string, unknown>) => Promise<any>
  const meetings = (s: Pick<Subject, "type" | "id">) =>
    db.selectFrom("meeting").select(["id", "title", "date", "kind", "series_id"]).where("subject_type", "=", s.type).where("subject_id", "=", s.id)

  async function subject(ref: string): Promise<Subject & { label: string }> {
    const s = await store.subject(ref)
    return { ...s, label: await rt.records.label(s.ref).catch(() => s.ref) }
  }

  const talkList = (s: Subject): Promise<TalkList> => read("talkList")({ about: s.ref })

  // The next planned meeting from today.
  async function next(s: Subject): Promise<MeetingRow | null> {
    const r = await meetings(s).where("status", "=", "planned").where("date", ">=", rt.clock.today()).orderBy("date").orderBy("id").limit(1).executeTakeFirst()
    return r ? toRow(r) : null
  }

  // The last held meeting, with how many items were discussed in it and how many it kept for the next one.
  async function last(s: Subject): Promise<Last | null> {
    const r = await meetings(s).where("status", "=", "held").orderBy("date", "desc").orderBy("id", "desc").limit(1).executeTakeFirst()
    if (!r) return null
    const m = toRow(r)
    const discussed = await db.selectFrom("talk_item").select((eb) => eb.fn.countAll().as("n")).where("meeting_id", "=", m.id).where("status", "=", "discussed").executeTakeFirstOrThrow()
    const kept = await db.selectFrom("talk_kept").select((eb) => eb.fn.countAll().as("n")).where("meeting_id", "=", m.id).executeTakeFirstOrThrow()
    return { ...m, discussed: Number(discussed.n), carried: Number(kept.n) }
  }

  // The subject's series that have not ended, the next date first (none last).
  async function series(s: Subject): Promise<SeriesRecord[]> {
    const day = rt.clock.today()
    const ids = await db
      .selectFrom("series")
      .select("id")
      .where("subject_type", "=", s.type)
      .where("subject_id", "=", s.id)
      .where((eb) => eb.or([eb("end_date", "is", null), eb("end_date", ">=", day)]))
      .orderBy("id")
      .execute()
    const list = await Promise.all(ids.map((r) => store.series(`S-${Number(r.id)}`)))
    return list.sort((a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999") || a.id - b.id)
  }

  // A series' rhythm as the designs read it: `every 2 weeks, Monday` (long), `monthly, 4th Tue` (short).
  const rhythm = (s: SeriesRecord, form: "short" | "long") => rhythmLabel(parseRhythm(s.rhythm), form)

  // The held meetings, newest first, with the actions and decisions logged in them.
  async function past(s: Subject): Promise<Past[]> {
    const rows = (await meetings(s).where("status", "=", "held").orderBy("date", "desc").orderBy("id", "desc").execute()).map(toRow)
    if (rows.length === 0) return []
    const ids = rows.map((m) => m.id)
    const acts = await store.unlessUnavailable([] as Array<Record<string, unknown>>, () =>
      db
        .selectFrom("actions.link")
        .select(["record_id", (eb) => eb.fn.countAll().as("n")])
        .where("record_type", "=", "meeting")
        .where("record_id", "in", ids)
        .groupBy("record_id")
        .execute(),
    )
    const decs = await store.unlessUnavailable([] as Array<Record<string, unknown>>, () =>
      db
        .selectFrom("projects.decision")
        .select(["meeting_id", (eb) => eb.fn.countAll().as("n")])
        .where("meeting_id", "in", ids)
        .groupBy("meeting_id")
        .execute(),
    )
    const a = new Map(acts.map((r) => [Number(r.record_id), Number(r.n)]))
    const d = new Map(decs.map((r) => [Number(r.meeting_id), Number(r.n)]))
    return rows.map((m) => ({ ...m, actions: a.get(m.id) ?? 0, decisions: d.get(m.id) ?? 0 }))
  }

  const toActions = (rows: Array<Record<string, unknown>>): MyAction[] =>
    rows
      .map((r) => ({ id: Number(r.id), ref: `A-${Number(r.id)}`, title: String(r.title), due: r.due_date === null ? null : String(r.due_date) }))
      .sort((x, y) => (x.due ?? "9999").localeCompare(y.due ?? "9999") || x.id - y.id)
      .map(({ ref, title, due }) => ({ ref, title, due }))

  // Your open actions around the subject: owner me, linked to it or to one of its meetings; by due date, then id.
  async function mine(s: Subject): Promise<MyAction[]> {
    const ids = (await meetings(s).execute()).map((r) => Number(r.id))
    const rows = await store.unlessUnavailable([] as Array<Record<string, unknown>>, () =>
      db
        .selectFrom("actions.action as a")
        .innerJoin("actions.link as l", "l.action_id", "a.id")
        .select(["a.id", "a.title", "a.due_date"])
        .distinct()
        .where("a.status", "=", "open")
        .where("a.owner_id", "is", null)
        .where((eb) =>
          eb.or([
            eb.and([eb("l.record_type", "=", s.type), eb("l.record_id", "=", s.id)]),
            ...(ids.length === 0 ? [] : [eb.and([eb("l.record_type", "=", "meeting"), eb("l.record_id", "in", ids)])]),
          ]),
        )
        .execute(),
    )
    return toActions(rows)
  }

  // A person's own open actions (they are the owner).
  async function owned(personId: number): Promise<MyAction[]> {
    const rows = await store.unlessUnavailable([] as Array<Record<string, unknown>>, () =>
      db.selectFrom("actions.action").select(["id", "title", "due_date"]).where("status", "=", "open").where("owner_id", "=", personId).execute(),
    )
    return toActions(rows)
  }

  // People by @handle (a series' attendees): name, first name, stakeholder, team; the gone ones left out.
  async function people(handles: string[]): Promise<Person[]> {
    const names = handles.map((h) => h.replace(/^@/, ""))
    if (names.length === 0) return []
    const rows = await store.unlessUnavailable([] as Array<Record<string, unknown>>, () =>
      db.selectFrom("people.person").select(["id", "handle", "name", "is_stakeholder", "is_team"]).where("handle", "in", names).execute(),
    )
    const byHandle = new Map(rows.map((r) => [String(r.handle), r]))
    return names.flatMap((h) => {
      const r = byHandle.get(h)
      if (!r) return []
      const name = String(r.name)
      return [{ id: Number(r.id), name, first: name.split(/\s+/)[0]!, stakeholder: Number(r.is_stakeholder) === 1, team: Number(r.is_team) === 1 }]
    })
  }

  return { store, subject, talkList, next, last, series, rhythm, past, mine, owned, people }
}

export type Subjects = ReturnType<typeof makeSubjects>
export type { TalkRecord }
