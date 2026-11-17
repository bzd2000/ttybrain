import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { sql, type Kysely } from "kysely"
import { IsolationError } from "../errors"
import { PmConnection, PmDriver } from "./driver"
import { KernelDb, kyselyOver } from "./kernel-db"
import type { TableAccess } from "./scope"
import { openRaw } from "./sqlite"

let kdb: KernelDb
const PRAGMAS = ["query_only", "ignore_check_constraints", "recursive_triggers", "trusted_schema"]
const pragmas = (r: { prepare(s: string): { all(p: unknown[]): any[] } }) =>
  Object.fromEntries(PRAGMAS.map((p) => [p, Object.values(r.prepare(`PRAGMA ${p}`).all([])[0])[0]]))
const PRAGMA_ATTACKS = [
  "PRAGMA query_only=1",
  "PRAGMA ignore_check_constraints=1",
  "PRAGMA recursive_triggers=1",
  "PRAGMA trusted_schema=OFF",
  "/* x */ PRAGMA query_only=1",
  "-- x\n  pragma query_only = 1",
]
let contracts: Kysely<any>
let migrating = false

const owners: Record<string, string> = {
  contract: "contracts",
  party: "contracts",
  project: "projects",
  contracts_contract: "contracts",
  contracts_party: "contracts",
  projects_project: "projects",
}

function access(): TableAccess {
  return {
    ownTables: () => new Set(["contract", "party"]),
    views: () =>
      new Map([["projects.project", { physical: "projects__pub_project", columns: ["id", "code"], baseTables: ["projects_project"] }]]),
    migrating: () => migrating,
    ownerOf: (name) => owners[name],
    // Migration mode requires both hooks; these tests check layers 1 and 2 alone.
    ownsPhysical: () => true,
    afterSchemaChange: () => {},
  }
}

async function rejects(p: () => Promise<unknown>): Promise<IsolationError> {
  try {
    await p()
  } catch (e) {
    expect(e).toBeInstanceOf(IsolationError)
    return e as IsolationError
  }
  throw new Error("expected an IsolationError, but the query ran")
}

beforeEach(() => {
  migrating = false
  kdb = new KernelDb(openRaw(":memory:"))
  kdb.raw.exec(`
    CREATE TABLE contracts_contract (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT NOT NULL, value INTEGER);
    CREATE TABLE contracts_party (id INTEGER PRIMARY KEY, contract_id INTEGER, name TEXT);
    CREATE TABLE projects_project (id INTEGER PRIMARY KEY, code TEXT, internal_col TEXT);
    CREATE TABLE kernel_plugin_migration (plugin TEXT, id TEXT);
    CREATE VIEW projects__pub_project AS SELECT id, code FROM projects_project;
    INSERT INTO projects_project VALUES (1, 'CRM', 'hidden'), (2, 'ERP', 'hidden');
    INSERT INTO contracts_contract VALUES (1, 1, 'SaaS licence', 120), (2, 1, 'Implementation', 300), (3, 2, 'Support', 80);
    INSERT INTO contracts_party VALUES (1, 1, 'Vendor B'), (2, 2, 'Integrator C');
  `)
  contracts = kdb.pluginDb("contracts", access())
})

afterEach(async () => {
  await kdb.close()
})

