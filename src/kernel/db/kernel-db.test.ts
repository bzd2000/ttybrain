import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BusyError, IsolationError } from "../errors"
import { KernelDb } from "./kernel-db"
import { openRaw, type RawDb } from "./sqlite"

let dir: string
let file: string
let kdb: KernelDb

function names(db: RawDb): string[] {
  return db.prepare("SELECT name FROM t ORDER BY name").all([]).map((r) => r.name)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-kdb-"))
  file = join(dir, "pm.db")
  kdb = new KernelDb(openRaw(file))
  kdb.raw.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
})

afterEach(async () => {
  await kdb.close()
  rmSync(dir, { recursive: true, force: true })
})

describe("openRaw", () => {
  test("journal_mode reports wal", () => {
    expect(kdb.raw.prepare("PRAGMA journal_mode").all([])).toEqual([{ journal_mode: "wal" }])
  })

  test("busy_timeout is 3000 and foreign keys are on", () => {
    expect(kdb.raw.prepare("PRAGMA busy_timeout").all([])).toEqual([{ timeout: 3000 }])
    expect(kdb.raw.prepare("PRAGMA foreign_keys").all([])).toEqual([{ foreign_keys: 1 }])
  })

  test("rows are plain objects with numbers; run reports changes and rowid", () => {
    const res = kdb.raw.prepare("INSERT INTO t (name) VALUES (?)").run(["a"])
    expect(res).toEqual({ changes: 1, lastInsertRowid: 1 })
    const rows = kdb.raw.prepare("SELECT id, name, 9007199254740991 AS big FROM t").all([])
    expect(rows).toEqual([{ id: 1, name: "a", big: 9007199254740991 }])
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype)
    expect(typeof rows[0].id).toBe("number")
  })

  test("statements report whether they return rows", () => {
    expect(kdb.raw.prepare("SELECT 1").reader).toBe(true)
    expect(kdb.raw.prepare("INSERT INTO t (name) VALUES (?)").reader).toBe(false)
    expect(kdb.raw.prepare("INSERT INTO t (name) VALUES (?) RETURNING id").reader).toBe(true)
  })

  // bun:sqlite's all() leaves EXPLAIN of a write statement un-reset, which made COMMIT fail with
  // "SQL statements in progress" after any layer 2 check inside a transaction.
  test("all() leaves no statement in progress, so COMMIT succeeds", () => {
    kdb.raw.exec("BEGIN IMMEDIATE")
    expect(kdb.raw.prepare("EXPLAIN INSERT INTO t (name) VALUES (?)").all(["a"]).length).toBeGreaterThan(0)
    kdb.raw.prepare("EXPLAIN CREATE TABLE u (x)").all([])
    kdb.raw.exec("COMMIT")
    expect(kdb.raw.inTransaction()).toBe(false)
  })

  test("SQLITE_BUSY is rethrown as BusyError", () => {
    const other = openRaw(file)
    try {
      other.exec("PRAGMA busy_timeout = 0")
      kdb.raw.exec("BEGIN IMMEDIATE")
      expect(() => other.exec("BEGIN IMMEDIATE")).toThrow(BusyError)
      kdb.raw.exec("ROLLBACK")
    } finally {
      other.close()
    }
  })
})

