import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { sql, type Kysely } from "kysely"
import { KernelDb } from "./db/kernel-db"
import type { TableAccess } from "./db/scope"
import { openRaw } from "./db/sqlite"
import { IsolationError, PmError, ValidationError, ViewUnavailableError } from "./errors"
import { ownTablesOf } from "./migrations"
import { ViewRegistry, type ViewDef } from "./views"

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
let views: ViewRegistry

// The people plugin's `person` view, as in the spec (§3.3.3), on a reduced table.
const person: ViewDef = {
  version: 1,
  columns: { id: "integer", handle: "text", name: "text", last_contact: "date", archived: "boolean" },
  query: (db) =>
    db.selectFrom("person as p").select([
      "p.id",
      "p.handle",
      "p.name",
      (eb) => eb.selectFrom("note").whereRef("note.person_id", "=", "p.id").select((e) => e.fn.max("date").as("d")).as("last_contact"),
      (eb) => eb("p.archived_at", "is not", null).as("archived"),
    ]),
}

function reader(pluginId: string): Kysely<any> {
  const access: TableAccess = {
    ownTables: () => ownTablesOf(kdb, pluginId),
    views: () => views.forReader(pluginId),
    reads: () => views.readsOf(pluginId),
    migrating: () => false,
    ownerOf: () => undefined,
  }
  return kdb.pluginDb(pluginId, access)
}

function viewNames(): string[] {
  return kdb.raw
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'view' ORDER BY name")
    .all([])
    .map((r) => String(r.name))
}

async function error<E>(p: () => Promise<unknown>, type: new (...a: any[]) => E): Promise<E> {
  try {
    await p()
  } catch (e) {
    expect(e).toBeInstanceOf(type)
    return e as E
  }
  throw new Error(`expected ${type.name}`)
}

beforeEach(() => {
  kdb = new KernelDb(openRaw(":memory:"))
  kdb.raw.exec(`
    CREATE TABLE people_person (id INTEGER PRIMARY KEY, handle TEXT, name TEXT, archived_at TEXT);
    CREATE TABLE people_note (id INTEGER PRIMARY KEY, person_id INTEGER, date TEXT);
    CREATE TABLE projects_action (id INTEGER PRIMARY KEY, title TEXT, owner_id INTEGER);
    INSERT INTO people_person VALUES (1, 'anna', 'Anna', NULL), (2, 'peter', 'Peter', '2026-10-01');
    INSERT INTO people_note VALUES (1, 1, '2026-11-02'), (2, 1, '2026-11-10');
    INSERT INTO projects_action VALUES (1, 'Send contract', 1), (2, 'Book room', 2), (3, 'Call vendor', NULL);
  `)
  views = new ViewRegistry()
})

afterEach(async () => {
  await kdb.close()
})

