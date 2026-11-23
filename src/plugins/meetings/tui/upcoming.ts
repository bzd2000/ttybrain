// What the Attention panel and screen 5 show about a planned meeting (the `home` and `meetings` designs): what it is
// about (a person's first name, a project's or a board's code), what waits on its talk-list ("To talk": the open items of its
// subject's list; a board meeting: its agenda length) and your open actions for it ("Your act.": owner me, linked to
// its subject, to it, or to an earlier meeting of its series). Read through the plugin's own reads and tables and the
// people, projects and actions views; a plugin that is not loaded shows nothing for its part.
import { addDays, dayDate, dueLabel, weekEnd, type Cell, type Tone, type useRuntime } from "@ttybrain/api/tui"
import { CLOSE_AFTER_DAYS } from "../logic/close"
import { GONE, makeStore } from "../logic/records"
import type { MeetingKind, SubjectType } from "../logic/schema"

export type Upcoming = {
  ref: string
  id: number
  title: string
  date: string
  kind: MeetingKind
  series: string | null
  closes_on: string | null // the day it closes itself (null: it never does)
  subject: { type: SubjectType; id: number } | null
  notes: boolean
  agenda: number // its agenda items
}
export type MyAction = { ref: string; title: string; due: string | null }

type Read = (input: Record<string, unknown>) => Promise<any>

// `Mon 23`: the day without its month.
export const dayOnly = (iso: string) => dayDate(iso).split(" ").slice(0, 2).join(" ")
export const MUTED_DASH: Cell = { text: "—", tone: "muted" }

// An action's due date as the designs show it beside a meeting: overdue `-4d` (red), next week's by weekday (`Mon`),
// otherwise as the due label (`Fri`, `4 Dec`).
export function dueCell(due: string | null, today: string): Cell {
  if (due === null) return MUTED_DASH
  if (due < today) return { text: dueLabel(due, today), tone: "red" }
  if (due > weekEnd(today) && due <= addDays(weekEnd(today), 7)) return { text: dayDate(due).split(" ")[0]! }
  return { text: dueLabel(due, today) }
}

type Runtime = ReturnType<typeof useRuntime>