describe("KernelDb.transaction", () => {
  test("writes are visible after commit", async () => {
    await kdb.transaction(async () => {
      await kdb.kysely.insertInto("t").values({ name: "a" }).execute()
    })
    expect(kdb.raw.inTransaction()).toBe(false)
    const other = openRaw(file)
    try {
      expect(names(other)).toEqual(["a"])
    } finally {
      other.close()
    }
  })

  test("a throw rolls everything back", async () => {
    await expect(
      kdb.transaction(async () => {
        await kdb.kysely.insertInto("t").values({ name: "a" }).execute()
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(kdb.raw.inTransaction()).toBe(false)
    expect(names(kdb.raw)).toEqual([])
  })

  test("nested: inner throw rolls back to the savepoint, outer commits", async () => {
    await kdb.transaction(async () => {
      await kdb.kysely.insertInto("t").values({ name: "A" }).execute()
      try {
        await kdb.transaction(async () => {
          await kdb.kysely.insertInto("t").values({ name: "B" }).execute()
          throw new Error("inner")
        })
      } catch {}
    })
    expect(names(kdb.raw)).toEqual(["A"])
  })

  test("nested: inner commit is kept when the outer commits", async () => {
    await kdb.transaction(async () => {
      await kdb.kysely.insertInto("t").values({ name: "A" }).execute()
      await kdb.transaction(async () => {
        await kdb.kysely.insertInto("t").values({ name: "B" }).execute()
      })
    })
    expect(names(kdb.raw)).toEqual(["A", "B"])
  })

  test("kysely.transaction() is unusable by design", async () => {
    const err = await kdb.kysely.transaction().execute(async () => 1).catch((e) => e)
    expect(err).toBeInstanceOf(IsolationError)
    expect(err.message).toBe("transactions are managed by the kernel")
  })
})

describe("KernelDb.withWriteLock", () => {
  test("two concurrent calls run sequentially", async () => {
    const order: string[] = []
    const op = (id: string) =>
      kdb.withWriteLock(async () => {
        order.push(`start ${id}`)
        await new Promise((r) => setTimeout(r, 10))
        order.push(`end ${id}`)
        return id
      })
    expect(await Promise.all([op("1"), op("2")])).toEqual(["1", "2"])
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"])
  })

  test("a failing call releases the lock", async () => {
    await expect(kdb.withWriteLock(async () => { throw new Error("x") })).rejects.toThrow("x")
    expect(await kdb.withWriteLock(async () => 7)).toBe(7)
  })
})

describe("KernelDb.write", () => {
  test("the outermost write takes the lock; a nested write reuses the transaction as a savepoint", async () => {
    await kdb.write(async () => {
      await kdb.kysely.insertInto("t").values({ name: "outer" }).execute()
      await kdb.write(async () => kdb.kysely.insertInto("t").values({ name: "inner" }).execute()) // would deadlock if it took the lock
      expect(kdb.inWrite()).toBe(true)
    })
    expect(kdb.inWrite()).toBe(false)
    expect(names(kdb.raw)).toEqual(["inner", "outer"])
  })

  test("concurrent outermost writes are serialised, not treated as nested", async () => {
    const order: string[] = []
    const w = (id: string) =>
      kdb.write(async () => {
        order.push(`start ${id}`)
        await new Promise((r) => setTimeout(r, 10))
        await kdb.kysely.insertInto("t").values({ name: id }).execute()
        order.push(`end ${id}`)
      })
    await Promise.all([w("a"), w("b")])
    expect(order).toEqual(["start a", "end a", "start b", "end b"])
    expect(names(kdb.raw)).toEqual(["a", "b"])
  })

  test("afterCommit runs after the outermost commit, and not for a rolled-back savepoint or transaction", async () => {
    const ran: string[] = []
    await kdb.write(async () => {
      kdb.afterCommit(() => ran.push("outer"))
      await kdb.write(async () => kdb.afterCommit(() => ran.push("kept")))
      await kdb
        .write(async () => {
          kdb.afterCommit(() => ran.push("dropped"))
          throw new Error("inner")
        })
        .catch(() => {})
      expect(ran).toEqual([])
    })
    expect(ran).toEqual(["outer", "kept"])
    await kdb
      .write(async () => {
        kdb.afterCommit(() => ran.push("never"))
        throw new Error("outer")
      })
      .catch(() => {})
    expect(ran).toEqual(["outer", "kept"])
  })

  test("afterCommit outside a transaction throws", () => {
    expect(() => kdb.afterCommit(() => {})).toThrow("afterCommit needs an open transaction")
  })
})

describe("KernelDb.close", () => {
  test("close during an open transaction drops its rows", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let inserted!: () => void
    const didInsert = new Promise<void>((r) => (inserted = r))
    const tx = kdb.transaction(async () => {
      await kdb.kysely.insertInto("t").values({ name: "lost" }).execute()
      inserted()
      await gate
    })
    await didInsert
    await kdb.close()
    release()
    await expect(tx).rejects.toThrow()

    kdb = new KernelDb(openRaw(file))
    expect(names(kdb.raw)).toEqual([])
  })
})
