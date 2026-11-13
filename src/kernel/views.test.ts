import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { sql, type Kysely } from "kysely"
import { KernelDb } from "./db/kernel-db"
import type { TableAccess } from "./db/scope"
import { openRaw } from "./db/sqlite"
import { IsolationError, ValidationError, ViewUnavailableError } from "./errors"
import { ownTablesOf } from "./migrations"
import { ViewRegistry, type ViewDef } from "./views"

let kdb: KernelDb
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