export function makeUpcoming(rt: Runtime) {
  const db = rt.data
  const store = makeStore(rt)
  // A view of a plugin that is not loaded gives nothing.
  const orNothing = store.unlessUnavailable
  const read = (op: string): Read => rt.self().read[op]! as Read

  // The planned meetings dated from `from` to `to`, by date (then series, then id: the `upcoming` read's order).
  async function between(from: string, to: string): Promise<Upcoming[]> {
    const { meetings } = (await read("upcoming")({ from, to })) as { meetings: Array<{ ref: string; id: number; title: string; date: string; kind: MeetingKind; series: string | null; closes_on: string | null }> }
    return withRows(meetings)
  }

  // The planned meetings before `before` that never close themselves or missed closing themselves (dated more than
  // CLOSE_AFTER_DAYS before it: the upkeep has not run), and every meeting without a subject.
  async function unclosed(before: string): Promise<{ notClosed: Upcoming[]; noSubject: Upcoming[] }> {
    const overdue = addDays(before, -CLOSE_AFTER_DAYS)
    const rows = await db
      .selectFrom("meeting")
      .select(["id", "title", "date", "kind", "series_id", "auto_close", "subject_type", "status"])
      .where((eb) => eb.or([eb("subject_type", "is", null), eb.and([eb("status", "=", "planned"), eb.or([eb.and([eb("auto_close", "=", 0), eb("date", "<", before)]), eb("date", "<", overdue)])])]))
      .where("status", "!=", "cancelled")
      .orderBy("date")
      .orderBy("id")
      .execute()
    const list = await withRows(
      rows.map((r) => ({
        ref: `M-${Number(r.id)}`,
        id: Number(r.id),
        title: String(r.title),
        date: String(r.date),
        kind: r.kind as MeetingKind,
        series: r.series_id === null ? null : `S-${Number(r.series_id)}`,
        closes_on: null,
      })),
    )
    return { notClosed: list.filter((m) => m.subject !== null), noSubject: list.filter((m) => m.subject === null) }
  }

  async function withRows(meetings: Array<Omit<Upcoming, "subject" | "notes" | "agenda">>): Promise<Upcoming[]> {
    if (meetings.length === 0) return []
    const ids = meetings.map((m) => m.id)
    const own = await db.selectFrom("meeting").select(["id", "subject_type", "subject_id", "notes"]).where("id", "in", ids).execute()
    const byId = new Map(own.map((r) => [Number(r.id), r]))
    const items = await db.selectFrom("agenda_item").select(["meeting_id", (eb) => eb.fn.countAll().as("n")]).where("meeting_id", "in", ids).groupBy("meeting_id").execute()
    const agenda = new Map(items.map((r) => [Number(r.meeting_id), Number(r.n)]))
    return meetings.map((m) => {
      const r = byId.get(m.id)!
      return {
        ...m,
        subject: r.subject_type === null ? null : { type: r.subject_type as SubjectType, id: Number(r.subject_id) },
        notes: String(r.notes).trim() !== "",
        agenda: agenda.get(m.id) ?? 0,
      }
    })
  }

  // What a meeting or series is about, as the About column shows it: a person's first name (magenta for a
  // stakeholder, as names elsewhere; a team member's in plain text, as the designs draw them), a project's or a board's code (cyan),
  // `—` (muted) for none or a record that is gone.
  async function about(subject: { type: SubjectType; id: number } | null): Promise<Cell> {
    if (subject === null) return MUTED_DASH
    if (subject.type === "person") {
      const p = await orNothing(undefined as Record<string, unknown> | undefined, () =>
        db.selectFrom("people.person").select(["name", "is_stakeholder", "is_team"]).where("id", "=", subject.id).executeTakeFirst(),
      )
      if (!p) return MUTED_DASH
      const tone: Tone = Number(p.is_stakeholder) === 1 && Number(p.is_team) !== 1 ? "magenta" : undefined
      return { text: String(p.name).split(/\s+/)[0]!, tone }
    }
    if (subject.type === "board") {
      const b = await db.selectFrom("board").select("code").where("id", "=", subject.id).executeTakeFirst()
      return b ? { text: String(b.code), tone: "cyan" } : MUTED_DASH
    }
    const p = await orNothing(undefined as Record<string, unknown> | undefined, () => db.selectFrom("projects.project").select("code").where("id", "=", subject.id).executeTakeFirst())
    return p ? { text: String(p.code), tone: "cyan" } : MUTED_DASH
  }

  // The subject's ref for a read (`@anna`, `#CRM`), or null when it is gone.
  async function subjectRef(subject: { type: SubjectType; id: number }): Promise<string | null> {
    const ref = await store.subjectRef(subject.type, subject.id)
    return ref === GONE || ref.includes(":") ? null : ref
  }

  // "To talk": the open items on the subject's talk-list (the ones added since its last meeting; carried items are
  // not counted), a board meeting's agenda length; null when there is no subject (or it is gone).
  async function talk(m: Upcoming): Promise<number | null> {
    if (m.kind === "board") return m.agenda
    if (m.subject === null) return null
    const ref = await subjectRef(m.subject)
    if (ref === null) return null
    const list = (await read("talkList")({ about: ref })) as { open: unknown[] }
    return list.open.length
  }

  // Your open actions for the meeting: owner me, linked to its subject, to it or to an earlier meeting of its series;
  // by due date (none last), then id.
  async function mine(m: Upcoming): Promise<MyAction[]> {
    const meetings = [m.id]
    if (m.series !== null) {
      const earlier = await db.selectFrom("meeting").select("id").where("series_id", "=", Number(m.series.slice(2))).where("date", "<", m.date).execute()
      meetings.push(...earlier.map((r) => Number(r.id)))
    }
    const subject = m.subject
    const rows = await orNothing([] as Array<Record<string, unknown>>, () =>
      db
        .selectFrom("actions.action as a")
        .innerJoin("actions.link as l", "l.action_id", "a.id")
        .select(["a.id", "a.title", "a.due_date"])
        .distinct()
        .where("a.status", "=", "open")
        .where("a.owner_id", "is", null)
        .where((eb) =>
          eb.or([
            eb.and([eb("l.record_type", "=", "meeting"), eb("l.record_id", "in", meetings)]),
            ...(subject === null ? [] : [eb.and([eb("l.record_type", "=", subject.type), eb("l.record_id", "=", subject.id)])]),
          ]),
        )
        .execute(),
    )
    return rows
      .map((r) => ({ id: Number(r.id), ref: `A-${Number(r.id)}`, title: String(r.title), due: r.due_date === null ? null : String(r.due_date) }))
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.id - b.id)
      .map(({ ref, title, due }) => ({ ref, title, due }))
  }

  return { between, unclosed, about, subjectRef, talk, mine }
}