describe("allowed", () => {
  test("select, where and order on an own table", async () => {
    const rows = await contracts
      .selectFrom("contract")
      .select(["id", "title", "value"])
      .where("value", ">", 100)
      .orderBy("value", "desc")
      .execute()
    expect(rows).toEqual([
      { id: 2, title: "Implementation", value: 300 },
      { id: 1, title: "SaaS licence", value: 120 },
    ])
  })

  test("countAll and sum", async () => {
    const row = await contracts
      .selectFrom("contract")
      .select((eb) => [eb.fn.countAll().as("n"), eb.fn.sum("value").as("total")])
      .executeTakeFirst()
    expect(row).toEqual({ n: 3, total: 500 })
  })

  test("select aliases can be ordered by", async () => {
    const rows = await contracts
      .selectFrom("contract")
      .select(["project_id", (eb) => eb.fn.countAll().as("n")])
      .groupBy("project_id")
      .orderBy("n", "desc")
      .execute()
    expect(rows).toEqual([
      { project_id: 1, n: 2 },
      { project_id: 2, n: 1 },
    ])
  })

  test("a join of own tables through aliases", async () => {
    const rows = await contracts
      .selectFrom("contract as c")
      .innerJoin("party as p", "p.contract_id", "c.id")
      .select(["c.title", "p.name"])
      .orderBy("c.id")
      .execute()
    expect(rows).toEqual([
      { title: "SaaS licence", name: "Vendor B" },
      { title: "Implementation", name: "Integrator C" },
    ])
  })

  test("insert and update (inside a write operation)", async () => {
    await kdb.write(async () => {
      const ins = await contracts.insertInto("contract").values({ project_id: 2, title: "Hosting", value: 50 }).executeTakeFirst()
      expect(ins.insertId).toBe(4n)
      const upd = await contracts.updateTable("contract").set({ value: 130 }).where("id", "=", 1).executeTakeFirst()
      expect(upd.numUpdatedRows).toBe(1n)
    }, { op: true })
    expect(kdb.raw.prepare("SELECT title, value FROM contracts_contract WHERE id IN (1, 4) ORDER BY id").all([])).toEqual([
      { title: "SaaS licence", value: 130 },
      { title: "Hosting", value: 50 },
    ])
  })

  test("a join of an own table with a published view", async () => {
    const rows = await contracts
      .selectFrom("contract")
      .innerJoin("projects.project as pr", "pr.id", "contract.project_id")
      .select(["contract.title", "pr.code"])
      .orderBy("contract.id")
      .execute()
    expect(rows).toEqual([
      { title: "SaaS licence", code: "CRM" },
      { title: "Implementation", code: "CRM" },
      { title: "Support", code: "ERP" },
    ])
  })

  test("schema statements inside a migration are prefixed", async () => {
    migrating = true
    await contracts.schema.createTable("x").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("name", "text").execute()
    await contracts.schema.createIndex("x_name").on("x").column("name").execute()
    const objs = kdb.raw.prepare("SELECT type, name, tbl_name FROM sqlite_schema WHERE name LIKE 'contracts_x%' ORDER BY name").all([])
    expect(objs).toEqual([
      { type: "table", name: "contracts_x", tbl_name: "contracts_x" },
      { type: "index", name: "contracts_x_name", tbl_name: "contracts_x" },
    ])
  })
})

