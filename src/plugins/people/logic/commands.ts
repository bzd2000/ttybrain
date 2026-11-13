// `pm person|note|goal …`. Reads go through ctx.data (own tables and views); writes only through
// ctx.self().write.*, so they are validated, transactional and recorded like any other caller's.
import { formatTable, ValidationError, type FlagDef, type PluginContext } from "../../../kernel/api"
import type { Store } from "./records"
import { LEVELS, NOTE_KINDS, type GoalRecord, type NoteRecord, type PersonRecord } from "./schema"

const text = (description: string, placeholder?: string): FlagDef => ({ type: "string", description, ...(placeholder ? { placeholder } : {}) })
const bool = (description: string): FlagDef => ({ type: "boolean", description })

const personFlags: Record<string, FlagDef> = {
  handle: text("the handle ([a-z0-9-]+; default: the first name)", "handle"),
  team: bool("a member of your team"),
  "no-team": bool("not a member of your team"),
  stakeholder: bool("a stakeholder"),
  "no-stakeholder": bool("not a stakeholder (clears influence and interest)"),
  org: text("organisation", "name"),
  title: text("job title", "title"),
  email: text("e-mail address", "address"),
  phone: text("phone number", "number"),
  influence: { type: "string", values: [...LEVELS], description: "influence (stakeholders only)" },
  interest: { type: "string", values: [...LEVELS], description: "interest (stakeholders only)" },
}

// The person flags as op input fields: only those given.
function personInput(flags: Record<string, unknown>): Record<string, unknown> {
  const pairs = (a: string, b: string, field: string) => {
    if (flags[a] && flags[b]) throw new ValidationError(`use --${a} or --${b}, not both`, { field: a })
    return flags[a] ? { [field]: true } : flags[b] ? { [field]: false } : {}
  }
  const map: Record<string, string> = { handle: "handle", org: "organisation", title: "job_title", email: "email", phone: "phone", influence: "influence", interest: "interest" }
  const out: Record<string, unknown> = { ...pairs("team", "no-team", "is_team"), ...pairs("stakeholder", "no-stakeholder", "is_stakeholder") }
  for (const [flag, field] of Object.entries(map)) if (flags[flag] !== undefined) out[field] = flags[flag]
  return out
}

const roleOf = (p: { is_team: boolean; is_stakeholder: boolean }) => [p.is_team ? "team" : "", p.is_stakeholder ? "stakeholder" : ""].filter(Boolean).join(", ")
const kindText = (k: string) => (k === "one_on_one" ? "1:1" : k)

function personText(p: PersonRecord): string {
  const lines = [`${p.ref} ${p.name}${p.archived ? " (archived)" : ""}`]
  const field = (label: string, v: string | null) => v && lines.push(`  ${label}: ${v}`)
  field("role", roleOf(p) || null)
  field("organisation", p.organisation)
  field("job title", p.job_title)
  field("email", p.email)
  field("phone", p.phone)
  field("influence", p.influence)
  field("interest", p.interest)
  field("last contact", p.last_contact)
  return lines.join("\n")
}

const goalRow = (g: GoalRecord) => ({ ref: g.ref, title: g.title, target: g.target_date, status: g.status })

