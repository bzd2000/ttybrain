import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTableChecker, firstKeyword, isSingleStatement, isSingleTrigger } from "./explain"
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
    expect(c.tablesTouched("SELECT * FROM a_t1 WHERE x = ?", "dml")).toEqual(["a_t1"])
  })
  test("join touches both tables", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("SELECT * FROM a_t1 JOIN b_t2 ON b_t2.a_id = a_t1.id", "dml").sort()).toEqual(["a_t1", "b_t2"])
  })
  test("update", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("UPDATE b_t2 SET z = ? WHERE id = ?", "dml")).toEqual(["b_t2"])
  })
  test("insert-select touches both", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("INSERT INTO a_t1 (x) SELECT z FROM b_t2", "dml").sort()).toEqual(["a_t1", "b_t2"])
  })
  test("view resolves to underlying table", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("SELECT * FROM a__pub_v", "dml")).toEqual(["a_t1"])
  })
  test("index lookup maps to its table", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("SELECT x FROM a_t1 WHERE x = ?", "dml")).toEqual(["a_t1"])
  })
  test("invalidate picks up new tables", () => {
    const c = createTableChecker(raw)
    c.tablesTouched("SELECT * FROM a_t1", "dml")
    raw.exec("CREATE TABLE c_t3 (id INTEGER PRIMARY KEY)")
    c.invalidate()
    expect(c.tablesTouched("SELECT * FROM c_t3", "dml")).toEqual(["c_t3"])
  })
  test("caches per sql string", () => {
    const c = createTableChecker(raw)
    const a = c.tablesTouched("SELECT * FROM a_t1", "dml")
    expect(c.tablesTouched("SELECT * FROM a_t1", "dml")).toBe(a)
  })
  test("truncate-style delete (OP_Clear) reports its table", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("DELETE FROM b_t2", "dml")).toEqual(["b_t2"])
  })
  test("triggers: writes by a trigger on another table are reported", () => {
    raw.exec("CREATE TRIGGER a_del AFTER DELETE ON a_t1 BEGIN DELETE FROM b_t2; END")
    raw.exec("CREATE TRIGGER a_ins AFTER INSERT ON a_t1 BEGIN INSERT INTO b_t2 (z) VALUES ('x'); END")
    const c = createTableChecker(raw)
    expect(c.tablesTouched("DELETE FROM a_t1", "dml").sort()).toEqual(["a_t1", "b_t2"])
    expect(c.tablesTouched("INSERT INTO a_t1 (x) VALUES (?)", "dml").sort()).toEqual(["a_t1", "b_t2"])
  })
  test("DROP TABLE reports the table (Destroy) and the schema table", () => {
    const c = createTableChecker(raw)
    const t = c.tablesTouched("DROP TABLE b_t2", "migration")
    expect(t).toContain("b_t2")
    expect(t).toContain("sqlite_schema")
  })
  test("temp tables are reported as non-table names (fail closed)", () => {
    raw.exec("CREATE TEMP TABLE tt (i)")
    const c = createTableChecker(raw)
    for (const sql of ["DELETE FROM tt", "SELECT * FROM tt"]) {
      const t = c.tablesTouched(sql, "dml")
      expect(t).toHaveLength(1)
      expect(t[0]).toMatch(/^db1:page\d+$/)
    }
  })
  test("VACUUM is rejected before anything is prepared", () => {
    for (const ctx of ["view", "dml", "migration"] as const) {
      expect(() => createTableChecker(raw).tablesTouched("VACUUM", ctx)).toThrow("VACUUM statements are not allowed here")
    }
  })
})

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

