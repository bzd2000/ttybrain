// Milestones, deliverables, risks, decisions and actions as records: their queries and mappers, lookups by display
// ref, the soft references they carry (owners, meetings), and the five record types (MS-, D-, R-, DE-, A-).
import { formatRef, NotFoundError, parseRef, Type, ValidationError, type PluginContext, type Static } from "../../../kernel/api"
import type { Store } from "./records"

const Text = Type.String()
const Opt = Type.Union([Text, Type.Null()])
const lit = Type.Literal
export const DeliverableStatus = Type.Union([lit("not_started"), lit("in_progress"), lit("in_review"), lit("delivered")])
export const RiskType = Type.Union([lit("risk"), lit("issue")])
export const Severity = Type.Union([lit("low"), lit("medium"), lit("high")])
const RiskStatus = Type.Union([lit("open"), lit("closed")])
const ActionStatus = Type.Union([lit("open"), lit("done"), lit("cancelled")])
const OptId = Type.Union([Type.Integer(), Type.Null()])

export const MilestoneRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  project: Text,
  project_id: Type.Integer(),
  title: Text,
  due_date: Text,
  done_date: Opt,
})
export const DeliverableRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  project: Text,
  project_id: Type.Integer(),
  title: Text,
  owner: Opt,
  due_date: Opt,
  status: DeliverableStatus,
  status_changed_at: Opt,
  delivered_date: Opt,
  milestone: Opt,
})
export const RiskRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  project: Text,
  project_id: Type.Integer(),
  type: RiskType,
  title: Text,
  description: Opt,
  severity: Severity,
  owner: Opt,
  mitigation: Opt,
  status: RiskStatus,
  closed_date: Opt,
})
export const DecisionRecord = Type.Object({
  ref: Text,
  id: Type.Integer(),
  project: Opt,
  project_id: Type.Union([Type.Integer(), Type.Null()]),
  date: Text,
  title: Text,
  description: Opt,
  decided_by: Opt,
  meeting: Opt,
})
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
export type MilestoneRecord = Static<typeof MilestoneRecord>
export type DeliverableRecord = Static<typeof DeliverableRecord>
export type RiskRecord = Static<typeof RiskRecord>
export type DecisionRecord = Static<typeof DecisionRecord>
export type ActionRecord = Static<typeof ActionRecord>

export type Kind = "milestone" | "deliverable" | "risk" | "decision" | "action"
export const KINDS = ["milestone", "deliverable", "risk", "decision", "action"] as const
export const PREFIX: Record<Kind, string> = { milestone: "MS-", deliverable: "D-", risk: "R-", decision: "DE-", action: "A-" }
const MEETING_PREFIX = "M-"

const ALIAS = { milestone: "m", deliverable: "d", risk: "r", decision: "d", action: "a" } as const
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export type Items = ReturnType<typeof makeItems>

