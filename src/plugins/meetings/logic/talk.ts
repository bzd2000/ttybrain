// Talk-lists (design §5.3, rulings M5, M8, M12). A talk item is something to raise with a person or about a project
// (its subject), with an optional project tag (a person's items only). While open it has a place on its subject's
// list; the list shows two groups, the items added since the subject's last held meeting and those carried over from
// before it, and an item's `position` is its rank in its group (moves stay inside the group). Discussing an item (in a
// meeting, or elsewhere) or dropping it takes it off the list; reopening puts it back near the place it had. A person's
// item tagged with a project is also on that project's list and its meetings' agendas, until it is discussed in either
// place. Subjects and tags are soft references shown through the people and projects views: `—` once the record is
// gone, `<type>:<id>` while no plugin registers the type; the item stays listed (Review Focus 4).
import { currentContext, formatRef, NonBlank, normalizeCode, NotFoundError, parseRef, Type, ValidationError, type PluginContext, type Static } from "@ttybrain/api"
import type { Store, Subject } from "./records"
import { TalkRecord, type SubjectType, type TalkRecord as Talk } from "./schema"

export type TalkList = { open: Talk[]; carried: Talk[]; carriedFrom?: string }
export type Talks = ReturnType<typeof makeTalks>

const ListOutput = Type.Object({ open: Type.Array(TalkRecord), carried: Type.Array(TalkRecord), carriedFrom: Type.Optional(Type.String()) })
const AgendaOutput = Type.Object({ meeting: Type.String(), items: Type.Array(TalkRecord) })
const AddTalk = Type.Object({ about: NonBlank(), text: NonBlank(), project: Type.Optional(Type.String()) })
const EditTalk = Type.Object({ ref: NonBlank(), text: Type.Optional(NonBlank()), project: Type.Optional(Type.Union([Type.String(), Type.Null()])) })
const MoveTalk = Type.Object({ ref: NonBlank(), to: Type.Integer({ minimum: 1 }) })
const TalkRef = Type.Object({ ref: NonBlank() })
const DiscussTalk = Type.Object({ ref: NonBlank(), meeting: Type.Optional(NonBlank()) })
type AddInput = Static<typeof AddTalk>
type EditInput = Static<typeof EditTalk>
type MoveInput = Static<typeof MoveTalk>
type DiscussInput = Static<typeof DiscussTalk>

const COLUMNS = ["id", "subject_type", "subject_id", "text", "project_id", "added_date", "position", "last_position", "status", "meeting_id"] as const
type Row = {
  id: number
  subject_type: SubjectType
  subject_id: number
  text: string
  project_id: number | null
  added_date: string
  position: number | null
  last_position: number | null
  status: Talk["status"]
  meeting_id: number | null
}
// A subject's open items split into the two groups the list shows, in list order.
type Groups = { since?: string; open: Row[]; carried: Row[] }

const today = () => currentContext().today
const now = () => currentContext().now
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ""
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
const shownRef = (input: string, prefix: string) => {
  const n = parseRef(input, prefix)
  return n === null ? input.trim() : formatRef(prefix, n)
}
const talkRef = (r: Row) => formatRef("T-", r.id)