describe("published views", () => {
  test("a view with a computed column is readable and joinable from another plugin", async () => {
    views.publish("people", "person", person)
    await views.createAll(kdb)
    expect(viewNames()).toEqual(["people__pub_person"])
    expect(views.forReader("projects").get("people.person")).toEqual({
      physical: "people__pub_person",
      columns: ["id", "handle", "name", "last_contact", "archived"],
      baseTables: ["people_note", "people_person"],
    })

    const rows = await reader("projects")
      .selectFrom("action as a")
      .leftJoin("people.person as o", "o.id", "a.owner_id")
      .select(["a.id", "a.title", "o.name as owner", "o.last_contact", "o.archived"])
      .orderBy("a.id")
      .execute()
    expect(rows).toEqual([
      { id: 1, title: "Send contract", owner: "Anna", last_contact: "2026-11-10", archived: 0 },
      { id: 2, title: "Book room", owner: "Peter", last_contact: null, archived: 1 },
      { id: 3, title: "Call vendor", owner: null, last_contact: null, archived: null },
    ])
  })

  test("createAll recreates the views each time and is idempotent", async () => {
    views.publish("people", "person", person)
    await views.createAll(kdb)
    await views.createAll(kdb)
    expect(viewNames()).toEqual(["people__pub_person"])
    expect(await reader("projects").selectFrom("people.person").select("handle").orderBy("id").execute()).toEqual([
      { handle: "anna" },
      { handle: "peter" },
    ])
  })

  test("a declared column missing from the query fails createAll with both lists", async () => {
    views.publish("people", "person", { ...person, columns: { ...person.columns, email: "text" } })
    const e = await error(() => views.createAll(kdb), ValidationError)
    expect(e.message).toBe(
      'view "people.person" declares columns [id, handle, name, last_contact, archived, email] but its query returns [id, handle, name, last_contact, archived]',
    )
    expect(viewNames()).toEqual([])
    expect(views.forReader("projects").size).toBe(0)
  })

  test("a view query with a bound parameter is rejected", async () => {
    views.publish("people", "person", {
      version: 1,
      columns: { id: "integer" },
      query: (db) => db.selectFrom("person").select("id").where("handle", "=", "anna"),
    })
    const e = await error(() => views.createAll(kdb), ValidationError)
    expect(e.message).toBe("view query may not use parameters")
    expect(viewNames()).toEqual([])
  })

  test("a view query is built with the owner's scoped db: another plugin's table is rejected", async () => {
    views.publish("people", "person", {
      version: 1,
      columns: { id: "integer" },
      query: (db) => db.selectFrom("projects_action").select("id"),
    })
    const e = await error(() => views.createAll(kdb), IsolationError)
    expect(e.message).toStartWith('table "projects_action" is not owned by plugin "people"')
    expect(viewNames()).toEqual([])
  })

  test("a view whose base tables are not all the owner's is rejected (raw sql fragment)", async () => {
    views.publish("people", "person", {
      version: 1,
      columns: { id: "integer", actions: "integer" },
      query: (db) => db.selectFrom("person").select(["id", sql<number>`(SELECT count(*) FROM projects_action)`.as("actions")]),
    })
    const e = await error(() => views.createAll(kdb), IsolationError)
    expect(e.message).toBe('view "people.person" reads table "projects_action", which plugin "people" does not own')
    expect(viewNames()).toEqual([])
  })

  test("publishing the same view twice is rejected", () => {
    views.publish("people", "person", person)
    expect(() => views.publish("people", "person", person)).toThrow('view "people.person" is already published')
  })

  test("reading a view of a declared but unloaded plugin is ViewUnavailableError", async () => {
    views.declareReads("projects", ["people"])
    const e = await error(() => reader("projects").selectFrom("people.person").select("id").execute(), ViewUnavailableError)
    expect(e.message).toBe('view "people.person" is unavailable')
    expect(e.details).toEqual({ view: "people.person" })
  })

  test("after remove(), the plugin's views are unavailable to its declared readers", async () => {
    views.publish("people", "person", person)
    views.declareReads("projects", ["people"])
    await views.createAll(kdb)
    views.remove("people")
    expect(views.forReader("projects").size).toBe(0)
    await error(() => reader("projects").selectFrom("people.person").select("id").execute(), ViewUnavailableError)
  })

  test("an undeclared plugin's missing view stays an IsolationError", async () => {
    const e = await error(() => reader("inbox").selectFrom("people.person").select("id").execute(), IsolationError)
    expect(e).not.toBeInstanceOf(ViewUnavailableError)
    expect(e.message).toBe("people.person is not a published view")
  })
})

