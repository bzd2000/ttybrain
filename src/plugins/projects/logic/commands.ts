// `ttybrain project …` and `ttybrain involve …`. Reads go through ctx.data (own tables and views); writes only through
// ctx.self().write.*, so they are validated, transactional and recorded like any other caller's.
import { readFile } from "node:fs/promises"
import { formatTable, NotFoundError, ValidationError, type FlagDef, type PluginContext } from "@ttybrain/api"
import type { Store } from "./records"
import { HEALTHS, PROJECT_STATUSES, type ContextRecord, type InvolvementRecord, type ProjectRecord } from "./schema"

const text = (description: string, placeholder?: string): FlagDef => ({ type: "string", description, ...(placeholder ? { placeholder } : {}) })
const bool = (description: string): FlagDef => ({ type: "boolean", description })

const projectFlags: Record<string, FlagDef> = {
  description: text("one paragraph on the project", "text"),
  status: { type: "string", values: [...PROJECT_STATUSES], description: "the project status (default: active)" },
  start: { type: "date", description: "start date" },
  end: { type: "date", description: "end date" },
  effort: { type: "number", description: "estimated effort in days" },
  "effort-note": text("a note on the effort estimate", "text"),
}

// The project flags as op input fields: only those given.
function projectInput(flags: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, string> = { description: "description", status: "status", start: "startDate", end: "endDate", effort: "effortDays", "effort-note": "effortNote" }
  const out: Record<string, unknown> = {}
  for (const [flag, field] of Object.entries(map)) if (flags[flag] !== undefined) out[field] = flags[flag]
  return out
}

const dot = (health: string | null) => (health === null ? "○" : `● ${health}`)
const effort = (p: ProjectRecord) => (p.effort_estimate_days === null ? "" : `${p.effort_estimate_days}d`)
const size = (s: string) => {
  const n = new TextEncoder().encode(s).length
  return n < 1000 ? `${n} B` : `${(n / 1000).toFixed(1)} kB`
}

function projectText(p: ProjectRecord, markdown: string | null): string {
  const lines = [`${p.ref} ${p.name}${p.archived ? " (archived)" : ""}`]
  const field = (label: string, v: string | null) => v && lines.push(`  ${label}: ${v}`)
  field("status", p.status)
  field("health", p.health === null ? "not set" : [p.health, `(${p.health_date})`, p.health_comment].filter(Boolean).join(" "))
  field("description", p.description)
  field("start", p.start_date)
  field("end", p.end_date)
  field("effort", p.effort_estimate_days === null ? null : [effort(p), p.effort_note ? `(${p.effort_note})` : ""].filter(Boolean).join(" "))
  field("next milestone", p.next_milestone_title === null ? null : `${p.next_milestone_title} (${p.next_milestone_due})`)
  field("open", `${p.open_actions} actions, ${p.open_risks} risks`)
  field("context", markdown === null ? null : `${size(markdown)}, updated ${p.context_updated_at}`)
  return lines.join("\n")
}

