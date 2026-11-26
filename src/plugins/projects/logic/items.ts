// Milestones, deliverables, risks and decisions as records: their queries and mappers, lookups by display ref, the
// soft references they carry (owners, meetings), and the four record types (MS-, D-, R-, DE-). Actions are the
// actions plugin's.
import { formatRef, NotFoundError, parseRef, Type, ValidationError, type PluginContext, type PluginRuntime, type Static } from "@ttybrain/api"
import type { Store } from "./records"

const Text = Type.String()
const Opt = Type.Union([Text, Type.Null()])
const lit = Type.Literal
export const DeliverableStatus = Type.Union([lit("not_started"), lit("in_progress"), lit("in_review"), lit("delivered")])
export const RiskType = Type.Union([lit("risk"), lit("issue")])
export const Severity = Type.Union([lit("low"), lit("medium"), lit("high")])
const RiskStatus = Type.Union([lit("open"), lit("closed")])

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
  owner: Opt, // "me", a person ("@bob") or null (no owner)
  owner_me: Type.Boolean(), // owned by me: tells "me" from no owner
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
  owner: Opt, // "me", a person ("@bob") or null (no owner)
  owner_me: Type.Boolean(),
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
export type MilestoneRecord = Static<typeof MilestoneRecord>
export type DeliverableRecord = Static<typeof DeliverableRecord>
export type RiskRecord = Static<typeof RiskRecord>
export type DecisionRecord = Static<typeof DecisionRecord>

export type Kind = "milestone" | "deliverable" | "risk" | "decision"
export const KINDS = ["milestone", "deliverable", "risk", "decision"] as const
export const PREFIX: Record<Kind, string> = { milestone: "MS-", deliverable: "D-", risk: "R-", decision: "DE-" }
const MEETING_PREFIX = "M-"

// The user as an owner: `me`, or `@me` (any case). The people plugin reserves the handle.
export const ME = "me"
export const isMe = (input: string) => /^@?me$/i.test(input.trim())
export type Owner = { owner_id: number | null; owner_me: 0 | 1 }

const ALIAS = { milestone: "m", deliverable: "d", risk: "r", decision: "d" } as const
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export type Items = ReturnType<typeof makeItems>

export function makeItems(ctx: PluginRuntime, store: Store) {
  const db = ctx.data

  const milestoneQuery = () =>
    db.selectFrom("milestone as m").innerJoin("project as p", "p.id", "m.project_id").select(["m.id", "m.project_id", "m.title", "m.due_date", "m.done_date", "p.code"])
  const deliverableQuery = () =>
    db
      .selectFrom("deliverable as d")
      .innerJoin("project as p", "p.id", "d.project_id")
      .leftJoin("people.person as pp", "pp.id", "d.owner_id")
      .select(["d.id", "d.project_id", "d.title", "d.owner_id", "d.owner_me", "d.due_date", "d.status", "d.status_changed_at", "d.delivered_date", "d.milestone_id", "p.code", "pp.handle"])
  const riskQuery = () =>
    db
      .selectFrom("risk as r")
      .innerJoin("project as p", "p.id", "r.project_id")
      .leftJoin("people.person as pp", "pp.id", "r.owner_id")
      .select(["r.id", "r.project_id", "r.type", "r.title", "r.description", "r.severity", "r.owner_id", "r.owner_me", "r.mitigation", "r.status", "r.closed_date", "p.code", "pp.handle"])
  const decisionQuery = () =>
    db
      .selectFrom("decision as d")
      .leftJoin("project as p", "p.id", "d.project_id")
      .select(["d.id", "d.project_id", "d.date", "d.title", "d.description", "d.decided_by", "d.meeting_id", "p.code"])
  const owner = (r: any) => (Number(r.owner_me) === 1 ? ME : r.owner_id === null ? null : r.handle === null ? `person:${r.owner_id}` : `@${r.handle}`)
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
    owner_me: Number(r.owner_me) === 1,
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
    owner_me: Number(r.owner_me) === 1,
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

  const queries = { milestone: milestoneQuery, deliverable: deliverableQuery, risk: riskQuery, decision: decisionQuery }
  const mappers = { milestone: toMilestone, deliverable: toDeliverable, risk: toRisk, decision: toDecision }
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

  // An owner as written: `me` / `@me` (any case) is me, empty is no owner, anything else an active person (a soft
  // reference: validated on write, never archived). undefined: not given.
  async function ownerOf(input: string | null | undefined): Promise<Owner | undefined> {
    if (input === undefined) return undefined
    if (input === null || input.trim() === "") return { owner_id: null, owner_me: 0 }
    if (isMe(input)) return { owner_id: null, owner_me: 1 }
    return { owner_id: (await store.activePerson(input)).id, owner_me: 0 }
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

  return { milestoneQuery, deliverableQuery, riskQuery, decisionQuery, toMilestone, toDeliverable, toRisk, toDecision, find, idOf, refOr, labelOf, guardProject, ownerOf, meetingId, milestoneFor }
}

export function registerItemRecordTypes(ctx: PluginContext, items: Items): void {
  const queries = { milestone: items.milestoneQuery, deliverable: items.deliverableQuery, risk: items.riskQuery, decision: items.decisionQuery }
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
