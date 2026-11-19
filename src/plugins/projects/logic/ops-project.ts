// The exposed operations on projects themselves: the read with logic (getContext) and the writes for projects,
// health, context and involvement. Writes return a record with its `ref`; `describe` gives the change-set line
// (plugin reference §2).
import {
  ConflictError,
  currentContext,
  isValidCode,
  NonBlank,
  NotFoundError,
  parseDate,
  Type,
  ValidationError,
  type PluginContext,
  type Static,
} from "@ttybrain/api"
import type { Store } from "./records"
import { ContextRecord, Health, InvolvementRecord, ProjectRecord, ProjectStatus } from "./schema"

const Ref = NonBlank()
const Clearable = Type.Optional(Type.Union([Type.String(), Type.Null()]))
const DateOrNone = Type.Optional(Type.Union([Type.String(), Type.Null()]))
const Effort = Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()]))

const AddProject = Type.Object({
  code: NonBlank(),
  name: NonBlank(),
  description: Type.Optional(Type.String()),
  status: Type.Optional(ProjectStatus),
  startDate: Type.Optional(Type.String()),
  endDate: Type.Optional(Type.String()),
  effortDays: Type.Optional(Type.Number({ minimum: 0 })),
  effortNote: Type.Optional(Type.String()),
})
const EditProject = Type.Object({
  project: Ref,
  name: Type.Optional(NonBlank()),
  description: Clearable,
  status: Type.Optional(ProjectStatus),
  startDate: DateOrNone,
  endDate: DateOrNone,
  effortDays: Effort,
  effortNote: Clearable,
})
const ProjectRefInput = Type.Object({ project: Ref })
const SetContext = Type.Object({ project: Ref, markdown: Type.String() })
const SetHealth = Type.Object({ project: Ref, health: Health, comment: Type.Optional(Type.String()), date: Type.Optional(Type.String()) })
const Involvement = Type.Object({ project: Ref, person: Ref, role: NonBlank() })

type EditInput = Static<typeof EditProject>
type InvolvementInput = Static<typeof Involvement>

// op input field → column, for the fields add and edit share.
const COLUMNS = {
  name: "name",
  description: "description",
  status: "status",
  startDate: "start_date",
  endDate: "end_date",
  effortDays: "effort_estimate_days",
  effortNote: "effort_note",
} as const
const DATE_FIELDS = new Set(["startDate", "endDate"])
const CODE_HINT = "2–16 letters or digits, e.g. CRM"

export const now = () => currentContext().now
export const today = () => currentContext().today
// Free text: trimmed, and empty means none.
export const clean = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim())
export const date = (input: string, field: string) => {
  try {
    return parseDate(input, today())
  } catch (e) {
    if (e instanceof ValidationError) throw new ValidationError(e.message, { field, hint: e.hint })
    throw e
  }
}
const bytes = (s: string) => new TextEncoder().encode(s).length
const size = (s: string | null) => {
  if (s === null) return "none"
  const n = bytes(s)
  return n < 1000 ? `${n} B` : `${(n / 1000).toFixed(1)} kB`
}

