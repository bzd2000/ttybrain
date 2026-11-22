// `ttybrain action list|add|edit|done|cancel|delete`. Reads go through ctx.data (the own table, people through
// people.person, projects through projects.project); writes only through ctx.self().write.*. An empty owner is me,
// shown as `me`.
import { addDays, currentContext, formatTable, parseRef, ValidationError, weekEnd, type FlagDef, type PluginContext } from "@ttybrain/api"
import { byDue, isMe } from "./ops"
import type { ActionRecord, Store } from "./records"

const text = (description: string, placeholder?: string): FlagDef => ({ type: "string", description, ...(placeholder ? { placeholder } : {}) })
const bool = (description: string): FlagDef => ({ type: "boolean", description })
const COLUMNS = ["ref", "title", "project", "owner", "for", "due", "status"]

// Only the flags that were given, renamed to op input fields.
function pick(flags: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [flag, field] of Object.entries(map)) if (flags[flag] !== undefined) out[field] = flags[flag]
  return out
}
const FIELDS = { due: "due", owner: "owner", project: "project", for: "forPerson", meeting: "meeting", notes: "notes" }

// The Actions screen's groups (spec §9): Overdue (open, before today), This week (to Sunday), Next week, Later, No
// date. A closed action dated before today goes under Earlier: it is not overdue.
function group(a: ActionRecord, today: string): string {
  if (a.due_date === null) return "No date"
  if (a.due_date < today) return a.status === "open" ? "Overdue" : "Earlier"
  const end = weekEnd(today)
  if (a.due_date <= end) return "This week"
  return a.due_date <= addDays(end, 7) ? "Next week" : "Later"
}
const GROUPS = ["Overdue", "Earlier", "This week", "Next week", "Later", "No date"]

const line = (a: ActionRecord) => `${a.ref} ${a.title} (${a.owner ?? "me"}${a.due_date ? `, due ${a.due_date}` : ""}${a.status !== "open" ? `, ${a.status}` : ""})`

export function registerCommands(ctx: PluginContext, store: Store): void {
  const write = () => ctx.self().write

  ctx.command({
    thing: "action",
    verb: "list",
    summary: "list actions grouped Overdue / This week / Next week / Later / No date",
    flags: {
      open: bool("only open actions"),
      overdue: bool("only open actions due before today"),
      owner: text("only this owner (me, or a person)", "me|handle"),
      project: text("only this project", "code"),
      for: text("only actions for this person", "handle"),
      meeting: text("only actions from this meeting", "M-n"),
    },
    run: async ({ flags }) => {
      const today = currentContext().today
      let q = store.actionQuery()
      if (flags.open || flags.overdue) q = q.where("a.status", "=", "open")
      if (flags.overdue) q = q.where("a.due_date", "<", today)
      if (flags.owner !== undefined) {
        const o = String(flags.owner)
        q = isMe(o) ? q.where("a.owner_id", "is", null) : q.where("a.owner_id", "=", (await store.person(o)).id)
      }
      if (flags.project !== undefined) q = q.where("a.project_id", "=", (await store.project(String(flags.project))).id)
      if (flags.for !== undefined) q = q.where("a.for_person_id", "=", (await store.person(String(flags.for))).id)
      if (flags.meeting !== undefined) {
        const n = parseRef(String(flags.meeting), "M-")
        if (n === null) throw new ValidationError(`invalid meeting "${String(flags.meeting).trim()}"`, { field: "meeting", hint: "a meeting ref, e.g. M-4" })
        q = q.where("a.meeting_id", "=", n)
      }
      const list = (await q.orderBy("a.id").execute()).map(store.toAction).sort(byDue)
      if (list.length === 0) return { json: list, text: "no actions" }
      const blocks = GROUPS.map((g) => {
        const rows = list
          .filter((a) => group(a, today) === g)
          .map((a) => ({ ref: a.ref, title: a.title, project: a.project, owner: a.owner ?? "me", for: a.for, due: a.due_date, status: a.status }))
        return rows.length ? `${g}\n${formatTable(COLUMNS, rows)}` : ""
      }).filter(Boolean)
      return { json: list, text: blocks.join("\n\n") }
    },
  })

  const fieldFlags = {
    owner: text("the owner (a person; empty or me: you)", "handle"),
    project: text("the project", "code"),
    for: text("the stakeholder it is for", "handle"),
    meeting: text("the meeting it comes from", "M-n"),
    notes: text("notes", "text"),
  }
  ctx.command({
    thing: "action",
    verb: "add",
    summary: "add an action (no --owner: it is yours)",
    args: [{ name: "title", required: true }],
    flags: { due: { type: "date", description: "the due date" }, ...fieldFlags },
    run: async ({ args, flags }) => {
      const a: ActionRecord = await write().addAction!({ title: args.title, ...pick(flags, FIELDS) })
      return { json: a, text: line(a) }
    },
  })
  ctx.command({
    thing: "action",
    verb: "edit",
    summary: "change an action; an empty value clears a field (an empty --owner makes it yours)",
    args: [{ name: "action", required: true }],
    flags: { title: text("the title", "title"), due: text("the due date (empty: none)", "date"), ...fieldFlags },
    run: async ({ args, flags }) => {
      const a: ActionRecord = await write().editAction!({ ref: args.action, ...pick(flags, { ...FIELDS, title: "title" }) })
      return { json: a, text: line(a) }
    },
  })
  ctx.command({
    thing: "action",
    verb: "done",
    summary: "mark an action done (today, or --date)",
    args: [{ name: "action", required: true }],
    flags: { date: { type: "date", description: "the date it was done" } },
    run: async ({ args, flags }) => {
      const a: ActionRecord = await write().completeAction!({ ref: args.action, ...pick(flags, { date: "date" }) })
      return { json: a, text: `${a.ref} done on ${a.done_date}` }
    },
  })
  ctx.command({
    thing: "action",
    verb: "cancel",
    summary: "cancel an action",
    args: [{ name: "action", required: true }],
    run: async ({ args }) => {
      const a: ActionRecord = await write().cancelAction!({ ref: args.action })
      return { json: a, text: `${a.ref} cancelled` }
    },
  })
  ctx.command({
    thing: "action",
    verb: "delete",
    summary: "delete an action",
    args: [{ name: "action", required: true }],
    destructive: true,
    run: async ({ args }) => {
      const a: ActionRecord = await write().deleteAction!({ ref: args.action })
      return { json: a, text: `${a.ref} deleted` }
    },
  })
}