export function makeTalks(ctx: PluginContext, store: Store) {
  const db = ctx.data
  const toRow = (r: Record<string, unknown>): Row => ({
    id: Number(r.id),
    subject_type: r.subject_type as SubjectType,
    subject_id: Number(r.subject_id),
    text: String(r.text),
    project_id: r.project_id === null ? null : Number(r.project_id),
    added_date: String(r.added_date),
    position: r.position === null ? null : Number(r.position),
    last_position: r.last_position === null ? null : Number(r.last_position),
    status: r.status as Talk["status"],
    meeting_id: r.meeting_id === null ? null : Number(r.meeting_id),
  })
  const select = () => db.selectFrom("talk_item").select([...COLUMNS])

  // A subject's own open items, in list order.
  const ownOpen = async (type: SubjectType, id: number) =>
    (await select().where("subject_type", "=", type).where("subject_id", "=", id).where("status", "=", "open").orderBy("position").execute()).map(toRow)
  // People's open items tagged with a project, person by person, each in list order.
  const taggedOpen = async (projectId: number) =>
    (await select().where("subject_type", "=", "person").where("project_id", "=", projectId).where("status", "=", "open").orderBy("subject_id").orderBy("position").execute()).map(
      toRow,
    )
  // The date of the subject's last held meeting.
  async function lastHeld(type: SubjectType, id: number): Promise<string | undefined> {
    const m = await db
      .selectFrom("meeting")
      .select("date")
      .where("subject_type", "=", type)
      .where("subject_id", "=", id)
      .where("status", "=", "held")
      .orderBy("date", "desc")
      .limit(1)
      .executeTakeFirst()
    return m ? String(m.date) : undefined
  }
  // The open items of a subject in their two groups: carried = added before its last held meeting.
  async function groups(type: SubjectType, id: number): Promise<Groups> {
    const rows = await ownOpen(type, id)
    const since = await lastHeld(type, id)
    const old = (r: Row) => since !== undefined && r.added_date < since
    return { since, open: rows.filter((r) => !old(r)), carried: rows.filter(old) }
  }

  type Memo = { refs: Map<string, Promise<string>>; groups: Map<string, Promise<Groups>> }
  const memo = (): Memo => ({ refs: new Map(), groups: new Map() })
  const cached = <T>(m: Map<string, Promise<T>>, key: string, make: () => Promise<T>) => {
    if (!m.has(key)) m.set(key, make())
    return m.get(key)!
  }

  async function records(rows: Row[], m = memo()): Promise<Talk[]> {
    const out: Talk[] = []
    for (const r of rows) {
      const shown = (type: SubjectType, id: number) => cached(m.refs, `${type}:${id}`, () => store.subjectRef(type, id))
      let position: number | null = null
      let carried = false
      if (r.status === "open") {
        const g = await cached(m.groups, `${r.subject_type}:${r.subject_id}`, () => groups(r.subject_type, r.subject_id))
        carried = g.carried.some((c) => c.id === r.id)
        position = (carried ? g.carried : g.open).findIndex((c) => c.id === r.id) + 1
      }
      out.push({
        ref: talkRef(r),
        id: r.id,
        about: await shown(r.subject_type, r.subject_id),
        text: r.text,
        project: r.project_id === null ? null : await shown("project", r.project_id),
        added_date: r.added_date,
        position,
        carried,
        status: r.status,
        meeting: r.meeting_id === null ? null : formatRef("M-", r.meeting_id),
      })
    }
    return out
  }

  async function row(input: string): Promise<Row> {
    const id = await store.talkId(input)
    if (id === null) throw new NotFoundError(`unknown talk item "${shownRef(input, "T-")}"`, { hint: 'run "ttybrain talk list"' })
    return toRow(await select().where("id", "=", id).executeTakeFirstOrThrow())
  }
  const item = async (input: string) => (await records([await row(input)]))[0]!

  // A subject's talk-list: its own open items in their two groups; a project's open group then has people's items
  // tagged with it (unnumbered there: their place is on their person's list). `own` leaves the tagged items out.
  async function list(subject: Pick<Subject, "type" | "id">, opts: { own?: boolean } = {}): Promise<TalkList> {
    const g = await groups(subject.type, subject.id)
    const tagged = subject.type === "project" && !opts.own ? await taggedOpen(subject.id) : []
    const m = memo()
    const open = await records([...g.open, ...tagged], m)
    const carried = await records(g.carried, m)
    return carried.length === 0 ? { open, carried } : { open, carried, carriedFrom: g.since! }
  }

  // A meeting's talk items (M5). A 1:1 or project meeting: the subject's open items (for a project, then people's
  // items tagged with it), each group led by the items already discussed in this meeting (ticked, in the order they
  // were). A board meeting: the board project's talk-list; what it took onto its agenda (M8) is discussed and gone.
  // A held meeting shows what it covered: the items discussed in it, then those it kept open at its close (whatever
  // became of them since), not the subject's list of today.
  async function agenda(meeting: string): Promise<{ meeting: string; items: Talk[] }> {
    const m = await store.meeting(meeting)
    const subject = await db.selectFrom("meeting").select(["subject_type", "subject_id"]).where("id", "=", m.id).executeTakeFirstOrThrow()
    if (subject.subject_type === null) return { meeting: m.ref, items: [] }
    const type = subject.subject_type as SubjectType
    const id = Number(subject.subject_id)
    const here = m.kind === "board" ? [] : await discussedIn(m.id)
    const own = (r: Row) => r.subject_type === type && r.subject_id === id
    const ticked = new Set(here.map((r) => r.id))
    const rest = m.status === "held" ? (await keptIn(m.id)).filter((r) => !ticked.has(r.id)) : [...(await ownOpen(type, id)), ...(type === "project" ? await taggedOpen(id) : [])]
    const rows = [...here.filter(own), ...rest.filter(own), ...here.filter((r) => !own(r)), ...rest.filter((r) => !own(r))]
    return { meeting: m.ref, items: await records(rows) }
  }
  const discussedIn = async (meetingId: number) =>
    (await select().where("meeting_id", "=", meetingId).where("status", "=", "discussed").orderBy("updated_at").orderBy("id").execute()).map(toRow)
  // The items a held meeting kept open at its close, in the order they were on its agenda.
  async function keptIn(meetingId: number): Promise<Row[]> {
    const kept = await db.selectFrom("talk_kept").select(["talk_id", "position"]).where("meeting_id", "=", meetingId).orderBy("position").execute()
    if (kept.length === 0) return []
    const byId = new Map((await select().where("id", "in", kept.map((k) => Number(k.talk_id))).execute()).map((r) => [Number(r.id), toRow(r)]))
    return kept.map((k) => byId.get(Number(k.talk_id))!).filter((r) => r !== undefined)
  }
  // Remembers the items a meeting keeps open as it closes (its agenda's open items, in agenda order).
  async function keep(meetingId: number, items: Array<{ id: number }>): Promise<void> {
    for (const [n, t] of items.entries()) await db.insertInto("talk_kept").values({ meeting_id: meetingId, talk_id: t.id, position: n + 1 }).execute()
  }

  // Gives a subject's open items positions 1..n in the given order. Two passes, so the unique position never clashes.
  async function reorder(ids: number[]): Promise<void> {
    for (const [i, id] of ids.entries()) await db.updateTable("talk_item").set({ position: -(i + 1) }).where("id", "=", id).execute()
    for (const [i, id] of ids.entries()) await db.updateTable("talk_item").set({ position: i + 1 }).where("id", "=", id).execute()
  }
  const openIds = async (r: Pick<Row, "subject_type" | "subject_id">) => (await ownOpen(r.subject_type, r.subject_id)).map((t) => t.id)

  // Back onto its subject's list near the place it had: at min(that place, the end).
  async function reopen(r: Row): Promise<void> {
    const ids = await openIds(r)
    const at = Math.min(r.last_position ?? ids.length + 1, ids.length + 1)
    await db.updateTable("talk_item").set({ status: "open", position: null, meeting_id: null, status_date: null, updated_at: now() }).where("id", "=", r.id).execute()
    ids.splice(at - 1, 0, r.id)
    await reorder(ids)
  }
  // A meeting that will not take place (skipped or cancelled): what was ticked in it is open again.
  async function reopenDiscussedIn(meetingId: number): Promise<void> {
    for (const r of await discussedIn(meetingId)) await reopen(r)
  }

  return { row, item, list, agenda, records, groups, reorder, openIds, reopen, reopenDiscussedIn, discussedIn, keep }
}

