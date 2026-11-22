// The one-time handover of the projects plugin's actions to the actions plugin (plan Review Focus 1–3): a database
// as an older ttybrain left it (actions in projects_action, with gaps in the ids, inbox and change-set origins and
// change-set history) is opened by this one: every action keeps its id, fields, timestamps and origins, projects'
// copy is emptied, and the next action gets max(id)+1. With actions or projects off the rows wait; a row that cannot
// be moved leaves everything as it was and the move is retried at the next start.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli } from "../../../kernel/cli/dispatch"
import { fixedClock } from "../../../kernel/clock"
import { runWithContext } from "../../../kernel/context"
import { bootKernel, type Kernel } from "../../../kernel/host"
import type { PluginDef } from "../../../kernel/plugin"
import { inbox } from "../../inbox/logic/index"
import { people } from "../../people/logic/index"
import { projects } from "../../projects/logic/index"
import { actions } from "./index"

let home: string
let open: Kernel[] = []

async function boot(plugins: PluginDef[], env: Record<string, string> = {}): Promise<Kernel> {
  const k = await bootKernel({ env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1", ...env }, plugins, clock: fixedClock("2026-11-13") })
  open.push(k)
  return k
}
async function close(k: Kernel): Promise<void> {
  open = open.filter((x) => x !== k)
  await k.shutdown()
}
async function cli(k: Kernel, ...argv: string[]): Promise<{ code: number; out: string; err: string; json: any }> {
  let out = ""
  let err = ""
  const code = await runCli(argv, k, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => "" })
  let json: any
  try {
    json = JSON.parse(out)
  } catch {
    json = undefined
  }
  return { code, out, err, json }
}
async function ok(k: Kernel, ...argv: string[]) {
  const r = await cli(k, ...argv)
  if (r.code !== 0) throw new Error(`ttybrain ${argv.join(" ")} → exit ${r.code}: ${r.out}${r.err}`)
  return r
}
const all = (k: Kernel, sql: string) => k.db.raw.prepare(sql).all([]) as any[]
const ALL = [people, projects, actions, inbox]
const WITHOUT_ACTIONS = { TTYBRAIN_CONFIG_JSON: JSON.stringify({ plugins: { disabled: ["actions"] } }) }
const WITHOUT_PROJECTS = { TTYBRAIN_CONFIG_JSON: JSON.stringify({ plugins: { disabled: ["projects"] } }) }

// The legacy rows: `n` actions with gaps in the ids (1, 2, 5, 7, 8, 10, …), every combination of status, due date,
// owner (me, @peter, @bob, an unknown person 99), project (none, CRM, ERP), for person and meeting M-4, and their
// own timestamps.
type Legacy = {
  id: number
  title: string
  due_date: string | null
  status: string
  done_date: string | null
  owner_id: number | null
  project_id: number | null
  for_person_id: number | null
  meeting_id: number | null
  notes: string | null
  created_at: string
  updated_at: string
}
function legacyRows(n: number): Legacy[] {
  const out: Legacy[] = []
  let id = 0
  for (let i = 0; i < n; i++) {
    id += i % 3 === 1 ? 3 : 1
    const status = ["open", "open", "done", "cancelled"][i % 4]!
    out.push({
      id,
      title: `Action number ${id}`,
      due_date: i % 5 === 0 ? null : `2026-${String(10 + (i % 3)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
      status,
      done_date: status === "done" ? "2026-11-02" : null,
      owner_id: [null, 1, 2, 99][i % 4]!,
      project_id: [null, 1, 2][i % 3]!,
      for_person_id: i % 7 === 0 ? 1 : null,
      meeting_id: i % 6 === 0 ? 4 : null,
      notes: i % 2 === 0 ? `notes ${id}` : null,
      created_at: `2026-0${1 + (i % 9)}-15T10:${String(i % 60).padStart(2, "0")}:00`,
      updated_at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T08:00:00`,
    })
  }
  return out
}

// A database as the older ttybrain left it: people (@peter 1, @bob 2), projects (CRM 1, ERP 2), two inbox items,
// and the actions in projects_action with an inbox origin (I-1 on the first), a change-set origin (CS-1 on the
// second) and the change set's history naming projects.addAction.
async function legacyDatabase(rows: Legacy[]): Promise<void> {
  const k = await boot([people, projects, inbox], WITHOUT_ACTIONS)
  await ok(k, "person", "add", "Peter Stone", "--handle", "peter", "--stakeholder")
  await ok(k, "person", "add", "Bob Smith", "--handle", "bob", "--team")
  await ok(k, "project", "add", "CRM", "CRM replatforming")
  await ok(k, "project", "add", "ERP", "ERP upgrade")
  await ok(k, "inbox", "add", "Peter needs the budget")
  await ok(k, "inbox", "add", "Bob will chase the vendor")
  const insert = k.db.raw.prepare(
    `INSERT INTO projects_action (id, title, due_date, status, done_date, owner_id, project_id, for_person_id, meeting_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const r of rows)
    insert.run([r.id, r.title, r.due_date, r.status, r.done_date, r.owner_id, r.project_id, r.for_person_id, r.meeting_id, r.notes, r.created_at, r.updated_at])
  const [a, b] = rows
  k.db.raw.exec(`
    INSERT INTO kernel_record_origin VALUES ('action', ${a!.id}, 'inbox', 'I-1', '2026-11-01T09:00:00');
    INSERT INTO kernel_change_set VALUES (1, NULL, NULL, '2026-11-02T09:00:00');
    INSERT INTO kernel_change_set_op VALUES (1, 0, 'projects', 'addAction', '{"title":"${b!.title}"}', '+ action "${b!.title}" (me)', 'A-${b!.id}');
    INSERT INTO kernel_record_origin VALUES ('action', ${b!.id}, 'changeset', 'CS-1', '2026-11-02T09:00:00');
  `)
  await close(k)
}

// `action list --json` as the projects plugin gave it: the record of each row, by due date (none last), then id.
const handle: Record<number, string> = { 1: "@peter", 2: "@bob" }
const code: Record<number, string> = { 1: "#CRM", 2: "#ERP" }
const person = (id: number | null) => (id === null ? null : (handle[id] ?? `person:${id}`))
function expectedList(rows: Legacy[]) {
  return [...rows]
    .sort((x, y) => (x.due_date === y.due_date ? x.id - y.id : x.due_date === null ? 1 : y.due_date === null ? -1 : x.due_date < y.due_date ? -1 : 1))
    .map((r) => ({
      ref: `A-${r.id}`,
      id: r.id,
      title: r.title,
      due_date: r.due_date,
      status: r.status,
      done_date: r.done_date,
      owner_id: r.owner_id,
      owner: person(r.owner_id),
      project_id: r.project_id,
      project: r.project_id === null ? null : code[r.project_id]!,
      for_person_id: r.for_person_id,
      for: person(r.for_person_id),
      meeting_id: r.meeting_id,
      meeting: r.meeting_id === null ? null : `M-${r.meeting_id}`,
      notes: r.notes,
    }))
}
const COLUMNS = "id, title, due_date, status, done_date, owner_id, project_id, for_person_id, meeting_id, notes, created_at, updated_at"
const steps = (k: Kernel) => all(k, `SELECT plugin, id FROM kernel_plugin_migration WHERE id LIKE 'upgrade:%' ORDER BY plugin, id`)
const DONE = [
  { plugin: "actions", id: "upgrade:from-projects" },
  { plugin: "projects", id: "upgrade:actions-handover" },
]

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pm-handover-"))
})
afterEach(async () => {
  for (const k of open.reverse()) await k.shutdown()
  open = []
  rmSync(home, { recursive: true, force: true })
})

describe("actions: the handover from projects", () => {
  test("a real database upgraded: 300 actions with gaps keep their ids, fields, timestamps and origins; the next one is max+1", async () => {
    const rows = legacyRows(300)
    await legacyDatabase(rows)
    const k = await boot(ALL)
    expect(k.plugins.map((p) => [p.id, p.status, p.error ?? null])).toEqual([
      ["people", "ok", null],
      ["projects", "ok", null],
      ["actions", "ok", null],
      ["inbox", "ok", null],
    ])
    expect(all(k, `SELECT ${COLUMNS} FROM actions_action ORDER BY id`)).toEqual(rows)
    expect(all(k, `SELECT count(*) AS n FROM projects_action`)).toEqual([{ n: 0 }])
    expect(steps(k)).toEqual(DONE)
    expect(all(k, `SELECT source, rows FROM actions_handover`)).toEqual([{ source: "projects", rows: 300 }])
    // The start that moved them backed the database up first.
    expect(readdirSync(home).filter((f) => /^ttybrain\.db\.bak-v\d+$/.test(f)).length).toBe(1)

    // `action list --json` is what the projects plugin gave for the same rows.
    expect((await ok(k, "action", "list", "--json")).json).toEqual(expectedList(rows))
    // Refs resolve, gaps stay gaps.
    const [a, b] = rows
    const last = rows[rows.length - 1]!
    expect(await runWithContext(k.context(), () => k.runtime("actions")!.records.resolve(`A-${last.id}`))).toEqual({ type: "action", id: last.id })
    expect((await cli(k, "action", "done", "A-3")).code).toBe(2)
    expect((await ok(k, "action", "edit", `A-${a!.id}`, "--title", "Renamed", "--json")).json.ref).toBe(`A-${a!.id}`)
    // Origins carry over: the inbox item still lists what it became, the change set still names its op.
    const rt = k.runtime("actions")!
    expect(await runWithContext(k.context(), () => rt.provenance.originOf("action", a!.id))).toEqual({ type: "inbox", ref: "I-1" })
    expect(await runWithContext(k.context(), () => rt.provenance.originOf("action", b!.id))).toEqual({ type: "changeset", ref: "CS-1" })
    expect((await ok(k, "inbox", "show", "I-1", "--json")).json.created.map((c: any) => c.ref)).toEqual([`A-${a!.id}`])
    expect(all(k, `SELECT plugin, operation, result_ref FROM kernel_change_set_op`)).toEqual([{ plugin: "projects", operation: "addAction", result_ref: `A-${b!.id}` }])
    // The next new action follows the highest id.
    expect((await ok(k, "action", "add", "After the move", "--json")).json.ref).toBe(`A-${last.id + 1}`)
    expect((await ok(k, "project", "show", "CRM", "--json")).json.open_actions).toBe(rows.filter((r) => r.project_id === 1 && r.status === "open").length)
    await close(k)

    // Another start changes nothing.
    const again = await boot(ALL)
    expect(all(again, `SELECT count(*) AS n FROM actions_action`)).toEqual([{ n: 301 }])
    expect(all(again, `SELECT count(*) AS n FROM projects_action`)).toEqual([{ n: 0 }])
    expect(all(again, `SELECT source, rows FROM actions_handover`)).toEqual([{ source: "projects", rows: 300 }])
  })

  test("actions switched off at upgrade: projects keeps its rows and shows none; enabling actions moves them", async () => {
    const rows = legacyRows(12)
    await legacyDatabase(rows)
    const off = await boot(ALL, WITHOUT_ACTIONS)
    expect(off.plugins.find((p) => p.id === "actions")!.status).toBe("disabled")
    expect(all(off, `SELECT ${COLUMNS} FROM projects_action ORDER BY id`)).toEqual(rows)
    expect(steps(off)).toEqual([])
    // Nothing shows the waiting rows: no action commands, no counts.
    expect((await cli(off, "action", "list")).code).not.toBe(0)
    expect((await ok(off, "project", "show", "CRM", "--json")).json.open_actions).toBe(0)
    await close(off)

    const on = await boot(ALL)
    expect(all(on, `SELECT ${COLUMNS} FROM actions_action ORDER BY id`)).toEqual(rows)
    expect(all(on, `SELECT count(*) AS n FROM projects_action`)).toEqual([{ n: 0 }])
    expect(steps(on)).toEqual(DONE)
    expect((await ok(on, "action", "list", "--json")).json).toEqual(expectedList(rows))
  })

  test("projects switched off at upgrade: the rows wait in projects and move once it is back", async () => {
    const rows = legacyRows(5)
    await legacyDatabase(rows)
    const off = await boot(ALL, WITHOUT_PROJECTS)
    expect(off.plugins.find((p) => p.id === "actions")!.status).toBe("ok")
    expect(all(off, `SELECT count(*) AS n FROM actions_action`)).toEqual([{ n: 0 }])
    expect(all(off, `SELECT count(*) AS n FROM projects_action`)).toEqual([{ n: 5 }])
    expect(steps(off)).toEqual([])
    await close(off)

    const on = await boot(ALL)
    expect(all(on, `SELECT ${COLUMNS} FROM actions_action ORDER BY id`)).toEqual(rows)
    expect(all(on, `SELECT count(*) AS n FROM projects_action`)).toEqual([{ n: 0 }])
    expect(steps(on)).toEqual(DONE)
  })

  test("a row that cannot be moved: nothing moves, projects' rows stay, the step says why and runs again at the next start", async () => {
    const rows = legacyRows(20)
    await legacyDatabase(rows)
    // An older build's row with a status the actions table refuses, in the middle of the ids.
    const raw = await boot([people, projects, inbox], WITHOUT_ACTIONS)
    raw.db.raw.exec(`PRAGMA ignore_check_constraints = ON; UPDATE projects_action SET status = 'parked' WHERE id = ${rows[10]!.id}; PRAGMA ignore_check_constraints = OFF;`)
    await close(raw)

    const k = await boot(ALL)
    expect(k.plugins.find((p) => p.id === "actions")!.error).toStartWith('data step "from-projects" failed: ')
    expect(all(k, `SELECT count(*) AS n FROM actions_action`)).toEqual([{ n: 0 }])
    expect(all(k, `SELECT count(*) AS n FROM actions_handover`)).toEqual([{ n: 0 }])
    expect(all(k, `SELECT count(*) AS n FROM projects_action`)).toEqual([{ n: 20 }])
    expect(steps(k)).toEqual([])
    k.db.raw.exec(`UPDATE projects_action SET status = 'open' WHERE id = ${rows[10]!.id}`)
    await close(k)

    const next = await boot(ALL)
    expect(next.plugins.find((p) => p.id === "actions")!.error).toBeUndefined()
    expect(all(next, `SELECT count(*) AS n FROM actions_action`)).toEqual([{ n: 20 }])
    expect(all(next, `SELECT count(*) AS n FROM projects_action`)).toEqual([{ n: 0 }])
    expect(steps(next)).toEqual(DONE)
  })

  test("an id already taken in actions (added while projects was off) stops the move, naming it", async () => {
    const rows = legacyRows(3)
    await legacyDatabase(rows)
    const off = await boot(ALL, WITHOUT_PROJECTS)
    expect((await ok(off, "action", "add", "New while projects was off", "--json")).json.ref).toBe("A-1")
    await close(off)

    const k = await boot(ALL)
    expect(k.plugins.find((p) => p.id === "actions")!.error).toBe(
      'data step "from-projects" failed: cannot move the projects plugin\'s actions: A-1 already exist in the actions plugin',
    )
    expect(all(k, `SELECT id, title FROM actions_action`)).toEqual([{ id: 1, title: "New while projects was off" }])
    expect(all(k, `SELECT count(*) AS n FROM projects_action`)).toEqual([{ n: 3 }])
    expect(steps(k)).toEqual([])
  })

  test("a new database: both steps are done at the first start, with nothing to move", async () => {
    const k = await boot(ALL)
    expect(steps(k)).toEqual(DONE)
    expect(all(k, `SELECT source, rows FROM actions_handover`)).toEqual([{ source: "projects", rows: 0 }])
    expect((await ok(k, "action", "add", "First", "--json")).json.ref).toBe("A-1")
  })
})
