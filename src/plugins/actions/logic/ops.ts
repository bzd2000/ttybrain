// The exposed operations on actions. An action's owner is a soft person reference where empty (or `@me`) means me.
// It links to any records (`links`: `#CRM`, `@anna`, `M-4`); `project`, `forPerson` (the stakeholder it is for) and
// `meeting` are shorthand for a link of that type (on edit each replaces the links of its type; empty clears them).
// `linkAction` / `unlinkAction` add and remove one. Each write returns the action record with its `ref`; `describe`
// gives the change-set line. The reads: `projectActions` (the actions part of a project's status: overdue and from
// the previous meeting) and `importedLegacy` (the handover, handover.ts).
import { currentContext, Deleted, NonBlank, parseDate, parseRef, Type, ValidationError, type PluginContext, type Static } from "@ttybrain/api"
import { RESERVED } from "./handover"
import { ActionRecord, GONE, type Loaded, type Store, type Target } from "./records"

const Ref = NonBlank()
const RefInput = Type.Object({ ref: Ref })
const OptStr = Type.Optional(Type.String())
const Clearable = Type.Optional(Type.Union([Type.String(), Type.Null()]))
const Links = Type.Optional(Type.Array(Type.String()))

const AddAction = Type.Object({ title: NonBlank(), due: OptStr, owner: OptStr, project: OptStr, forPerson: OptStr, meeting: OptStr, links: Links, notes: OptStr })
const EditAction = Type.Object({
  ref: Ref,
  title: Type.Optional(NonBlank()),
  due: Clearable,
  owner: Clearable,
  project: Clearable,
  forPerson: Clearable,
  meeting: Clearable,
  links: Links,
  notes: Clearable,
})
const LinkInput = Type.Object({ ref: Ref, to: NonBlank() })
const Complete = Type.Object({ ref: Ref, date: OptStr })
const ProjectActionsInput = Type.Object({ project: NonBlank(), reference: Type.Optional(NonBlank()), previousMeeting: Type.Optional(NonBlank()) })
export const ProjectActions = Type.Object({ overdue: Type.Array(ActionRecord), fromMeeting: Type.Array(ActionRecord) })
export type ProjectActions = Static<typeof ProjectActions>

type AddInput = Static<typeof AddAction>
type EditInput = Static<typeof EditAction>
type LinkInput = Static<typeof LinkInput>

const EDIT_FIELDS = ["title", "due", "owner", "project", "forPerson", "meeting", "links", "notes"] as const
const FIELD_LABEL: Record<string, string> = { forPerson: "for" }

export const now = () => currentContext().now
export const today = () => currentContext().today
// Free text: trimmed, and empty means none.
const clean = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim())
export const date = (input: string, field: string) => {
  try {
    return parseDate(input, today())
  } catch (e) {
    if (e instanceof ValidationError) throw new ValidationError(e.message, { field, hint: e.hint })
    throw e
  }
}
// `@me` (also bare `me`, kept for old scripts; any case) names the user, who is stored as no owner and shown as `@me`.
export const ME = "@me"
export const isMe = (input: string) => /^@?me$/i.test(input.trim())
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ""
// Ascending by due date, undated last, then by id.
export const byDue = (a: { due_date: string | null; id: number }, b: { due_date: string | null; id: number }) =>
  a.due_date === b.due_date ? a.id - b.id : a.due_date === null ? 1 : b.due_date === null ? -1 : a.due_date < b.due_date ? -1 : 1
const same = (x: Target, y: Target) => x.type === y.type && x.id === y.id
const targetsOf = (a: Loaded): Target[] => a.rec.links.map((l) => ({ type: l.type, id: l.id }))