export function registerTalk(ctx: PluginContext, store: Store, talks: Talks): void {
  const db = ctx.data
  const aboutOf = (r: Row) => store.subjectRef(r.subject_type, r.subject_id)

  function mustBeOpen(r: Row): void {
    const hint = `reopen it first: ttybrain talk reopen ${talkRef(r)}`
    if (r.status === "dropped") throw new ValidationError(`${talkRef(r)} is dropped`, { hint })
    if (r.status === "discussed") throw new ValidationError(`${talkRef(r)} is already discussed${r.meeting_id === null ? "" : ` (${formatRef("M-", r.meeting_id)})`}`, { hint })
  }
  // Takes an open item off its list (discussed or dropped), remembering its place, and closes the gap.
  async function close(r: Row, set: { status: "discussed" | "dropped"; meeting_id: number | null }): Promise<void> {
    await db
      .updateTable("talk_item")
      .set({ ...set, position: null, last_position: r.position, status_date: today(), updated_at: now() })
      .where("id", "=", r.id)
      .execute()
    await talks.reorder(await talks.openIds(r))
  }
  const before = async (input: string) => {
    try {
      return (await talks.records([await talks.row(input)]))[0]
    } catch {
      return undefined
    }
  }
  // A project tag, for a person's item only: a project's or board's own items are on its meetings already.
  async function projectTag(subject: { type: SubjectType; ref: string }, v: string | null | undefined): Promise<number | null> {
    if (blank(v)) return null
    if (subject.type !== "person")
      throw new ValidationError(`a project tag is for a person's item; ${subject.ref}'s own items are on its meetings already`, {
        field: "project",
        hint: "leave out the project, or add the item to the person's talk-list",
      })
    return store.projectId(v!, "a talk item's project tag needs a project")
  }

  ctx.expose({
    read: {
      talkList: {
        input: Type.Object({ about: NonBlank() }),
        output: ListOutput,
        toolDescription: "A person's or project's talk-list: the open items (a project's include people's items tagged with it) and those carried over from before its last held meeting.",
        run: async (i: { about: string }) => talks.list(await store.subject(i.about)),
      },
      agendaFor: {
        input: Type.Object({ meeting: NonBlank() }),
        output: AgendaOutput,
        toolDescription: "The talk items of a meeting: its subject's talk-list, with the items already discussed in it.",
        run: async (i: { meeting: string }) => talks.agenda(i.meeting),
      },
    },
    write: {
      addTalk: {
        input: AddTalk,
        output: TalkRecord,
        describe: async (i: AddInput) => {
          let about = i.about.trim()
          try {
            about = (await store.subject(i.about)).ref
          } catch {}
          return `+ talk ${about} "${i.text.trim()}"${blank(i.project) ? "" : ` #${normalizeCode(i.project!)}`}`
        },
        run: async (i: AddInput) => {
          const subject = await store.activeSubject(i.about)
          const project_id = await projectTag(subject, i.project)
          const position = (await talks.openIds({ subject_type: subject.type, subject_id: subject.id })).length + 1
          const t = now()
          const res = await db
            .insertInto("talk_item")
            .values({
              subject_type: subject.type,
              subject_id: subject.id,
              text: i.text.trim(),
              project_id,
              added_date: today(),
              position,
              last_position: null,
              status: "open",
              meeting_id: null,
              status_date: null,
              created_at: t,
              updated_at: t,
            })
            .executeTakeFirstOrThrow()
          return talks.item(formatRef("T-", Number(res.insertId)))
        },
      },
      editTalk: {
        input: EditTalk,
        output: TalkRecord,
        describe: async (i: EditInput) => {
          const changes = [
            i.text === undefined ? undefined : `text "${i.text.trim()}"`,
            i.project === undefined ? undefined : `project ${blank(i.project) ? "none" : `#${normalizeCode(i.project!)}`}`,
          ].filter((c) => c !== undefined)
          return `~ ${shownRef(i.ref, "T-")} ${changes.length ? changes.join(", ") : "(no change)"}`
        },
        run: async (i: EditInput) => {
          const r = await talks.row(i.ref)
          const set: Record<string, unknown> = { updated_at: now() }
          if (i.text !== undefined) set.text = i.text.trim()
          if (i.project !== undefined) set.project_id = await projectTag({ type: r.subject_type, ref: await aboutOf(r) }, i.project)
          await db.updateTable("talk_item").set(set).where("id", "=", r.id).execute()
          return talks.item(i.ref)
        },
      },
      // To another rank within its group (the open items, or the carried ones).
      moveTalk: {
        input: MoveTalk,
        output: TalkRecord,
        describe: async (i: MoveInput) => {
          const t = await before(i.ref)
          return `~ ${shownRef(i.ref, "T-")} position ${t?.position != null ? `${t.position} → ` : "→ "}${i.to}`
        },
        run: async (i: MoveInput) => {
          const r = await talks.row(i.ref)
          mustBeOpen(r)
          const g = await talks.groups(r.subject_type, r.subject_id)
          const carried = g.carried.some((c) => c.id === r.id)
          const group = (carried ? g.carried : g.open).map((c) => c.id)
          if (i.to > group.length)
            throw new ValidationError(`${await aboutOf(r)}'s talk-list has ${plural(group.length, carried ? "carried item" : "open item")}`, {
              field: "to",
              hint: `use 1 to ${group.length}`,
            })
          // The group's items change places among the slots the group holds on the list; the other group stays put.
          const all = await talks.openIds(r)
          const slots = all.map((id, n) => (group.includes(id) ? n : -1)).filter((n) => n >= 0)
          group.splice(group.indexOf(r.id), 1)
          group.splice(i.to - 1, 0, r.id)
          for (const [n, slot] of slots.entries()) all[slot] = group[n]!
          await talks.reorder(all)
          await db.updateTable("talk_item").set({ updated_at: now() }).where("id", "=", r.id).execute()
          return talks.item(i.ref)
        },
      },
      dropTalk: {
        input: TalkRef,
        output: TalkRecord,
        describe: async (i: { ref: string }) => `~ ${shownRef(i.ref, "T-")} dropped`,
        run: async (i: { ref: string }) => {
          const r = await talks.row(i.ref)
          mustBeOpen(r)
          await close(r, { status: "dropped", meeting_id: null })
          return talks.item(i.ref)
        },
      },
      // Discussed (M5): in a meeting it is on (about its subject, or a project meeting for a person's item tagged with
      // that project), or without one (talked about elsewhere).
      discussTalk: {
        input: DiscussTalk,
        output: TalkRecord,
        describe: async (i: DiscussInput) => `~ ${shownRef(i.ref, "T-")} discussed${i.meeting === undefined ? "" : ` in ${shownRef(i.meeting, "M-")}`}`,
        run: async (i: DiscussInput) => {
          const r = await talks.row(i.ref)
          mustBeOpen(r)
          let meeting_id: number | null = null
          if (i.meeting !== undefined) {
            const m = await store.openMeeting(i.meeting, { allowHeld: true })
            const s = await db.selectFrom("meeting").select(["subject_type", "subject_id"]).where("id", "=", m.id).executeTakeFirstOrThrow()
            const type = s.subject_type as SubjectType | null
            const id = s.subject_id === null ? null : Number(s.subject_id)
            const onIt =
              (type === r.subject_type && id === r.subject_id) || (type === "project" && r.subject_type === "person" && r.project_id !== null && r.project_id === id)
            if (!onIt) throw new ValidationError(`${talkRef(r)} is not on ${m.ref}'s agenda`, { field: "meeting" })
            meeting_id = m.id
          }
          await close(r, { status: "discussed", meeting_id })
          return talks.item(i.ref)
        },
      },
      // Back onto its subject's list near the place it had (M5: ticking a discussed item again).
      reopenTalk: {
        input: TalkRef,
        output: TalkRecord,
        describe: async (i: { ref: string }) => `~ ${shownRef(i.ref, "T-")} reopened`,
        run: async (i: { ref: string }) => {
          const r = await talks.row(i.ref)
          if (r.status === "open") throw new ValidationError(`${talkRef(r)} is open`)
          await talks.reopen(r)
          return talks.item(i.ref)
        },
      },
    },
  })
}
