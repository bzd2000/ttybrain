// `ttybrain action list|show|add|edit|link|unlink|done|cancel|delete`. Reads go through ctx.data (the own tables,
// people through people.person, projects through projects.project); writes only through ctx.self().write.*. An
// empty owner is me, shown as `me`. `--link <ref>` (repeatable) names any record; `--project`, `--for` and
// `--meeting` are shorthand for a link of that type.
import { addDays, currentContext, formatTable, parseRef, ValidationError, weekEnd, type FlagDef, type PluginContext } from "@ttybrain/api"
import { byDue, isMe } from "./ops"
import { LINK_HINT, type ActionRecord, type Store, type Target } from "./records"

const text = (description: string, placeholder?: string): FlagDef => ({ type: "string", description, ...(placeholder ? { placeholder } : {}) })
const bool = (description: string): FlagDef => ({ type: "boolean", description })
const links = (description: string): FlagDef => ({ type: "string", repeatable: true, description, placeholder: "ref" })
const COLUMNS = ["ref", "title", "project", "owner", "for", "due", "status"]

// Only the flags that were given, renamed to op input fields.
function pick(flags: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [flag, field] of Object.entries(map)) if (flags[flag] !== undefined) out[field] = flags[flag]
  return out
}
const FIELDS = { due: "due", owner: "owner", project: "project", for: "forPerson", meeting: "meeting", link: "links", notes: "notes" }

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

// `action show`: the title line, then one `  label: value` line per field that has a value.
function showText(a: ActionRecord): string {
  const lines = [`${a.ref} ${a.title}`]
  const field = (label: string, v: string | null) => v && lines.push(`  ${label}: ${v}`)
  field("status", a.status === "done" && a.done_date ? `done (${a.done_date})` : a.status)
  field("owner", a.owner ?? "me")
  field("due", a.due_date)
  field("links", a.links.map((l) => l.ref).join(", ") || null)
  field("notes", a.notes)
  return lines.join("\n")
}

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
      project: text("only actions linked to this project", "code"),
      for: text("only actions linked to this person", "handle"),
      meeting: text("only actions linked to this meeting", "M-n"),
      link: links("only actions linked to this record (repeatable: any of them)"),
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
      const only = (t: Target) => (q = q.where(store.linkedTo([t])))
      if (flags.project !== undefined) only({ type: "project", id: (await store.project(String(flags.project))).id })
      if (flags.for !== undefined) only({ type: "person", id: (await store.person(String(flags.for))).id })
      if (flags.meeting !== undefined) {
        const n = parseRef(String(flags.meeting), "M-")
        if (n === null) throw new ValidationError(`invalid meeting "${String(flags.meeting).trim()}"`, { field: "meeting", hint: "a meeting ref, e.g. M-4" })
        only({ type: "meeting", id: n })
      }
      if (flags.link !== undefined) {
        const targets: Target[] = []
        for (const ref of flags.link as string[]) {
          const t = await store.lookup(ref)
          if (t === null) throw new ValidationError(`unknown record "${ref.trim()}"`, { field: "links", hint: LINK_HINT })
          targets.push(t)
        }
        q = q.where(store.linkedTo(targets))
      }
      const list = (await store.toActions(await q.orderBy("a.id").execute())).sort(byDue)
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

  ctx.command({
    thing: "action",
    verb: "show",
    summary: "show an action with its links",
    args: [{ name: "action", required: true }],
    run: async ({ args }) => {
      const a = await store.find(String(args.action))
      return { json: a, text: showText(a) }
    },
  })

  const fieldFlags = {
    owner: text("the owner (a person; empty or me: you)", "handle"),
    project: text("link to this project", "code"),
    for: text("link to the stakeholder it is for", "handle"),
    meeting: text("link to the meeting it comes from", "M-n"),
    notes: text("notes", "text"),
  }
  ctx.command({
    thing: "action",
    verb: "add",
    summary: "add an action (no --owner: it is yours)",
    args: [{ name: "title", required: true }],
    flags: { due: { type: "date", description: "the due date" }, ...fieldFlags, link: links("link to this record (repeatable): #CRM, @anna, M-4") },
    run: async ({ args, flags }) => {
      const a: ActionRecord = await write().addAction!({ title: args.title, ...pick(flags, FIELDS) })
      return { json: a, text: line(a) }
    },
  })
  ctx.command({
    thing: "action",
    verb: "edit",
    summary: "change an action; an empty value clears a field (an empty --owner makes it yours, an empty --project unlinks its projects)",
    args: [{ name: "action", required: true }],
    flags: {
      title: text("the title", "title"),
      due: text("the due date (empty: none)", "date"),
      ...fieldFlags,
      link: links("its links, replacing them all (repeatable): #CRM, @anna, M-4"),
    },
    run: async ({ args, flags }) => {
      const a: ActionRecord = await write().editAction!({ ref: args.action, ...pick(flags, { ...FIELDS, title: "title" }) })
      return { json: a, text: line(a) }
    },
  })
  ctx.command({
    thing: "action",
    verb: "link",
    summary: "link an action to a record (#CRM, @anna, M-4)",
    args: [
      { name: "action", required: true },
      { name: "record", required: true },
    ],
    run: async ({ args }) => {
      const a: ActionRecord = await write().linkAction!({ ref: args.action, to: args.record })
      return { json: a, text: `${a.ref} linked to ${a.links[a.links.length - 1]!.ref}` }
    },
  })
  ctx.command({
    thing: "action",
    verb: "unlink",
    summary: "remove a link from an action",
    args: [
      { name: "action", required: true },
      { name: "record", required: true },
    ],
    run: async ({ args }) => {
      const before = await store.find(String(args.action))
      const a: ActionRecord = await write().unlinkAction!({ ref: args.action, to: args.record })
      const gone = before.links.find((l) => !a.links.some((x) => x.type === l.type && x.id === l.id))
      return { json: a, text: `${a.ref} unlinked from ${gone?.ref ?? String(args.record).trim()}` }
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
