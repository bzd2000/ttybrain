// Talk-lists (design §5.3, rulings M5, M8, M12). A talk item is something to raise with a person or about a project
// (its subject), with an optional project tag. While open it has a place on its subject's list (positions 1..n,
// dense through add, move, drop, discuss and reopen); discussing it (in a meeting, or elsewhere) or dropping it takes
// it off the list. A person's item tagged with a project is also on that project's list and its meetings' agendas,
// until it is discussed in either place. The "carried" group is the open items added before the subject's last held
// meeting. Subjects and tags are soft references shown through the record registry: one that no longer resolves
// shows as `—` (or `<type>:<id>` while its plugin is not loaded), and the item stays listed (Review Focus 4).
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

const COLUMNS = ["id", "subject_type", "subject_id", "text", "project_id", "added_date", "position", "status", "meeting_id"] as const
type Row = { id: number; subject_type: SubjectType; subject_id: number; text: string; project_id: number | null; added_date: string; position: number | null; status: Talk["status"]; meeting_id: number | null }

const today = () => currentContext().today
const now = () => currentContext().now
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ""
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
const shownRef = (input: string, prefix: string) => {
  const n = parseRef(input, prefix)
  return n === null ? input.trim() : formatRef(prefix, n)
}

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
    status: r.status as Talk["status"],
    meeting_id: r.meeting_id === null ? null : Number(r.meeting_id),
  })
  const select = () => db.selectFrom("talk_item").select([...COLUMNS])

  // The display ref of a subject or tag through the record registry: `@anna`, `#CRM`; `person:<id>` when its type is
  // not registered (its plugin is off); `—` when the record is gone.
  async function shown(type: SubjectType, id: number, memo: Map<string, Promise<string>>): Promise<string> {
    const key = `${type}:${id}`
    if (!memo.has(key))
      memo.set(
        key,
        ctx.records.refOf(type, id).catch(() => "—"),
      )
    return memo.get(key)!
  }

  async function records(rows: Row[], memo = new Map<string, Promise<string>>()): Promise<Talk[]> {
    const out: Talk[] = []
    for (const r of rows)
      out.push({
        ref: formatRef("T-", r.id),
        id: r.id,
        about: await shown(r.subject_type, r.subject_id, memo),
        text: r.text,
        project: r.project_id === null ? null : await shown("project", r.project_id, memo),
        added_date: r.added_date,
        position: r.position,
        status: r.status,
        meeting: r.meeting_id === null ? null : formatRef("M-", r.meeting_id),
      })
    return out
  }

  async function row(input: string): Promise<Row> {
    const id = await store.talkId(input)
    if (id === null) throw new NotFoundError(`unknown talk item "${shownRef(input, "T-")}"`, { hint: 'run "ttybrain talk list"' })
    return toRow(await select().where("id", "=", id).executeTakeFirstOrThrow())
  }
  const item = async (input: string) => (await records([await row(input)]))[0]!

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

  // A subject's talk-list: its own open items, then (for a project) people's items tagged with it; split into those
  // added since its last held meeting and those carried over from before it. `own` leaves the tagged items out.
  async function list(subject: Pick<Subject, "type" | "id">, opts: { own?: boolean } = {}): Promise<TalkList> {
    const rows = [...(await ownOpen(subject.type, subject.id)), ...(subject.type === "project" && !opts.own ? await taggedOpen(subject.id) : [])]
    const since = await lastHeld(subject.type, subject.id)
    const all = await records(rows)
    const carried = since === undefined ? [] : all.filter((t) => t.added_date < since)
    const open = all.filter((t) => !carried.includes(t))
    return since === undefined || carried.length === 0 ? { open, carried } : { open, carried, carriedFrom: since }
  }

  // A meeting's talk items (M5). A 1:1 or project meeting: the subject's open items (for a project, then people's
  // items tagged with it), each group led by the items already discussed in this meeting (ticked, in the order they
  // were). A board meeting: the board project's talk-list; what it took onto its agenda (M8) is discussed and gone.
  async function agenda(meeting: string): Promise<{ meeting: string; items: Talk[] }> {
    const m = await store.meeting(meeting)
    const subject = await db.selectFrom("meeting").select(["subject_type", "subject_id"]).where("id", "=", m.id).executeTakeFirstOrThrow()
    if (subject.subject_type === null) return { meeting: m.ref, items: [] }
    const type = subject.subject_type as SubjectType
    const id = Number(subject.subject_id)
    const here =
      m.kind === "board"
        ? []
        : (await select().where("meeting_id", "=", m.id).where("status", "=", "discussed").orderBy("updated_at").orderBy("id").execute()).map(toRow)
    const own = (r: Row) => r.subject_type === type && r.subject_id === id
    const tagged = type === "project" ? await taggedOpen(id) : []
    const rows = [...here.filter(own), ...(await ownOpen(type, id)), ...here.filter((r) => !own(r)), ...tagged]
    return { meeting: m.ref, items: await records(rows) }
  }

  return { row, item, list, agenda, records, ownOpen }
}

