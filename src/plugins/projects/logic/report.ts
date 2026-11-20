// projects' reports: `project-status` (`ttybrain report status <project>`, the prep block, built from projectStatus) and
// `overview` (`ttybrain report overview`, the Attention screen as text). Other plugins add sections to both (meetings
// to the status report, people and inbox to the overview); the kernel owns neither.
import { addDays, parseRef, Type, ValidationError, type Cell, type Mark, type PluginContext } from "@ttybrain/api"
import type { Items } from "./items"
import { makeOverview, type OverviewAction } from "./overview"
import { date, today } from "./ops-project"
import type { Store } from "./records"
import type { ProjectStatus, StatusInput } from "./status"

const SINCE_DAYS = 30 // the status report's default "since": today − 30

type Row = Record<string, Cell>
const healthTone = (health: string | null): NonNullable<Mark["tone"]> => (health === "green" || health === "amber" || health === "red" ? health : "muted")
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
      reference: Type.Optional(Type.String({ description: "the date the due-soon windows count from (default: today), e.g. a meeting's date" })),
      "previous-meeting": Type.Optional(Type.String({ description: "a meeting ref (M-n): its open actions are listed too" })),
    }),
    describe: "a project's status: health, milestones, deliverables, risks, decisions and actions since a date",
    // Fail the command (not a section) on an unknown project, a bad date or a bad meeting ref.
    prepare: async (p: { project: string; since?: string; reference?: string; "previous-meeting"?: string }): Promise<StatusInput> => {
      const input: StatusInput = {
        project: (await store.project(p.project)).code,
        since: p.since !== undefined ? date(p.since, "since") : addDays(today(), -SINCE_DAYS),
      }
      if (p.reference !== undefined) input.reference = date(p.reference, "reference")
      const meeting = p["previous-meeting"]
      if (meeting !== undefined) {
        if (parseRef(meeting, "M-") === null) throw new ValidationError(`invalid meeting "${meeting.trim()}"`, { field: "previous-meeting", hint: "a meeting ref, e.g. M-4" })
        input.previousMeeting = meeting.trim()
      }
      return input
    },
  })

  const section = (id: string, order: number, build: (s: ProjectStatus, p: StatusInput) => { title: string; columns: string[]; rows: Row[]; marks?: Array<Mark | null>; empty: string; note?: string }) =>
    ctx.reportSection("project-status", { id, order, run: async (p: StatusInput) => build(await status(p), p) })

  section("health", 10, (s, p) => ({
    title: "Health",
    columns: ["Project", "Name", "Health", "Date", "Comment"],
    rows: [{ Project: s.project.ref, Name: s.project.name, Health: s.project.health ?? "not set", Date: s.project.healthDate, Comment: s.project.healthComment }],
    marks: [{ icon: "●", tone: healthTone(s.project.health) }],
    empty: "",
    ...(s.project.healthStale ? { note: `⚠ health not updated since ${p.since}` } : {}),
  }))
  section("milestones", 20, (s, p) => ({
    title: "Milestones",
    columns: ["ID", "Milestone", "Due", "Done", "Late"],
    rows: [...s.milestones.completed, ...s.milestones.upcoming].map((m) => ({ ID: m.ref, Milestone: m.title, Due: m.due_date, Done: m.done_date, Late: m.late ? "late" : "" })),
    marks: [...s.milestones.completed, ...s.milestones.upcoming].map((m): Mark => ({ icon: m.done_date !== null ? "✓" : "○", ...(m.late ? { tone: "red" as const } : {}) })),
    empty: `No milestones completed since ${p.since} or due in the next 60 days.`,
  }))
  section("deliverables", 30, (s, p) => ({
    title: "Deliverables",
    columns: ["ID", "Deliverable", "Owner", "Due", "Status"],
    rows: s.deliverables.map((d) => ({ ID: d.ref, Deliverable: d.title, Owner: d.owner, Due: d.due_date, Status: d.status })),
    marks: s.deliverables.map((d): Mark => ({ icon: d.status === "delivered" ? "✓" : d.status === "in_progress" || d.status === "in_review" ? "◐" : "○" })),
    empty: `No deliverables changed since ${p.since} or due in the next 30 days.`,
  }))
  section("risks", 40, (s) => ({
    title: "Risks & issues",
    columns: ["ID", "Type", "Severity", "Title", "Owner", "Mitigation"],
    rows: s.risks.map((r) => ({ ID: r.ref, Type: r.type, Severity: r.severity, Title: r.title, Owner: r.owner, Mitigation: r.mitigation })),
    marks: s.risks.map((r): Mark => ({ icon: "▲", ...(r.severity === "high" ? { tone: "red" as const } : {}) })),
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
    const marks: Mark[] = []
    for (const [why, list] of [
      ["overdue", s.actions.overdue],
      ["previous meeting", s.actions.fromMeeting],
    ] as const)
      for (const a of list)
        if (!seen.has(a.ref)) {
          seen.add(a.ref)
          rows.push({ ID: a.ref, Action: a.title, Owner: me(a.owner), Due: a.due_date, Why: why })
          marks.push({ icon: "!", ...(why === "overdue" ? { tone: "red" as const } : {}) })
        }
    return { title: "Actions", columns: ["ID", "Action", "Owner", "Due", "Why"], rows, marks, empty: "No overdue actions." }
  })
}

