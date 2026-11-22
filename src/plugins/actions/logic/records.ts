// Actions as records: the query and mapper, lookups by display ref, the soft references an action carries (owner and
// for person from people.person, the project from projects.project, the meeting through the record types), and the
// `action` record type (A-). People, projects and meetings are optional: without their plugin the columns they
// would fill are null, and a reference to their records is refused.
import {
  formatRef,
  normalizeCode,
  normalizeHandle,
  NotFoundError,
  parseRef,
  suggest,
  Type,
  ValidationError,
  ViewUnavailableError,
  type PluginContext,
  type PluginRuntime,
  type Static,
} from "@ttybrain/api"

const Text = Type.String()
const Opt = Type.Union([Text, Type.Null()])
const OptId = Type.Union([Type.Integer(), Type.Null()])
export const ActionStatus = Type.Union([Type.Literal("open"), Type.Literal("done"), Type.Literal("cancelled")])

// An action: the view's columns (ids included, so `owner_id: null` reads as "me"), plus display refs and notes.
export const ActionRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  title: Text,
  due_date: Opt,
  status: ActionStatus,
  done_date: Opt,
  owner_id: OptId,
  owner: Opt,
  project_id: OptId,
  project: Opt,
  for_person_id: OptId,
  for: Opt,
  meeting_id: OptId,
  meeting: Opt,
  notes: Opt,
})
export type ActionRecord = Static<typeof ActionRecord>

export const PREFIX = "A-"
const MEETING_PREFIX = "M-"

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export type PersonRef = { id: number; ref: string; handle: string; name: string; archived: boolean }
export type ProjectRef = { id: number; ref: string; code: string; archived: boolean }
export type Store = ReturnType<typeof makeStore>

