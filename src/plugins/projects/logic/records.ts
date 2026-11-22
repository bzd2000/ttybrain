// Lookups shared by the operations and the commands (projects from the plugin's own tables, people through the
// kernel's record types and the people.person view), and the `project` record type (#CODE) with the `#` tag.
import {
  normalizeCode,
  normalizeHandle,
  NotFoundError,
  suggest,
  ValidationError,
  ViewUnavailableError,
  type PluginContext,
  type PluginRuntime,
} from "@ttybrain/api"
import type { ProjectRecord } from "./schema"
import { projectQuery } from "./views"

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

export type Store = ReturnType<typeof makeStore>
export type PersonRef = { id: number; ref: string; handle: string; name: string; archived: boolean }

// Takes a runtime (the read/write side of a context), so the logic part and the TUI part share one store.
export function makeStore(ctx: PluginRuntime) {
  const db = ctx.data

  // The published columns plus the unpublished ones a record carries.
  const recordQuery = () => projectQuery(db).select(["p.effort_note", "p.context_updated_at"])

  // A project row (recordQuery) as a record; its open actions come from the actions plugin (openActions).
  const toProject = (r: any, openActions: number): ProjectRecord => ({
    ref: `#${r.code}`,
    id: Number(r.id),
    code: String(r.code),
    name: String(r.name),
    description: str(r.description),
    status: r.status,
    start_date: str(r.start_date),
    end_date: str(r.end_date),
    effort_estimate_days: r.effort_estimate_days === null ? null : Number(r.effort_estimate_days),
    effort_note: str(r.effort_note),
    health: str(r.health) as ProjectRecord["health"],
    health_comment: str(r.health_comment),
    health_date: str(r.health_date),
    next_milestone_title: str(r.next_milestone_title),
    next_milestone_due: str(r.next_milestone_due),
    open_actions: openActions,
    open_risks: Number(r.open_risks),
    context_updated_at: str(r.context_updated_at),
    archived: Number(r.archived) === 1,
  })

  // The open actions linked to each project id, from actions.action and actions.link; none while the actions plugin
  // is not loaded.
  async function openActions(projectId?: number): Promise<Map<number, number>> {
    try {
      let q = db
        .selectFrom("actions.link as l")
        .innerJoin("actions.action as a", "a.id", "l.action_id")
        .select((eb) => ["l.record_id", eb.fn.count("a.id").distinct().as("n")])
        .where("l.record_type", "=", "project")
        .where("a.status", "=", "open")
      if (projectId !== undefined) q = q.where("l.record_id", "=", projectId)
      return new Map((await q.groupBy("l.record_id").execute()).map((r) => [Number(r.record_id), Number(r.n)]))
    } catch (e) {
      if (e instanceof ViewUnavailableError) return new Map()
      throw e
    }
  }
  // Rows of recordQuery as records.
  async function toProjects(rows: any[]): Promise<ProjectRecord[]> {
    const open = rows.length === 1 ? await openActions(Number(rows[0].id)) : await openActions()
    return rows.map((r) => toProject(r, open.get(Number(r.id)) ?? 0))
  }

  async function codes(): Promise<string[]> {
    return (await db.selectFrom("project").select("code").orderBy("code").execute()).map((r) => String(r.code))
  }

  async function codeId(input: string): Promise<number | null> {
    const row = await db.selectFrom("project").select("id").where("code", "=", normalizeCode(input)).executeTakeFirst()
    return row ? Number(row.id) : null
  }

  // A code (`CRM`, `#crm`) first, then a numeric id: codes may be all digits too.
  async function projectId(input: string): Promise<number | null> {
    const byCode = await codeId(input)
    if (byCode !== null) return byCode
    const code = normalizeCode(input)
    if (!/^\d+$/.test(code)) return null
    const byId = await db.selectFrom("project").select("id").where("id", "=", Number(code)).executeTakeFirst()
    return byId ? Number(byId.id) : null
  }

  async function projectById(id: number): Promise<ProjectRecord> {
    return (await toProjects([await recordQuery().where("p.id", "=", id).executeTakeFirstOrThrow()]))[0]!
  }

  async function project(input: string): Promise<ProjectRecord> {
    const id = await projectId(input)
    const code = normalizeCode(input)
    if (id === null) throw new NotFoundError(`unknown project "${code}"`, { suggestions: suggest(code, await codes()) })
    return projectById(id)
  }

  // A project that may be written to (or have records written on it): not archived.
  async function activeProject(input: string): Promise<ProjectRecord> {
    const p = await project(input)
    if (p.archived) throw new ValidationError(`${p.ref} is archived`, { hint: `restore it first: ttybrain project restore ${p.code}` })
    return p
  }

  async function context(id: number): Promise<{ markdown: string | null; updatedAt: string | null }> {
    const row = await db.selectFrom("project").select(["context", "context_updated_at"]).where("id", "=", id).executeTakeFirstOrThrow()
    return { markdown: str(row.context), updatedAt: str(row.context_updated_at) }
  }

  // ---- people (soft references): validated through the kernel's record types, shown from people.person.
  async function handles(): Promise<string[]> {
    return (await db.selectFrom("people.person").select("handle").orderBy("handle").execute()).map((r) => String(r.handle))
  }

  async function personById(id: number): Promise<PersonRef | null> {
    const row = await db.selectFrom("people.person").select(["id", "handle", "name", "archived"]).where("id", "=", id).executeTakeFirst()
    if (!row) return null
    return { id: Number(row.id), ref: `@${row.handle}`, handle: String(row.handle), name: String(row.name), archived: Number(row.archived) === 1 }
  }

  async function person(input: string): Promise<PersonRef> {
    const handle = normalizeHandle(input)
    const found = await ctx.records.resolve(`@${handle}`)
    const p = found && found.type === "person" ? await personById(found.id) : null
    if (!p) throw new NotFoundError(`unknown person "${input.trim()}"`, { suggestions: suggest(handle, await handles()) })
    return p
  }

  // A person who may be given a role: not archived.
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

  // The display code of a project input without failing (for describe lines).
  async function codeLabel(input: string): Promise<string> {
    const id = await projectId(input)
    return id === null ? normalizeCode(input) : (await projectById(id)).code
  }

  // Who plays which role on a project, by name from people.person.
  async function involvement(projectId: number): Promise<Array<{ person: string; name: string; role: string }>> {
    const rows = await db
      .selectFrom("involvement as i")
      .leftJoin("people.person as pp", "pp.id", "i.person_id")
      .select(["i.person_id", "i.role", "pp.handle", "pp.name"])
      .where("i.project_id", "=", projectId)
      .orderBy("pp.name")
      .orderBy("i.role")
      .execute()
    return rows.map((r) => ({
      person: r.handle === null ? `person:${r.person_id}` : `@${r.handle}`,
      name: r.name === null ? "" : String(r.name),
      role: String(r.role),
    }))
  }

  return { recordQuery, toProjects, codes, codeId, projectId, projectById, project, activeProject, context, person, activePerson, personLabel, codeLabel, involvement }
}

export function registerRecordTypes(ctx: PluginContext, store: Store): void {
  ctx.recordType({
    name: "project",
    prefix: "#",
    resolve: (input) => store.projectId(input),
    label: async (id) => (await store.projectById(id)).name,
    ref: async (id) => (await store.projectById(id)).ref,
    search: async (text, limit) => {
      const like = `%${text.trim().replace(/^#/, "")}%`
      const rows = await ctx.data
        .selectFrom("project")
        .select(["code", "name"])
        .where((eb) => eb.or([eb("name", "like", like), eb("code", "like", like)]))
        .where("archived_at", "is", null)
        .orderBy("code")
        .limit(limit)
        .execute()
      return rows.map((r) => ({ ref: `#${r.code}`, label: String(r.name) }))
    },
  })
  ctx.tagType({ prefix: "#", recordType: "project", resolve: (token) => store.codeId(token) }) // a tag names a code, never an id
}
