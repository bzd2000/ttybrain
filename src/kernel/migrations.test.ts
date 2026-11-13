import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql, type Kysely } from "kysely"
import { fixedClock } from "./clock"
import { KernelDb } from "./db/kernel-db"
import { openRaw } from "./db/sqlite"
import { IsolationError } from "./errors"
import { MigrationRunner, type Migration } from "./migrations"
import { resolvePaths, type Paths } from "./paths"

let dir: string
let paths: Paths
let kdb: KernelDb
let runner: MigrationRunner

const clock = fixedClock("2026-11-13", "10:00:00")

function boot() {
  kdb = new KernelDb(openRaw(paths.db))
  runner = new MigrationRunner(kdb, paths, clock)
}

async function reboot() {
  await kdb.close()
  boot()
  await runner.ensureKernelTables()
}

function rows(q: string): any[] {
  return kdb.raw.prepare(q).all([])
}

function applied(): any[] {
  return rows("SELECT plugin, id, applied_at FROM kernel_plugin_migration ORDER BY plugin, id")
}

function schema(): any[] {
  return rows("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name")
}

function raw(id: string, ...stmts: string[]): Migration {
  return {
    id,
    up: async (db) => {
      for (const s of stmts) await sql.raw(s).execute(db)
    },
  }
}

async function rejects(p: Promise<unknown>): Promise<IsolationError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(IsolationError)
    return e as IsolationError
  }
  throw new Error("expected an IsolationError, but the migration ran")
}

const contracts: Migration[] = [
  {
    id: "001",
    up: async (db) => {
      await db.schema.createTable("contract").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("title", "text").execute()
    },
  },
  {
    id: "002",
    up: async (db) => {
      await db.schema.createTable("party").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("name", "text").execute()
    },
  },
]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pm-mig-"))
  paths = resolvePaths({ PM_HOME: dir })
  boot()
  await runner.ensureKernelTables()
})

afterEach(async () => {
  await kdb.close()
  rmSync(dir, { recursive: true, force: true })
})

describe("kernel tables", () => {
  test("ensureKernelTables creates the four kernel tables, idempotently", async () => {
    await runner.ensureKernelTables()
    expect(rows("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").map((r) => r.name)).toEqual([
      "kernel_change_set",
      "kernel_change_set_op",
      "kernel_plugin_migration",
      "kernel_record_origin",
    ])
    expect(rows("PRAGMA table_info(kernel_plugin_migration)").map((r) => [r.name, r.pk])).toEqual([
      ["plugin", 1],
      ["id", 2],
      ["applied_at", 0],
    ])
  })
})