export function registerOps(ctx: PluginContext, store: Store): void {
  const db = ctx.data

  const ownerId = (input: string | null | undefined) => (input !== undefined && input !== null && isMe(input) ? Promise.resolve(null) : store.personId(input))
  const dueOf = (v: string | null | undefined) => (v === undefined ? undefined : blank(v) ? null : date(v!, "due"))
  const projectOf = async (v: string | null | undefined) => (v === undefined ? undefined : blank(v) ? null : (await store.activeProject(v!)).id)
  // A date for a describe line: normalised when valid, as typed otherwise (describe never throws).
  const shown = (input: string) => {
    try {
      return date(input, "due")
    } catch {
      return input.trim()
    }
  }

  // The links an add or edit asks for. `links` replaces them all, and the shorthands given are added to it; without
  // `links`, each shorthand given replaces the current links of its type (empty: none). The shorthands come first,
  // so `project` is the action's first project link.
  async function linksFor(i: AddInput | EditInput, current: Target[]): Promise<Target[]> {
    // A link the action already has is kept as it is (an archived project among several stays linked).
    const keepOrNew = async (l: string): Promise<Target> => {
      const t = await store.lookup(l)
      return t !== null && current.some((c) => same(c, t)) ? t : store.target(l)
    }
    let rest = i.links === undefined ? current : await Promise.all(i.links.map(keepOrNew))
    const shorthand: Target[] = []
    for (const [type, id] of [
      ["project", await projectOf(i.project)],
      ["person", await store.personId(i.forPerson)],
      ["meeting", await store.meetingId(i.meeting)],
    ] as const) {
      if (id === undefined) continue
      if (i.links === undefined) rest = rest.filter((t) => t.type !== type)
      if (id !== null) shorthand.push({ type, id })
    }
    return [...shorthand, ...rest]
  }
  // The link an unlink names: by its display ref or `<type>:<id>` (a record that is gone shows `—`, which names no
  // link, so it is unlinked by `<type>:<id>`), else by resolving the ref.
  async function linkNamed(a: Loaded, to: string): Promise<Target | undefined> {
    const want = to.trim().toLowerCase()
    const shown = a.rec.links.find((l) => (l.ref !== GONE && l.ref.toLowerCase() === want) || `${l.type}:${l.id}` === want)
    if (shown !== undefined) return { type: shown.type, id: shown.id }
    const t = await store.lookup(to)
    return t === null ? undefined : targetsOf(a).find((l) => same(l, t))
  }
  const touch = (id: number) => db.updateTable("action").set({ updated_at: now() }).where("id", "=", id).execute()
  // The action behind a ref, refused while every project it is linked to is archived (unlinkAction skips this).
  const writable = async (ref: string): Promise<Loaded> => {
    const a = await store.loadOne(ref)
    store.guard(a)
    return a
  }

  const imported = async () => (await db.selectFrom("handover").select("source").where("source", "=", "projects").executeTakeFirst()) !== undefined
  // Until the projects plugin's actions are imported, a new action's id goes on from the higher of our own maximum and
  // the highest id still waiting in projects (no collision, no jump). Only when projects cannot be read (off, out of
  // range) is it above RESERVED, so it cannot take an id a moved action keeps; after the import, ids go on from the
  // highest.
  const newId = async (): Promise<number | undefined> => {
    if (await imported()) return undefined
    const row = await db.selectFrom("action").select((eb) => eb.fn.max("id").as("m")).executeTakeFirst()
    const own = Number(row?.m ?? 0)
    const legacyMax = ctx.read("projects")?.legacyMaxId
    if (legacyMax === undefined) return Math.max(own, RESERVED) + 1
    return Math.max(own, Number(((await legacyMax({})) as { max: number }).max)) + 1
  }

  async function setStatus(ref: string, status: "done" | "cancelled", doneDate: string | null): Promise<ActionRecord> {
    const a = (await writable(ref)).rec
    if (a.status === status) throw new ValidationError(`${a.ref} is already ${status}`)
    await db.updateTable("action").set({ status, done_date: doneDate, updated_at: now() }).where("id", "=", a.id).execute()
    return store.find(String(a.id))
  }

  // The open actions linked to a project that are due before the reference (default today), and those linked to a
  // meeting.
  async function projectActions(i: Static<typeof ProjectActionsInput>): Promise<ProjectActions> {
    const p = await store.project(i.project)
    const reference = i.reference !== undefined ? date(i.reference, "reference") : today()
    let meeting: number | null = null
    if (i.previousMeeting !== undefined) {
      meeting = parseRef(i.previousMeeting, "M-")
      if (meeting === null) throw new ValidationError(`invalid meeting "${i.previousMeeting.trim()}"`, { field: "previousMeeting", hint: "a meeting ref, e.g. M-4" })
    }
    const rows = await store.actionQuery().where(store.linkedTo([{ type: "project", id: p.id }])).where("a.status", "=", "open").execute()
    const open = (await store.toActions(rows)).sort(byDue)
    return {
      overdue: open.filter((a) => a.due_date !== null && a.due_date < reference),
      fromMeeting: meeting === null ? [] : open.filter((a) => a.links.some((l) => l.type === "meeting" && l.id === meeting)),
    }
  }

  ctx.expose({
    read: {
      projectActions: {
        input: ProjectActionsInput,
        output: ProjectActions,
        toolDescription: "A project's open actions that are overdue on a date (default today), and those from a meeting (M-n).",
        run: projectActions,
      },
      // Whether the projects plugin's actions were imported, and each imported row as it was (id, updated_at).
      importedLegacy: {
        input: Type.Object({}),
        output: Type.Object({ imported: Type.Boolean(), rows: Type.Array(Type.Object({ id: Type.Integer(), updated_at: Type.String() })) }),
        run: async () => {
          if (!(await imported())) return { imported: false, rows: [] }
          const rows = await db.selectFrom("handover_row").select(["id", "updated_at"]).where("source", "=", "projects").orderBy("id").execute()
          return { imported: true, rows: rows.map((r) => ({ id: Number(r.id), updated_at: String(r.updated_at) })) }
        },
      },
    },
    write: {
      addAction: {
        input: AddAction,
        output: ActionRecord,
        describe: async (i: AddInput) => {
          const parts = [blank(i.owner) || isMe(i.owner!) ? ME : await store.personLabel(i.owner!)]
          if (!blank(i.forPerson)) parts.push(`for ${await store.personLabel(i.forPerson!)}`)
          if (!blank(i.project)) parts.push(await store.codeLabel(i.project!))
          for (const l of i.links ?? []) parts.push(await store.linkLabel(l))
          if (!blank(i.due)) parts.push(`due ${shown(i.due!)}`)
          return `+ action "${i.title.trim()}" (${parts.join(", ")})`
        },
        run: async (i: AddInput) => {
          const links = await linksFor(i, [])
          const owner = await ownerId(i.owner)
          const due = dueOf(i.due)
          const t = now()
          const id = await newId()
          const res = await db
            .insertInto("action")
            .values({
              ...(id !== undefined && { id }),
              title: i.title.trim(),
              due_date: due ?? null,
              status: "open",
              owner_id: owner ?? null,
              notes: clean(i.notes) ?? null,
              created_at: t,
              updated_at: t,
            })
            .executeTakeFirstOrThrow()
          await store.setLinks(Number(res.insertId), links)
          return store.find(String(res.insertId))
        },
      },
      editAction: {
        input: EditAction,
        output: ActionRecord,
        describe: (i: EditInput) => {
          const f = EDIT_FIELDS.filter((x) => i[x] !== undefined).map((x) => FIELD_LABEL[x] ?? x)
          return `~ ${store.refOr(i.ref)} ${f.length ? f.join(", ") : "(no change)"}`
        },
        run: async (i: EditInput) => {
          const loaded = await writable(i.ref)
          const a = loaded.rec
          const links = await linksFor(i, targetsOf(loaded))
          const owner = await ownerId(i.owner)
          const due = dueOf(i.due)
          await db
            .updateTable("action")
            .set({
              ...(i.title !== undefined ? { title: i.title.trim() } : {}),
              ...(due !== undefined ? { due_date: due } : {}),
              ...(owner !== undefined ? { owner_id: owner } : {}),
              ...(i.notes !== undefined ? { notes: clean(i.notes) } : {}),
              updated_at: now(),
            })
            .where("id", "=", a.id)
            .execute()
          await store.setLinks(a.id, links)
          return store.find(String(a.id))
        },
      },
      linkAction: {
        input: LinkInput,
        output: ActionRecord,
        describe: async (i: LinkInput) => `~ ${store.refOr(i.ref)} link ${await store.linkLabel(i.to)}`,
        run: async (i: LinkInput) => {
          const loaded = await writable(i.ref)
          const a = loaded.rec
          const t = await store.target(i.to)
          if (t.type === "action" && t.id === a.id) throw new ValidationError(`${a.ref} cannot be linked to itself`, { field: "to" })
          const have = targetsOf(loaded)
          if (have.some((x) => same(x, t))) throw new ValidationError(`${a.ref} is already linked to ${await store.linkLabel(i.to)}`, { field: "to" })
          await store.setLinks(a.id, [...have, t])
          await touch(a.id)
          return store.find(String(a.id))
        },
      },
      unlinkAction: {
        input: LinkInput,
        output: ActionRecord,
        describe: async (i: LinkInput) => `~ ${store.refOr(i.ref)} unlink ${await store.linkLabel(i.to)}`,
        run: async (i: LinkInput) => {
          // Always allowed: unlinking is how an action leaves an archived project.
          const loaded = await store.loadOne(i.ref)
          const a = loaded.rec
          const t = await linkNamed(loaded, i.to)
          if (t === undefined) throw new ValidationError(`${a.ref} is not linked to ${await store.linkLabel(i.to)}`, { field: "to" })
          await store.setLinks(
            a.id,
            targetsOf(loaded).filter((x) => !same(x, t)),
          )
          await touch(a.id)
          return store.find(String(a.id))
        },
      },
      completeAction: {
        input: Complete,
        output: ActionRecord,
        describe: (i: Static<typeof Complete>) => `~ ${store.refOr(i.ref)} done`,
        run: (i: Static<typeof Complete>) => setStatus(i.ref, "done", i.date !== undefined ? date(i.date, "date") : today()),
      },
      cancelAction: {
        input: RefInput,
        output: ActionRecord,
        describe: (i: { ref: string }) => `~ ${store.refOr(i.ref)} cancelled`,
        run: (i: { ref: string }) => setStatus(i.ref, "cancelled", null),
      },
      deleteAction: {
        input: RefInput,
        output: Deleted,
        describe: async (i: { ref: string }) => `- action ${store.refOr(i.ref)} "${await store.labelOf(i.ref)}"`,
        run: async (i: { ref: string }) => {
          const a = (await writable(i.ref)).rec
          await db.deleteFrom("link").where("action_id", "=", a.id).execute()
          await db.deleteFrom("action").where("id", "=", a.id).execute()
          return { ref: a.ref, deleted: true as const }
        },
      },
    },
  })
}
