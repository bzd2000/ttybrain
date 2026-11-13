import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTableChecker } from "./explain"
import { openRaw, type RawDb } from "./sqlite"

let raw: RawDb
beforeEach(() => {
  raw = openRaw(":memory:")
  raw.exec(`
    CREATE TABLE a_t1 (id INTEGER PRIMARY KEY, x TEXT, y TEXT);
    CREATE TABLE b_t2 (id INTEGER PRIMARY KEY, a_id INT, z TEXT);
    CREATE INDEX a_t1_x ON a_t1(x);
    CREATE VIEW a__pub_v AS SELECT id, x FROM a_t1;
  `)
})
afterEach(() => raw.close())

describe("createTableChecker", () => {
  test("select with a parameter", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("SELECT * FROM a_t1 WHERE x = ?")).toEqual(["a_t1"])
  })
  test("join touches both tables", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("SELECT * FROM a_t1 JOIN b_t2 ON b_t2.a_id = a_t1.id").sort()).toEqual(["a_t1", "b_t2"])
  })
  test("update", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("UPDATE b_t2 SET z = ? WHERE id = ?")).toEqual(["b_t2"])
  })
  test("insert-select touches both", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("INSERT INTO a_t1 (x) SELECT z FROM b_t2").sort()).toEqual(["a_t1", "b_t2"])
  })
  test("view resolves to underlying table", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("SELECT * FROM a__pub_v")).toEqual(["a_t1"])
  })
  test("index lookup maps to its table", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("SELECT x FROM a_t1 WHERE x = ?")).toEqual(["a_t1"])
  })
  test("invalidate picks up new tables", () => {
    const c = createTableChecker(raw)
    c.tablesTouched("SELECT * FROM a_t1")
    raw.exec("CREATE TABLE c_t3 (id INTEGER PRIMARY KEY)")
    c.invalidate()
    expect(c.tablesTouched("SELECT * FROM c_t3")).toEqual(["c_t3"])
  })
  test("caches per sql string", () => {
    const c = createTableChecker(raw)
    const a = c.tablesTouched("SELECT * FROM a_t1")
    expect(c.tablesTouched("SELECT * FROM a_t1")).toBe(a)
  })
})
