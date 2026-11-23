// The exposed operations: the reads `sinceDate` (design §8) and `upcoming`, and every meeting write (the series ones
// are in series.ts). Writes return the meeting with its `ref`; `describe` gives the change-set line (plugin
// reference §3). Agenda items are addressed by their meeting and their 1-based position, which stays dense (1..n)
// through add, move and remove. Every new meeting has a subject (`about`), which gives its kind unless one is given.
import {
  addDays,
  currentContext,
  formatRef,
  NonBlank,
  normalizeCode,
  normalizeHandle,
  NotFoundError,
  parseRef,
  Type,
  ValidationError,
  type PluginContext,
  type Static,
} from "@ttybrain/api"
import { CLOSE_AFTER_DAYS, Closed, type Closer } from "./close"
import type { Store } from "./records"
import type { Talks } from "./talk"
import { KindInput, MeetingKind, MeetingRecord, MeetingStatus, type MeetingRecord as Meeting, type SubjectType } from "./schema"
import { dateField as date, kindFor, normalizeKind, shownDate } from "./series"
import { sinceFor, type SinceResult } from "./since"

const Ref = NonBlank()
const OptStr = Type.Optional(Type.String())
const Clearable = Type.Optional(Type.Union([Type.String(), Type.Null()]))
const Position = Type.Integer({ minimum: 1 })

const AddMeeting = Type.Object({
  about: NonBlank(),
  title: NonBlank(),
  date: NonBlank(),
  kind: Type.Optional(KindInput),
  attendees: Type.Optional(Type.Array(NonBlank())),
  projects: Type.Optional(Type.Array(NonBlank())),
  sinceDate: OptStr,
})
const EditMeeting = Type.Object({ ref: Ref, title: Type.Optional(NonBlank()), date: Type.Optional(NonBlank()), kind: Type.Optional(KindInput), sinceDate: Clearable })
const MeetingRef = Type.Object({ ref: Ref })
const MoveMeeting = Type.Object({ ref: Ref, to: NonBlank() })
const SetSubject = Type.Object({ meeting: Type.Optional(Ref), allWithout: Type.Optional(Type.Boolean()), about: NonBlank() })
const SubjectAll = Type.Object({ ref: Type.String(), about: Type.String(), meetings: Type.Array(MeetingRecord) })
const UpcomingInput = Type.Object({ from: NonBlank(), to: NonBlank() })
const UpcomingRow = Type.Object({
  ref: Type.String(),
  id: Type.Integer(),
  title: Type.String(),
  date: Type.String(),
  kind: MeetingKind,
  status: MeetingStatus,
  about: Type.Union([Type.String(), Type.Null()]),
  series: Type.Union([Type.String(), Type.Null()]),
  closes_on: Type.Union([Type.String(), Type.Null()]), // the day it closes itself if not closed by then (date + 3); null: it never does
})
const UpcomingOutput = Type.Object({ meetings: Type.Array(UpcomingRow) })
const SetAttendees = Type.Object({ meeting: Ref, people: Type.Array(NonBlank()) })
const AddAgendaItem = Type.Object({ meeting: Ref, text: NonBlank(), project: OptStr, ask: OptStr, position: Type.Optional(Position) })
const EditAgendaItem = Type.Object({ meeting: Ref, item: Position, text: Type.Optional(NonBlank()), project: Clearable, ask: Clearable })
const MoveAgendaItem = Type.Object({ meeting: Ref, item: Position, to: Position })
const RemoveAgendaItem = Type.Object({ meeting: Ref, item: Position })
const SetNotes = Type.Object({ meeting: Ref, markdown: Type.String() })
const SinceInput = Type.Object({ meeting: Ref, project: Ref })
const SinceOutput = Type.Object({
  since: Type.String(),
  source: Type.Union([Type.Literal("meeting"), Type.Literal("previous"), Type.Literal("default")]),
  previous: Type.Union([Type.Object({ ref: Type.String(), title: Type.String(), date: Type.String() }), Type.Null()]),
})