export function registerProjectOps(ctx: PluginContext, store: Store): void {
  const db = ctx.data

  // The given project fields as column values (dates parsed, free text cleaned).
  function columns(i: Partial<EditInput>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [field, column] of Object.entries(COLUMNS)) {
      const v = i[field as keyof typeof COLUMNS]
      if (v === undefined) continue
      if (v === null) out[column] = null
      else if (DATE_FIELDS.has(field)) out[column] = date(String(v), field)
      else if (typeof v === "number" || field === "status") out[column] = v
      else out[column] = field === "name" ? String(v).trim() : clean(String(v))
    }
    return out
  }

  function code(input: string): string {
    const c = input.trim().replace(/^#/, "")
    if (!isValidCode(c)) throw new ValidationError(`invalid project code "${input.trim()}"`, { field: "code", hint: CODE_HINT })
    return c
  }

  const touch = (id: number) => db.updateTable("project").set({ updated_at: now() }).where("id", "=", id).execute()

  async function involvementRow(i: InvolvementInput, active: boolean) {
    const p = await store.activeProject(i.project)
    const person = active ? await store.activePerson(i.person) : await store.person(i.person)
    const role = i.role.trim()
    const row = await db
      .selectFrom("involvement")
      .select("id")
      .where("project_id", "=", p.id)
      .where("person_id", "=", person.id)
      .where("role", "=", role)
      .executeTakeFirst()
    const out: Static<typeof InvolvementRecord> = { ref: p.ref, project: p.ref, person: person.ref, person_id: person.id, name: person.name, role }
    return { p, person, role, existing: row ? Number(row.id) : null, out }
  }

  const involvementLine = async (sign: string, i: InvolvementInput) =>
    `${sign} ${await store.personLabel(i.person)} on ${await store.codeLabel(i.project)} as ${i.role.trim()}`

  ctx.expose({
    read: {
      getContext: {
        input: ProjectRefInput,
        output: ContextRecord,
        toolDescription: "The project's context Markdown (background, scope) and when it was last updated.",
        run: async (i: { project: string }) => {
          const p = await store.project(i.project)
          return { ref: p.ref, ...(await store.context(p.id)) }
        },
      },
    },
    write: {
      addProject: {
        input: AddProject,
        output: ProjectRecord,
        describe: (i: Static<typeof AddProject>) => `+ project ${i.code.trim().replace(/^#/, "")} "${i.name.trim()}"`,
        run: async (i: Static<typeof AddProject>) => {
          const c = code(i.code)
          if ((await store.codeId(c)) !== null) throw new ConflictError(`project "${c}" already exists`, { hint: "choose another code" })
          const t = now()
          const res = await db
            .insertInto("project")
            .values({ status: "active", ...columns(i), code: c, created_at: t, updated_at: t })
            .executeTakeFirstOrThrow()
          return store.projectById(Number(res.insertId))
        },
      },
      editProject: {
        input: EditProject,
        output: ProjectRecord,
        describe: async (i: EditInput) => {
          const fields = Object.keys(COLUMNS).filter((f) => i[f as keyof typeof COLUMNS] !== undefined)
          return `~ ${await store.codeLabel(i.project)} ${fields.length ? fields.join(", ") : "(no change)"}`
        },
        run: async (i: EditInput) => {
          const p = await store.activeProject(i.project)
          await db
            .updateTable("project")
            .set({ ...columns(i), updated_at: now() })
            .where("id", "=", p.id)
            .execute()
          return store.projectById(p.id)
        },
      },
      archiveProject: {
        input: ProjectRefInput,
        output: ProjectRecord,
        describe: async (i: { project: string }) => `~ ${await store.codeLabel(i.project)} archived`,
        run: async (i: { project: string }) => {
          const p = await store.project(i.project)
          if (!p.archived) await db.updateTable("project").set({ archived_at: now(), updated_at: now() }).where("id", "=", p.id).execute()
          return store.projectById(p.id)
        },
      },
      restoreProject: {
        input: ProjectRefInput,
        output: ProjectRecord,
        describe: async (i: { project: string }) => `~ ${await store.codeLabel(i.project)} restored`,
        run: async (i: { project: string }) => {
          const p = await store.project(i.project)
          if (p.archived) await db.updateTable("project").set({ archived_at: null, updated_at: now() }).where("id", "=", p.id).execute()
          return store.projectById(p.id)
        },
      },
      setContext: {
        input: SetContext,
        output: ContextRecord,
        describe: async (i: Static<typeof SetContext>) => {
          const id = await store.projectId(i.project)
          const before = id === null ? null : (await store.context(id)).markdown
          return `~ ${await store.codeLabel(i.project)} context (${size(before)} → ${size(i.markdown === "" ? null : i.markdown)})`
        },
        run: async (i: Static<typeof SetContext>) => {
          const p = await store.activeProject(i.project)
          const t = now()
          await db
            .updateTable("project")
            .set({ context: i.markdown === "" ? null : i.markdown, context_updated_at: t, updated_at: t })
            .where("id", "=", p.id)
            .execute()
          return { ref: p.ref, ...(await store.context(p.id)) }
        },
      },
      setHealth: {
        input: SetHealth,
        output: ProjectRecord,
        describe: async (i: Static<typeof SetHealth>) => {
          const id = await store.projectId(i.project)
          const before = id === null ? null : (await store.projectById(id)).health
          const comment = clean(i.comment)
          return `~ ${await store.codeLabel(i.project)} health ${before ?? "not set"} → ${i.health}${comment ? `: "${comment}"` : ""}`
        },
        run: async (i: Static<typeof SetHealth>) => {
          const p = await store.activeProject(i.project)
          const t = now()
          await db
            .insertInto("health_update")
            .values({
              project_id: p.id,
              date: i.date !== undefined ? date(i.date, "date") : today(),
              health: i.health,
              comment: clean(i.comment) ?? null,
              created_at: t,
              updated_at: t,
            })
            .execute()
          await touch(p.id)
          return store.projectById(p.id)
        },
      },
      addInvolvement: {
        input: Involvement,
        output: InvolvementRecord,
        describe: (i: InvolvementInput) => involvementLine("+", i),
        run: async (i: InvolvementInput) => {
          const { p, person, role, existing, out } = await involvementRow(i, true)
          if (existing !== null) throw new ConflictError(`${person.ref} is already ${role} on ${p.code}`)
          const t = now()
          await db.insertInto("involvement").values({ project_id: p.id, person_id: person.id, role, created_at: t, updated_at: t }).execute()
          return out
        },
      },
      removeInvolvement: {
        input: Involvement,
        output: InvolvementRecord,
        describe: (i: InvolvementInput) => involvementLine("-", i),
        run: async (i: InvolvementInput) => {
          const { p, person, role, existing, out } = await involvementRow(i, false)
          if (existing === null) throw new NotFoundError(`${person.ref} has no role "${role}" on ${p.code}`)
          await db.deleteFrom("involvement").where("id", "=", existing).execute()
          return out
        },
      },
    },
  })
}