describe("rejected", () => {
  test("selectFrom another plugin's table names its owner", async () => {
    const e = await rejects(() => contracts.selectFrom("project").selectAll().execute())
    expect(e.message).toBe('table "project" is not owned by plugin "contracts"; read projects.project if published, or use projects.<operation>')
  })

  test("a join with another plugin's table", async () => {
    await rejects(() =>
      contracts.selectFrom("contract").innerJoin("project", "project.id", "contract.project_id").selectAll().execute(),
    )
  })

  test("updateTable on another plugin's table", async () => {
    await rejects(() => contracts.updateTable("project").set({ code: "X" }).execute())
    expect(kdb.raw.prepare("SELECT code FROM projects_project WHERE id = 1").all([])).toEqual([{ code: "CRM" }])
  })

  test("a sub-query on another plugin's table", async () => {
    await rejects(() =>
      contracts
        .selectFrom("contract")
        .selectAll()
        .where("project_id", "in", (eb: any) => eb.selectFrom("project").select("id"))
        .execute(),
    )
  })

  test("updateTable on a published view is read-only", async () => {
    const e = await rejects(() => contracts.updateTable("projects.project").set({ code: "X" }).execute())
    expect(e.message).toBe("projects.project is a published view and is read-only")
  })

  test("a write through a view's physical name is read-only too", async () => {
    const e = await rejects(() => contracts.updateTable("projects__pub_project").set({ code: "X" }).execute())
    expect(e.message).toBe("projects.project is a published view and is read-only")
  })

  test("an unpublished view name", async () => {
    const e = await rejects(() => contracts.selectFrom("projects.secret").selectAll().execute())
    expect(e.message).toContain("projects.secret")
  })

  test("raw SQL on another plugin's table (layer 2)", async () => {
    const e = await rejects(() => sql`SELECT * FROM projects_project`.execute(contracts))
    expect(e.message).toBe('plugin "contracts" may not use table "projects_project"')
  })

  test("raw SQL on a kernel table (layer 2)", async () => {
    await rejects(() => sql`SELECT * FROM kernel_plugin_migration`.execute(contracts))
  })

  test("a column the view does not publish", async () => {
    const e = await rejects(() => contracts.selectFrom("projects.project").select("internal_col").execute())
    expect(e.message).toBe('unknown column "internal_col"')
  })

  test("createTable outside a migration", async () => {
    const e = await rejects(() => contracts.schema.createTable("x").addColumn("id", "integer").execute())
    expect(e.message).toBe("schema changes are only allowed in migrations")
  })

  test("raw DDL outside a migration (layer 2)", async () => {
    const e = await rejects(() => sql`CREATE TABLE contracts_y (id INTEGER)`.execute(contracts))
    expect(e.message).toBe("schema changes are only allowed in migrations")
  })

  test("raw transaction control", async () => {
    const e = await rejects(() => sql`BEGIN`.execute(contracts))
    expect(e.message).toBe("transactions are managed by the kernel")
  })

  test("raw PRAGMA", async () => {
    await rejects(() => sql`PRAGMA foreign_keys = OFF`.execute(contracts))
    expect(kdb.raw.prepare("PRAGMA foreign_keys").all([])).toEqual([{ foreign_keys: 1 }])
  })

  test("kysely.transaction()", async () => {
    await rejects(() => contracts.transaction().execute(async () => {}))
  })
})

describe("nested builder queries", () => {
  test("a ctx.data sub-query over an own table", async () => {
    const rows = await contracts
      .selectFrom("contract")
      .select("title")
      .where("id", "in", contracts.selectFrom("party").select("contract_id"))
      .orderBy("id")
      .execute()
    expect(rows).toEqual([{ title: "SaaS licence" }, { title: "Implementation" }])
  })

  test("a ctx.data sub-query over a published view", async () => {
    const rows = await contracts
      .selectFrom("contract")
      .select("title")
      .where("project_id", "in", contracts.selectFrom("projects.project").select("id").where("code", "=", "ERP"))
      .execute()
    expect(rows).toEqual([{ title: "Support" }])
  })

  test("insert ... select with a ctx.data expression", async () => {
    await kdb.write(() =>
      contracts
        .insertInto("contract")
        .columns(["project_id", "title", "value"])
        .expression(contracts.selectFrom("party").select([(eb) => eb.val(9).as("project_id"), "name", (eb) => eb.val(1).as("value")]))
        .execute(),
      { op: true },
    )
    expect(kdb.raw.prepare("SELECT title FROM contracts_contract WHERE project_id = 9 ORDER BY id").all([])).toEqual([
      { title: "Vendor B" },
      { title: "Integrator C" },
    ])
  })

  test("createTable and createView as a ctx.data query in a migration", async () => {
    migrating = true
    await contracts.schema.createTable("w").as(contracts.selectFrom("projects.project").select(["id", "code"])).execute()
    await contracts.schema.createView("v").as(contracts.selectFrom("contract").select(["id", "title"]).where("value", ">", 100)).execute()
    expect(kdb.raw.prepare("SELECT code FROM contracts_w ORDER BY id").all([])).toEqual([{ code: "CRM" }, { code: "ERP" }])
    expect(kdb.raw.prepare("SELECT title FROM contracts_v ORDER BY id").all([])).toEqual([
      { title: "SaaS licence" },
      { title: "Implementation" },
    ])
  })

  test("a sub-query built with another plugin's ctx.data is checked again", async () => {
    const projects = kdb.pluginDb("projects", {
      ownTables: () => new Set(["project"]),
      views: () => new Map(),
      migrating: () => false,
      ownerOf: (name) => owners[name],
    })
    const e = await rejects(() =>
      contracts
        .selectFrom("contract")
        .selectAll()
        .where("project_id", "in", projects.selectFrom("project").select("id").where("internal_col", "=", "hidden"))
        .execute(),
    )
    expect(e.message).toBe('table "projects_project" is not owned by plugin "contracts"; read projects.project if published, or use projects.<operation>')
  })
})