// Takes a runtime (the read/write side of a context), so the logic part and the TUI part share one store.
export function makeStore(rt: PluginRuntime) {
  const db = rt.data
  const hasPeople = () => rt.records.hasType("person")
  const hasProjects = () => rt.records.hasType("project")

  // `empty` when the publisher of a view is not loaded (or at a version this plugin does not read).
  async function unlessUnavailable<T>(empty: T, read: () => Promise<T>): Promise<T> {
    try {
      return await read()
    } catch (e) {
      if (e instanceof ViewUnavailableError) return empty
      throw e
    }
  }

  // Owner and for-person handles and names come from people.person, the project code from projects.project; a
  // null owner is me.
  const actionQuery = () => {
    let q = db
      .selectFrom("action as a")
      .select(["a.id", "a.title", "a.due_date", "a.status", "a.done_date", "a.owner_id", "a.project_id", "a.for_person_id", "a.meeting_id", "a.notes"])
    q = hasProjects()
      ? q.leftJoin("projects.project as p", "p.id", "a.project_id").select(["p.code", "p.archived"])
      : q.select((eb) => [eb.lit(null).as("code"), eb.lit(null).as("archived")])
    q = hasPeople()
      ? q
          .leftJoin("people.person as po", "po.id", "a.owner_id")
          .leftJoin("people.person as pf", "pf.id", "a.for_person_id")
          .select(["po.handle as owner_handle", "po.name as owner_name", "pf.handle as for_handle", "pf.name as for_name"])
      : q.select((eb) => [eb.lit(null).as("owner_handle"), eb.lit(null).as("owner_name"), eb.lit(null).as("for_handle"), eb.lit(null).as("for_name")])
    return q
  }

  const personRef = (id: unknown, handle: unknown) => (id === null ? null : handle === null ? `person:${id}` : `@${handle}`)
  const toAction = (r: any): ActionRecord => ({
    ref: formatRef(PREFIX, Number(r.id)),
    id: Number(r.id),
    title: String(r.title),
    due_date: str(r.due_date),
    status: r.status,
    done_date: str(r.done_date),
    owner_id: int(r.owner_id),
    owner: personRef(r.owner_id, r.owner_handle),
    project_id: int(r.project_id),
    project: r.code === null || r.code === undefined ? null : `#${r.code}`,
    for_person_id: int(r.for_person_id),
    for: personRef(r.for_person_id, r.for_handle),
    meeting_id: int(r.meeting_id),
    meeting: r.meeting_id === null ? null : formatRef(MEETING_PREFIX, Number(r.meeting_id)),
    notes: str(r.notes),
  })
  // Whether a row's project is archived (false without one, or without the projects plugin).
  const archived = (r: any) => Number(r.archived ?? 0) === 1

  // The row behind a display ref (`A-3`, or a bare id); undefined when there is none.
  async function rowById(id: number): Promise<any | undefined> {
    return actionQuery().where("a.id", "=", id).executeTakeFirst()
  }
  async function find(input: string): Promise<ActionRecord> {
    const n = parseRef(input, PREFIX)
    const row = n === null ? undefined : await rowById(n)
    if (!row) throw new NotFoundError(`unknown action "${n === null ? input.trim() : formatRef(PREFIX, n)}"`)
    return toAction(row)
  }
  async function idOf(input: string): Promise<number | null> {
    const n = parseRef(input, PREFIX)
    if (n === null) return null
    return (await db.selectFrom("action").select("id").where("id", "=", n).executeTakeFirst()) ? n : null
  }
  // A display ref for describe lines, without failing.
  const refOr = (input: string) => {
    const n = parseRef(input, PREFIX)
    return n === null ? input.trim() : formatRef(PREFIX, n)
  }
  async function labelOf(input: string): Promise<string> {
    try {
      return (await find(input)).title
    } catch {
      return ""
    }
  }

  // ---- projects (soft references): from projects.project. A code (`CRM`, `#crm`) first, then a numeric id.
  async function codes(): Promise<string[]> {
    return unlessUnavailable([] as string[], async () =>
      (await db.selectFrom("projects.project").select("code").orderBy("code").execute()).map((r) => String(r.code)),
    )
  }
  async function projectRow(input: string): Promise<ProjectRef | null> {
    if (!hasProjects()) return null
    const code = normalizeCode(input)
    const q = () => db.selectFrom("projects.project").select(["id", "code", "archived"])
    const row = (await q().where("code", "=", code).executeTakeFirst()) ?? (/^\d+$/.test(code) ? await q().where("id", "=", Number(code)).executeTakeFirst() : undefined)
    return row ? { id: Number(row.id), ref: `#${row.code}`, code: String(row.code), archived: Number(row.archived) === 1 } : null
  }
  async function project(input: string): Promise<ProjectRef> {
    const p = await projectRow(input)
    const code = normalizeCode(input)
    if (p === null) throw new NotFoundError(`unknown project "${code}"`, { suggestions: suggest(code, await codes()) })
    return p
  }
  // A project that may have actions written on it: not archived.
  async function activeProject(input: string): Promise<ProjectRef> {
    const p = await project(input)
    if (p.archived) throw new ValidationError(`${p.ref} is archived`, { hint: `restore it first: ttybrain project restore ${p.code}` })
    return p
  }
  // The project an existing action belongs to (`#CRM`, or none) must accept writes.
  const guardProject = async (ref: string | null): Promise<void> => {
    if (ref !== null) await activeProject(ref.slice(1))
  }
  // The display code of a project input without failing (for describe lines).
  async function codeLabel(input: string): Promise<string> {
    return (await projectRow(input))?.code ?? normalizeCode(input)
  }

  // ---- people (soft references): validated through the kernel's record types, shown from people.person.
  async function handles(): Promise<string[]> {
    return unlessUnavailable([] as string[], async () =>
      (await db.selectFrom("people.person").select("handle").orderBy("handle").execute()).map((r) => String(r.handle)),
    )
  }
  async function personById(id: number): Promise<PersonRef | null> {
    const row = await db.selectFrom("people.person").select(["id", "handle", "name", "archived"]).where("id", "=", id).executeTakeFirst()
    if (!row) return null
    return { id: Number(row.id), ref: `@${row.handle}`, handle: String(row.handle), name: String(row.name), archived: Number(row.archived) === 1 }
  }
  async function person(input: string): Promise<PersonRef> {
    const handle = normalizeHandle(input)
    const found = hasPeople() ? await rt.records.resolve(`@${handle}`) : null
    const p = found && found.type === "person" ? await personById(found.id) : null
    if (!p) throw new NotFoundError(`unknown person "${input.trim()}"`, { suggestions: suggest(handle, await handles()) })
    return p
  }
  // A person who may be given an action: not archived.
  async function activePerson(input: string): Promise<PersonRef> {
    const p = await person(input)
    if (p.archived) throw new ValidationError(`${p.ref} is archived`, { hint: `restore it first: ttybrain person restore ${p.ref}` })
    return p
  }
  // The display ref of a person input without failing (for describe lines).
  async function personLabel(input: string): Promise<string> {
    try {
      return (await person(input)).ref
    } catch {
      return `@${normalizeHandle(input)}`
    }
  }
  // Owners are soft references: validated on write, never archived.
  async function personId(input: string | null | undefined): Promise<number | null | undefined> {
    if (input === undefined) return undefined
    if (input === null || input.trim() === "") return null
    return (await activePerson(input)).id
  }

  // A meeting is a soft reference to another plugin's record: validated only when that plugin is loaded.
  async function meetingId(input: string | null | undefined): Promise<number | null | undefined> {
    if (input === undefined) return undefined
    if (input === null || input.trim() === "") return null
    const n = parseRef(input, MEETING_PREFIX)
    if (n === null) throw new ValidationError(`invalid meeting "${input.trim()}"`, { field: "meeting", hint: "a meeting ref, e.g. M-4" })
    if (rt.records.hasType("meeting") && !(await rt.records.resolve(formatRef(MEETING_PREFIX, n))))
      throw new NotFoundError(`unknown meeting "${formatRef(MEETING_PREFIX, n)}"`)
    return n
  }

  return {
    actionQuery,
    toAction,
    archived,
    find,
    idOf,
    refOr,
    labelOf,
    unlessUnavailable,
    project,
    activeProject,
    guardProject,
    codeLabel,
    person,
    personLabel,
    personId,
    meetingId,
  }
}

export function registerRecordTypes(ctx: PluginContext, store: Store): void {
  ctx.recordType({
    name: "action",
    prefix: PREFIX,
    resolve: (input) => store.idOf(input),
    label: async (id) => (await store.find(String(id))).title,
    search: async (text, limit) => {
      const rows = await ctx.data.selectFrom("action").select(["id", "title"]).where("title", "like", `%${text.trim()}%`).orderBy("id").limit(limit).execute()
      return rows.map((r) => ({ ref: formatRef(PREFIX, Number(r.id)), label: String(r.title) }))
    },
  })
}