describe("applying", () => {
  test("the first run applies 001 and 002; a second run applies nothing", async () => {
    let calls = 0
    const counted = contracts.map((m) => ({ id: m.id, up: async (db: Kysely<any>) => (calls++, m.up(db)) }))
    expect(runner.pending("contracts", counted).map((m) => m.id)).toEqual(["001", "002"])
    await runner.run("contracts", counted, false)
    expect(calls).toBe(2)
    expect(applied()).toEqual([
      { plugin: "contracts", id: "001", applied_at: "2026-11-13T10:00:00" },
      { plugin: "contracts", id: "002", applied_at: "2026-11-13T10:00:00" },
    ])
    expect(rows("SELECT name FROM sqlite_schema WHERE name LIKE 'contracts_%' ORDER BY name")).toEqual([
      { name: "contracts_contract" },
      { name: "contracts_party" },
    ])

    await reboot()
    expect(runner.pending("contracts", counted)).toEqual([])
    await runner.run("contracts", counted, false)
    expect(calls).toBe(2)
    expect(applied().length).toBe(2)
  })

  test("a migration that throws leaves no table and no kernel_plugin_migration row", async () => {
    const failing: Migration = {
      id: "001",
      up: async (db) => {
        await db.schema.createTable("contract").addColumn("id", "integer", (c) => c.primaryKey()).execute()
        throw new Error("boom")
      },
    }
    await expect(runner.run("contracts", [failing], false)).rejects.toThrow("boom")
    expect(rows("SELECT name FROM sqlite_schema WHERE name LIKE 'contracts_%'")).toEqual([])
    expect(applied()).toEqual([])
    expect(kdb.raw.inTransaction()).toBe(false)
  })

  test("a failed migration stops the plugin's later migrations; earlier ones stay applied", async () => {
    const later: Migration = { id: "003", up: async () => {} }
    await expect(runner.run("contracts", [...contracts.slice(0, 1), raw("002", "SELECT no_such_fn()"), later], false)).rejects.toThrow()
    expect(applied().map((r) => r.id)).toEqual(["001"])
  })

  test("a table created earlier in a migration is usable by its short name later in the same migration", async () => {
    const m: Migration = {
      id: "001",
      up: async (db) => {
        await db.schema.createTable("contract").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("title", "text").execute()
        await db.insertInto("contract").values({ id: 1, title: "SaaS licence" }).execute()
        await db.updateTable("contract").set({ title: "SaaS licence 2" }).where("id", "=", 1).execute()
      },
    }
    await runner.run("contracts", [m], false)
    let seen: unknown
    await runner.run("contracts", [m, { id: "002", up: async (db) => void (seen = await db.selectFrom("contract").selectAll().execute()) }], false)
    expect(seen).toEqual([{ id: 1, title: "SaaS licence 2" }])
  })

  test("the db handed to a migration cannot change the schema after the migration", async () => {
    let kept: Kysely<any> | undefined
    await runner.run("contracts", [{ id: "001", up: async (db) => void (kept = db) }], false)
    await rejects(kept!.schema.createTable("late").addColumn("id", "integer").execute())
    expect(rows("SELECT name FROM sqlite_schema WHERE name LIKE 'contracts_%'")).toEqual([])
  })

  test("own triggers and views are allowed for built-in plugins", async () => {
    await runner.run(
      "contracts",
      [
        ...contracts,
        raw(
          "003",
          "CREATE TABLE contracts_log (id INTEGER PRIMARY KEY, contract_id INTEGER REFERENCES contracts_contract(id))",
          "CREATE TRIGGER contracts_t AFTER UPDATE ON contracts_contract BEGIN INSERT INTO contracts_log (contract_id) VALUES (new.id); END",
          "CREATE VIEW contracts_v AS SELECT c.id, p.name FROM contracts_contract c JOIN contracts_party p ON p.id = c.id",
          "CREATE UNIQUE INDEX contracts_contract_title ON contracts_contract(title)",
        ),
      ],
      false,
    )
    expect(applied().map((r) => r.id)).toEqual(["001", "002", "003"])
  })
})

