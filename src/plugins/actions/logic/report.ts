// The actions plugin's sections on the projects plugin's reports: "actions" on `project-status` (order 60: the
// project's overdue actions and those from the previous meeting, so the board pack and the meeting prep show them),
// and "overdue-actions" (10) and "due-this-week" (20) on `overview`. Without projects those reports are not there,
// and the sections are simply not run.
import { dueLabel, type Cell, type Mark, type PluginContext, type ReportCompact } from "@ttybrain/api"
import { makeOverview, type OverviewAction } from "./overview"
import { today, type ProjectActions } from "./ops"
import type { Store } from "./records"

type Row = Record<string, Cell>
// What the project-status report's prepare gives its sections.
type StatusInput = { project: string; since: string; reference?: string; previousMeeting?: string }

const firstName = (name: string) => name.split(/\s+/)[0] || name

export function registerReports(ctx: PluginContext, store: Store): void {
  registerStatusSection(ctx, store)
  registerOverviewSections(ctx, store)
}

function registerStatusSection(ctx: PluginContext, store: Store): void {
  // The owners' first names (`@anna` → `Anna`), for the compact form.
  const firstNames = async (s: ProjectActions): Promise<Map<string, string>> => {
    const owners = [...s.overdue, ...s.fromMeeting].map((x) => x.owner)
    const handles = [...new Set(owners.filter((h): h is string => h !== null && h.startsWith("@")).map((h) => h.slice(1)))]
    if (handles.length === 0) return new Map()
    const rows = await store.unlessUnavailable([] as Array<{ handle: unknown; name: unknown }>, () =>
      ctx.data.selectFrom("people.person").select(["handle", "name"]).where("handle", "in", handles).execute(),
    )
    return new Map(rows.map((r) => [`@${String(r.handle)}`, firstName(String(r.name))]))
  }

  ctx.reportSection("project-status", {
    id: "actions",
    order: 60,
    run: async (p: StatusInput) => {
      const s: ProjectActions = await ctx.self().read.projectActions!({
        project: p.project,
        ...(p.reference !== undefined && { reference: p.reference }),
        ...(p.previousMeeting !== undefined && { previousMeeting: p.previousMeeting }),
      })
      const who = await firstNames(s)
      const t = today()
      const seen = new Set<string>()
      const rows: Row[] = []
      const marks: Mark[] = []
      const lines: ReportCompact["lines"] = []
      for (const [why, list] of [
        ["overdue", s.overdue],
        ["previous meeting", s.fromMeeting],
      ] as const)
        for (const a of list)
          if (!seen.has(a.ref)) {
            seen.add(a.ref)
            rows.push({ ID: a.ref, Action: a.title, Owner: a.owner ?? "me", Due: a.due_date, Why: why })
            marks.push({ icon: "!", ...(why === "overdue" ? { tone: "red" as const } : {}) })
            // The compact form lists only what is overdue today, in red (`! A-27 Send revised budget to Peter
            // me · -3d`); the table keeps everything due before the reference and the previous meeting's actions.
            if (a.due_date !== null && a.due_date < t) {
              const owner = a.owner === null ? "me" : (who.get(a.owner) ?? a.owner)
              lines.push({ icon: { text: "!", tone: "red" }, text: [{ text: `${a.ref} ${a.title}` }], aside: { text: `${owner} · ${dueLabel(a.due_date, t)}`, tone: "red" } })
            }
          }
      return { title: "Actions", columns: ["ID", "Action", "Owner", "Due", "Why"], rows, marks, empty: "No overdue actions.", compact: { title: "Overdue actions", lines } }
    },
  })
}

function registerOverviewSections(ctx: PluginContext, store: Store): void {
  const overview = makeOverview(ctx, store)
  const actionRow = ({ a, owner }: OverviewAction): Row => ({ ID: a.ref, Action: a.title, Project: a.project?.slice(1) ?? null, Owner: owner, Due: a.due_date })
  const ACTION_COLUMNS = ["ID", "Action", "Project", "Owner", "Due"]

  ctx.reportSection("overview", {
    id: "overdue-actions",
    order: 10,
    run: async () => ({ title: "Overdue actions", columns: ACTION_COLUMNS, rows: (await overview.overdueActions()).map(actionRow), empty: "No overdue actions." }),
  })
  ctx.reportSection("overview", {
    id: "due-this-week",
    order: 20,
    run: async () => ({ title: "Due this week", columns: ACTION_COLUMNS, rows: (await overview.dueThisWeek()).map(actionRow), empty: "Nothing due this week." }),
  })
}
