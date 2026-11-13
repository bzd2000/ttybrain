// projects' reports: `project-status` (`pm report status <project>`, the prep block, built from projectStatus) and
// `overview` (`pm report overview`, the Overview screen as text). Other plugins add sections to both (meetings
// to the status report, people and inbox to the overview); the kernel owns neither.
import { addDays, Type, weekEnd, type Cell, type PluginContext } from "../../../kernel/api"
import type { ActionRecord, Items } from "./items"
import { date, today } from "./ops-project"
import type { Store } from "./records"
import type { ProjectStatus, StatusInput } from "./status"

const SINCE_DAYS = 30 // the status report's default "since": today − 30
const ATTENTION_DAYS = 30 // a project without a health update for longer needs attention
const MILESTONE_DAYS = 14 // the overview's milestone window
const HEALTH_RANK: Record<string, number> = { red: 0, amber: 1 }

type Row = Record<string, Cell>
const me = (owner: string | null) => owner ?? "me"

export function registerReports(ctx: PluginContext, store: Store, items: Items): void {
  registerStatusReport(ctx, store)
  registerOverview(ctx, store, items)
}

function registerStatusReport(ctx: PluginContext, store: Store): void {
  // Each section formats the same projectStatus result; the params object is shared by one run's sections.
  const runs = new WeakMap<object, Promise<ProjectStatus>>()
  const status = (params: StatusInput): Promise<ProjectStatus> => {
    let s = runs.get(params)
    if (!s) runs.set(params, (s = ctx.self().read.projectStatus!(params)))
    return s
  }

  ctx.report({
    id: "project-status",
    cliName: "status",
    title: "Project status",
    params: Type.Object({
      project: Type.String({ description: "the project code" }),
      since: Type.Optional(Type.String({ description: "report changes since this date (default: 30 days ago)" })),
    }),
    describe: "a project's status: health, milestones, deliverables, risks, decisions and actions since a date",
    // Fail the command (not a section) on an unknown project or a bad date.
    prepare: async (p: { project: string; since?: string }): Promise<StatusInput> => ({
      project: (await store.project(p.project)).code,
      since: p.since !== undefined ? date(p.since, "since") : addDays(today(), -SINCE_DAYS),
    }),
  })

  const section = (id: string, order: number, build: (s: ProjectStatus, p: StatusInput) => { title: string; columns: string[]; rows: Row[]; empty: string; note?: string }) =>
    ctx.reportSection("project-status", { id, order, run: async (p: StatusInput) => build(await status(p), p) })

  section("health", 10, (s, p) => ({
    title: "Health",
    columns: ["Project", "Name", "Health", "Date", "Comment"],
    rows: [{ Project: s.project.ref, Name: s.project.name, Health: s.project.health ?? "not set", Date: s.project.healthDate, Comment: s.project.healthComment }],
    empty: "",
    ...(s.project.healthStale ? { note: `⚠ health not updated since ${p.since}` } : {}),
  }))
  section("milestones", 20, (s, p) => ({
    title: "Milestones",
    columns: ["ID", "Milestone", "Due", "Done", "Late"],
    rows: [...s.milestones.completed, ...s.milestones.upcoming].map((m) => ({ ID: m.ref, Milestone: m.title, Due: m.due_date, Done: m.done_date, Late: m.late ? "late" : "" })),
    empty: `No milestones completed since ${p.since} or due in the next 60 days.`,
  }))
  section("deliverables", 30, (s, p) => ({
    title: "Deliverables",
    columns: ["ID", "Deliverable", "Owner", "Due", "Status"],
    rows: s.deliverables.map((d) => ({ ID: d.ref, Deliverable: d.title, Owner: d.owner, Due: d.due_date, Status: d.status })),
    empty: `No deliverables changed since ${p.since} or due in the next 30 days.`,
  }))
  section("risks", 40, (s) => ({
    title: "Risks & issues",
    columns: ["ID", "Type", "Severity", "Title", "Owner", "Mitigation"],
    rows: s.risks.map((r) => ({ ID: r.ref, Type: r.type, Severity: r.severity, Title: r.title, Owner: r.owner, Mitigation: r.mitigation })),
    empty: "No open risks or issues.",
  }))
  section("decisions", 50, (s, p) => ({
    title: "Decisions",
    columns: ["ID", "Date", "Decision", "Decided by"],
    rows: s.decisions.map((d) => ({ ID: d.ref, Date: d.date, Decision: d.title, "Decided by": d.decided_by })),
    empty: `No decisions since ${p.since}.`,
  }))
  section("actions", 60, (s) => {
    const seen = new Set<string>()
    const rows: Row[] = []
    for (const [why, list] of [
      ["overdue", s.actions.overdue],
      ["previous meeting", s.actions.fromMeeting],
    ] as const)
      for (const a of list) if (!seen.has(a.ref)) seen.add(a.ref), rows.push({ ID: a.ref, Action: a.title, Owner: me(a.owner), Due: a.due_date, Why: why })
    return { title: "Actions", columns: ["ID", "Action", "Owner", "Due", "Why"], rows, empty: "No overdue actions." }
  })
}