export function registerCommands(ctx: PluginContext, store: Store): void {
  const write = () => ctx.self().write

  // ---- project
  ctx.command({
    thing: "project",
    verb: "list",
    summary: "list projects with their health, next milestone and open items",
    flags: {
      status: { type: "string", values: [...PROJECT_STATUSES], description: "only projects with this status" },
      health: { type: "string", values: [...HEALTHS], description: "only projects with this current health" },
      archived: bool("archived projects only"),
    },
    run: async ({ flags }) => {
      // The own tables (the same query as the view), so a listed row has the same shape as `project show`.
      let q = store.recordQuery().where("p.archived_at", flags.archived ? "is not" : "is", null)
      if (flags.status !== undefined) q = q.where("p.status", "=", String(flags.status))
      const rows = (await q.orderBy("p.code").execute()).map(store.toProject).filter((p) => flags.health === undefined || p.health === flags.health)
      const table = rows.map((p) => ({
        health: dot(p.health),
        code: p.code,
        name: p.name,
        "next milestone": p.next_milestone_title,
        due: p.next_milestone_due,
        actions: p.open_actions,
        risks: p.open_risks,
        effort: effort(p),
      }))
      return {
        json: rows,
        text: rows.length ? formatTable(["health", "code", "name", "next milestone", "due", "actions", "risks", "effort"], table) : "no projects",
      }
    },
  })

  ctx.command({
    thing: "project",
    verb: "show",
    summary: "show a project with its people and context",
    args: [{ name: "project", required: true }],
    run: async ({ args }) => {
      const p = await store.project(String(args.project))
      const { markdown } = await store.context(p.id)
      const involvement = await store.involvement(p.id)
      const blocks = [projectText(p, markdown)]
      if (involvement.length) blocks.push(`People\n${formatTable(["person", "name", "role"], involvement)}`)
      return { json: { ...p, context: markdown, involvement }, text: blocks.join("\n\n") }
    },
  })

  ctx.command({
    thing: "project",
    verb: "add",
    summary: "add a project",
    args: [
      { name: "code", required: true },
      { name: "name", required: true },
    ],
    flags: projectFlags,
    run: async ({ args, flags }) => {
      const p: ProjectRecord = await write().addProject!({ code: args.code, name: args.name, ...projectInput(flags) })
      return { json: p, text: `${p.ref} ${p.name}` }
    },
  })

  ctx.command({
    thing: "project",
    verb: "edit",
    summary: "change a project's fields; --health records a health update",
    args: [{ name: "project", required: true }],
    flags: {
      name: text("the project name", "name"),
      ...projectFlags,
      health: { type: "string", values: [...HEALTHS], description: "record a health update (today)" },
      "health-comment": text("the comment on the health update", "text"),
    },
    run: async ({ args, flags }) => {
      if (flags["health-comment"] !== undefined && flags.health === undefined)
        throw new ValidationError("--health-comment needs --health", { field: "health" })
      const fields = { ...projectInput(flags), ...(flags.name !== undefined ? { name: flags.name } : {}) }
      let p: ProjectRecord | undefined
      if (Object.keys(fields).length > 0 || flags.health === undefined) p = await write().editProject!({ project: args.project, ...fields })
      if (flags.health !== undefined)
        p = await write().setHealth!({
          project: args.project,
          health: flags.health,
          ...(flags["health-comment"] !== undefined ? { comment: flags["health-comment"] } : {}),
        })
      const out = p!
      return { json: out, text: projectText(out, (await store.context(out.id)).markdown) }
    },
  })

  for (const [verb, op, summary] of [
    ["archive", "archiveProject", "archive a project (projects are never deleted)"],
    ["restore", "restoreProject", "restore an archived project"],
  ] as const) {
    ctx.command({
      thing: "project",
      verb,
      summary,
      args: [{ name: "project", required: true }],
      run: async ({ args }) => {
        const p: ProjectRecord = await write()[op]!({ project: args.project })
        return { json: p, text: `${p.ref} ${verb}d` }
      },
    })
  }

  ctx.command({
    thing: "project",
    verb: "context",
    summary: "print a project's context Markdown, replace it from a file or stdin, or clear it",
    args: [{ name: "project", required: true }],
    flags: {
      "set-file": text("replace the context with this Markdown file", "path"),
      stdin: bool("replace the context with stdin"),
      clear: bool("remove the context"),
    },
    run: async ({ args, flags, readStdin }) => {
      const file = flags["set-file"] as string | undefined
      const sources = [file !== undefined && "--set-file", flags.stdin && "--stdin", flags.clear && "--clear"].filter(Boolean)
      if (sources.length > 1) throw new ValidationError(`use only one of --set-file, --stdin and --clear`, { field: "set-file" })
      if (flags.clear) {
        const c: ContextRecord = await write().setContext!({ project: args.project, markdown: "" })
        return { json: c, text: `${c.ref} context updated (cleared)` }
      }
      if (file === undefined && !flags.stdin) {
        const c: ContextRecord = await ctx.self().read.getContext!({ project: args.project })
        return { json: c, text: c.markdown ?? `no context for ${c.ref}` }
      }
      let markdown: string
      if (file !== undefined) {
        try {
          markdown = await readFile(file, "utf8")
        } catch (e) {
          if ((e as { code?: string }).code === "ENOENT") throw new NotFoundError(`no file "${file}"`)
          throw e
        }
      } else markdown = await readStdin()
      // An empty pipe or file is almost always a mistake; it must not silently erase the context.
      if (markdown.trim() === "") throw new ValidationError("the new context is empty", { hint: "use --clear to remove the context" })
      const c: ContextRecord = await write().setContext!({ project: args.project, markdown })
      return { json: c, text: `${c.ref} context updated (${c.markdown === null ? "cleared" : size(c.markdown)})` }
    },
  })

  // ---- involve
  for (const [verb, op, summary] of [
    ["add", "addInvolvement", "give a person a role on a project"],
    ["remove", "removeInvolvement", "remove a person's role on a project"],
  ] as const) {
    ctx.command({
      thing: "involve",
      verb,
      summary,
      args: [
        { name: "project", required: true },
        { name: "person", required: true },
      ],
      flags: { role: { type: "string", required: true, placeholder: "role", description: 'the role, e.g. sponsor or "key user"' } },
      run: async ({ args, flags }) => {
        const r: InvolvementRecord = await write()[op]!({ project: args.project, person: args.person, role: flags.role })
        return { json: r, text: `${r.person} ${verb === "add" ? "is" : "is no longer"} ${r.role} on ${r.project}` }
      },
    })
  }
}
