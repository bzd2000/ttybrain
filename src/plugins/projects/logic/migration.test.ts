// Migration 002 rebuilds `project` for codes of up to 16 characters. Seeded on the 001 schema (the plugin booted
// without 002), then booted again with it: every row, id, link and constraint survives.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fixedClock } from "../../../kernel/clock"
import { runWithContext } from "../../../kernel/context"
import { bootKernel, type Kernel } from "../../../kernel/host"
import type { PluginContext, PluginDef } from "../../../kernel/plugin"
import { people } from "../../people/logic/index"
import { projects } from "./index"

let home: string
let k: Kernel | undefined

// The projects plugin as it was before migration 002.
const before002: PluginDef = {
  ...projects,
  activate(ctx: PluginContext) {
    const migration: PluginContext["migration"] = (id, up) => (id === "002" ? undefined : ctx.migration(id, up))
    return projects.activate(new Proxy(ctx, { get: (t, p) => (p === "migration" ? migration : Reflect.get(t, p)) }))
  },
}

const boot = (plugin: PluginDef) =>
  bootKernel({ env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1" }, plugins: [people, plugin], clock: fixedClock("2026-11-13") })
const rows = (q: string) => k!.db.raw.prepare(q).all([]) as any[]
const TABLES = ["project", "health_update", "milestone", "deliverable", "risk", "decision", "action", "involvement"]
const dump = () => Object.fromEntries(TABLES.map((t) => [t, rows(`SELECT * FROM projects_${t} ORDER BY id`)]))
const foreignKeys = () => Object.fromEntries(TABLES.map((t) => [t, rows(`PRAGMA foreign_key_list(projects_${t})`).map((r) => [r.from, r.table, r.to])]))
const indexes = () => rows("SELECT name, tbl_name, sql FROM sqlite_schema WHERE type = 'index' AND name LIKE 'projects_%' ORDER BY name")

afterEach(async () => {
  await k?.shutdown()
  k = undefined
  rmSync(home, { recursive: true, force: true })
})

describe("projects migration 002: codes of up to 16 characters", () => {
  test("rebuilds project keeping rows, ids, links, indexes and constraints", async () => {
    home = mkdtempSync(join(tmpdir(), "pm-mig002-"))
    k = await boot(before002)
    expect(k.plugins.map((p) => `${p.id} ${p.status}`)).toEqual(["people ok", "projects ok"])
    expect(rows("SELECT id FROM kernel_plugin_migration WHERE plugin = 'projects'").map((r) => r.id)).toEqual(["001"])
    const w = (id: string) => k!.ops.api(id)!.write
    await runWithContext(k.context(), async () => {
      await w("people").addPerson!({ name: "Anna Smit", handle: "anna", is_team: true })
      await w("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
      await w("projects").addProject!({ code: "ERP2", name: "ERP upgrade" })
      await w("projects").addProject!({ code: "DATAHUB1", name: "Data hub" })
      await w("projects").setHealth!({ project: "ERP2", health: "amber", comment: "Late" })
      await w("projects").addMilestone!({ project: "ERP2", title: "Go-live", due: "2026-12-01" })
      await w("projects").addDeliverable!({ project: "ERP2", title: "Cutover plan", milestone: "MS-1", owner: "@anna" })
      await w("projects").addRisk!({ project: "CRM", title: "Vendor lock-in", type: "risk", severity: "high", owner: "@anna" })
      await w("projects").addDecision!({ project: "DATAHUB1", title: "Use Postgres" })
      await w("projects").addAction!({ title: "Call vendor", project: "CRM", owner: "@anna" })
      await w("projects").addAction!({ title: "No project" })
      await w("projects").addAction!({ title: "Plan cutover", project: "ERP2" })
      await w("projects").addInvolvement!({ project: "ERP2", person: "@anna", role: "lead" })
    })
    const data = dump()
    const fks = foreignKeys()
    const idx = indexes()
    expect(rows("SELECT sql FROM sqlite_schema WHERE name = 'projects_project'")[0].sql).toContain("between 2 and 8")
    await k.shutdown()

    k = await boot(projects)
    expect(k.plugins.map((p) => `${p.id} ${p.status}`)).toEqual(["people ok", "projects ok"])
    expect(rows("SELECT id FROM kernel_plugin_migration WHERE plugin = 'projects' ORDER BY id").map((r) => r.id)).toEqual(["001", "002"])
    const sqlNow = rows("SELECT sql FROM sqlite_schema WHERE name = 'projects_project'")[0].sql as string
    expect(sqlNow).toContain("length(code) between 2 and 16 and code not glob '*[^A-Z0-9]*'")
    expect(dump()).toEqual(data)
    expect(foreignKeys()).toEqual(fks)
    expect(fks.action).toEqual([["project_id", "projects_project", "id"]])
    expect(indexes()).toEqual(idx)
    expect(rows("PRAGMA foreign_key_check")).toEqual([])
    expect(rows("SELECT name FROM sqlite_schema WHERE name LIKE 'projects_project%' ORDER BY name").map((r) => r.name)).toEqual([
      "projects_project",
    ])
    // The published view reads the rebuilt table, links included.
    expect(rows(`SELECT code, open_actions, open_risks FROM "projects__pub_project" ORDER BY code`)).toEqual([
      { code: "CRM", open_actions: 1, open_risks: 1 },
      { code: "DATAHUB1", open_actions: 0, open_risks: 0 },
      { code: "ERP2", open_actions: 1, open_risks: 0 },
    ])

    // Codes stay unique; a 16-character code goes in, a 17-character one is refused by the CHECK itself.
    const insert = (code: string) =>
      k!.db.raw.exec(`INSERT INTO projects_project (code, name, created_at, updated_at) VALUES ('${code}', 'x', 'now', 'now')`)
    expect(() => insert("CRM")).toThrow(/UNIQUE/)
    insert("DATAPLATFORM2027")
    expect(() => insert("DATAPLATFORM20271")).toThrow(/CHECK/)
    expect(() => insert("crm2")).toThrow(/CHECK/)
    expect(() => k!.db.raw.exec("INSERT INTO projects_action (title, status, project_id, created_at, updated_at) VALUES ('x', 'open', 99, 'n', 'n')")).toThrow(
      /FOREIGN KEY/,
    )
    expect(() => k!.db.raw.exec("DELETE FROM projects_project WHERE code = 'CRM'")).toThrow(/FOREIGN KEY/)
  })
})
