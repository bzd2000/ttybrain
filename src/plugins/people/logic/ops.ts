// The exposed operations: one read with logic (staleStakeholders) and every write. Writes return the full
// record with its `ref`; `describe` gives the change-set line (plugin reference §1).
import {
  addDays,
  ConflictError,
  currentContext,
  makeHandle,
  normalizeCode,
  normalizeHandle,
  parseDate,
  Type,
  ValidationError,
  type PluginContext,
  type Static,
} from "../../../kernel/api"
import type { Store } from "./records"
import { GoalRecord, GoalStatus, Level, NoteKind, NoteRecord, PersonRecord, type GoalRecord as Goal, type PersonRecord as Person } from "./schema"

const Name = Type.String({ minLength: 1 })
const Ref = Type.String({ minLength: 1 })
const Clearable = Type.Optional(Type.Union([Type.String(), Type.Null()]))
const LevelOrNone = Type.Optional(Type.Union([Level, Type.Null()]))

const personFields = {
  handle: Type.Optional(Type.String()),
  organisation: Clearable,
  job_title: Clearable,
  email: Clearable,
  phone: Clearable,
  is_team: Type.Optional(Type.Boolean()),
  is_stakeholder: Type.Optional(Type.Boolean()),
  influence: LevelOrNone,
  interest: LevelOrNone,
}
const AddPerson = Type.Object({ name: Name, ...personFields })
const EditPerson = Type.Object({ ref: Ref, name: Type.Optional(Name), ...personFields })
const PersonRef = Type.Object({ ref: Ref })
const AddNote = Type.Object({ person: Ref, kind: NoteKind, text: Name, date: Type.Optional(Type.String()), project: Type.Optional(Type.String()) })
const EditNote = Type.Object({
  ref: Ref,
  text: Type.Optional(Name),
  kind: Type.Optional(NoteKind),
  date: Type.Optional(Type.String()),
  project: Clearable,
})
const NoteRef = Type.Object({ ref: Ref })
const AddGoal = Type.Object({ person: Ref, title: Name, target_date: Type.Optional(Type.String()), notes: Type.Optional(Type.String()) })
const EditGoal = Type.Object({ ref: Ref, title: Type.Optional(Name), target_date: Clearable, notes: Clearable })
const SetGoalStatus = Type.Object({ ref: Ref, status: GoalStatus })
const Deleted = Type.Object({ ref: Type.String(), deleted: Type.Literal(true) })

const StaleInput = Type.Object({ days: Type.Integer({ minimum: 0 }), limit: Type.Optional(Type.Integer({ minimum: 1 })) })
const StaleRow = Type.Object({
  ref: Type.String(),
  name: Type.String(),
  influence: Type.Union([Level, Type.Null()]),
  interest: Type.Union([Level, Type.Null()]),
  last_contact: Type.Union([Type.String(), Type.Null()]),
  projects: Type.Array(Type.String()),
})
export type StaleRow = Static<typeof StaleRow>

type PersonInput = Partial<Static<typeof EditPerson>>
const PERSON_COLUMNS = ["name", "organisation", "job_title", "email", "phone", "is_team", "is_stakeholder", "influence", "interest"] as const
const HANDLE = /^[a-z0-9-]+$/

const now = () => currentContext().now
const today = () => currentContext().today
// Free text: trimmed, and empty means none.
const clean = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim())
const shown = (v: unknown) => (v === null || v === undefined ? "none" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v))
const date = (input: string, field: string) => {
  try {
    return parseDate(input, today())
  } catch (e) {
    if (e instanceof ValidationError) throw new ValidationError(e.message, { field, hint: e.hint })
    throw e
  }
}
const roles = (p: { is_team?: boolean; is_stakeholder?: boolean }) =>
  [p.is_team ? "team" : "", p.is_stakeholder ? "stakeholder" : ""].filter(Boolean).join(", ")