export function registerCommands(ctx: PluginContext, store: Store): void {
  const write = () => ctx.self().write

  async function noteRows(notes: NoteRecord[]) {
    const codes = await store.projectCodes([...new Set(notes.map((n) => n.project_id).filter((x): x is number => x !== null))])
    return notes.map((n) => ({
      ref: n.ref,
      date: n.date,
      person: n.person,
      kind: kindText(n.kind),
      project: n.project_id === null ? "" : (codes.get(n.project_id) ?? `#${n.project_id}`),
      text: n.text,
    }))
  }

  // ---- person
  ctx.command({
    thing: "person",
    verb: "list",
    summary: "list people (stakeholders by influence, then oldest contact first)",
    flags: { team: bool("team members only"), stakeholders: bool("stakeholders only"), archived: bool("archived people only") },
    run: async ({ flags }) => {
      if (flags.team && flags.stakeholders) throw new ValidationError("use --team or --stakeholders, not both", { field: "team" })
      let q = ctx.data
        .selectFrom("people.person")
        .selectAll()
        .where("archived", "=", flags.archived ? 1 : 0)
      if (flags.team) q = q.where("is_team", "=", 1)
      if (flags.stakeholders) q = q.where("is_stakeholder", "=", 1)
      const rows = (await q.orderBy("name").orderBy("id").execute()).map((r: any) => ({
        ref: `@${r.handle}`,
        id: Number(r.id),
        handle: String(r.handle),
        name: String(r.name),
        organisation: r.organisation ?? null,
        job_title: r.job_title ?? null,
        email: r.email ?? null,
        is_team: Number(r.is_team) === 1,
        is_stakeholder: Number(r.is_stakeholder) === 1,
        influence: r.influence ?? null,
        interest: r.interest ?? null,
        last_contact: r.last_contact ?? null,
        archived: Number(r.archived) === 1,
      }))
      if (flags.stakeholders)
        rows.sort(
          (a, b) => Number(b.influence === "high") - Number(a.influence === "high") || String(a.last_contact ?? "").localeCompare(String(b.last_contact ?? "")),
        )
      const table = rows.map((p) => ({ ...p, role: roleOf(p), "last contact": p.last_contact, title: p.job_title, org: p.organisation }))
      return {
        json: rows,
        text: rows.length ? formatTable(["ref", "name", "role", "org", "title", "influence", "interest", "last contact"], table) : "no people",
      }
    },
  })

  ctx.command({
    thing: "person",
    verb: "show",
    summary: "show a person with their notes and goals",
    args: [{ name: "person", required: true }],
    run: async ({ args }) => {
      const p = await store.person(String(args.person))
      const notes = (await store.noteQuery().where("n.person_id", "=", p.id).orderBy("n.date", "desc").orderBy("n.id", "desc").execute()).map(store.toNote)
      const goals = (await store.goalQuery().where("g.person_id", "=", p.id).orderBy("g.id").execute()).map(store.toGoal)
      const blocks = [personText(p)]
      if (goals.length) blocks.push(`Goals\n${formatTable(["ref", "title", "target", "status"], goals.map(goalRow))}`)
      if (notes.length) blocks.push(`Notes\n${formatTable(["ref", "date", "kind", "project", "text"], await noteRows(notes))}`)
      return { json: { ...p, notes, goals }, text: blocks.join("\n\n") }
    },
  })

  ctx.command({
    thing: "person",
    verb: "add",
    summary: "add a person",
    args: [{ name: "name", required: true }],
    flags: personFlags,
    run: async ({ args, flags }) => {
      const p: PersonRecord = await write().addPerson!({ name: args.name, ...personInput(flags) })
      return { json: p, text: `${p.ref} ${p.name}` }
    },
  })

  ctx.command({
    thing: "person",
    verb: "edit",
    summary: "change a person's fields",
    args: [{ name: "person", required: true }],
    flags: { name: text("full name", "name"), ...personFlags },
    run: async ({ args, flags }) => {
      const input = { ref: args.person, ...personInput(flags), ...(flags.name !== undefined ? { name: flags.name } : {}) }
      const p: PersonRecord = await write().editPerson!(input)
      return { json: p, text: personText(p) }
    },
  })

  for (const [verb, op, summary] of [
    ["archive", "archivePerson", "archive a person (people are never deleted)"],
    ["restore", "restorePerson", "restore an archived person"],
  ] as const) {
    ctx.command({
      thing: "person",
      verb,
      summary,
      args: [{ name: "person", required: true }],
      run: async ({ args }) => {
        const p: PersonRecord = await write()[op]!({ ref: args.person })
        return { json: p, text: `${p.ref} ${verb}d` }
      },
    })
  }

  // ---- note
  ctx.command({
    thing: "note",
    verb: "list",
    summary: "list notes, newest first",
    flags: {
      person: text("only notes on this person", "handle"),
      project: text("only notes about this project", "code"),
      kind: { type: "string", values: [...NOTE_KINDS], description: "only this kind" },
    },
    run: async ({ flags }) => {
      let q = store.noteQuery()
      if (flags.person !== undefined) q = q.where("n.person_id", "=", (await store.person(String(flags.person))).id)
      if (flags.project !== undefined) q = q.where("n.project_id", "=", await store.projectId(String(flags.project)))
      if (flags.kind !== undefined) q = q.where("n.kind", "=", String(flags.kind))
      const notes = (await q.orderBy("n.date", "desc").orderBy("n.id", "desc").execute()).map(store.toNote)
      return { json: notes, text: notes.length ? formatTable(["ref", "date", "person", "kind", "project", "text"], await noteRows(notes)) : "no notes" }
    },
  })

  ctx.command({
    thing: "note",
    verb: "add",
    summary: "add a 1:1 or interaction note on a person",
    args: [
      { name: "person", required: true },
      { name: "text", required: true },
    ],
    flags: {
      "1on1": bool("a 1:1 with a team member"),
      interaction: bool("any other contact (a stakeholder conversation, a concern raised)"),
      date: { type: "date", description: "the date (default: today)" },
      project: text("the project it is about", "code"),
    },
    run: async ({ args, flags }) => {
      if (Boolean(flags["1on1"]) === Boolean(flags.interaction)) throw new ValidationError("pass --1on1 or --interaction", { field: "kind" })
      const n: NoteRecord = await write().addNote!({
        person: args.person,
        kind: flags["1on1"] ? "one_on_one" : "interaction",
        text: args.text,
        ...(flags.date !== undefined ? { date: flags.date } : {}),
        ...(flags.project !== undefined ? { project: flags.project } : {}),
      })
      return { json: n, text: `${n.ref} ${kindText(n.kind)} with ${n.person} on ${n.date}` }
    },
  })

  ctx.command({
    thing: "note",
    verb: "edit",
    summary: "replace a note's text",
    args: [
      { name: "note", required: true },
      { name: "text", required: true },
    ],
    run: async ({ args }) => {
      const n: NoteRecord = await write().editNote!({ ref: args.note, text: args.text })
      return { json: n, text: `${n.ref} updated` }
    },
  })

  ctx.command({
    thing: "note",
    verb: "delete",
    summary: "delete a note",
    args: [{ name: "note", required: true }],
    destructive: true,
    run: async ({ args }) => {
      const out = await write().deleteNote!({ ref: args.note })
      return { json: out, text: `${out.ref} deleted` }
    },
  })

  // ---- goal
  ctx.command({
    thing: "goal",
    verb: "list",
    summary: "list a person's goals",
    args: [{ name: "person", required: true }],
    run: async ({ args }) => {
      const p = await store.person(String(args.person))
      const goals = (await store.goalQuery().where("g.person_id", "=", p.id).orderBy("g.id").execute()).map(store.toGoal)
      return { json: goals, text: goals.length ? formatTable(["ref", "title", "target", "status"], goals.map(goalRow)) : `no goals for ${p.ref}` }
    },
  })

  ctx.command({
    thing: "goal",
    verb: "add",
    summary: "add a goal for a person",
    args: [
      { name: "person", required: true },
      { name: "title", required: true },
    ],
    flags: { target: { type: "date", description: "target date" }, notes: text("notes") },
    run: async ({ args, flags }) => {
      const g: GoalRecord = await write().addGoal!({
        person: args.person,
        title: args.title,
        ...(flags.target !== undefined ? { target_date: flags.target } : {}),
        ...(flags.notes !== undefined ? { notes: flags.notes } : {}),
      })
      return { json: g, text: `${g.ref} ${g.title} (${g.person})` }
    },
  })

  ctx.command({
    thing: "goal",
    verb: "edit",
    summary: "change a goal's title, target date or notes",
    args: [{ name: "goal", required: true }],
    flags: { title: text("title", "title"), target: { type: "date", description: "target date" }, notes: text("notes") },
    run: async ({ args, flags }) => {
      const g: GoalRecord = await write().editGoal!({
        ref: args.goal,
        ...(flags.title !== undefined ? { title: flags.title } : {}),
        ...(flags.target !== undefined ? { target_date: flags.target } : {}),
        ...(flags.notes !== undefined ? { notes: flags.notes } : {}),
      })
      return { json: g, text: `${g.ref} ${g.title}` }
    },
  })

  for (const [verb, status, summary] of [
    ["done", "achieved", "mark a goal achieved"],
    ["drop", "dropped", "drop a goal"],
  ] as const) {
    ctx.command({
      thing: "goal",
      verb,
      summary,
      args: [{ name: "goal", required: true }],
      run: async ({ args }) => {
        const g: GoalRecord = await write().setGoalStatus!({ ref: args.goal, status })
        return { json: g, text: `${g.ref} ${g.status}` }
      },
    })
  }
}
