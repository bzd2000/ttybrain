// The read operation behind the prep block (spec §8): projectStatus({ project, since, reference?, previousMeeting? }).
// Every "today"-dependent rule compares with `reference` (default: the context's today), never SQLite's clock.
import { addDays, NonBlank, parseRef, Type, ValidationError, type PluginContext, type Static } from "@pm/api"
import { ActionRecord, DecisionRecord, DeliverableRecord, MilestoneRecord, RiskRecord, type Items } from "./items"
import { date, today } from "./ops-project"
import type { Store } from "./records"

const Opt = Type.Union([Type.String(), Type.Null()])
const LateMilestone = Type.Intersect([MilestoneRecord, Type.Object({ late: Type.Boolean() })])

export const StatusInput = Type.Object({
  project: NonBlank(),
  since: NonBlank(),
  reference: Type.Optional(NonBlank()),
  previousMeeting: Type.Optional(NonBlank()),
})
export const ProjectStatus = Type.Object({
  project: Type.Object({
    ref: Type.String(),
    name: Type.String(),
    health: Opt,
    healthComment: Opt,
    healthDate: Opt,
    healthStale: Type.Boolean(),
  }),
  milestones: Type.Object({ completed: Type.Array(LateMilestone), upcoming: Type.Array(LateMilestone) }),
  deliverables: Type.Array(DeliverableRecord),
  risks: Type.Array(RiskRecord),
  decisions: Type.Array(DecisionRecord),
  actions: Type.Object({ overdue: Type.Array(ActionRecord), fromMeeting: Type.Array(ActionRecord) }),
})
export type StatusInput = Static<typeof StatusInput>
export type ProjectStatus = Static<typeof ProjectStatus>

// The prep block's windows (spec §8): upcoming milestones and due deliverables, in days after the reference.
const MILESTONE_DAYS = 60
const DELIVERABLE_DAYS = 30
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }
// Ascending by due date, undated last, then by id.
const byDue = (a: { due_date: string | null; id: number }, b: { due_date: string | null; id: number }) =>
  a.due_date === b.due_date ? a.id - b.id : a.due_date === null ? 1 : b.due_date === null ? -1 : a.due_date < b.due_date ? -1 : 1

export function registerStatusOps(ctx: PluginContext, store: Store, items: Items): void {
  async function projectStatus(i: StatusInput): Promise<ProjectStatus> {
    const p = await store.project(i.project)
    const since = date(i.since, "since")
    const reference = i.reference !== undefined ? date(i.reference, "reference") : today()
    let meeting: number | null = null
    if (i.previousMeeting !== undefined) {
      meeting = parseRef(i.previousMeeting, "M-")
      if (meeting === null) throw new ValidationError(`invalid meeting "${i.previousMeeting.trim()}"`, { field: "previousMeeting", hint: "a meeting ref, e.g. M-4" })
    }

    const milestones = (await items.milestoneQuery().where("m.project_id", "=", p.id).orderBy("m.due_date").orderBy("m.id").execute())
      .map(items.toMilestone)
      .map((m) => ({ ...m, late: m.done_date === null && m.due_date < reference }))
    const completed = milestones
      .filter((m) => m.done_date !== null && m.done_date >= since)
      .sort((a, b) => (a.done_date === b.done_date ? a.id - b.id : a.done_date! < b.done_date! ? -1 : 1))
    const upcoming = milestones.filter((m) => m.done_date === null && m.due_date <= addDays(reference, MILESTONE_DAYS))

    const deliverableLimit = addDays(reference, DELIVERABLE_DAYS)
    const deliverables = (await items.deliverableQuery().where("d.project_id", "=", p.id).execute())
      .map(items.toDeliverable)
      .filter(
        (d) =>
          (d.status_changed_at !== null && d.status_changed_at.slice(0, 10) >= since) ||
          (d.status !== "delivered" && d.due_date !== null && d.due_date <= deliverableLimit),
      )
      .sort(byDue)

    const risks = (await items.riskQuery().where("r.project_id", "=", p.id).where("r.status", "=", "open").execute())
      .map(items.toRisk)
      .sort((a, b) => SEVERITY_RANK[a.severity]! - SEVERITY_RANK[b.severity]! || a.id - b.id)

    const decisions = (
      await items.decisionQuery().where("d.project_id", "=", p.id).where("d.date", ">=", since).orderBy("d.date").orderBy("d.id").execute()
    ).map(items.toDecision)

    const open = (await items.actionQuery().where("a.project_id", "=", p.id).where("a.status", "=", "open").execute()).map(items.toAction).sort(byDue)

    return {
      project: {
        ref: p.ref,
        name: p.name,
        health: p.health,
        healthComment: p.health_comment,
        healthDate: p.health_date,
        healthStale: p.health_date === null || p.health_date < since,
      },
      milestones: { completed, upcoming },
      deliverables,
      risks,
      decisions,
      actions: {
        overdue: open.filter((a) => a.due_date !== null && a.due_date < reference),
        fromMeeting: meeting === null ? [] : open.filter((a) => a.meeting_id === meeting),
      },
    }
  }

  ctx.expose({
    read: {
      projectStatus: {
        input: StatusInput,
        output: ProjectStatus,
        toolDescription:
          "The data behind a project's status/prep block since a date: health (and whether it is stale), milestones completed and coming up, deliverables changed or due soon, open risks and issues, decisions, overdue actions and those from the previous meeting.",
        run: projectStatus,
      },
    },
  })
}