type AddInput = Static<typeof AddMeeting>
type EditInput = Static<typeof EditMeeting>
type AttendeesInput = Static<typeof SetAttendees>
type AddItemInput = Static<typeof AddAgendaItem>
type EditItemInput = Static<typeof EditAgendaItem>
type MoveInput = Static<typeof MoveAgendaItem>
type RemoveInput = Static<typeof RemoveAgendaItem>
type NotesInput = Static<typeof SetNotes>
type MoveMeetingInput = Static<typeof MoveMeeting>
type SubjectInput = Static<typeof SetSubject>

const now = () => currentContext().now
const today = () => currentContext().today
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ""
// Free text: trimmed, and empty means none.
const clean = (v: string | null | undefined) => (blank(v) ? null : v!.trim())
const items = (n: number) => (n === 0 ? "no items" : `only ${n} ${n === 1 ? "item" : "items"}`)
const uniq = <T>(xs: T[]) => [...new Set(xs)]

export function registerOps(ctx: PluginContext, store: Store, talks: Talks, closer: Closer): void {
  const db = ctx.data

  // The meeting as it is now, for a describe line; undefined when the ref does not resolve.
  async function before(input: string): Promise<Meeting | undefined> {
    try {
      return await store.meeting(input)
    } catch {
      return undefined
    }
  }
  const refOf = (input: string, m?: Meeting) => {
    if (m) return m.ref
    const n = parseRef(input, "M-")
    return n === null ? input.trim() : formatRef("M-", n)
  }

  // The agenda item ids of a meeting, in position order.
  async function itemIds(meetingId: number): Promise<number[]> {
    const rows = await db.selectFrom("agenda_item").select("id").where("meeting_id", "=", meetingId).orderBy("position").execute()
    return rows.map((r) => Number(r.id))
  }
  function itemIndex(m: Meeting, ids: number[], item: number): number {
    if (item > ids.length) throw new NotFoundError(`${m.ref} has no item ${item}`, { hint: `${m.ref} has ${ids.length === 0 ? "no items" : `items 1 to ${ids.length}`}` })
    return item - 1
  }
  // Gives the items positions 1..n in the given order. Two passes, so the unique (meeting, position) never clashes.
  async function reorder(ids: number[]): Promise<void> {
    for (const [i, id] of ids.entries()) await db.updateTable("agenda_item").set({ position: -(i + 1) }).where("id", "=", id).execute()
    for (const [i, id] of ids.entries()) await db.updateTable("agenda_item").set({ position: i + 1 }).where("id", "=", id).execute()
  }
  const touch = (id: number) => db.updateTable("meeting").set({ updated_at: now() }).where("id", "=", id).execute()
  const projectOf = async (v: string | null | undefined) => (v === undefined ? undefined : blank(v) ? null : await store.projectId(v!))

  async function setStatus(m: Meeting, status: "held" | "cancelled"): Promise<Meeting> {
    await db.updateTable("meeting").set({ status, updated_at: now() }).where("id", "=", m.id).execute()
    return store.meeting(m.ref)
  }

  // A skipped or cancelled meeting takes place nowhere: the talk items ticked in it are open again.
  async function dropMeeting(m: Meeting): Promise<Meeting> {
    await talks.reopenDiscussedIn(m.id)
    return setStatus(m, "cancelled")
  }

  // A meeting's subject type, or null for one that has none yet (from before subjects existed).
  async function subjectTypeOf(m: Meeting): Promise<SubjectType | null> {
    const row = await db.selectFrom("meeting").select("subject_type").where("id", "=", m.id).executeTakeFirstOrThrow()
    return (row.subject_type as SubjectType | null) ?? null
  }

  ctx.expose({
    read: {
      sinceDate: {
        input: SinceInput,
        output: SinceOutput,
        toolDescription: "The date a meeting's prep for a project counts from: the meeting's own since date, else the last held meeting covering the project, else 30 days before.",
        run: async (i: Static<typeof SinceInput>): Promise<SinceResult> => sinceFor(store, await store.meeting(i.meeting), await store.projectId(i.project)),
      },
      // The planned meetings dated from `from` to `to` (both included), by date.
      upcoming: {
        input: UpcomingInput,
        output: UpcomingOutput,
        toolDescription: "The planned meetings between two dates, with what each is about and its series.",
        run: async (i: Static<typeof UpcomingInput>) => {
          const from = date(i.from, "from")
          const to = date(i.to, "to")
          const ids = await db
            .selectFrom("meeting")
            .select(["id", "auto_close"])
            .where("status", "=", "planned")
            .where("date", ">=", from)
            .where("date", "<=", to)
            .orderBy("date")
            .orderBy("id")
            .execute()
          const meetings = []
          for (const r of ids) {
            const m = await store.meeting(formatRef("M-", Number(r.id)))
            const closes_on = Number(r.auto_close) === 1 ? addDays(m.date, CLOSE_AFTER_DAYS) : null
            meetings.push({ ref: m.ref, id: m.id, title: m.title, date: m.date, kind: m.kind, status: m.status, about: m.about, series: m.series, closes_on })
          }
          return { meetings }
        },
      },
    },
    write: {
      addMeeting: {
        input: AddMeeting,
        output: MeetingRecord,
        describe: async (i: AddInput) => `+ meeting "${i.title.trim()}" ${shownDate(i.date)}`,
        run: async (i: AddInput) => {
          const subject = await store.activeSubject(i.about)
          const kind = kindFor(subject, i.kind)
          const day = date(i.date, "date")
          const since = blank(i.sinceDate) ? null : date(i.sinceDate!, "sinceDate")
          // Without attendees, a meeting about a person has that person.
          const people: number[] = i.attendees === undefined && subject.type === "person" ? [subject.id] : []
          for (const h of i.attendees ?? []) people.push(await store.personId(h))
          const projects: number[] = []
          for (const c of i.projects ?? []) projects.push(await store.projectId(c))
          const t = now()
          const res = await db
            .insertInto("meeting")
            .values({
              title: i.title.trim(),
              date: day,
              kind,
              status: "planned",
              since_date: since,
              notes: "",
              subject_type: subject.type,
              subject_id: subject.id,
              auto_close: day >= today() ? 1 : 0, // a past meeting never closes itself (as `meeting subject`, M4)
              created_at: t,
              updated_at: t,
            })
            .executeTakeFirstOrThrow()
          const id = Number(res.insertId)
          for (const person_id of uniq(people)) await db.insertInto("attendee").values({ meeting_id: id, person_id }).execute()
          const ordered = uniq(projects)
          const names =
            ordered.length === 0 ? [] : await db.selectFrom("projects.project").select(["id", "name"]).where("id", "in", ordered).execute()
          const nameOf = new Map(names.map((r) => [Number(r.id), String(r.name)]))
          for (const [n, project_id] of ordered.entries())
            await db
              .insertInto("agenda_item")
              .values({ meeting_id: id, position: n + 1, text: `${nameOf.get(project_id) ?? "Project"} status`, project_id, ask: null })
              .execute()
          return store.meeting(formatRef("M-", id))
        },
      },
      editMeeting: {
        input: EditMeeting,
        output: MeetingRecord,
        describe: async (i: EditInput) => {
          const m = await before(i.ref)
          const after = {
            title: i.title === undefined ? undefined : `"${i.title.trim()}"`,
            date: i.date === undefined ? undefined : shownDate(i.date),
            kind: i.kind === undefined ? undefined : normalizeKind(i.kind),
            since: i.sinceDate === undefined ? undefined : blank(i.sinceDate) ? "none" : shownDate(i.sinceDate!),
          }
          const was = m && { title: `"${m.title}"`, date: m.date, kind: m.kind, since: m.since_date ?? "none" }
          const changes = (Object.keys(after) as Array<keyof typeof after>)
            .filter((f) => after[f] !== undefined && (!was || was[f] !== after[f]))
            .map((f) => (was ? `${f} ${was[f]} → ${after[f]}` : f))
          return `~ ${refOf(i.ref, m)} ${changes.length ? changes.join(", ") : "(no change)"}`
        },
        run: async (i: EditInput) => {
          const m = await store.openMeeting(i.ref, { allowHeld: true })
          const set: Record<string, unknown> = { updated_at: now() }
          if (i.title !== undefined) set.title = i.title.trim()
          if (i.date !== undefined) {
            const day = date(i.date, "date")
            set.date = day
            if (m.about !== null) set.auto_close = day >= today() ? 1 : 0 // as `meeting subject` (M4)
          }
          if (i.kind !== undefined) {
            const type = await subjectTypeOf(m)
            const kind = normalizeKind(i.kind)
            if (type === null && kind === "one_on_one")
              throw new ValidationError("a 1:1 needs a person; this meeting has no subject", { field: "kind", hint: `run ttybrain meeting subject ${m.ref} @handle first` })
            set.kind = type === null ? kind : kindFor({ type, ref: m.about! }, i.kind)
          }
          if (i.sinceDate !== undefined) set.since_date = blank(i.sinceDate) ? null : date(i.sinceDate!, "sinceDate")
          await db.updateTable("meeting").set(set).where("id", "=", m.id).execute()
          return store.meeting(m.ref)
        },
      },
      // Skip one date of a series (M3): the occurrence is cancelled and keeps its place, so it is not made again.
      skipMeeting: {
        input: MeetingRef,
        output: MeetingRecord,
        describe: async (i: { ref: string }) => `~ ${refOf(i.ref, await before(i.ref))} skipped`,
        run: async (i: { ref: string }) => dropMeeting(await store.openMeeting(i.ref)),
      },
      // Move a planned meeting to another date (M3): an occurrence keeps the series date it was made for.
      moveMeeting: {
        input: MoveMeeting,
        output: MeetingRecord,
        describe: async (i: MoveMeetingInput) => {
          const m = await before(i.ref)
          return `~ ${refOf(i.ref, m)} date ${m ? `${m.date} → ` : ""}${shownDate(i.to)}`
        },
        run: async (i: MoveMeetingInput) => {
          const m = await store.openMeeting(i.ref)
          const to = date(i.to, "to")
          const set: Record<string, unknown> = { date: to, updated_at: now() }
          if (m.about !== null) set.auto_close = to >= today() ? 1 : 0 // as `meeting subject` (M4)
          await db.updateTable("meeting").set(set).where("id", "=", m.id).execute()
          return store.meeting(m.ref)
        },
      },
      // Give a meeting its subject (design §5.5, §5.7): a person makes it a 1:1, a board a board meeting, a project
      // keeps board (as before boards existed) and makes anything else a project meeting. It closes itself from then on only when dated today or later (M4). With `allWithout`
      // instead of `meeting`, every meeting that has no subject yet gets it, in date order, all in this one write;
      // the output's `ref` is then the first meeting changed (the subject's ref when there was none).
      setSubject: {
        input: SetSubject,
        output: Type.Union([MeetingRecord, SubjectAll]),
        describe: async (i: SubjectInput) =>
          i.allWithout === true ? `~ meetings without a subject about ${i.about.trim()}` : `~ ${refOf(i.meeting ?? "", await before(i.meeting ?? ""))} about ${i.about.trim()}`,
        run: async (i: SubjectInput) => {
          if ((i.meeting === undefined) === (i.allWithout !== true))
            throw new ValidationError("give either meeting or allWithout", { field: "meeting" })
          const subject = await store.activeSubject(i.about)
          const assign = async (m: Meeting) => {
            const kind = subject.type === "person" ? "one_on_one" : subject.type === "board" || m.kind === "board" ? "board" : "project"
            const set: Record<string, unknown> = { subject_type: subject.type, subject_id: subject.id, kind, updated_at: now() }
            if (m.date >= today()) set.auto_close = 1
            await db.updateTable("meeting").set(set).where("id", "=", m.id).execute()
            return store.meeting(m.ref)
          }
          if (i.meeting !== undefined) return assign(await store.meeting(i.meeting))
          const ids = await db.selectFrom("meeting").select("id").where("subject_type", "is", null).orderBy("date").orderBy("id").execute()
          const meetings: Meeting[] = []
          for (const r of ids) meetings.push(await assign(await store.meeting(formatRef("M-", Number(r.id)))))
          return { ref: meetings[0]?.ref ?? subject.ref, about: subject.ref, meetings }
        },
      },
      cancelMeeting: {
        input: MeetingRef,
        output: MeetingRecord,
        describe: async (i: { ref: string }) => `~ ${refOf(i.ref, await before(i.ref))} cancelled`,
        run: async (i: { ref: string }) => dropMeeting(await store.openMeeting(i.ref)),
      },
      // Held: unticked talk items kept for next time, a 1:1's notes on its person (close.ts).
      closeMeeting: {
        input: MeetingRef,
        output: Closed,
        describe: async (i: { ref: string }) => `~ ${refOf(i.ref, await before(i.ref))} held`,
        run: async (i: { ref: string }) => {
          const m = await store.meeting(i.ref)
          if (m.status === "held") {
            const row = await db.selectFrom("meeting").select("closed_itself").where("id", "=", m.id).executeTakeFirstOrThrow()
            const hint = Number(row.closed_itself) === 1 ? `it closed itself ${CLOSE_AFTER_DAYS} days after its date; see ttybrain report minutes ${m.ref}` : undefined
            throw new ValidationError(`${m.ref} is already held`, hint === undefined ? {} : { hint })
          }
          await store.openMeeting(m.ref) // a cancelled meeting cannot be held
          return closer.close(m)
        },
      },
      setAttendees: {
        input: SetAttendees,
        output: MeetingRecord,
        describe: async (i: AttendeesInput) => {
          const m = await before(i.meeting)
          const was = new Set(m?.attendees ?? [])
          const wanted = uniq(i.people.map((h) => `@${normalizeHandle(h)}`))
          const added = wanted.filter((h) => !was.has(h)).sort()
          const removed = [...was].filter((h) => !wanted.includes(h)).sort()
          const changes = [...added.map((h) => `+${h}`), ...removed.map((h) => `−${h}`)]
          return `~ ${refOf(i.meeting, m)} attendees ${changes.length ? changes.join(" ") : "(no change)"}`
        },
        run: async (i: AttendeesInput) => {
          const m = await store.openMeeting(i.meeting, { allowHeld: true })
          const people: number[] = []
          for (const h of i.people) people.push(await store.personId(h))
          await db.deleteFrom("attendee").where("meeting_id", "=", m.id).execute()
          for (const person_id of uniq(people)) await db.insertInto("attendee").values({ meeting_id: m.id, person_id }).execute()
          await touch(m.id)
          return store.meeting(m.ref)
        },
      },
      addAgendaItem: {
        input: AddAgendaItem,
        output: MeetingRecord,
        describe: async (i: AddItemInput) => {
          const m = await before(i.meeting)
          return `+ ${refOf(i.meeting, m)} item ${i.position ?? (m ? m.agenda.length + 1 : "?")} "${i.text.trim()}"`
        },
        run: async (i: AddItemInput) => {
          const m = await store.openMeeting(i.meeting, { allowHeld: true })
          const ids = await itemIds(m.id)
          const position = i.position ?? ids.length + 1
          if (position > ids.length + 1) throw new ValidationError(`${m.ref} has ${items(ids.length)}`, { field: "position", hint: `use 1 to ${ids.length + 1}` })
          const project_id = (await projectOf(i.project)) ?? null
          // Position 0 is never taken (positions are 1..n); reorder then puts the new item in its place.
          const res = await db
            .insertInto("agenda_item")
            .values({ meeting_id: m.id, position: 0, text: i.text.trim(), project_id, ask: clean(i.ask) })
            .executeTakeFirstOrThrow()
          ids.splice(position - 1, 0, Number(res.insertId))
          await reorder(ids)
          await touch(m.id)
          return store.meeting(m.ref)
        },
      },
      editAgendaItem: {
        input: EditAgendaItem,
        output: MeetingRecord,
        describe: async (i: EditItemInput) => {
          const m = await before(i.meeting)
          const was = m?.agenda.find((a) => a.position === i.item)
          const quoted = (v: string | null) => (v === null ? "none" : `"${v}"`)
          const after = {
            text: i.text === undefined ? undefined : i.text.trim(),
            project: i.project === undefined ? undefined : blank(i.project) ? null : normalizeCode(i.project!),
            ask: i.ask === undefined ? undefined : clean(i.ask),
          }
          const old = was && { text: was.text, project: was.project === null ? null : was.project.slice(1), ask: was.ask }
          const changes = (Object.keys(after) as Array<keyof typeof after>)
            .filter((f) => after[f] !== undefined && (!old || old[f] !== after[f]))
            .map((f) => `${f}: ${quoted(after[f]!)}`)
          return `~ ${refOf(i.meeting, m)} item ${i.item} ${changes.length ? changes.join(", ") : "(no change)"}`
        },
        run: async (i: EditItemInput) => {
          const m = await store.openMeeting(i.meeting, { allowHeld: true })
          const ids = await itemIds(m.id)
          const id = ids[itemIndex(m, ids, i.item)]!
          const set: Record<string, unknown> = {}
          if (i.text !== undefined) set.text = i.text.trim()
          const project = await projectOf(i.project)
          if (project !== undefined) set.project_id = project
          if (i.ask !== undefined) set.ask = clean(i.ask)
          if (Object.keys(set).length) await db.updateTable("agenda_item").set(set).where("id", "=", id).execute()
          await touch(m.id)
          return store.meeting(m.ref)
        },
      },
      moveAgendaItem: {
        input: MoveAgendaItem,
        output: MeetingRecord,
        describe: async (i: MoveInput) => `~ ${refOf(i.meeting, await before(i.meeting))} item ${i.item} → ${i.to}`,
        run: async (i: MoveInput) => {
          const m = await store.openMeeting(i.meeting, { allowHeld: true })
          const ids = await itemIds(m.id)
          const from = itemIndex(m, ids, i.item)
          if (i.to > ids.length) throw new ValidationError(`${m.ref} has ${items(ids.length)}`, { field: "to", hint: `use 1 to ${ids.length}` })
          const [id] = ids.splice(from, 1)
          ids.splice(i.to - 1, 0, id!)
          await reorder(ids)
          await touch(m.id)
          return store.meeting(m.ref)
        },
      },
      removeAgendaItem: {
        input: RemoveAgendaItem,
        output: MeetingRecord,
        describe: async (i: RemoveInput) => {
          const m = await before(i.meeting)
          const was = m?.agenda.find((a) => a.position === i.item)
          return `- ${refOf(i.meeting, m)} item ${i.item}${was ? ` "${was.text}"` : ""}`
        },
        run: async (i: RemoveInput) => {
          const m = await store.openMeeting(i.meeting, { allowHeld: true })
          const ids = await itemIds(m.id)
          const [id] = ids.splice(itemIndex(m, ids, i.item), 1)
          await db.deleteFrom("agenda_item").where("id", "=", id!).execute()
          await reorder(ids)
          await touch(m.id)
          return store.meeting(m.ref)
        },
      },
      setNotes: {
        input: SetNotes,
        output: MeetingRecord,
        describe: async (i: NotesInput) => `~ ${refOf(i.meeting, await before(i.meeting))} notes`,
        run: async (i: NotesInput) => {
          const m = await store.openMeeting(i.meeting, { allowHeld: true })
          await db.updateTable("meeting").set({ notes: i.markdown, updated_at: now() }).where("id", "=", m.id).execute()
          return store.meeting(m.ref)
        },
      },
    },
  })
}
