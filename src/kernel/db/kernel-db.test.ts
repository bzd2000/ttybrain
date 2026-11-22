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
  file = join(dir, "ttybrain.db")
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

describe("KernelDb.write noWait", () => {
  test("fails with BusyError at once while another connection holds the write lock, and keeps busy_timeout", async () => {
    const other = openRaw(file)
    try {
      other.exec("BEGIN IMMEDIATE")
      const started = performance.now()
      await expect(kdb.write(async () => 1, { noWait: true })).rejects.toThrow(BusyError)
      expect(performance.now() - started).toBeLessThan(1000)
      expect(kdb.raw.inTransaction()).toBe(false)
      expect(kdb.raw.prepare("PRAGMA busy_timeout").all([])).toEqual([{ timeout: 3000 }])
      other.exec("ROLLBACK")
      expect(await kdb.write(async () => 2, { noWait: true })).toBe(2)
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

  test("an after-commit hook that writes, while another write is queued, gets its own outermost write", async () => {
    let fromHook!: Promise<unknown>
    const first = kdb.write(async () => {
      await kdb.kysely.insertInto("t").values({ name: "first" }).execute()
      kdb.afterCommit(() => {
        expect(kdb.inWrite()).toBe(false) // hooks run outside the write scope, after the lock is released
        fromHook = kdb.write(async () => kdb.kysely.insertInto("t").values({ name: "from-hook" }).execute())
      })
    })
    const queued = kdb.write(async () => {
      await kdb.kysely.insertInto("t").values({ name: "fail-queued" }).execute()
      throw new Error("boom")
    })
    await first
    await expect(queued).rejects.toThrow("boom")
    await fromHook
    expect(names(kdb.raw)).toEqual(["first", "from-hook"])
    expect(kdb.raw.inTransaction()).toBe(false)
  })

  test("sibling nested writes run one after another: a failing one rolls back alone", async () => {
    const ran: string[] = []
    const settled = await kdb.write(async () => {
      const slow = (name: string, fail: boolean) =>
        kdb.write(async () => {
          await kdb.kysely.insertInto("t").values({ name }).execute()
          kdb.afterCommit(() => ran.push(name))
          await new Promise((r) => setTimeout(r, 5))
          if (fail) throw new Error(`fail ${name}`)
          return name
        })
      return Promise.allSettled([slow("p", true), slow("q", false)])
    })
    expect(settled.map((s) => s.status)).toEqual(["rejected", "fulfilled"])
    expect((settled[0] as PromiseRejectedResult).reason.message).toBe("fail p")
    expect(names(kdb.raw)).toEqual(["q"])
    expect(ran).toEqual(["q"])
  })

  describe("un-awaited nested writes are drained into their parent", () => {
    const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
    const insert = (name: string) => kdb.kysely.insertInto("t").values({ name }).execute()
    const errors: string[] = []
    const track = (p: Promise<unknown>) => p.catch((e) => void errors.push(e.message))
    beforeEach(() => void (errors.length = 0))

    test("R3d: parent throws → its un-awaited nested writes roll back with it", async () => {
      let s1!: Promise<unknown>, s2!: Promise<unknown>
      const parent = kdb.write(async () => {
        s1 = kdb.write(async () => (await tick(), insert("s1")))
        s2 = kdb.write(async () => insert("s2"))
        throw new Error("parent fails")
      })
      await expect(parent).rejects.toThrow("parent fails")
      await Promise.allSettled([s1, s2])
      expect(names(kdb.raw)).toEqual([])
      expect(kdb.raw.inTransaction()).toBe(false)
    })

    test("R3: parent succeeds → nested writes still running when it returns commit with it", async () => {
      let s1!: Promise<unknown>
      await kdb.write(async () => {
        await insert("parent")
        s1 = track(kdb.write(async () => (await tick(), insert("s1"))))
      })
      expect(names(kdb.raw)).toEqual(["parent", "s1"]) // committed before the parent's promise resolved
      await s1
      expect(errors).toEqual([])
    })

    test("R3b: parent fails while a nested write is in flight → nothing persists", async () => {
      let s1!: Promise<unknown>
      const parent = kdb.write(async () => {
        await insert("parent")
        s1 = track(kdb.write(async () => (await tick(), insert("s1"))))
        await tick(1)
        throw new Error("parent fails")
      })
      await expect(parent).rejects.toThrow("parent fails")
      await s1
      expect(names(kdb.raw)).toEqual([])
      expect(errors.filter((m) => m.includes("savepoint"))).toEqual([])
    })

    test("H1: the parent's own after-commit hook survives an un-awaited nested write's frame", async () => {
      const ran: string[] = []
      await kdb.write(async () => {
        track(kdb.write(async () => (await tick(), kdb.afterCommit(() => ran.push("child")))))
        await tick(1)
        kdb.afterCommit(() => ran.push("parent"))
      })
      expect(ran.sort()).toEqual(["child", "parent"])
    })

    test("H2: a write started from a timer after its parent ended is rejected, not run in another chain's transaction", async () => {
      let late!: Promise<unknown>
      await kdb.write(async () => {
        late = tick(5).then(() => kdb.write(async () => insert("late")))
      })
      const other = kdb.write(async () => (await insert("other"), await tick(10)))
      await expect(late).rejects.toThrow("write started after its parent write ended; await nested writes")
      await other
      expect(names(kdb.raw)).toEqual(["other"])
      expect(kdb.raw.inTransaction()).toBe(false)
    })
  })

  describe("a parent may not issue statements while a nested write it started is running", () => {
    const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
    const insert = (name: string) => kdb.kysely.insertInto("t").values({ name }).execute()
    const NESTED = "a write ran a statement while one of its nested writes was running; await nested writes"

    test("C1: un-awaited child fails later; the parent's statement in between fails the parent, nothing is lost silently", async () => {
      let child!: Promise<unknown>
      const parent = kdb.write(async () => {
        await insert("p-before")
        child = kdb.write(async () => (await tick(10), Promise.reject(new Error("child fails"))))
        await tick(2)
        await insert("p-during")
        return "parent ok"
      })
      await expect(parent).rejects.toThrow(NESTED)
      await expect(child).rejects.toThrow("child fails")
      expect(names(kdb.raw)).toEqual([])
      expect(kdb.raw.inTransaction()).toBe(false)
    })

    test("C1b: an un-awaited child that succeeds while the parent keeps issuing statements fails the parent too", async () => {
      let child!: Promise<unknown>
      const parent = kdb.write(async () => {
        await insert("p-before")
        child = kdb.write(async () => (await tick(10), insert("child")))
        await tick(2)
        await kdb.kysely.selectFrom("t").selectAll().execute() // reads count too: one rule for every statement
        return "parent ok"
      })
      await expect(parent).rejects.toThrow(NESTED)
      await child
      expect(names(kdb.raw)).toEqual([])
      expect(kdb.raw.inTransaction()).toBe(false)
    })

    test("C4: one level down, the middle write fails and the outer write can carry on", async () => {
      let grandchild!: Promise<unknown>
      let middleError = ""
      await kdb.write(async () => {
        await insert("outer")
        await kdb
          .write(async () => {
            await insert("middle")
            grandchild = kdb.write(async () => (await tick(10), Promise.reject(new Error("grandchild fails"))))
            await tick(2)
            await insert("middle-during")
          })
          .catch((e) => (middleError = e.message))
      })
      await grandchild.catch(() => {})
      expect(middleError).toBe(NESTED)
      expect(names(kdb.raw)).toEqual(["outer"])
      expect(kdb.raw.inTransaction()).toBe(false)
    })

    test("awaited nested writes, and the nested write's own statements, are the normal case", async () => {
      await kdb.write(async () => {
        await insert("a")
        await kdb.write(async () => {
          await insert("b")
          await kdb.write(async () => insert("c"))
          await insert("d")
        })
        await insert("e")
      })
      expect(names(kdb.raw)).toEqual(["a", "b", "c", "d", "e"])
    })

    test("code outside any write may still read while a write has a nested write open", async () => {
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      let opened!: () => void
      const childOpen = new Promise<void>((r) => (opened = r))
      const w = kdb.write(async () => {
        await kdb.write(async () => (await insert("child"), opened(), await gate))
      })
      await childOpen
      expect((await kdb.kysely.selectFrom("t").select("name").execute()).map((r) => r.name)).toEqual(["child"])
      release()
      await w
    })

    test("a statement from a write that already ended is rejected", async () => {
      let late!: Promise<unknown>
      await kdb.write(async () => {
        late = tick(2).then(() => insert("late"))
      })
      await expect(late).rejects.toThrow("a statement ran after its write ended; await all work inside a write")
      expect(names(kdb.raw)).toEqual([])
    })
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