describe("schema checks", () => {
  // `projects` owns a table with a trigger; the kernel published projects.project as a view.
  beforeEach(async () => {
    await runner.run(
      "projects",
      [
        raw(
          "001",
          "CREATE TABLE projects_project (id INTEGER PRIMARY KEY, code TEXT, updated_at TEXT)",
          "CREATE TRIGGER projects_trg AFTER UPDATE OF code ON projects_project BEGIN UPDATE projects_project SET updated_at = 'x' WHERE id = new.id; END",
        ),
      ],
      false,
    )
    kdb.raw.exec("CREATE VIEW projects__pub_project AS SELECT id, code FROM projects_project")
    kdb.invalidateSchema()
  })

  async function rejected(migration: Migration, external = false): Promise<IsolationError> {
    const before = schema()
    const e = await rejects(runner.run("contracts", [contracts[0]!, { ...migration, id: "002" }], external))
    // Rolled back: only contracts 001 is applied and the other plugin's objects are untouched.
    expect(schema().filter((o) => !o.name.startsWith("contracts_"))).toEqual(before.filter((o) => !o.name.startsWith("contracts_")))
    expect(rows("SELECT name FROM sqlite_schema WHERE name LIKE 'contracts_%' ORDER BY name")).toEqual([{ name: "contracts_contract" }])
    expect(applied().filter((r) => r.plugin === "contracts").map((r) => r.id)).toEqual(["001"])
    return e
  }

  test("an external migration creating a trigger rolls back with IsolationError", async () => {
    const e = await rejected(
      raw("002", "CREATE TABLE contracts_log (id INTEGER PRIMARY KEY)", "CREATE TRIGGER contracts_t AFTER INSERT ON contracts_log BEGIN SELECT 1; END"),
      true,
    )
    expect(e.message).toContain("external plugins may not create triggers")
  })

  test("R10a: dropping another plugin's published view", async () => {
    const e = await rejected(raw("002", "DROP VIEW projects__pub_project"))
    expect(e.message).toContain('"projects__pub_project"')
  })

  test("R10a: dropping another plugin's trigger", async () => {
    const e = await rejected(raw("002", "DROP TRIGGER projects_trg"))
    expect(e.message).toContain('"projects_trg"')
  })

  test("R10a: an object without the plugin's prefix", async () => {
    const e = await rejected(raw("002", "CREATE TABLE stray (id INTEGER PRIMARY KEY)"))
    expect(e.message).toContain('"stray"')
  })

  test("R10b: a trigger on another plugin's table, even for a built-in plugin", async () => {
    const e = await rejected(raw("002", "CREATE TRIGGER contracts_t AFTER UPDATE ON projects_project BEGIN SELECT 1; END"))
    expect(e.message).toContain('"projects_project"')
  })

  test("R10b: an own trigger whose body writes another plugin's table", async () => {
    const e = await rejected(
      raw("002", "CREATE TRIGGER contracts_t AFTER INSERT ON contracts_contract BEGIN DELETE FROM projects_project; END"),
    )
    expect(e.message).toContain('"projects_project"')
  })

  test("R10c: a view over another plugin's table", async () => {
    const e = await rejected(raw("002", "CREATE VIEW contracts_v AS SELECT * FROM projects_project"))
    expect(e.message).toContain('"projects_project"')
  })

  test("R10c: a view over another plugin's published view", async () => {
    const e = await rejected(raw("002", "CREATE VIEW contracts_v AS SELECT * FROM projects__pub_project"))
    expect(e.message).toContain('"projects_project"')
  })

  test("an own-named index on another plugin's table", async () => {
    const e = await rejected(raw("002", "CREATE INDEX contracts_i ON projects_project(code)"))
    expect(e.message).toContain('"projects_project"')
  })

  test("R11a: run rejects a plugin id that is not [a-z][a-z0-9-]*", async () => {
    for (const id of ["my_plugin", "Contracts", "1st", ""]) {
      const e = await rejects(runner.run(id, contracts, false))
      expect(e.message).toContain(`plugin id "${id}"`)
    }
    expect(applied().filter((r) => r.plugin !== "projects")).toEqual([])
  })

  test("R11b: an own table whose short name starts with the plugin id and _", async () => {
    const e = await rejected({
      id: "002",
      up: async (db) => {
        await db.schema.createTable("contracts_x").addColumn("id", "integer", (c) => c.primaryKey()).execute()
      },
    })
    expect(e.message).toContain('"contracts_contracts_x"')
  })

  test("R11c: a foreign key to another plugin's table", async () => {
    const e = await rejected(raw("002", "CREATE TABLE contracts_c (id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects_project(id))"))
    expect(e.message).toContain("foreign key")
    expect(e.message).toContain('"projects_project"')
  })

  test("R11c: a foreign key to another plugin's published view", async () => {
    const e = await rejected(raw("002", "CREATE TABLE contracts_c (id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects__pub_project(id))"))
    expect(e.message).toContain('"projects__pub_project"')
  })

  test("a name reserved for the kernel (<id>__*)", async () => {
    const e = await rejected(raw("002", "CREATE VIEW contracts__pub_fake AS SELECT * FROM contracts_contract"))
    expect(e.message).toContain('"contracts__pub_fake"')
  })

  test("a change that bypassed layer 2 is still caught by the schema diff", async () => {
    const e = await rejected({ id: "002", up: async () => kdb.raw.exec("ALTER TABLE projects_project ADD COLUMN extra TEXT") })
    expect(e.message).toContain('"projects_project"')
  })

  test("temporary schema objects are rejected", async () => {
    const e = await rejected({ id: "002", up: async () => kdb.raw.exec("CREATE TEMP TABLE contracts_tmp (x)") })
    expect(e.message).toContain("temporary")
  })
})