describe("no leaking between queries", () => {
  test("a query that used projects.project and failed does not allow projects_project afterwards", async () => {
    // Passes layer 1 (uses the view) but fails while running: SQLite has no such function.
    await expect(
      contracts.selectFrom("projects.project").select(sql`no_such_fn(1)`.as("x")).execute(),
    ).rejects.toThrow()
    await rejects(() => sql`SELECT * FROM projects_project`.execute(contracts))
  })

  test("a layer 1 failure on the view does not allow projects_project afterwards", async () => {
    await rejects(() => contracts.selectFrom("projects.project").select("internal_col").execute())
    await rejects(() => sql`SELECT * FROM projects_project`.execute(contracts))
  })
})

describe("reserved plugin ids", () => {
  test("pluginDb refuses kernel and sqlite", () => {
    for (const id of ["kernel", "sqlite"]) expect(() => kdb.pluginDb(id, access())).toThrow(IsolationError)
  })

  test("layer 2 never treats kernel_* or sqlite_* as own, even for a connection named kernel", async () => {
    migrating = true
    const conn = new PmConnection(kdb.raw, "kernel", { ...access(), ownTables: () => new Set(["plugin_migration"]) }, kdb.tables, () => {})
    const db = kyselyOver(new PmDriver(conn))
    await rejects(() => sql`DROP TABLE kernel_plugin_migration`.execute(db))
    await rejects(() => sql`SELECT * FROM kernel_plugin_migration`.execute(db))
    expect(kdb.raw.prepare("SELECT name FROM sqlite_schema WHERE name = 'kernel_plugin_migration'").all([])).toEqual([
      { name: "kernel_plugin_migration" },
    ])
  })
})

describe("migration mode fails closed without its hooks", () => {
  function bare(): TableAccess {
    const { ownsPhysical: _o, afterSchemaChange: _a, ...rest } = access()
    return rest
  }

  test("pluginDb refuses an access that is migrating without ownsPhysical/afterSchemaChange", () => {
    migrating = true
    expect(() => kdb.pluginDb("contracts", bare())).toThrow("migration mode requires the ownsPhysical and afterSchemaChange hooks")
    expect(() => kdb.pluginDb("contracts", { ...access(), afterSchemaChange: undefined })).toThrow(IsolationError)
    expect(() => kdb.pluginDb("contracts", { ...access(), ownsPhysical: undefined })).toThrow(IsolationError)
  })

  test("an access that switches to migrating later is refused at query time, before anything runs", async () => {
    const db = kdb.pluginDb("contracts", bare())
    migrating = true
    const e = await rejects(() => db.schema.createTable("x").addColumn("id", "integer").execute())
    expect(e.message).toBe("migration mode requires the ownsPhysical and afterSchemaChange hooks")
    await rejects(() => sql`CREATE TABLE contracts_y (id INTEGER)`.execute(db))
    await rejects(() => db.selectFrom("contract").selectAll().execute())
    expect(kdb.raw.prepare("SELECT name FROM sqlite_schema WHERE name IN ('contracts_x', 'contracts_y')").all([])).toEqual([])
  })
})

