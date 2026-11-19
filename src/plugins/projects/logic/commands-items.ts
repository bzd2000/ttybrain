// `pm milestone|deliverable|risk|decision …` (plugin reference §2). Reads go through ctx.data (own tables, people
// names through people.person); writes only through ctx.self().write.*.
import { currentContext, formatTable, type FlagDef, type PluginContext } from "@pm/api"
import type { Items } from "./items"
import type { DecisionRecord, DeliverableRecord, MilestoneRecord, RiskRecord } from "./items"
import type { Store } from "./records"
import { DELIVERABLE_STATUSES, RISK_STATUSES, RISK_TYPES, SEVERITIES } from "./schema"

const text = (description: string, placeholder?: string): FlagDef => ({ type: "string", description, ...(placeholder ? { placeholder } : {}) })
const date = (description: string): FlagDef => ({ type: "date", description })
const oneOf = (values: readonly string[], description: string, required = false): FlagDef => ({ type: "string", values: [...values], description, ...(required ? { required } : {}) })
// Only the flags that were given, renamed to op input fields.
function pick(flags: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [flag, field] of Object.entries(map)) if (flags[flag] !== undefined) out[field] = flags[flag]
  return out
}
const projectArg = { name: "project", required: false }

export function registerItemCommands(ctx: PluginContext, store: Store, items: Items): void {
  const write = () => ctx.self().write
  const projectFilter = async (q: any, column: string, input: unknown) => (input === undefined ? q : q.where(column, "=", (await store.project(String(input))).id))
  const ownerFilter = async (q: any, column: string, input: unknown) => (input === undefined ? q : q.where(column, "=", (await store.person(String(input))).id))

  // ---- milestone
  ctx.command({
    thing: "milestone",
    verb: "list",
    summary: "list milestones by due date; late ones are marked",
    args: [projectArg],
    flags: { open: { type: "boolean", description: "only milestones that are not done" } },
    run: async ({ args, flags }) => {
      let q = await projectFilter(items.milestoneQuery(), "m.project_id", args.project)
      if (flags.open) q = q.where("m.done_date", "is", null)
      const today = currentContext().today
      const list = (await q.orderBy("m.due_date").orderBy("m.id").execute()).map(items.toMilestone).map((m: MilestoneRecord) => ({ ...m, late: m.done_date === null && m.due_date < today }))
      const rows = list.map((m: MilestoneRecord & { late: boolean }) => ({ ref: m.ref, project: m.project, title: m.title, due: m.due_date, done: m.done_date, late: m.late ? "late" : "" }))
      return { json: list, text: list.length ? formatTable(["ref", "project", "title", "due", "done", "late"], rows) : "no milestones" }
    },
  })
  ctx.command({
    thing: "milestone",
    verb: "add",
    summary: "add a milestone to a project",
    args: [
      { name: "project", required: true },
      { name: "title", required: true },
    ],
    flags: { due: { ...date("the due date"), required: true } },
    run: async ({ args, flags }) => {
      const m: MilestoneRecord = await write().addMilestone!({ project: args.project, title: args.title, due: flags.due })
      return { json: m, text: `${m.ref} ${m.title} (${m.project}, due ${m.due_date})` }
    },
  })
  ctx.command({
    thing: "milestone",
    verb: "edit",
    summary: "change a milestone's title or due date",
    args: [{ name: "milestone", required: true }],
    flags: { title: text("the title", "title"), due: date("the due date") },
    run: async ({ args, flags }) => {
      const m: MilestoneRecord = await write().editMilestone!({ ref: args.milestone, ...pick(flags, { title: "title", due: "due" }) })
      return { json: m, text: `${m.ref} ${m.title} (due ${m.due_date})` }
    },
  })
  ctx.command({
    thing: "milestone",
    verb: "done",
    summary: "mark a milestone done (today, or --date)",
    args: [{ name: "milestone", required: true }],
    flags: { date: date("the date it was done") },
    run: async ({ args, flags }) => {
      const m: MilestoneRecord = await write().completeMilestone!({ ref: args.milestone, ...pick(flags, { date: "date" }) })
      return { json: m, text: `${m.ref} done on ${m.done_date}` }
    },
  })
  ctx.command({
    thing: "milestone",
    verb: "delete",
    summary: "delete a milestone (its deliverables stay, unlinked)",
    args: [{ name: "milestone", required: true }],
    destructive: true,
    run: async ({ args }) => {
      const m: MilestoneRecord = await write().deleteMilestone!({ ref: args.milestone })
      return { json: m, text: `${m.ref} deleted` }
    },
  })

  // ---- deliverable
  ctx.command({
    thing: "deliverable",
    verb: "list",
    summary: "list deliverables by due date",
    args: [projectArg],
    flags: { status: oneOf(DELIVERABLE_STATUSES, "only this status"), owner: text("only this owner", "handle"), milestone: text("only this milestone", "MS-n") },
    run: async ({ args, flags }) => {
      let q = await projectFilter(items.deliverableQuery(), "d.project_id", args.project)
      q = await ownerFilter(q, "d.owner_id", flags.owner)
      if (flags.status !== undefined) q = q.where("d.status", "=", String(flags.status))
      if (flags.milestone !== undefined) q = q.where("d.milestone_id", "=", (await items.find("milestone", String(flags.milestone))).id)
      const list: DeliverableRecord[] = (await q.orderBy("d.due_date").orderBy("d.id").execute()).map(items.toDeliverable)
      const rows = list.map((d) => ({ ref: d.ref, project: d.project, title: d.title, owner: d.owner, due: d.due_date, status: d.status, milestone: d.milestone }))
      return { json: list, text: list.length ? formatTable(["ref", "project", "title", "owner", "due", "status", "milestone"], rows) : "no deliverables" }
    },
  })
  const deliverableFlags = { owner: text("the owner (a person)", "handle"), due: date("the due date"), milestone: text("link a milestone of the project", "MS-n") }
  const deliverableMap = { owner: "owner", due: "due", milestone: "milestone" }
  const deliverableLine = (d: DeliverableRecord) => `${d.ref} ${d.title} (${d.project}, ${d.status})`
  ctx.command({
    thing: "deliverable",
    verb: "add",
    summary: "add a deliverable to a project",
    args: [
      { name: "project", required: true },
      { name: "title", required: true },
    ],
    flags: { ...deliverableFlags, status: oneOf(DELIVERABLE_STATUSES, "the status (default: not_started)") },
    run: async ({ args, flags }) => {
      const d: DeliverableRecord = await write().addDeliverable!({ project: args.project, title: args.title, ...pick(flags, { ...deliverableMap, status: "status" }) })
      return { json: d, text: deliverableLine(d) }
    },
  })
  ctx.command({
    thing: "deliverable",
    verb: "edit",
    summary: 'change a deliverable; an empty --owner or --milestone clears it',
    args: [{ name: "deliverable", required: true }],
    flags: { title: text("the title", "title"), ...deliverableFlags },
    run: async ({ args, flags }) => {
      const d: DeliverableRecord = await write().editDeliverable!({ ref: args.deliverable, ...pick(flags, { ...deliverableMap, title: "title" }) })
      return { json: d, text: deliverableLine(d) }
    },
  })
  ctx.command({
    thing: "deliverable",
    verb: "status",
    summary: "set a deliverable's status (delivered stamps today)",
    args: [
      { name: "deliverable", required: true },
      { name: "status", required: true },
    ],
    run: async ({ args }) => {
      const d: DeliverableRecord = await write().setDeliverableStatus!({ ref: args.deliverable, status: args.status })
      return { json: d, text: deliverableLine(d) }
    },
  })
  ctx.command({
    thing: "deliverable",
    verb: "delete",
    summary: "delete a deliverable",
    args: [{ name: "deliverable", required: true }],
    destructive: true,
    run: async ({ args }) => {
      const d: DeliverableRecord = await write().deleteDeliverable!({ ref: args.deliverable })
      return { json: d, text: `${d.ref} deleted` }
    },
  })

  // ---- risk
  ctx.command({
    thing: "risk",
    verb: "list",
    summary: "list risks and issues, open first, worst first",
    args: [projectArg],
    flags: {
      type: oneOf(RISK_TYPES, "only risks or only issues"),
      severity: oneOf(SEVERITIES, "only this severity"),
      status: oneOf(RISK_STATUSES, "only this status"),
      owner: text("only this owner", "handle"),
    },
    run: async ({ args, flags }) => {
      let q = await projectFilter(items.riskQuery(), "r.project_id", args.project)
      q = await ownerFilter(q, "r.owner_id", flags.owner)
      for (const f of ["type", "severity", "status"] as const) if (flags[f] !== undefined) q = q.where(`r.${f}`, "=", String(flags[f]))
      const order = { high: 0, medium: 1, low: 2 }
      const list: RiskRecord[] = (await q.orderBy("r.id").execute()).map(items.toRisk)
      list.sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || order[a.severity] - order[b.severity] || a.id - b.id)
      const rows = list.map((r) => ({ ref: r.ref, project: r.project, type: r.type, title: r.title, severity: r.severity, owner: r.owner, status: r.status }))
      return { json: list, text: list.length ? formatTable(["ref", "project", "type", "title", "severity", "owner", "status"], rows) : "no risks" }
    },
  })
  const riskFlags = { owner: text("the owner (a person)", "handle"), description: text("what it is", "text"), mitigation: text("how it is handled", "text") }
  const riskMap = { owner: "owner", description: "description", mitigation: "mitigation" }
  const riskLine = (r: RiskRecord) => `${r.ref} ${r.type} "${r.title}" (${r.severity}, ${r.project}, ${r.status})`
  ctx.command({
    thing: "risk",
    verb: "add",
    summary: "add a risk or an issue to a project",
    args: [
      { name: "project", required: true },
      { name: "title", required: true },
    ],
    flags: { type: oneOf(RISK_TYPES, "risk or issue", true), severity: oneOf(SEVERITIES, "low, medium or high", true), ...riskFlags },
    run: async ({ args, flags }) => {
      const r: RiskRecord = await write().addRisk!({ project: args.project, title: args.title, ...pick(flags, { ...riskMap, type: "type", severity: "severity" }) })
      return { json: r, text: riskLine(r) }
    },
  })
  ctx.command({
    thing: "risk",
    verb: "edit",
    summary: "change a risk or issue; an empty --owner clears it",
    args: [{ name: "risk", required: true }],
    flags: { title: text("the title", "title"), type: oneOf(RISK_TYPES, "risk or issue"), severity: oneOf(SEVERITIES, "low, medium or high"), ...riskFlags },
    run: async ({ args, flags }) => {
      const r: RiskRecord = await write().editRisk!({ ref: args.risk, ...pick(flags, { ...riskMap, title: "title", type: "type", severity: "severity" }) })
      return { json: r, text: riskLine(r) }
    },
  })
  ctx.command({
    thing: "risk",
    verb: "close",
    summary: "close a risk or issue (today, or --date)",
    args: [{ name: "risk", required: true }],
    flags: { date: date("the date it was closed") },
    run: async ({ args, flags }) => {
      const r: RiskRecord = await write().closeRisk!({ ref: args.risk, ...pick(flags, { date: "date" }) })
      return { json: r, text: `${r.ref} closed on ${r.closed_date}` }
    },
  })
  ctx.command({
    thing: "risk",
    verb: "delete",
    summary: "delete a risk or issue",
    args: [{ name: "risk", required: true }],
    destructive: true,
    run: async ({ args }) => {
      const r: RiskRecord = await write().deleteRisk!({ ref: args.risk })
      return { json: r, text: `${r.ref} deleted` }
    },
  })

  // ---- decision
  ctx.command({
    thing: "decision",
    verb: "list",
    summary: "list decisions, newest first",
    args: [projectArg],
    run: async ({ args }) => {
      const q = await projectFilter(items.decisionQuery(), "d.project_id", args.project)
      const list: DecisionRecord[] = (await q.orderBy("d.date", "desc").orderBy("d.id", "desc").execute()).map(items.toDecision)
      const rows = list.map((d) => ({ ref: d.ref, date: d.date, project: d.project, title: d.title, "decided by": d.decided_by, meeting: d.meeting }))
      return { json: list, text: list.length ? formatTable(["ref", "date", "project", "title", "decided by", "meeting"], rows) : "no decisions" }
    },
  })
  const decisionFlags = {
    date: date("the decision date (default: today)"),
    description: text("the reasoning", "text"),
    "decided-by": text("who decided", "text"),
    meeting: text("the meeting it was taken in", "M-n"),
  }
  const decisionMap = { date: "date", description: "description", "decided-by": "decidedBy", meeting: "meeting" }
  const decisionLine = (d: DecisionRecord) => `${d.ref} ${d.title}${d.project ? ` (${d.project})` : ""}`
  ctx.command({
    thing: "decision",
    verb: "add",
    summary: "record a decision, optionally on a project",
    args: [{ name: "title", required: true }],
    flags: { project: text("the project", "code"), ...decisionFlags },
    run: async ({ args, flags }) => {
      const d: DecisionRecord = await write().addDecision!({ title: args.title, ...pick(flags, { ...decisionMap, project: "project" }) })
      return { json: d, text: decisionLine(d) }
    },
  })
  ctx.command({
    thing: "decision",
    verb: "edit",
    summary: "change a decision; an empty --project or --meeting clears it",
    args: [{ name: "decision", required: true }],
    flags: { title: text("the title", "title"), project: text("the project", "code"), ...decisionFlags },
    run: async ({ args, flags }) => {
      const d: DecisionRecord = await write().editDecision!({ ref: args.decision, ...pick(flags, { ...decisionMap, project: "project", title: "title" }) })
      return { json: d, text: decisionLine(d) }
    },
  })
  ctx.command({
    thing: "decision",
    verb: "delete",
    summary: "delete a decision",
    args: [{ name: "decision", required: true }],
    destructive: true,
    run: async ({ args }) => {
      const d: DecisionRecord = await write().deleteDecision!({ ref: args.decision })
      return { json: d, text: `${d.ref} deleted` }
    },
  })
}
