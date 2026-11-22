// The exposed operations on actions. An action's owner is a soft person reference where empty (or `me`) means me;
// `forPerson` is the stakeholder it is for; the project and meeting are optional. Each write returns the action
// record with its `ref`; `describe` gives the change-set line. The reads: `projectActions` (the actions part of a
// project's status: overdue and from the previous meeting) and `importedLegacy` (the handover, handover.ts).
import { currentContext, Deleted, NonBlank, parseDate, parseRef, Type, ValidationError, type PluginContext, type Static } from "@ttybrain/api"
import { ActionRecord, type Store } from "./records"

const Ref = NonBlank()
const RefInput = Type.Object({ ref: Ref })
const OptStr = Type.Optional(Type.String())
const Clearable = Type.Optional(Type.Union([Type.String(), Type.Null()]))

const AddAction = Type.Object({ title: NonBlank(), due: OptStr, owner: OptStr, project: OptStr, forPerson: OptStr, meeting: OptStr, notes: OptStr })
const EditAction = Type.Object({
  ref: Ref,
  title: Type.Optional(NonBlank()),
  due: Clearable,
  owner: Clearable,
  project: Clearable,
  forPerson: Clearable,
  meeting: Clearable,
  notes: Clearable,
})
const Complete = Type.Object({ ref: Ref, date: OptStr })
const ProjectActionsInput = Type.Object({ project: NonBlank(), reference: Type.Optional(NonBlank()), previousMeeting: Type.Optional(NonBlank()) })
export const ProjectActions = Type.Object({ overdue: Type.Array(ActionRecord), fromMeeting: Type.Array(ActionRecord) })
export type ProjectActions = Static<typeof ProjectActions>

type AddInput = Static<typeof AddAction>
type EditInput = Static<typeof EditAction>

const EDIT_FIELDS = ["title", "due", "owner", "project", "forPerson", "meeting", "notes"] as const
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
// `me` (any case) names the user, who is stored as no owner.
export const isMe = (input: string) => input.trim().toLowerCase() === "me"
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ""
// Ascending by due date, undated last, then by id.
export const byDue = (a: { due_date: string | null; id: number }, b: { due_date: string | null; id: number }) =>
  a.due_date === b.due_date ? a.id - b.id : a.due_date === null ? 1 : b.due_date === null ? -1 : a.due_date < b.due_date ? -1 : 1

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

  async function setStatus(ref: string, status: "done" | "cancelled", doneDate: string | null): Promise<ActionRecord> {
    const a = await store.find(ref)
    await store.guardProject(a.project)
    if (a.status === status) throw new ValidationError(`${a.ref} is already ${status}`)
    await db.updateTable("action").set({ status, done_date: doneDate, updated_at: now() }).where("id", "=", a.id).execute()
    return store.find(String(a.id))
  }

  // The open actions on a project that are due before the reference (default today) and those from a meeting.
  async function projectActions(i: Static<typeof ProjectActionsInput>): Promise<ProjectActions> {
    const p = await store.project(i.project)
    const reference = i.reference !== undefined ? date(i.reference, "reference") : today()
    let meeting: number | null = null
    if (i.previousMeeting !== undefined) {
      meeting = parseRef(i.previousMeeting, "M-")
      if (meeting === null) throw new ValidationError(`invalid meeting "${i.previousMeeting.trim()}"`, { field: "previousMeeting", hint: "a meeting ref, e.g. M-4" })
    }
    const open = (await store.actionQuery().where("a.project_id", "=", p.id).where("a.status", "=", "open").execute()).map(store.toAction).sort(byDue)
    return {
      overdue: open.filter((a) => a.due_date !== null && a.due_date < reference),
      fromMeeting: meeting === null ? [] : open.filter((a) => a.meeting_id === meeting),
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
      importedLegacy: {
        input: Type.Object({}),
        output: Type.Object({ imported: Type.Boolean() }),
        run: async () => ({ imported: (await db.selectFrom("handover").select("source").where("source", "=", "projects").executeTakeFirst()) !== undefined }),
      },
    },
    write: {
      addAction: {
        input: AddAction,
        output: ActionRecord,
        describe: async (i: AddInput) => {
          const parts = [blank(i.owner) || isMe(i.owner!) ? "me" : await store.personLabel(i.owner!)]
          if (!blank(i.forPerson)) parts.push(`for ${await store.personLabel(i.forPerson!)}`)
          if (!blank(i.project)) parts.push(await store.codeLabel(i.project!))
          if (!blank(i.due)) parts.push(`due ${shown(i.due!)}`)
          return `+ action "${i.title.trim()}" (${parts.join(", ")})`
        },
        run: async (i: AddInput) => {
          const project = await projectOf(i.project)
          const owner = await ownerId(i.owner)
          const forPerson = await store.personId(i.forPerson)
          const meeting = await store.meetingId(i.meeting)
          const due = dueOf(i.due)
          const t = now()
          const res = await db
            .insertInto("action")
            .values({
              title: i.title.trim(),
              due_date: due ?? null,
              status: "open",
              owner_id: owner ?? null,
              project_id: project ?? null,
              for_person_id: forPerson ?? null,
              meeting_id: meeting ?? null,
              notes: clean(i.notes) ?? null,
              created_at: t,
              updated_at: t,
            })
            .executeTakeFirstOrThrow()
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
          const a = await store.find(i.ref)
          await store.guardProject(a.project)
          const project = await projectOf(i.project)
          const owner = await ownerId(i.owner)
          const forPerson = await store.personId(i.forPerson)
          const meeting = await store.meetingId(i.meeting)
          const due = dueOf(i.due)
          await db
            .updateTable("action")
            .set({
              ...(i.title !== undefined ? { title: i.title.trim() } : {}),
              ...(due !== undefined ? { due_date: due } : {}),
              ...(owner !== undefined ? { owner_id: owner } : {}),
              ...(project !== undefined ? { project_id: project } : {}),
              ...(forPerson !== undefined ? { for_person_id: forPerson } : {}),
              ...(meeting !== undefined ? { meeting_id: meeting } : {}),
              ...(i.notes !== undefined ? { notes: clean(i.notes) } : {}),
              updated_at: now(),
            })
            .where("id", "=", a.id)
            .execute()
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
          const a = await store.find(i.ref)
          await store.guardProject(a.project)
          await db.deleteFrom("action").where("id", "=", a.id).execute()
          return { ref: a.ref, deleted: true as const }
        },
      },
    },
  })
}