describe("pragmas never reach prepare", () => {
  test("raw sql PRAGMA through a plugin's db is rejected, outside and inside migration mode", async () => {
    const before = pragmas(kdb.raw)
    for (const m of [false, true]) {
      migrating = m
      for (const q of PRAGMA_ATTACKS) await rejects(() => sql.raw(q).execute(contracts))
    }
    expect(pragmas(kdb.raw)).toEqual(before)
  })

  test("a plugin-bundled Kysely spoofing a schema node kind with a PRAGMA is rejected in migration mode", async () => {
    migrating = true
    const before = pragmas(kdb.raw)
    const conn = new PmConnection(kdb.raw, "contracts", access(), kdb.tables, () => {})
    for (const q of PRAGMA_ATTACKS) {
      await rejects(() => conn.executeQuery({ sql: q, parameters: [], query: { kind: "CreateTableNode" } } as any))
    }
    expect(pragmas(kdb.raw)).toEqual(before)
  })

  test("legitimate DML and migration DDL still pass", async () => {
    await kdb.write(() => sql`UPDATE contracts_contract SET value = value + 1 WHERE id = 1`.execute(contracts), { op: true })
    expect(await contracts.selectFrom("contract").select("value").where("id", "=", 1).executeTakeFirst()).toEqual({ value: 121 })
    migrating = true
    await sql`/* own */ CREATE TABLE contracts_extra (id INTEGER PRIMARY KEY)`.execute(contracts)
    expect(kdb.raw.prepare("SELECT name FROM sqlite_schema WHERE name = 'contracts_extra'").all([])).toEqual([{ name: "contracts_extra" }])
  })
})

describe("data changes need a write (R15)", () => {
  const OUTSIDE = "data changes must run inside a write operation"
  const count = () => kdb.raw.prepare("SELECT count(*) AS n FROM contracts_contract").all([])[0]!.n

  test("insert, update, delete and raw REPLACE outside a write are rejected; reads are not", async () => {
    for (const q of [
      () => contracts.insertInto("contract").values({ title: "x" }).execute(),
      () => contracts.updateTable("contract").set({ value: 1 }).execute(),
      () => contracts.deleteFrom("contract").where("id", "=", 1).execute(),
      () => contracts.replaceInto("contract").values({ id: 1, title: "x" }).execute(),
      () => sql`INSERT INTO contracts_contract (title) VALUES ('x')`.execute(contracts),
    ]) {
      const e = await rejects(q)
      expect(e.message).toBe(OUTSIDE)
    }
    expect(count()).toBe(3)
    expect(await contracts.selectFrom("contract").select("id").execute()).toHaveLength(3)
  })

  test("the table checks still come first: a foreign table outside a write names the table", async () => {
    const e = await rejects(() => contracts.updateTable("project").set({ code: "X" }).execute())
    expect(e.message).not.toBe(OUTSIDE)
  })

  test("the same insert inside a write operation runs", async () => {
    await kdb.write(() => contracts.insertInto("contract").values({ title: "x" }).execute(), { op: true })
    expect(count()).toBe(4)
  })

  test("a bare kernel write that is not an operation (the TUI's act, a change set) does not allow it", async () => {
    await expect(kdb.write(() => contracts.insertInto("contract").values({ title: "x" }).execute())).rejects.toThrow(OUTSIDE)
    await expect(kdb.write(() => sql`DELETE FROM contracts_contract`.execute(contracts))).rejects.toThrow(OUTSIDE)
    expect(count()).toBe(3)
  })

  test("inside a bare write, an operation's nested scope allows it, and the bare scope still does not afterwards", async () => {
    await kdb.write(async () => {
      await kdb.write(() => contracts.insertInto("contract").values({ title: "op" }).execute(), { op: true })
      // a kernel transaction nested inside the operation inherits the operation's scope
      await kdb.write(() => kdb.transaction(() => contracts.insertInto("contract").values({ title: "op-tx" }).execute()), { op: true })
      await expect(contracts.insertInto("contract").values({ title: "bare" }).execute()).rejects.toThrow(OUTSIDE)
    })
    expect(count()).toBe(5)
  })

  test("a kernel transaction that is not a write (a view build) does not allow it either", async () => {
    await expect(kdb.transaction(() => contracts.insertInto("contract").values({ title: "x" }).execute())).rejects.toThrow(OUTSIDE)
    expect(count()).toBe(3)
  })

  test("migrations are unaffected", async () => {
    migrating = true
    await kdb.transaction(async () => {
      await contracts.insertInto("contract").values({ title: "seed" }).execute()
      await contracts.updateTable("contract").set({ value: 0 }).where("title", "=", "seed").execute()
    })
    expect(count()).toBe(4)
  })
})