describe("statement allow-list before EXPLAIN", () => {
  test("flag pragmas are rejected in every context without taking effect", () => {
    const before = pragmas(raw)
    const c = createTableChecker(raw)
    for (const q of [...PRAGMA_ATTACKS, "ATTACH ':memory:' AS x", "BEGIN", "SAVEPOINT s", "ANALYZE", "REINDEX", "EXPLAIN SELECT 1", "WITH x AS (SELECT 1) SELECT * FROM x"]) {
      for (const ctx of ["view", "dml", "migration"] as const) expect(() => c.tablesTouched(q, ctx)).toThrow("statements are not allowed here")
    }
    expect(pragmas(raw)).toEqual(before)
  })

  test("each context allows its own statements only", () => {
    const c = createTableChecker(raw)
    expect(c.tablesTouched("SELECT * FROM a_t1", "view")).toEqual(["a_t1"])
    expect(c.tablesTouched("VALUES (1)", "view")).toEqual([])
    expect(() => c.tablesTouched("DELETE FROM a_t1", "view")).toThrow("DELETE statements are not allowed here")
    expect(c.tablesTouched("REPLACE INTO b_t2 (id, z) VALUES (?, ?)", "dml")).toEqual(["b_t2"])
    expect(() => c.tablesTouched("CREATE TABLE a_new (i)", "dml")).toThrow("CREATE statements are not allowed here")
    expect(c.tablesTouched("CREATE TABLE a_new (i)", "migration")).toContain("sqlite_schema")
    expect(c.tablesTouched("ALTER TABLE a_t1 ADD COLUMN w TEXT", "migration")).toContain("sqlite_schema")
  })

  test("a view body is explained as a sub-query and must be one statement", () => {
    const c = createTableChecker(raw)
    expect(() => c.tablesTouched("SELECT 1; DELETE FROM a_t1", "view")).toThrow("only a single SQL statement is allowed")
    expect(() => c.tablesTouched("SELECT 1; PRAGMA query_only=1", "dml")).toThrow("only a single SQL statement is allowed")
    expect(raw.prepare("SELECT count(*) AS n FROM a_t1").all([])).toEqual([{ n: 0 }])
  })

  test("firstKeyword skips whitespace, comments and parentheses", () => {
    expect(firstKeyword("  /* a */ -- b\n ( select 1)")).toBe("SELECT")
    expect(firstKeyword("/* unterminated PRAGMA")).toBe("")
    expect(firstKeyword("")).toBe("")
  })
})

describe("isSingleStatement", () => {
  test.each([
    ["SELECT 1 AS x", true],
    ["SELECT ';' AS x", true],
    ["SELECT 'it''s;' AS x", true],
    ['SELECT 1 AS "a;b"', true],
    ['SELECT 1 AS "a"";b"', true],
    ["SELECT 1 AS `a;b`", true],
    ["SELECT 1 AS [a;b]", true],
    ["SELECT 1 /* ; */ AS x", true],
    ["SELECT 1 - 2 / 3 AS x", true],
    ["SELECT 1; SELECT 2", false],
    ["SELECT 1;", false],
    ["SELECT 1 -- it's\n; DROP TABLE t", false],
    ["SELECT 1 -- ;", true],
    ["SELECT 'unterminated", false],
    ['SELECT "unterminated', false],
    ["SELECT 1 /* unterminated", false],
  ])("%p → %p", (q, ok) => {
    expect(isSingleStatement(q)).toBe(ok)
  })
})

describe("isSingleTrigger", () => {
  const head = "CREATE TRIGGER a_trg AFTER INSERT ON a_t1 BEGIN"
  test.each([
    [`${head} UPDATE a_t1 SET y = 'x'; END`, true],
    [`${head} UPDATE a_t1 SET y = 'x'; INSERT INTO a_t1 (x) VALUES (';'); END  -- done`, true],
    [`${head} UPDATE a_t1 SET y = CASE WHEN 1 THEN 'a' END; END`, true],
    [`CREATE TEMP TRIGGER t AFTER INSERT ON a_t1 BEGIN SELECT 1; END`, true],
    [`${head} SELECT 1; END; PRAGMA query_only=1`, false],
    [`${head} SELECT 1; END; PRAGMA query_only=1; END`, false],
    [`${head} SELECT 1; PRAGMA query_only=1; END`, false],
    [`CREATE TABLE a_x (i); PRAGMA query_only=1`, false],
    [`CREATE TABLE a_x (i); SELECT 1; END`, false],
    [`${head} SELECT 1 END`, false],
  ])("%p → %p", (q, ok) => {
    expect(isSingleTrigger(q)).toBe(ok)
  })

  test("a trigger is one statement in a migration only", () => {
    const c = createTableChecker(raw)
    const q = `${head} UPDATE a_t1 SET y = 'x'; END`
    expect(c.tablesTouched(q, "migration")).toContain("sqlite_schema")
    expect(() => c.tablesTouched(q, "dml")).toThrow("only a single SQL statement is allowed")
  })
})