function registerOverview(ctx: PluginContext, store: Store, items: Items): void {
  ctx.report({ id: "overview", cliName: "overview", title: "Overview", params: Type.Object({}), describe: "the Overview screen as text" })
  const section = (id: string, order: number, run: () => Promise<{ title: string; columns: string[]; rows: Row[]; empty: string }>) =>
    ctx.reportSection("overview", { id, order, run })

  // Open actions with a due date, on no project or an active one; owners by name (people.person), `me` when empty.
  const openActions = async () => {
    const rows = await items.actionQuery().where("a.status", "=", "open").where("a.due_date", "is not", null).where("p.archived_at", "is", null).execute()
    return rows
      .map((r) => ({ a: items.toAction(r), owner: r.owner_id === null ? "me" : r.owner_name === null ? `person:${r.owner_id}` : String(r.owner_name) }))
      .sort((x, y) => (x.a.due_date === y.a.due_date ? x.a.id - y.a.id : x.a.due_date! < y.a.due_date! ? -1 : 1))
  }
  const actionRow = ({ a, owner }: { a: ActionRecord; owner: string }): Row => ({ ID: a.ref, Action: a.title, Project: a.project?.slice(1) ?? null, Owner: owner, Due: a.due_date })
  const ACTION_COLUMNS = ["ID", "Action", "Project", "Owner", "Due"]

  section("overdue-actions", 10, async () => {
    const t = today()
    return { title: "Overdue actions", columns: ACTION_COLUMNS, rows: (await openActions()).filter((x) => x.a.due_date! < t).map(actionRow), empty: "No overdue actions." }
  })
  section("due-this-week", 20, async () => {
    const t = today()
    const end = weekEnd(t)
    const rows = (await openActions()).filter((x) => x.a.due_date! >= t && x.a.due_date! <= end).map(actionRow)
    return { title: "Due this week", columns: ACTION_COLUMNS, rows, empty: "Nothing due this week." }
  })
  section("projects-needing-attention", 30, async () => {
    const stale = addDays(today(), -ATTENTION_DAYS)
    const list = (await store.recordQuery().where("p.archived_at", "is", null).where("p.status", "!=", "closed").execute())
      .map(store.toProject)
      .filter((p) => p.health === "red" || p.health === "amber" || p.health_date === null || p.health_date < stale)
      .sort((a, b) => (HEALTH_RANK[a.health ?? ""] ?? 2) - (HEALTH_RANK[b.health ?? ""] ?? 2) || a.code.localeCompare(b.code))
    return {
      title: "Projects needing attention",
      columns: ["Project", "Name", "Health", "Updated", "Comment"],
      rows: list.map((p) => ({ Project: p.code, Name: p.name, Health: p.health ?? "not set", Updated: p.health_date, Comment: p.health_comment })),
      empty: "No project needs attention.",
    }
  })
  section("milestones", 40, async () => {
    const t = today()
    const rows = await items
      .milestoneQuery()
      .where("m.done_date", "is", null)
      .where("m.due_date", "<=", addDays(t, MILESTONE_DAYS))
      .where("p.archived_at", "is", null)
      .orderBy("m.due_date")
      .orderBy("m.id")
      .execute()
    return {
      title: "Late milestones and next 14 days",
      columns: ["ID", "Milestone", "Project", "Due", "Late"],
      rows: rows.map(items.toMilestone).map((m) => ({ ID: m.ref, Milestone: m.title, Project: m.project.slice(1), Due: m.due_date, Late: m.due_date < t ? "late" : "" })),
      empty: "No late milestones and none in the next 14 days.",
    }
  })
  section("high-risks", 50, async () => {
    const rows = await items
      .riskQuery()
      .select("pp.name as owner_name")
      .where("r.status", "=", "open")
      .where("r.severity", "=", "high")
      .where("p.archived_at", "is", null)
      .orderBy("r.id")
      .execute()
    return {
      title: "High risks & issues",
      columns: ["ID", "Type", "Title", "Project", "Owner"],
      rows: rows.map((r) => {
        const x = items.toRisk(r)
        return { ID: x.ref, Type: x.type, Title: x.title, Project: x.project.slice(1), Owner: r.owner_name === null ? x.owner : String(r.owner_name) }
      }),
      empty: "No open high-severity risks or issues.",
    }
  })
}