export function registerTalk(ctx: PluginContext, store: Store, talks: Talks): void {
  const db = ctx.data
  const listName = async (r: Row) => `${(await talks.records([r]))[0]!.about}'s talk-list`

  // Gives a subject's open items positions 1..n in the given order. Two passes, so the unique position never clashes.
  async function reorder(ids: number[]): Promise<void> {
    for (const [i, id] of ids.entries()) await db.updateTable("talk_item").set({ position: -(i + 1) }).where("id", "=", id).execute()
    for (const [i, id] of ids.entries()) await db.updateTable("talk_item").set({ position: i + 1 }).where("id", "=", id).execute()
  }
  const openIds = async (r: Pick<Row, "subject_type" | "subject_id">) => (await talks.ownOpen(r.subject_type, r.subject_id)).map((t) => t.id)

  function mustBeOpen(r: Row): void {
    if (r.status === "dropped") throw new ValidationError(`${formatRef("T-", r.id)} is dropped`, { hint: `reopen it first` })
    if (r.status === "discussed")
      throw new ValidationError(`${formatRef("T-", r.id)} is already discussed${r.meeting_id === null ? "" : ` (${formatRef("M-", r.meeting_id)})`}`)
  }
  // Takes an open item off its list (discussed or dropped) and closes the gap.
  async function close(r: Row, set: { status: "discussed" | "dropped"; meeting_id: number | null }): Promise<void> {
    await db.updateTable("talk_item").set({ ...set, position: null, status_date: today(), updated_at: now() }).where("id", "=", r.id).execute()
    await reorder(await openIds(r))
  }
  const before = async (input: string) => {
    try {
      return await talks.row(input)
    } catch {
      return undefined
    }
  }
  const projectTag = async (v: string | null | undefined) => (blank(v) ? null : await store.projectId(v!))

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
          const subject = await store.subject(i.about)
          const project_id = await projectTag(i.project)
          const position = (await openIds({ subject_type: subject.type, subject_id: subject.id })).length + 1
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
          if (i.project !== undefined) set.project_id = await projectTag(i.project)
          await db.updateTable("talk_item").set(set).where("id", "=", r.id).execute()
          return talks.item(i.ref)
        },
      },
      moveTalk: {
        input: MoveTalk,
        output: TalkRecord,
        describe: async (i: MoveInput) => {
          const r = await before(i.ref)
          return `~ ${shownRef(i.ref, "T-")} position ${r?.position != null ? `${r.position} → ` : "→ "}${i.to}`
        },
        run: async (i: MoveInput) => {
          const r = await talks.row(i.ref)
          if (r.status !== "open") throw new ValidationError(`${formatRef("T-", r.id)} is ${r.status}`)
          const ids = await openIds(r)
          if (i.to > ids.length) throw new ValidationError(`${await listName(r)} has ${plural(ids.length, "open item")}`, { field: "to", hint: `use 1 to ${ids.length}` })
          ids.splice(ids.indexOf(r.id), 1)
          ids.splice(i.to - 1, 0, r.id)
          await reorder(ids)
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
          if (r.status !== "open") throw new ValidationError(`${formatRef("T-", r.id)} is ${r.status}`)
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
            if (!onIt) throw new ValidationError(`${formatRef("T-", r.id)} is not on ${m.ref}'s agenda`, { field: "meeting" })
            meeting_id = m.id
          }
          await close(r, { status: "discussed", meeting_id })
          return talks.item(i.ref)
        },
      },
      // Back onto its subject's list, at the end (M5: ticking a discussed item again).
      reopenTalk: {
        input: TalkRef,
        output: TalkRecord,
        describe: async (i: { ref: string }) => `~ ${shownRef(i.ref, "T-")} reopened`,
        run: async (i: { ref: string }) => {
          const r = await talks.row(i.ref)
          if (r.status === "open") throw new ValidationError(`${formatRef("T-", r.id)} is open`)
          const position = (await openIds(r)).length + 1
          await db.updateTable("talk_item").set({ status: "open", position, meeting_id: null, status_date: null, updated_at: now() }).where("id", "=", r.id).execute()
          return talks.item(i.ref)
        },
      },
    },
  })
}