export function makeItems(ctx: PluginContext, store: Store) {
  const db = ctx.data

  const milestoneQuery = () =>
    db.selectFrom("milestone as m").innerJoin("project as p", "p.id", "m.project_id").select(["m.id", "m.project_id", "m.title", "m.due_date", "m.done_date", "p.code"])
  const deliverableQuery = () =>
    db
      .selectFrom("deliverable as d")
      .innerJoin("project as p", "p.id", "d.project_id")
      .leftJoin("people.person as pp", "pp.id", "d.owner_id")
      .select(["d.id", "d.project_id", "d.title", "d.owner_id", "d.due_date", "d.status", "d.status_changed_at", "d.delivered_date", "d.milestone_id", "p.code", "pp.handle"])
  const riskQuery = () =>
    db
      .selectFrom("risk as r")
      .innerJoin("project as p", "p.id", "r.project_id")
      .leftJoin("people.person as pp", "pp.id", "r.owner_id")
      .select(["r.id", "r.project_id", "r.type", "r.title", "r.description", "r.severity", "r.owner_id", "r.mitigation", "r.status", "r.closed_date", "p.code", "pp.handle"])
  const decisionQuery = () =>
    db
      .selectFrom("decision as d")
      .leftJoin("project as p", "p.id", "d.project_id")
      .select(["d.id", "d.project_id", "d.date", "d.title", "d.description", "d.decided_by", "d.meeting_id", "p.code"])
  // Owner and for-person handles and names come from people.person; a null owner is me.
  const actionQuery = () =>
    db
      .selectFrom("action as a")
      .leftJoin("project as p", "p.id", "a.project_id")
      .leftJoin("people.person as po", "po.id", "a.owner_id")
      .leftJoin("people.person as pf", "pf.id", "a.for_person_id")
      .select([
        "a.id",
        "a.title",
        "a.due_date",
        "a.status",
        "a.done_date",
        "a.owner_id",
        "a.project_id",
        "a.for_person_id",
        "a.meeting_id",
        "a.notes",
        "p.code",
        "p.archived_at",
        "po.handle as owner_handle",
        "po.name as owner_name",
        "pf.handle as for_handle",
        "pf.name as for_name",
      ])

  const owner = (r: any) => (r.owner_id === null ? null : r.handle === null ? `person:${r.owner_id}` : `@${r.handle}`)
  const toMilestone = (r: any): MilestoneRecord => ({
    ref: formatRef("MS-", Number(r.id)),
    id: Number(r.id),
    project: `#${r.code}`,
    project_id: Number(r.project_id),
    title: String(r.title),
    due_date: String(r.due_date),
    done_date: str(r.done_date),
  })
  const toDeliverable = (r: any): DeliverableRecord => ({
    ref: formatRef("D-", Number(r.id)),
    id: Number(r.id),
    project: `#${r.code}`,
    project_id: Number(r.project_id),
    title: String(r.title),
    owner: owner(r),
    due_date: str(r.due_date),
    status: r.status,
    status_changed_at: str(r.status_changed_at),
    delivered_date: str(r.delivered_date),
    milestone: r.milestone_id === null ? null : formatRef("MS-", Number(r.milestone_id)),
  })
  const toRisk = (r: any): RiskRecord => ({
    ref: formatRef("R-", Number(r.id)),
    id: Number(r.id),
    project: `#${r.code}`,
    project_id: Number(r.project_id),
    type: r.type,
    title: String(r.title),
    description: str(r.description),
    severity: r.severity,
    owner: owner(r),
    mitigation: str(r.mitigation),
    status: r.status,
    closed_date: str(r.closed_date),
  })
  const toDecision = (r: any): DecisionRecord => ({
    ref: formatRef("DE-", Number(r.id)),
    id: Number(r.id),
    project: r.code === null ? null : `#${r.code}`,
    project_id: int(r.project_id),
    date: String(r.date),
    title: String(r.title),
    description: str(r.description),
    decided_by: str(r.decided_by),
    meeting: r.meeting_id === null ? null : formatRef(MEETING_PREFIX, Number(r.meeting_id)),
  })

  const personRef = (id: unknown, handle: unknown) => (id === null ? null : handle === null ? `person:${id}` : `@${handle}`)
  const toAction = (r: any): ActionRecord => ({
    ref: formatRef("A-", Number(r.id)),
    id: Number(r.id),
    title: String(r.title),
    due_date: str(r.due_date),
    status: r.status,
    done_date: str(r.done_date),
    owner_id: int(r.owner_id),
    owner: personRef(r.owner_id, r.owner_handle),
    project_id: int(r.project_id),
    project: r.code === null ? null : `#${r.code}`,
    for_person_id: int(r.for_person_id),
    for: personRef(r.for_person_id, r.for_handle),
    meeting_id: int(r.meeting_id),
    meeting: r.meeting_id === null ? null : formatRef(MEETING_PREFIX, Number(r.meeting_id)),
    notes: str(r.notes),
  })

  const queries = { milestone: milestoneQuery, deliverable: deliverableQuery, risk: riskQuery, decision: decisionQuery, action: actionQuery }
  const mappers = { milestone: toMilestone, deliverable: toDeliverable, risk: toRisk, decision: toDecision, action: toAction }
  const alias = ALIAS

  // The row behind a display ref (`R-3`, or a bare id); undefined when there is none.
  async function rowById(kind: Kind, id: number): Promise<any | undefined> {
    return (queries[kind]() as any).where(`${alias[kind]}.id`, "=", id).executeTakeFirst()
  }
  async function find<K extends Kind>(kind: K, input: string): Promise<ReturnType<(typeof mappers)[K]>> {
    const n = parseRef(input, PREFIX[kind])
    const row = n === null ? undefined : await rowById(kind, n)
    if (!row) throw new NotFoundError(`unknown ${kind} "${n === null ? input.trim() : formatRef(PREFIX[kind], n)}"`)
    return mappers[kind](row) as any
  }
  async function idOf(kind: Kind, input: string): Promise<number | null> {
    const n = parseRef(input, PREFIX[kind])
    return n !== null && (await rowById(kind, n)) ? n : null
  }
  // A display ref for describe lines, without failing.
  const refOr = (kind: Kind, input: string) => {
    const n = parseRef(input, PREFIX[kind])
    return n === null ? input.trim() : formatRef(PREFIX[kind], n)
  }
  async function labelOf(kind: Kind, input: string): Promise<string> {
    try {
      return (await find(kind, input)).title
    } catch {
      return ""
    }
  }

  // The project an existing record belongs to (`#CRM`, or none) must accept writes.
  const guardProject = async (ref: string | null): Promise<void> => {
    if (ref !== null) await store.activeProject(ref.slice(1))
  }

  // Owners are soft references: validated on write, never archived.
  async function ownerId(input: string | null | undefined): Promise<number | null | undefined> {
    if (input === undefined) return undefined
    if (input === null || input.trim() === "") return null
    return (await store.activePerson(input)).id
  }

  // A meeting is a soft reference to another plugin's record: validated only when that plugin is loaded.
  async function meetingId(input: string | null | undefined): Promise<number | null | undefined> {
    if (input === undefined) return undefined
    if (input === null || input.trim() === "") return null
    const n = parseRef(input, MEETING_PREFIX)
    if (n === null) throw new ValidationError(`invalid meeting "${input.trim()}"`, { field: "meeting", hint: "a meeting ref, e.g. M-4" })
    if (ctx.records.hasType("meeting") && !(await ctx.records.resolve(formatRef(MEETING_PREFIX, n))))
      throw new NotFoundError(`unknown meeting "${formatRef(MEETING_PREFIX, n)}"`)
    return n
  }

  // A deliverable's milestone: an existing milestone of the same project.
  async function milestoneFor(input: string | null | undefined, projectId: number): Promise<number | null | undefined> {
    if (input === undefined) return undefined
    if (input === null || input.trim() === "") return null
    const m = await find("milestone", input)
    if (m.project_id !== projectId) throw new ValidationError(`${m.ref} belongs to ${m.project}`, { field: "milestone", hint: "link a milestone of the same project" })
    return m.id
  }

  return { milestoneQuery, deliverableQuery, riskQuery, decisionQuery, actionQuery, toMilestone, toDeliverable, toRisk, toDecision, toAction, find, idOf, refOr, labelOf, guardProject, ownerId, meetingId, milestoneFor }
}

export function registerItemRecordTypes(ctx: PluginContext, items: Items): void {
  const queries = { milestone: items.milestoneQuery, deliverable: items.deliverableQuery, risk: items.riskQuery, decision: items.decisionQuery, action: items.actionQuery }
  const alias = ALIAS
  for (const kind of KINDS) {
    ctx.recordType({
      name: kind,
      prefix: PREFIX[kind],
      resolve: (input) => items.idOf(kind, input),
      label: async (id) => (await items.find(kind, String(id))).title,
      search: async (text, limit) => {
        const rows = await (queries[kind]() as any).where(`${alias[kind]}.title`, "like", `%${text.trim()}%`).orderBy(`${alias[kind]}.id`).limit(limit).execute()
        return rows.map((r: any) => ({ ref: formatRef(PREFIX[kind], Number(r.id)), label: String(r.title) }))
      },
    })
  }
}
