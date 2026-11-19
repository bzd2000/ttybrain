// The meetings reports (spec §8): `board` (`ttybrain report board <M-n>`: attendees, agenda, then one block per covered
// project, made of projects' `project-status` sections run through ctx.reports, plus the asks) and `minutes`
// (`ttybrain report minutes <M-n>`: attendees, notes, and the decisions and actions linked to the meeting). The reads
// `prep` (per agenda item: its project's status sections and the since) and `report` (a rendered report) serve the TUI.
import { NonBlank, Type, type Cell, type PluginContext, type ReportSectionResult, type Static } from "@pm/api"
import type { Store } from "./records"
import type { MeetingRecord as Meeting } from "./schema"
import { sinceFor, type SinceResult } from "./since"

type Row = Record<string, Cell>
type Block = { code: string; name: string; since: SinceResult; sections: ReportSectionResult[] }

const MeetingParams = Type.Object({ meeting: Type.String({ description: "the meeting (M-n)" }) })

// The shape of a report section, for the `prep` output.
const CellSchema = Type.Union([Type.String(), Type.Number(), Type.Null()])
const Tone = Type.Union([Type.Literal("red"), Type.Literal("amber"), Type.Literal("green"), Type.Literal("muted")])
const MarkSchema = Type.Object({ icon: Type.Optional(Type.String()), tone: Type.Optional(Tone) })
const SectionSchema = Type.Object({
  title: Type.String(),
  columns: Type.Array(Type.String()),
  rows: Type.Array(Type.Record(Type.String(), CellSchema)),
  empty: Type.String(),
  note: Type.Optional(Type.String()),
  group: Type.Optional(Type.String()),
  marks: Type.Optional(Type.Array(Type.Union([MarkSchema, Type.Null()]))),
  text: Type.Optional(Type.String()),
})
const SinceSchema = Type.Object({
  since: Type.String(),
  source: Type.Union([Type.Literal("meeting"), Type.Literal("previous"), Type.Literal("default")]),
  previous: Type.Union([Type.Object({ ref: Type.String(), title: Type.String(), date: Type.String() }), Type.Null()]),
})
const PrepInput = Type.Object({ meeting: NonBlank() })
const PrepEntry = Type.Object({
  position: Type.Integer(),
  text: Type.String(),
  project: Type.Union([Type.String(), Type.Null()]),
  ask: Type.Union([Type.String(), Type.Null()]),
  since: Type.Union([SinceSchema, Type.Null()]),
  sections: Type.Array(SectionSchema),
})
const ReportInput = Type.Object({
  meeting: NonBlank(),
  kind: Type.Union([Type.Literal("board"), Type.Literal("minutes")]),
  format: Type.Union([Type.Literal("md"), Type.Literal("text"), Type.Literal("json")]),
})
const ReportOutput = Type.Object({ text: Type.String(), title: Type.String() })
type PrepEntry = Static<typeof PrepEntry>
type ReportInput = Static<typeof ReportInput>

