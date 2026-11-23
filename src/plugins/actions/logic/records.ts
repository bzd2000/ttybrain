// Actions as records: the query and mapper, lookups by display ref, the soft references an action carries (its owner
// from people.person; its links to any record: projects and people shown from their views, other records through
// the record types), and the `action` record type (A-). People, projects and meetings are optional: without their
// plugin a link to their records shows the kernel's `<type>:<id>`, and a new reference to them is refused.
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
  type ExpressionBuilder,
  type PluginContext,
  type PluginRuntime,
  type Static,
} from "@ttybrain/api"

const Text = Type.String()
const Opt = Type.Union([Text, Type.Null()])
const OptId = Type.Union([Type.Integer(), Type.Null()])
export const ActionStatus = Type.Union([Type.Literal("open"), Type.Literal("done"), Type.Literal("cancelled")])
// A link: the record's type name and id, and its display ref (`#CRM`, `@anna`, `M-4`); `—` when the record is gone,
// `<type>:<id>` when the plugin that owns the type is not loaded.
export const ActionLink = Type.Object({ type: Text, id: Type.Integer(), ref: Text })
export type ActionLink = Static<typeof ActionLink>

// An action: the view's columns (ids included, so `owner_id: null` reads as "me"), display refs and notes, and its
// links. `project`, `for` and `meeting` (with their ids) are the first link of that type, as before links existed.
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
  links: Type.Array(ActionLink),
})
export type ActionRecord = Static<typeof ActionRecord>

export const PREFIX = "A-"
const MEETING_PREFIX = "M-"
export const GONE = "—"
export const LINK_HINT = "link a record by its ref: a project (#CRM), a board (#MB), a person (@anna), a meeting (M-4)"

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export type PersonRef = { id: number; ref: string; handle: string; name: string; archived: boolean }
export type ProjectRef = { id: number; ref: string; code: string; archived: boolean }
// A record an action links to, by record type name and id.
export type Target = { type: string; id: number }
// An action as loaded: the record, plus what screens show beside it (names), and `archived`: the first of its
// projects when it has project links and every one of them is archived (else null).
export type Loaded = { rec: ActionRecord; ownerName: string | null; ownerHandle: string | null; forName: string | null; archived: ProjectRef | null }
export type Store = ReturnType<typeof makeStore>