describe("backup", () => {
  test("pm.db.bak-v2 exists after adding 003 to a DB with 2 applied", async () => {
    await runner.run("contracts", contracts, false)
    await reboot()
    await runner.run("contracts", [...contracts, raw("003", "CREATE TABLE contracts_c (id INTEGER PRIMARY KEY)")], false)
    expect(readdirSync(dir).filter((f) => f.includes(".bak-"))).toEqual(["pm.db.bak-v2"])
  })

  test("the backup is a copy from before the first migration of the boot, made once per boot", async () => {
    await runner.run("contracts", contracts, false)
    await runner.run("first", [raw("001", "CREATE TABLE first_t (id INTEGER PRIMARY KEY)")], false)
    // A database created in this boot is not an existing one: nothing to back up, even for the second plugin.
    expect(readdirSync(dir).filter((f) => f.includes(".bak-"))).toEqual([])

    await reboot()
    const third = raw("003", "CREATE TABLE contracts_c (id INTEGER PRIMARY KEY)")
    await runner.run("contracts", [...contracts, third], false)
    const bak = `${paths.db}.bak-v3`
    expect(existsSync(bak)).toBe(true)
    const copy = openRaw(bak)
    try {
      expect(copy.prepare("SELECT plugin, id FROM kernel_plugin_migration ORDER BY plugin, id").all([])).toEqual([
        { plugin: "contracts", id: "001" },
        { plugin: "contracts", id: "002" },
        { plugin: "first", id: "001" },
      ])
      expect(copy.prepare("SELECT name FROM sqlite_schema WHERE name = 'contracts_c'").all([])).toEqual([])
    } finally {
      copy.close()
    }

    // Once per boot: the next plugin's migrations in the same boot add no second backup.
    await runner.run("other", [raw("001", "CREATE TABLE other_t (id INTEGER PRIMARY KEY)")], false)
    expect(readdirSync(dir).filter((f) => f.includes(".bak-")).sort()).toEqual(["pm.db.bak-v3"])
  })

  test("no backup when nothing is pending", async () => {
    await runner.run("contracts", contracts, false)
    await reboot()
    await runner.run("contracts", contracts, false)
    runner.backupIfNeeded("contracts", contracts)
    expect(readdirSync(dir).filter((f) => f.includes(".bak-"))).toEqual([])
  })
})

describe("concurrent first boot", () => {
  test("two processes migrating a new DB at the same time apply each migration once", async () => {
    await kdb.close()
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), "pm-mig-"))
    paths = resolvePaths({ PM_HOME: dir })
    const child = join(import.meta.dir, "../../tests/fixtures/migrate-child.ts")
    const start = String(Date.now() + 300)
    const procs = [0, 1].map(() => Bun.spawn(["bun", child, dir, start], { stdout: "pipe", stderr: "pipe" }))
    const codes = await Promise.all(procs.map((p) => p.exited))
    const errs = await Promise.all(procs.map((p) => new Response(p.stderr).text()))
    expect({ codes, errs }).toEqual({ codes: [0, 0], errs: ["", ""] })
    boot()
    expect(rows("SELECT plugin, id, count(*) AS n FROM kernel_plugin_migration GROUP BY plugin, id ORDER BY plugin, id")).toEqual([
      { plugin: "contracts", id: "001", n: 1 },
      { plugin: "contracts", id: "002", n: 1 },
    ])
  })
})