function registerOverview(ctx: PluginContext, store: Store, items: Items): void {
  ctx.report({ id: "overview", cliName: "overview", title: "Overview", params: Type.Object({}), describe: "the Attention screen as text" })
  const section = (id: string, order: number, run: () => Promise<{ title: string; columns: string[]; rows: Row[]; empty: string }>) =>
    ctx.reportSection("overview", { id, order, run })
  const overview = makeOverview(ctx, store, items)

  const actionRow = ({ a, owner }: OverviewAction): Row => ({ ID: a.ref, Action: a.title, Project: a.project?.slice(1) ?? null, Owner: owner, Due: a.due_date })
  const ACTION_COLUMNS = ["ID", "Action", "Project", "Owner", "Due"]

  section("overdue-actions", 10, async () => ({
    title: "Overdue actions",
    columns: ACTION_COLUMNS,
    rows: (await overview.overdueActions()).map(actionRow),
    empty: "No overdue actions.",
  }))
  section("due-this-week", 20, async () => ({
    title: "Due this week",
    columns: ACTION_COLUMNS,
    rows: (await overview.dueThisWeek()).map(actionRow),
    empty: "Nothing due this week.",
  }))
  section("projects-needing-attention", 30, async () => ({
    title: "Projects needing attention",
    columns: ["Project", "Name", "Health", "Updated", "Comment"],
    rows: (await overview.projectsNeedingAttention()).map((p) => ({ Project: p.code, Name: p.name, Health: p.health ?? "not set", Updated: p.health_date, Comment: p.health_comment })),
    empty: "No project needs attention.",
  }))
  section("milestones", 40, async () => {
    const t = ctx.clock.today()
    return {
      title: "Late milestones and next 14 days",
      columns: ["ID", "Milestone", "Project", "Due", "Late"],
      rows: (await overview.milestones()).map((m) => ({ ID: m.ref, Milestone: m.title, Project: m.project.slice(1), Due: m.due_date, Late: m.due_date < t ? "late" : "" })),
      empty: "No late milestones and none in the next 14 days.",
    }
  })
  section("high-risks", 50, async () => ({
    title: "High risks & issues",
    columns: ["ID", "Type", "Title", "Project", "Owner"],
    rows: (await overview.highRisks()).map(({ risk: x, owner }) => ({ ID: x.ref, Type: x.type, Title: x.title, Project: x.project.slice(1), Owner: owner })),
    empty: "No open high-severity risks or issues.",
  }))
}