const sameTarget = (a: Target, b: Target) => a.type === b.type && a.id === b.id
const chunks = <T>(xs: T[], n = 500): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

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

  // The actions with their owner's handle and name (people.person); a null owner is me. Links are loaded by `load`.
  const actionQuery = () => {
    const q = db.selectFrom("action as a").select(["a.id", "a.title", "a.due_date", "a.status", "a.done_date", "a.owner_id", "a.notes"])
    return hasPeople()
      ? q.leftJoin("people.person as po", "po.id", "a.owner_id").select(["po.handle as owner_handle", "po.name as owner_name"])
      : q.select((eb) => [eb.lit(null).as("owner_handle"), eb.lit(null).as("owner_name")])
  }
  // A where-clause for actionQuery: linked to any of these records.
  const linkedTo =
    (targets: Target[]) =>
    (eb: ExpressionBuilder<any, any>) =>
      eb.exists(
        eb
          .selectFrom("link as l")
          .select("l.id")
          .whereRef("l.action_id", "=", "a.id")
          .where((x: ExpressionBuilder<any, any>) => x.or(targets.map((t) => x.and([x("l.record_type", "=", t.type), x("l.record_id", "=", t.id)])))),
      )

  // Each action's links, in the order they were made.
  async function linksOf(ids: number[]): Promise<Map<number, Target[]>> {
    const out = new Map<number, Target[]>()
    for (const part of chunks([...new Set(ids)]))
      for (const r of await db.selectFrom("link").select(["action_id", "record_type", "record_id"]).where("action_id", "in", part).orderBy("id").execute()) {
        const list = out.get(Number(r.action_id)) ?? []
        list.push({ type: String(r.record_type), id: Number(r.record_id) })
        out.set(Number(r.action_id), list)
      }
    return out
  }
  async function projectsById(ids: number[]): Promise<Map<number, ProjectRef>> {
    const out = new Map<number, ProjectRef>()
    if (ids.length === 0 || !hasProjects()) return out
    for (const part of chunks([...new Set(ids)]))
      for (const r of await unlessUnavailable([] as any[], () => db.selectFrom("projects.project").select(["id", "code", "archived"]).where("id", "in", part).execute()))
        out.set(Number(r.id), { id: Number(r.id), ref: `#${r.code}`, code: String(r.code), archived: Number(r.archived) === 1 })
    return out
  }
  async function peopleById(ids: number[]): Promise<Map<number, PersonRef>> {
    const out = new Map<number, PersonRef>()
    if (ids.length === 0 || !hasPeople()) return out
    for (const part of chunks([...new Set(ids)]))
      for (const r of await unlessUnavailable([] as any[], () =>
        db.selectFrom("people.person").select(["id", "handle", "name", "archived"]).where("id", "in", part).execute(),
      ))
        out.set(Number(r.id), { id: Number(r.id), ref: `@${r.handle}`, handle: String(r.handle), name: String(r.name), archived: Number(r.archived) === 1 })
    return out
  }

  // The display refs of links. Projects and people come from their views in one query each; other records from
  // their record type, which builds `<prefix><id>` (a deleted meeting still shows `M-4`). A type nobody registers
  // shows the kernel's `<type>:<id>`; a project or person that is gone, or a ref that cannot be built, shows `—`.
  async function refsOf(targets: Target[]) {
    const ids = (type: string) => targets.filter((t) => t.type === type).map((t) => t.id)
    const projects = await projectsById(ids("project"))
    const people = await peopleById(ids("person"))
    const other = new Map<string, string>()
    for (const t of targets) {
      const key = `${t.type}:${t.id}`
      if (t.type === "project" || t.type === "person" || other.has(key)) continue
      try {
        other.set(key, await rt.records.refOf(t.type, t.id))
      } catch (e) {
        if (!(e instanceof NotFoundError || e instanceof ValidationError)) throw e
        other.set(key, GONE)
      }
    }
    const ref = (t: Target): string => {
      const own = t.type === "project" ? projects : t.type === "person" ? people : undefined
      if (own === undefined) return other.get(`${t.type}:${t.id}`)!
      return own.get(t.id)?.ref ?? (rt.records.hasType(t.type) ? GONE : `${t.type}:${t.id}`)
    }
    return { ref, projects, people }
  }

  // Rows of actionQuery as loaded actions, links and all, in the rows' order.
  async function load(rows: any[]): Promise<Loaded[]> {
    const links = await linksOf(rows.map((r) => Number(r.id)))
    const { ref, projects, people } = await refsOf([...links.values()].flat())
    return rows.map((r) => {
      const id = Number(r.id)
      const own = (links.get(id) ?? []).map((t) => ({ ...t, ref: ref(t) }))
      const first = (type: string) => own.find((l) => l.type === type) ?? null
      const project = first("project")
      const person = first("person")
      const meeting = first("meeting")
      const rec: ActionRecord = {
        ref: formatRef(PREFIX, id),
        id,
        title: String(r.title),
        due_date: str(r.due_date),
        status: r.status,
        done_date: str(r.done_date),
        owner_id: int(r.owner_id),
        owner: r.owner_id === null ? null : r.owner_handle === null ? `person:${r.owner_id}` : `@${r.owner_handle}`,
        project_id: project?.id ?? null,
        project: project === null ? null : (projects.get(project.id)?.ref ?? null),
        for_person_id: person?.id ?? null,
        for: person === null ? null : (people.get(person.id)?.ref ?? `person:${person.id}`),
        meeting_id: meeting?.id ?? null,
        meeting: meeting === null ? null : formatRef(MEETING_PREFIX, meeting.id),
        notes: str(r.notes),
        links: own,
      }
      // Archived only when every project it is linked to is archived (a gone project is not): then it is frozen.
      const linked = own.filter((l) => l.type === "project").map((l) => projects.get(l.id))
      const archived = linked.length > 0 && linked.every((p) => p?.archived) ? linked[0]! : null
      return { rec, ownerName: str(r.owner_name), ownerHandle: str(r.owner_handle), forName: person === null ? null : (people.get(person.id)?.name ?? null), archived }
    })
  }
  const toActions = async (rows: any[]): Promise<ActionRecord[]> => (await load(rows)).map((x) => x.rec)

  // The action behind a display ref (`A-3`, or a bare id).
  async function loadOne(input: string): Promise<Loaded> {
    const n = parseRef(input, PREFIX)
    const row = n === null ? undefined : await actionQuery().where("a.id", "=", n).executeTakeFirst()
    if (!row) throw new NotFoundError(`unknown action "${n === null ? input.trim() : formatRef(PREFIX, n)}"`)
    return (await load([row]))[0]!
  }
  const find = async (input: string): Promise<ActionRecord> => (await loadOne(input)).rec
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
  // A project by code or id. A code another record type has (a board: `#` is shared) is refused as that type.
  async function project(input: string): Promise<ProjectRef> {
    const p = await projectRow(input)
    const code = normalizeCode(input)
    if (p !== null) return p
    const other = await rt.records.resolve(`#${code}`)
    if (other && other.type !== "project")
      throw new ValidationError(`#${code} is a ${other.type}, not a project`, { hint: `link the action to it instead: --link #${code}` })
    throw new NotFoundError(`unknown project "${code}"`, { suggestions: suggest(code, await codes()) })
  }
  const archivedProject = (p: ProjectRef) => new ValidationError(`${p.ref} is archived`, { hint: `restore it first: ttybrain project restore ${p.code}` })
  // A project that may have actions written on it: not archived.
  async function activeProject(input: string): Promise<ProjectRef> {
    const p = await project(input)
    if (p.archived) throw archivedProject(p)
    return p
  }
  // An action whose projects are all archived accepts no writes (but unlinking) until one is restored.
  const guard = (a: Loaded): void => {
    if (a.archived !== null) throw archivedProject(a.archived)
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
    return (await peopleById([id])).get(id) ?? null
  }
  async function person(input: string): Promise<PersonRef> {
    const handle = normalizeHandle(input)
    const found = hasPeople() ? await rt.records.resolve(`@${handle}`) : null
    const p = found && found.type === "person" ? await personById(found.id) : null
    if (!p) throw new NotFoundError(`unknown person "${input.trim()}"`, { suggestions: suggest(handle, await handles()) })
    return p
  }
  const archivedPerson = (p: PersonRef) => new ValidationError(`${p.ref} is archived`, { hint: `restore it first: ttybrain person restore ${p.ref}` })
  // A person who may be given an action: not archived.
  async function activePerson(input: string): Promise<PersonRef> {
    const p = await person(input)
    if (p.archived) throw archivedPerson(p)
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

  // ---- links: any record the kernel's record types resolve (`#CRM`, `@anna`, `M-4`; a bare `CRM` is a project code).
  async function lookup(input: string): Promise<Target | null> {
    const ref = input.trim()
    // A code two record types both know (a data error: `"#MB" is both a project and a board`) is not swallowed.
    const tryRef = async (r: string) => {
      try {
        return await rt.records.resolve(r)
      } catch (e) {
        if (!(e instanceof NotFoundError)) throw e
        return null
      }
    }
    return (await tryRef(ref)) ?? (/^[#@]/.test(ref) ? null : await tryRef(`#${ref}`))
  }
  // A record a new link may point at: it resolves, and a project, person or board (meetings.board) is not archived.
  async function target(input: string): Promise<Target> {
    const t = input.trim() === "" ? null : await lookup(input)
    if (t === null) throw new ValidationError(`unknown record "${input.trim()}"`, { field: "links", hint: LINK_HINT })
    if (t.type === "project") {
      const p = (await projectsById([t.id])).get(t.id)
      if (p?.archived) throw archivedProject(p)
    } else if (t.type === "person") {
      const p = await personById(t.id)
      if (p?.archived) throw archivedPerson(p)
    } else if (t.type === "board") {
      const b = await unlessUnavailable(undefined as { code: unknown; archived_at: unknown } | undefined, () =>
        db.selectFrom("meetings.board").select(["code", "archived_at"]).where("id", "=", t.id).executeTakeFirst(),
      )
      if (b && b.archived_at !== null) throw new ValidationError(`#${b.code} is archived`, { hint: `restore it first: ttybrain board restore #${b.code}` })
    }
    return t
  }
  // The display ref of a link input without failing (for describe lines): `CRM` → `#CRM`; as typed when unknown.
  async function linkLabel(input: string): Promise<string> {
    const t = await lookup(input)
    if (t === null) return input.trim()
    try {
      return await rt.records.refOf(t.type, t.id)
    } catch (e) {
      if (!(e instanceof NotFoundError || e instanceof ValidationError)) throw e
      return input.trim()
    }
  }
  // Replaces an action's links with `want` (in that order), when they differ.
  async function setLinks(actionId: number, want: Target[]): Promise<void> {
    const list = want.filter((t, i) => want.findIndex((u) => sameTarget(t, u)) === i)
    const have = (await linksOf([actionId])).get(actionId) ?? []
    if (have.length === list.length && have.every((t, i) => sameTarget(t, list[i]!))) return
    await db.deleteFrom("link").where("action_id", "=", actionId).execute()
    for (const t of list) await db.insertInto("link").values({ action_id: actionId, record_type: t.type, record_id: t.id }).execute()
  }

  return {
    actionQuery,
    linkedTo,
    load,
    toActions,
    loadOne,
    find,
    idOf,
    refOr,
    labelOf,
    unlessUnavailable,
    peopleById,
    project,
    activeProject,
    guard,
    codeLabel,
    person,
    personLabel,
    personId,
    meetingId,
    lookup,
    target,
    linkLabel,
    setLinks,
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