const bare = (code: string | null) => (code === null ? null : code.replace(/^#/, ""))

export function registerReports(ctx: PluginContext, store: Store): void {
  const db = ctx.data

  // The meeting's attendees with their names, in the meeting's (handle) order.
  async function attendees(m: Meeting): Promise<ReportSectionResult> {
    const handles = m.attendees.map((h) => h.slice(1))
    const people =
      handles.length === 0
        ? []
        : await store.unlessUnavailable([] as Array<{ handle: unknown; name: unknown }>, () =>
            db.selectFrom("people.person").select(["handle", "name"]).where("handle", "in", handles).execute(),
          )
    const nameOf = new Map(people.map((p) => [String(p.handle), String(p.name)]))
    return {
      title: "Attendees",
      columns: ["Name", "Handle"],
      rows: m.attendees.map((h) => ({ Name: nameOf.get(h.slice(1)) ?? null, Handle: h })),
      empty: "No attendees.",
    }
  }

  // One block per project the agenda covers, in agenda order: its since and its project-status sections.
  async function blocks(m: Meeting): Promise<Map<number, Block>> {
    const covered = new Map<number, string>()
    for (const item of m.agenda) if (item.project_id !== null && item.project !== null && !covered.has(item.project_id)) covered.set(item.project_id, item.project)
    const names =
      covered.size === 0
        ? []
        : await store.unlessUnavailable([] as Array<{ id: unknown; name: unknown }>, () =>
            db.selectFrom("projects.project").select(["id", "name"]).where("id", "in", [...covered.keys()]).execute(),
          )
    const nameOf = new Map(names.map((r) => [Number(r.id), String(r.name)]))
    const out = new Map<number, Block>()
    for (const [id, ref] of covered) {
      const code = bare(ref)!
      const since = await sinceFor(store, m, id)
      const params = { project: code, since: since.since, reference: m.date, ...(since.previous ? { "previous-meeting": since.previous.ref } : {}) }
      const { sections } = await ctx.reports.run("project-status", params)
      out.set(id, { code, name: nameOf.get(id) ?? code, since, sections })
    }
    return out
  }

  // ---- board ----

  ctx.report({
    id: "board",
    cliName: "board",
    title: (m: Meeting) => `${m.title} · ${m.date}`,
    params: MeetingParams,
    describe: "a meeting's board pack: attendees, agenda with asks, then the status of each project on the agenda",
    prepare: (p: { meeting: string }) => store.meeting(p.meeting), // an unknown meeting fails the command (exit 2)
  })
  ctx.reportSection("board", { id: "attendees", order: 10, run: attendees })
  ctx.reportSection("board", {
    id: "agenda",
    order: 20,
    run: async (m: Meeting) => ({
      title: "Agenda",
      columns: ["#", "Item", "Project", "Ask"],
      rows: m.agenda.map((i) => ({ "#": i.position, Item: i.text, Project: bare(i.project), Ask: i.ask })),
      empty: "No agenda yet.",
    }),
  })
  ctx.reportSection("board", {
    id: "projects",
    order: 30,
    run: async (m: Meeting) => {
      const out: ReportSectionResult[] = []
      for (const [id, b] of await blocks(m)) {
        const group = `${b.code} ${b.name} · since ${b.since.since}`
        out.push(...b.sections.map((s) => ({ ...s, group })))
        const asks: Row[] = m.agenda.filter((i) => i.project_id === id && i.ask !== null).map((i) => ({ "#": i.position, Ask: i.ask }))
        if (asks.length) out.push({ title: "Ask", columns: ["#", "Ask"], rows: asks, empty: "", group })
      }
      return out
    },
  })

  // ---- minutes ----

  ctx.report({
    id: "minutes",
    cliName: "minutes",
    title: (m: Meeting) => `Minutes · ${m.title} · ${m.date}`,
    params: MeetingParams,
    describe: "a meeting's minutes: attendees, notes, and the decisions and actions linked to it",
    prepare: (p: { meeting: string }) => store.meeting(p.meeting),
  })
  ctx.reportSection("minutes", { id: "attendees", order: 10, run: attendees })
  ctx.reportSection("minutes", {
    id: "notes",
    order: 20,
    run: async (m: Meeting) => {
      const has = m.notes.trim() !== ""
      return { title: "Notes", columns: [], rows: [], empty: has ? "" : "No notes.", ...(has ? { text: m.notes } : {}) }
    },
  })
  ctx.reportSection("minutes", {
    id: "decisions",
    order: 30,
    run: async (m: Meeting) => {
      const rows = await db
        .selectFrom("projects.decision as d")
        .leftJoin("projects.project as p", "p.id", "d.project_id")
        .select(["d.id", "d.title", "d.date", "p.code"])
        .where("d.meeting_id", "=", m.id)
        .orderBy("d.id")
        .execute()
      const out: Row[] = []
      for (const r of rows)
        out.push({ ID: await ctx.records.refOf("decision", Number(r.id)), Decision: String(r.title), Project: r.code === null ? null : String(r.code), Date: r.date === null ? null : String(r.date) })
      return { title: "Decisions", columns: ["ID", "Decision", "Project", "Date"], rows: out, empty: "No decisions." }
    },
  })
  ctx.reportSection("minutes", {
    id: "actions",
    order: 40,
    run: async (m: Meeting) => {
      const rows = await db
        .selectFrom("projects.action as a")
        .leftJoin("projects.project as p", "p.id", "a.project_id")
        .leftJoin("people.person as o", "o.id", "a.owner_id")
        .select(["a.id", "a.title", "a.due_date", "a.owner_id", "p.code", "o.handle"])
        .where("a.meeting_id", "=", m.id)
        .orderBy("a.id")
        .execute()
      const owner = (r: (typeof rows)[number]) => (r.owner_id === null ? "me" : r.handle === null ? `person:${r.owner_id}` : `@${r.handle}`)
      const out: Row[] = []
      for (const r of rows)
        out.push({
          ID: await ctx.records.refOf("action", Number(r.id)),
          Action: String(r.title),
          Owner: owner(r),
          Due: r.due_date === null ? null : String(r.due_date),
          Project: r.code === null ? null : String(r.code),
        })
      return { title: "Actions", columns: ["ID", "Action", "Owner", "Due", "Project"], rows: out, empty: "No actions." }
    },
  })

  // ---- reads ----

  ctx.expose({
    read: {
      prep: {
        input: PrepInput,
        output: Type.Array(PrepEntry),
        toolDescription: "A meeting's prep, per agenda item in order: its project's status sections (since the last held meeting covering it) and the ask.",
        run: async (i: { meeting: string }): Promise<PrepEntry[]> => {
          const m = await store.meeting(i.meeting)
          const byProject = await blocks(m)
          return m.agenda.map((item) => {
            const b = item.project_id === null ? undefined : byProject.get(item.project_id)
            return { position: item.position, text: item.text, project: item.project, ask: item.ask, since: b?.since ?? null, sections: b?.sections ?? [] }
          })
        },
      },
      report: {
        input: ReportInput,
        output: ReportOutput,
        toolDescription: "A meeting's board pack or minutes, rendered as Markdown, text or JSON.",
        run: async (i: ReportInput) => {
          const result = await ctx.reports.run(i.kind, { meeting: i.meeting })
          return { text: ctx.reports.render(result, i.format), title: result.title }
        },
      },
    },
  })
}