describe("a view is one checked SELECT statement", () => {
  function untouched() {
    expect(kdb.raw.prepare("SELECT count(*) AS n FROM projects_action").all([])).toEqual([{ n: 3 }])
    expect(kdb.raw.prepare("SELECT count(*) AS n FROM kernel_secret").all([])).toEqual([{ n: 1 }])
    expect(kdb.raw.prepare("SELECT name FROM sqlite_schema WHERE name = 'evil'").all([])).toEqual([])
    expect(viewNames()).toEqual([])
  }
  const fake = (sqlText: string, kind = "SelectQueryNode"): ViewDef => ({
    version: 1,
    columns: { x: "integer" },
    query: () => ({ compile: () => ({ sql: sqlText, parameters: [], query: { kind } }) as any }),
  })

  function untouched4() {
    expect(kdb.raw.prepare("SELECT count(*) AS n FROM kernel_secret").all([])).toEqual([{ n: 1 }])
    expect(viewNames()).toEqual([])
  }

  beforeEach(() => {
    kdb.raw.exec("CREATE TABLE kernel_secret (a INTEGER); INSERT INTO kernel_secret VALUES (1)")
  })

  test("a statement terminator in a raw fragment is rejected and nothing runs", async () => {
    views.publish("people", "person", {
      version: 1,
      columns: { x: "integer" },
      query: (db) =>
        db
          .selectFrom("person")
          .select(sql<number>`1`.as("x"))
          .where(sql<boolean>`1=1; DELETE FROM projects_action; CREATE TABLE evil(a); SELECT 1 AS x`),
    })
    const e = await error(() => views.createAll(kdb), ValidationError)
    expect(e.message).toBe('view "people.person": the query must be a single SELECT statement')
    untouched()
  })

  test("a hand-made compile() with several statements is rejected and nothing runs", async () => {
    views.publish("people", "person", fake("SELECT 1 AS x; UPDATE projects_action SET title = 'x'; DROP TABLE kernel_secret; SELECT 1"))
    await error(() => views.createAll(kdb), ValidationError)
    untouched()
  })

  test("a compiled query that is not a SelectQueryNode is rejected", async () => {
    views.publish("people", "person", fake("SELECT 1 AS x", "RawNode"))
    const e = await error(() => views.createAll(kdb), ValidationError)
    expect(e.message).toBe('view "people.person": the query must be a single SELECT statement')
    untouched()
  })

  test("a single SELECT on another plugin's or the kernel's table is rejected before the view exists", async () => {
    for (const [t, q] of [
      ["projects_action", "SELECT id AS x FROM projects_action"],
      ["kernel_secret", "SELECT a AS x FROM kernel_secret"],
    ]) {
      views.remove("people")
      views.publish("people", "person", fake(q!))
      const e = await error(() => views.createAll(kdb), IsolationError)
      expect(e.message).toBe(`view "people.person" reads table "${t}", which plugin "people" does not own`)
      untouched()
    }
  })

  test("a spoofed SelectQueryNode with a PRAGMA is rejected before anything is prepared", async () => {
    const before = pragmas(kdb.raw)
    for (const q of PRAGMA_ATTACKS) {
      views.remove("people")
      views.publish("people", "person", fake(q))
      const e = await error(() => views.createAll(kdb), ValidationError)
      expect(e.message).toBe('view "people.person": the query must be a single SELECT statement')
    }
    expect(pragmas(kdb.raw)).toEqual(before)
    kdb.raw.exec("INSERT INTO projects_action (title) VALUES ('still writable')")
    untouched4()
  })

  test("existing PmError details are kept, with plugin and view added", async () => {
    views.publish("people", "person", {
      version: 1,
      columns: { id: "integer" },
      query: () => {
        throw new PmError("custom", "custom", 1, { details: { extra: 1 } })
      },
    })
    const e = await error(() => views.createAll(kdb), PmError)
    expect(e.details).toEqual({ extra: 1, plugin: "people", view: "person" })
  })

  test("errors from createAll carry details { plugin, view }", async () => {
    views.publish("people", "person", person)
    views.publish("people", "broken", { version: 1, columns: { id: "integer" }, query: (db) => db.selectFrom("person").select("id").where("id", "=", 1) })
    const a = await error(() => views.createAll(kdb), PmError)
    expect(a.details).toEqual({ plugin: "people", view: "broken" })

    views.remove("people")
    views.publish("people", "person", { ...person, columns: { id: "integer" } })
    const b = await error(() => views.createAll(kdb), ValidationError)
    expect(b.details).toEqual({ plugin: "people", view: "person" })

    views.remove("people")
    views.publish("people", "person", { version: 1, columns: { id: "integer" }, query: () => { throw new Error("plugin bug") } })
    const c = await error(() => views.createAll(kdb), ValidationError)
    expect(c.message).toBe('view "people.person": plugin bug')
    expect(c.details).toEqual({ plugin: "people", view: "person" })
  })
})
