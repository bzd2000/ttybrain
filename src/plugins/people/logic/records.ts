// Lookups shared by the operations and the commands (reading the plugin's own tables), and the record types
// `person` (@handle), `note` (N-) and `goal` (G-) plus the `@` tag that the kernel resolves through them.
import {
  formatRef,
  normalizeHandle,
  NotFoundError,
  parseRef,
  suggest,
  ValidationError,
  ViewUnavailableError,
  normalizeCode,
  type PluginContext,
  type PluginRuntime,
} from "../../../kernel/api"
import type { GoalRecord, NoteRecord, PersonRecord } from "./schema"

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

export type Store = ReturnType<typeof makeStore>

export function makeStore(ctx: PluginRuntime) {
  const db = ctx.data

  const personQuery = () =>
    db
      .selectFrom("person as p")
      .selectAll("p")
      .select((eb) =>
        eb
          .selectFrom("note")
          .whereRef("note.person_id", "=", "p.id")
          .select((e) => e.fn.max("date").as("d"))
          .as("last_contact"),
      )

  const toPerson = (r: any): PersonRecord => ({
    ref: `@${r.handle}`,
    id: Number(r.id),
    handle: String(r.handle),
    name: String(r.name),
    organisation: str(r.organisation),
    job_title: str(r.job_title),
    email: str(r.email),
    phone: str(r.phone),
    is_team: Number(r.is_team) === 1,
    is_stakeholder: Number(r.is_stakeholder) === 1,
    influence: str(r.influence) as PersonRecord["influence"],
    interest: str(r.interest) as PersonRecord["interest"],
    last_contact: str(r.last_contact),
    archived: r.archived_at !== null && r.archived_at !== undefined,
  })

  const noteQuery = () =>
    db
      .selectFrom("note as n")
      .innerJoin("person as p", "p.id", "n.person_id")
      .select(["n.id", "n.person_id", "n.project_id", "n.kind", "n.date", "n.text", "p.handle"])

  const toNote = (r: any): NoteRecord => ({
    ref: formatRef("N-", Number(r.id)),
    id: Number(r.id),
    person: `@${r.handle}`,
    person_id: Number(r.person_id),
    project_id: r.project_id === null ? null : Number(r.project_id),
    kind: r.kind,
    date: String(r.date),
    text: String(r.text),
  })

  const goalQuery = () =>
    db
      .selectFrom("goal as g")
      .innerJoin("person as p", "p.id", "g.person_id")
      .select(["g.id", "g.person_id", "g.title", "g.target_date", "g.status", "g.notes", "p.handle"])

  const toGoal = (r: any): GoalRecord => ({
    ref: formatRef("G-", Number(r.id)),
    id: Number(r.id),
    person: `@${r.handle}`,
    person_id: Number(r.person_id),
    title: String(r.title),
    target_date: str(r.target_date),
    status: r.status,
    notes: str(r.notes),
  })

  async function handles(): Promise<string[]> {
    return (await db.selectFrom("person").select("handle").orderBy("handle").execute()).map((r) => String(r.handle))
  }

  async function handleId(input: string): Promise<number | null> {
    const row = await db.selectFrom("person").select("id").where("handle", "=", normalizeHandle(input)).executeTakeFirst()
    return row ? Number(row.id) : null
  }

  // A handle (`anna`, `@anna`) first, then a numeric id: handles may be all digits too.
  async function personId(input: string): Promise<number | null> {
    const byHandle = await handleId(input)
    if (byHandle !== null) return byHandle
    const handle = normalizeHandle(input)
    if (!/^\d+$/.test(handle)) return null
    const byId = await db.selectFrom("person").select("id").where("id", "=", Number(handle)).executeTakeFirst()
    return byId ? Number(byId.id) : null
  }

  async function personById(id: number): Promise<PersonRecord> {
    return toPerson(await personQuery().where("p.id", "=", id).executeTakeFirstOrThrow())
  }

  async function person(input: string): Promise<PersonRecord> {
    const id = await personId(input)
    if (id === null) throw new NotFoundError(`unknown person "${input}"`, { suggestions: suggest(normalizeHandle(input), await handles()) })
    return personById(id)
  }

  // A person who may be written to (or have notes and goals written for them): not archived.
  async function activePerson(input: string): Promise<PersonRecord> {
    const p = await person(input)
    if (p.archived) throw new ValidationError(`${p.ref} is archived`, { hint: `restore it first: pm person restore ${p.ref}` })
    return p
  }

  async function noteId(input: string): Promise<number | null> {
    const id = parseRef(input, "N-")
    if (id === null) return null
    const row = await db.selectFrom("note").select("id").where("id", "=", id).executeTakeFirst()
    return row ? Number(row.id) : null
  }

  async function note(input: string): Promise<NoteRecord> {
    const n = parseRef(input, "N-")
    const row = n === null ? undefined : await noteQuery().where("n.id", "=", n).executeTakeFirst()
    if (!row) throw new NotFoundError(`unknown note "${n === null ? input : formatRef("N-", n)}"`)
    return toNote(row)
  }

  async function goalId(input: string): Promise<number | null> {
    const id = parseRef(input, "G-")
    if (id === null) return null
    const row = await db.selectFrom("goal").select("id").where("id", "=", id).executeTakeFirst()
    return row ? Number(row.id) : null
  }

  async function goal(input: string): Promise<GoalRecord> {
    const n = parseRef(input, "G-")
    const row = n === null ? undefined : await goalQuery().where("g.id", "=", n).executeTakeFirst()
    if (!row) throw new NotFoundError(`unknown goal "${n === null ? input : formatRef("G-", n)}"`)
    return toGoal(row)
  }

  // Soft references to projects, resolved through the kernel's record types (projects may not be loaded).
  async function projectId(input: string): Promise<number> {
    const code = normalizeCode(input)
    const found = await ctx.records.resolve(`#${code}`)
    if (!found || found.type !== "project") throw new NotFoundError(`unknown project "${code}"`)
    return found.id
  }

  // Reads of the projects plugin's published views; without them (projects not loaded) there is nothing to show.
  async function unlessUnavailable<T>(empty: T, read: () => Promise<T>): Promise<T> {
    try {
      return await read()
    } catch (e) {
      if (e instanceof ViewUnavailableError) return empty
      throw e
    }
  }

  // person id → the codes of the projects they are involved in, sorted.
  async function projectsOfPeople(personIds: number[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>()
    if (personIds.length === 0) return out
    const rows = await unlessUnavailable([] as Array<{ person_id: unknown; code: unknown }>, () =>
      db
        .selectFrom("projects.involvement as i")
        .innerJoin("projects.project as pr", "pr.id", "i.project_id")
        .select(["i.person_id", "pr.code"])
        .where("i.person_id", "in", personIds)
        .distinct()
        .orderBy("pr.code")
        .execute(),
    )
    for (const r of rows) {
      const list = out.get(Number(r.person_id)) ?? []
      list.push(String(r.code))
      out.set(Number(r.person_id), list)
    }
    return out
  }

  // project id → code, for display.
  async function projectCodes(projectIds: number[]): Promise<Map<number, string>> {
    if (projectIds.length === 0) return new Map()
    const rows = await unlessUnavailable([] as Array<{ id: unknown; code: unknown }>, () =>
      db.selectFrom("projects.project").select(["id", "code"]).where("id", "in", projectIds).execute(),
    )
    return new Map(rows.map((r) => [Number(r.id), String(r.code)]))
  }

  return { projectId, projectsOfPeople, projectCodes, unlessUnavailable, personQuery, toPerson, noteQuery, toNote, goalQuery, toGoal, handles, handleId, personId, personById, person, activePerson, note, goal, noteId, goalId }
}

export function registerRecordTypes(ctx: PluginContext, store: Store): void {
  ctx.recordType({
    name: "person",
    prefix: "@",
    resolve: (input) => store.personId(input),
    label: async (id) => (await store.personById(id)).name,
    ref: async (id) => (await store.personById(id)).ref,
    search: async (text, limit) => {
      const like = `%${text.trim().replace(/^@/, "")}%`
      const rows = await ctx.data
        .selectFrom("person")
        .select(["handle", "name"])
        .where((eb) => eb.or([eb("name", "like", like), eb("handle", "like", like)]))
        .where("archived_at", "is", null)
        .orderBy("name")
        .limit(limit)
        .execute()
      return rows.map((r) => ({ ref: `@${r.handle}`, label: String(r.name) }))
    },
  })
  ctx.recordType({
    name: "note",
    prefix: "N-",
    resolve: (input) => store.noteId(input),
    label: async (id) => {
      const n = await store.note(String(id))
      return `${n.kind === "one_on_one" ? "1:1" : "Interaction"} with ${n.person}, ${n.date}`
    },
    search: async () => [],
  })
  ctx.recordType({
    name: "goal",
    prefix: "G-",
    resolve: (input) => store.goalId(input),
    label: async (id) => (await store.goal(String(id))).title,
    search: async (text, limit) => {
      const rows = await store.goalQuery().where("g.title", "like", `%${text.trim()}%`).orderBy("g.id").limit(limit).execute()
      return rows.map((r) => ({ ref: formatRef("G-", Number(r.id)), label: String(r.title) }))
    },
  })
  ctx.tagType({ prefix: "@", recordType: "person", resolve: (token) => store.handleId(token) }) // a tag names a handle, never an id
}