export function registerOps(ctx: PluginContext, store: Store): void {
  const db = ctx.data

  async function freeHandle(input: string, self?: number): Promise<string> {
    const handle = normalizeHandle(input)
    if (!HANDLE.test(handle)) throw new ValidationError(`invalid handle "${input}"`, { field: "handle", hint: "use lowercase letters, digits and -" })
    const other = await store.handleId(handle)
    if (other !== null && other !== self) throw new ConflictError(`handle "${handle}" is taken`, { hint: "choose another --handle" })
    return handle
  }

  async function newHandle(i: { name: string; handle?: string }): Promise<string> {
    if (i.handle !== undefined) return freeHandle(i.handle)
    const taken = new Set(await store.handles())
    return makeHandle(i.name, (h) => taken.has(h))
  }

  // §4: influence and interest are for stakeholders only. Turning `is_stakeholder` off clears them.
  function stakeholderFields(i: PersonInput, before?: Person): Record<string, unknown> {
    const stakeholder = i.is_stakeholder ?? before?.is_stakeholder ?? false
    if (stakeholder) return {}
    if ((i.influence ?? null) !== null || (i.interest ?? null) !== null)
      throw new ValidationError("influence and interest are for stakeholders only", { field: i.influence ? "influence" : "interest", hint: "add --stakeholder" })
    return before?.influence || before?.interest ? { influence: null, interest: null } : {}
  }

  // The given person fields as column values (booleans as 0/1, free text cleaned).
  function columns(i: PersonInput): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const c of PERSON_COLUMNS) {
      const v = i[c]
      if (v === undefined) continue
      out[c] = typeof v === "boolean" ? (v ? 1 : 0) : c === "name" ? String(v).trim() : clean(v as string | null)
    }
    return out
  }

  async function personDiff(i: Static<typeof EditPerson>): Promise<string> {
    const id = await store.personId(i.ref)
    const before = id === null ? undefined : await store.personById(id)
    const ref = before?.ref ?? `@${normalizeHandle(i.ref)}`
    const after: Record<string, unknown> = { ...i, ...(i.handle !== undefined ? { handle: normalizeHandle(i.handle) } : {}) }
    const changes = (["handle", ...PERSON_COLUMNS] as const)
      .filter((c) => after[c] !== undefined && (!before || shown(before[c]) !== shown(after[c])))
      .map((c) => (before ? `${c} ${shown(before[c])} → ${shown(after[c])}` : c))
    return changes.length ? `~ ${ref} ${changes.join(", ")}` : `~ ${ref} (no change)`
  }

  async function personLabel(input: string): Promise<string> {
    const id = await store.personId(input)
    return id === null ? `@${normalizeHandle(input)}` : (await store.personById(id)).ref
  }

  async function goalBefore(ref: string): Promise<{ ref: string; goal?: Goal }> {
    const id = await store.goalId(ref)
    if (id === null) return { ref: ref.toUpperCase().startsWith("G-") ? ref.toUpperCase() : `G-${ref}` }
    const goal = await store.goal(String(id))
    return { ref: goal.ref, goal }
  }

  const noteRef = async (ref: string) => {
    const id = await store.noteId(ref)
    return id === null ? (ref.toUpperCase().startsWith("N-") ? ref.toUpperCase() : `N-${ref}`) : `N-${id}`
  }
  const given = (i: Record<string, unknown>, keys: string[]) => keys.filter((k) => i[k] !== undefined)

  ctx.expose({
    read: {
      staleStakeholders: {
        input: StaleInput,
        output: Type.Array(StaleRow),
        toolDescription: "Active stakeholders with no note for `days` days: high influence first, then oldest contact first.",
        run: async (i: Static<typeof StaleInput>): Promise<StaleRow[]> => {
          const cutoff = addDays(today(), -i.days)
          const rows = (await store.personQuery().where("p.is_stakeholder", "=", 1).where("p.archived_at", "is", null).execute())
            .map(store.toPerson)
            .filter((p) => p.last_contact === null || p.last_contact < cutoff)
            .sort(
              (a, b) =>
                Number(b.influence === "high") - Number(a.influence === "high") ||
                (a.last_contact ?? "").localeCompare(b.last_contact ?? "") ||
                a.name.localeCompare(b.name),
            )
            .slice(0, i.limit)
          const projects = await store.projectsOfPeople(rows.map((p) => p.id))
          return rows.map((p) => ({
            ref: p.ref,
            name: p.name,
            influence: p.influence,
            interest: p.interest,
            last_contact: p.last_contact,
            projects: projects.get(p.id) ?? [],
          }))
        },
      },
    },
    write: {
      addPerson: {
        input: AddPerson,
        output: PersonRecord,
        describe: async (i: Static<typeof AddPerson>) => {
          const handle = i.handle !== undefined ? normalizeHandle(i.handle) : await newHandle(i)
          const r = roles(i)
          return `+ person @${handle} "${i.name.trim()}"${r ? ` (${r})` : ""}`
        },
        run: async (i: Static<typeof AddPerson>) => {
          const handle = await newHandle(i)
          stakeholderFields(i)
          const t = now()
          const res = await db
            .insertInto("person")
            .values({ ...columns(i), handle, is_team: i.is_team ? 1 : 0, is_stakeholder: i.is_stakeholder ? 1 : 0, created_at: t, updated_at: t })
            .executeTakeFirstOrThrow()
          return store.personById(Number(res.insertId))
        },
      },
      editPerson: {
        input: EditPerson,
        output: PersonRecord,
        describe: personDiff,
        run: async (i: Static<typeof EditPerson>) => {
          const before = await store.activePerson(i.ref)
          const set: Record<string, unknown> = { ...columns(i), ...stakeholderFields(i, before) }
          if (i.handle !== undefined) set.handle = await freeHandle(i.handle, before.id)
          await db
            .updateTable("person")
            .set({ ...set, updated_at: now() })
            .where("id", "=", before.id)
            .execute()
          return store.personById(before.id)
        },
      },
      archivePerson: {
        input: PersonRef,
        output: PersonRecord,
        describe: async (i: { ref: string }) => `~ ${await personLabel(i.ref)} archived`,
        run: async (i: { ref: string }) => {
          const p = await store.person(i.ref)
          if (!p.archived) await db.updateTable("person").set({ archived_at: now(), updated_at: now() }).where("id", "=", p.id).execute()
          return store.personById(p.id)
        },
      },
      restorePerson: {
        input: PersonRef,
        output: PersonRecord,
        describe: async (i: { ref: string }) => `~ ${await personLabel(i.ref)} restored`,
        run: async (i: { ref: string }) => {
          const p = await store.person(i.ref)
          if (p.archived) await db.updateTable("person").set({ archived_at: null, updated_at: now() }).where("id", "=", p.id).execute()
          return store.personById(p.id)
        },
      },
      addNote: {
        input: AddNote,
        output: NoteRecord,
        describe: async (i: Static<typeof AddNote>) =>
          `+ note on ${await personLabel(i.person)} (${[i.kind, i.project !== undefined ? normalizeCode(i.project) : ""].filter(Boolean).join(", ")})`,
        run: async (i: Static<typeof AddNote>) => {
          const p = await store.activePerson(i.person)
          const project_id = i.project !== undefined ? await store.projectId(i.project) : null
          const t = now()
          const res = await db
            .insertInto("note")
            .values({
              person_id: p.id,
              project_id,
              kind: i.kind,
              date: i.date !== undefined ? date(i.date, "date") : today(),
              text: i.text,
              created_at: t,
              updated_at: t,
            })
            .executeTakeFirstOrThrow()
          return store.note(String(res.insertId))
        },
      },
      editNote: {
        input: EditNote,
        output: NoteRecord,
        describe: async (i: Static<typeof EditNote>) => `~ ${await noteRef(i.ref)} ${given(i, ["text", "kind", "date", "project"]).join(", ")}`.trimEnd(),
        run: async (i: Static<typeof EditNote>) => {
          const n = await store.note(i.ref)
          await store.activePerson(n.person)
          const set: Record<string, unknown> = { updated_at: now() }
          if (i.text !== undefined) set.text = i.text
          if (i.kind !== undefined) set.kind = i.kind
          if (i.date !== undefined) set.date = date(i.date, "date")
          if (i.project !== undefined) set.project_id = i.project === null ? null : await store.projectId(i.project)
          await db.updateTable("note").set(set).where("id", "=", n.id).execute()
          return store.note(String(n.id))
        },
      },
      deleteNote: {
        input: NoteRef,
        output: Deleted,
        describe: async (i: { ref: string }) => `- ${await noteRef(i.ref)}`,
        run: async (i: { ref: string }) => {
          const n = await store.note(i.ref)
          await store.activePerson(n.person)
          await db.deleteFrom("note").where("id", "=", n.id).execute()
          return { ref: n.ref, deleted: true as const }
        },
      },
      addGoal: {
        input: AddGoal,
        output: GoalRecord,
        describe: async (i: Static<typeof AddGoal>) => `+ goal for ${await personLabel(i.person)} "${i.title.trim()}"`,
        run: async (i: Static<typeof AddGoal>) => {
          const p = await store.activePerson(i.person)
          const t = now()
          const res = await db
            .insertInto("goal")
            .values({
              person_id: p.id,
              title: i.title.trim(),
              target_date: i.target_date !== undefined ? date(i.target_date, "target_date") : null,
              status: "open",
              notes: clean(i.notes) ?? null,
              created_at: t,
              updated_at: t,
            })
            .executeTakeFirstOrThrow()
          return store.goal(String(res.insertId))
        },
      },
      editGoal: {
        input: EditGoal,
        output: GoalRecord,
        describe: async (i: Static<typeof EditGoal>) => `~ ${(await goalBefore(i.ref)).ref} ${given(i, ["title", "target_date", "notes"]).join(", ")}`.trimEnd(),
        run: async (i: Static<typeof EditGoal>) => {
          const g = await store.goal(i.ref)
          await store.activePerson(g.person)
          const set: Record<string, unknown> = { updated_at: now() }
          if (i.title !== undefined) set.title = i.title.trim()
          if (i.target_date !== undefined) set.target_date = i.target_date === null ? null : date(i.target_date, "target_date")
          if (i.notes !== undefined) set.notes = clean(i.notes)
          await db.updateTable("goal").set(set).where("id", "=", g.id).execute()
          return store.goal(String(g.id))
        },
      },
      setGoalStatus: {
        input: SetGoalStatus,
        output: GoalRecord,
        describe: async (i: Static<typeof SetGoalStatus>) => {
          const { ref, goal } = await goalBefore(i.ref)
          return goal ? `~ ${ref} ${goal.status} → ${i.status}` : `~ ${ref} → ${i.status}`
        },
        run: async (i: Static<typeof SetGoalStatus>) => {
          const g = await store.goal(i.ref)
          await store.activePerson(g.person)
          await db.updateTable("goal").set({ status: i.status, updated_at: now() }).where("id", "=", g.id).execute()
          return store.goal(String(g.id))
        },
      },
    },
  })
}
