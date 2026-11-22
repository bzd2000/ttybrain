// Migration 002 turns the fixed project_id / for_person_id / meeting_id columns into links. Seeded on the 001 shape
// (the plugin booted without 002), then booted again with it: every link is there, every row keeps its id and
// other columns, the origins still name the same records, and the foreign keys hold.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli } from "../../../kernel/cli/dispatch"
import { fixedClock } from "../../../kernel/clock"
import { bootKernel, type Kernel } from "../../../kernel/host"
import type { PluginContext, PluginDef } from "../../../kernel/plugin"
import { meetings } from "../../meetings/logic/index"
import { people } from "../../people/logic/index"
import { projects } from "../../projects/logic/index"
import { actions } from "./index"

let home: string
let k: Kernel | undefined

// The actions plugin as Task 2 left it: migration 001 only.
const before002: PluginDef = {
  ...actions,
  activate(ctx: PluginContext) {
    const migration: PluginContext["migration"] = (id, up) => (id === "002" ? undefined : ctx.migration(id, up))
    return actions.activate(new Proxy(ctx, { get: (t, p) => (p === "migration" ? migration : Reflect.get(t, p)) }))
  },
}

const boot = (plugins: PluginDef[]) => bootKernel({ env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1" }, plugins, clock: fixedClock("2026-11-13") })
const rows = (q: string) => k!.db.raw.prepare(q).all([]) as any[]
const KEPT = "id, title, due_date, status, done_date, owner_id, notes, created_at, updated_at"

afterEach(async () => {
  await k?.shutdown()
  k = undefined
  rmSync(home, { recursive: true, force: true })
})

describe("actions migration 002: links", () => {
  test("copies project, for person and meeting into links, then drops the columns; rows, ids and origins intact", async () => {
    home = mkdtempSync(join(tmpdir(), "pm-actions-mig002-"))
    k = await boot([people, before002]) // without projects, so the handover waits
    expect(rows("SELECT id FROM kernel_plugin_migration WHERE plugin = 'actions' AND id NOT LIKE 'upgrade:%'").map((r) => r.id)).toEqual(["001"])
    // Ids with gaps, every combination of the three columns, an unknown person (99) and a meeting that never existed.
    k.db.raw.exec(`
      INSERT INTO actions_action (id, title, due_date, status, done_date, owner_id, project_id, for_person_id, meeting_id, notes, created_at, updated_at) VALUES
        (1, 'Nothing linked', NULL, 'open', NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00', '2026-01-02T00:00:00'),
        (3, 'All three', '2026-11-20', 'open', NULL, 2, 1, 1, 4, 'n3', '2026-01-03T00:00:00', '2026-01-04T00:00:00'),
        (4, 'Project only', '2026-11-01', 'done', '2026-11-02', NULL, 2, NULL, NULL, NULL, '2026-01-05T00:00:00', '2026-01-06T00:00:00'),
        (9, 'For only', NULL, 'cancelled', NULL, 99, NULL, 99, NULL, 'n9', '2026-01-07T00:00:00', '2026-01-08T00:00:00'),
        (12, 'Meeting only', NULL, 'open', NULL, NULL, NULL, NULL, 7, NULL, '2026-01-09T00:00:00', '2026-01-10T00:00:00');
      INSERT INTO kernel_record_origin VALUES ('action', 3, 'inbox', 'I-1', '2026-11-01T09:00:00');
    `)
    const kept = rows(`SELECT ${KEPT} FROM actions_action ORDER BY id`)
    await k.shutdown()

    k = await boot([people, projects, meetings, actions])
    expect(k.plugins.map((p) => [p.id, p.status, p.error ?? null])).toEqual([
      ["people", "ok", null],
      ["projects", "ok", null],
      ["actions", "ok", null],
      ["meetings", "ok", null],
    ])
    expect(rows("SELECT id FROM kernel_plugin_migration WHERE plugin = 'actions' AND id NOT LIKE 'upgrade:%' ORDER BY id").map((r) => r.id)).toEqual(["001", "002"])
    expect(rows(`SELECT ${KEPT} FROM actions_action ORDER BY id`)).toEqual(kept)
    expect(rows("SELECT name FROM pragma_table_info('actions_action') ORDER BY cid").map((r) => r.name)).toEqual(KEPT.split(", "))
    expect(rows("SELECT action_id, record_type, record_id FROM actions_link ORDER BY action_id, id")).toEqual([
      { action_id: 3, record_type: "project", record_id: 1 },
      { action_id: 3, record_type: "person", record_id: 1 },
      { action_id: 3, record_type: "meeting", record_id: 4 },
      { action_id: 4, record_type: "project", record_id: 2 },
      { action_id: 9, record_type: "person", record_id: 99 },
      { action_id: 12, record_type: "meeting", record_id: 7 },
    ])
    expect(rows("PRAGMA foreign_key_list(actions_link)").map((r) => [r.from, r.table, r.to, r.on_delete])).toEqual([["action_id", "actions_action", "id", "NO ACTION"]])
    expect(rows("PRAGMA foreign_key_check")).toEqual([])
    expect(rows("SELECT name FROM sqlite_schema WHERE type = 'index' AND name LIKE 'actions_%' AND sql IS NOT NULL ORDER BY name").map((r) => r.name)).toEqual([
      "actions_action_status",
      "actions_link_record",
    ])
    expect(rows("SELECT name FROM sqlite_schema WHERE name LIKE 'actions_action%' AND type = 'table'").map((r) => r.name)).toEqual(["actions_action"])
    expect(rows("SELECT record_type, record_id, origin_ref FROM kernel_record_origin")).toEqual([{ record_type: "action", record_id: 3, origin_ref: "I-1" }])
    // A unique link per record: the same one twice is refused by the table.
    expect(() => k!.db.raw.exec("INSERT INTO actions_link (action_id, record_type, record_id) VALUES (3, 'project', 1)")).toThrow(/UNIQUE/)
    // The next action follows the highest id; the handover found nothing to move.
    let out = ""
    expect(await runCli(["action", "add", "After", "--json"], k, { out: (s) => void (out += s), err: () => {}, stdin: async () => "" })).toBe(0)
    expect(JSON.parse(out).ref).toBe("A-13")
  })
})
