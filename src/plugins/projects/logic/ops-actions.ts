// The exposed write operations on actions. An action's owner is a soft person reference where empty (or `me`)
// means me; `forPerson` is the stakeholder it is for; the project and meeting are optional. Each write returns
// the action record with its `ref`; `describe` gives the change-set line (plugin reference §2).
import { Deleted, NonBlank, Type, ValidationError, type PluginContext, type Static } from "@ttybrain/api"
import { ActionRecord, type Items } from "./items"
import { clean, date, now, today } from "./ops-project"
import type { Store } from "./records"

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

type AddInput = Static<typeof AddAction>
type EditInput = Static<typeof EditAction>

const EDIT_FIELDS = ["title", "due", "owner", "project", "forPerson", "meeting", "notes"] as const
const FIELD_LABEL: Record<string, string> = { forPerson: "for" }

// `me` (any case) names the user, who is stored as no owner.
export const isMe = (input: string) => input.trim().toLowerCase() === "me"
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ""

export function registerActionOps(ctx: PluginContext, store: Store, items: Items): void {
  const db = ctx.data

  const ownerId = (input: string | null | undefined) => (input !== undefined && input !== null && isMe(input) ? Promise.resolve(null) : items.ownerId(input))
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
    const a = await items.find("action", ref)
    await items.guardProject(a.project)
    if (a.status === status) throw new ValidationError(`${a.ref} is already ${status}`)
    await db.updateTable("action").set({ status, done_date: doneDate, updated_at: now() }).where("id", "=", a.id).execute()
    return items.find("action", String(a.id))
  }

  ctx.expose({
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
          const forPerson = await items.ownerId(i.forPerson)
          const meeting = await items.meetingId(i.meeting)
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
          return items.find("action", String(res.insertId))
        },
      },
      editAction: {
        input: EditAction,
        output: ActionRecord,
        describe: (i: EditInput) => {
          const f = EDIT_FIELDS.filter((x) => i[x] !== undefined).map((x) => FIELD_LABEL[x] ?? x)
          return `~ ${items.refOr("action", i.ref)} ${f.length ? f.join(", ") : "(no change)"}`
        },
        run: async (i: EditInput) => {
          const a = await items.find("action", i.ref)
          await items.guardProject(a.project)
          const project = await projectOf(i.project)
          const owner = await ownerId(i.owner)
          const forPerson = await items.ownerId(i.forPerson)
          const meeting = await items.meetingId(i.meeting)
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
          return items.find("action", String(a.id))
        },
      },
      completeAction: {
        input: Complete,
        output: ActionRecord,
        describe: (i: Static<typeof Complete>) => `~ ${items.refOr("action", i.ref)} done`,
        run: (i: Static<typeof Complete>) => setStatus(i.ref, "done", i.date !== undefined ? date(i.date, "date") : today()),
      },
      cancelAction: {
        input: RefInput,
        output: ActionRecord,
        describe: (i: { ref: string }) => `~ ${items.refOr("action", i.ref)} cancelled`,
        run: (i: { ref: string }) => setStatus(i.ref, "cancelled", null),
      },
      deleteAction: {
        input: RefInput,
        output: Deleted,
        describe: async (i: { ref: string }) => `- action ${items.refOr("action", i.ref)} "${await items.labelOf("action", i.ref)}"`,
        run: async (i: { ref: string }) => {
          const a = await items.find("action", i.ref)
          await items.guardProject(a.project)
          await db.deleteFrom("action").where("id", "=", a.id).execute()
          return { ref: a.ref, deleted: true as const }
        },
      },
    },
  })
}
