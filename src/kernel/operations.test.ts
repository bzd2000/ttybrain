import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Type from "typebox"
import { fixedClock } from "./clock"
import { currentContext, runWithContext, type OpContext, type Origin } from "./context"
import { KernelDb } from "./db/kernel-db"
import { openRaw } from "./db/sqlite"
import { IsolationError, NotFoundError, ValidationError } from "./errors"
import { EventBus } from "./events"
import { MigrationRunner } from "./migrations"
import { OperationRegistry, type ReadOp, type WriteOp } from "./operations"
import { resolvePaths } from "./paths"
import { ProvenanceStore } from "./provenance"
import { RecordTypeRegistry } from "./records"
import { NonBlank } from "./schemas"

let dir: string
let kdb: KernelDb
let events: EventBus
let records: RecordTypeRegistry
let provenance: ProvenanceStore
let ops: OperationRegistry
let changed: unknown[]

const ctx = (origin?: Origin): OpContext => ({ actor: "me", today: "2026-11-13", now: "2026-11-13T10:00:00", origin })
const inCtx = <T>(fn: () => Promise<T>, origin?: Origin) => runWithContext(ctx(origin), fn)

const titles = () => kdb.raw.prepare("SELECT title FROM fixture_item ORDER BY id").all([]).map((r) => r.title)

// The fixture plugin: `add` (write) and `count` (read) over its own table; `fail` inserts and then throws.
const add: WriteOp = {
  input: Type.Object({ title: Type.String({ minLength: 1 }) }),
  output: Type.Object({ ref: Type.String(), id: Type.Integer() }),
  describe: (i) => `+ item "${i.title}"`,
  run: async (i) => {
    const r = await kdb.kysely.insertInto("fixture_item").values({ title: i.title }).executeTakeFirstOrThrow()
    return { ref: `F-${r.insertId}`, id: Number(r.insertId) }
  },
}
const count: ReadOp = {
  input: Type.Object({}),
  output: Type.Object({ n: Type.Integer() }),
  run: async () => ({ n: titles().length }),
}

function expose(extra: Record<string, WriteOp> = {}) {
  ops.expose("fixture", { read: { count }, write: { add, ...extra } })
  return ops.api("fixture")!
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pm-ops-"))
  const paths = resolvePaths({ PM_HOME: dir })
  kdb = new KernelDb(openRaw(paths.db))
  await new MigrationRunner(kdb, paths, fixedClock("2026-11-13")).ensureKernelTables()
  kdb.raw.exec("CREATE TABLE fixture_item (id INTEGER PRIMARY KEY, title TEXT NOT NULL)")
  events = new EventBus()
  changed = []
  events.on("record.changed", (p) => changed.push(p))
  records = new RecordTypeRegistry()
  records.register({
    name: "fixture_item",
    plugin: "fixture",
    prefix: "F-",
    resolve: async (ref) => Number(ref.slice(2)),
    label: async (id) => `item ${id}`,
    search: async () => [],
  })
  provenance = new ProvenanceStore(kdb, records)
  ops = new OperationRegistry({ db: kdb, events, records, provenance, validateOutputs: true })
})

afterEach(async () => {
  await kdb.close()
  rmSync(dir, { recursive: true, force: true })
})

describe("OperationRegistry: input validation", () => {
  test("invalid input is a ValidationError naming the field", async () => {
    const api = expose()
    const err = await inCtx(() => api.write.add!({ title: 42 })).catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.field).toBe("title")
    expect(err.message).toBe("fixture.add: title must be string")
    expect(titles()).toEqual([])
  })

  test("NonBlank rejects empty and blank text with the field name", async () => {
    const nested: WriteOp = {
      ...add,
      input: Type.Object({ item: Type.Object({ title: NonBlank() }) }),
      run: (i) => add.run({ title: i.item.title }),
    }
    const api = expose({ nested })
    for (const title of ["", "   "]) {
      const err = await inCtx(() => api.write.nested!({ item: { title } })).catch((e) => e)
      expect(err).toBeInstanceOf(ValidationError)
      expect(err.field).toBe("item.title")
      expect(err.message).toBe("fixture.nested: item.title must not be blank")
    }
    expect(titles()).toEqual([])
    expect(await inCtx(() => api.write.nested!({ item: { title: " ok " } }))).toEqual({ ref: "F-1", id: 1 })
  })

  test("a missing required property names that property", async () => {
    const api = expose()
    const err = await inCtx(() => api.write.add!({})).catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.field).toBe("title")
  })

  test("reads validate too and then run", async () => {
    const api = expose()
    expect(await inCtx(() => api.read.count!({}))).toEqual({ n: 0 })
    const err = await inCtx(() => api.read.count!(5)).catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.field).toBeUndefined()
  })
})

describe("OperationRegistry: writes", () => {
  test("a write is atomic: run inserts and then throws, no row remains", async () => {
    const api = expose({
      fail: { ...add, run: async (i) => (await add.run(i), Promise.reject(new Error("boom"))) },
    })
    await expect(inCtx(() => api.write.fail!({ title: "half" }))).rejects.toThrow("boom")
    expect(titles()).toEqual([])
    expect(changed).toEqual([])
  })

  test("a write inside another write uses a savepoint; the outer commit keeps both", async () => {
    const api = expose({
      addTwo: {
        ...add,
        run: async (i) => {
          const inner = await api.write.add!({ title: `${i.title} (inner)` })
          expect(kdb.raw.inTransaction()).toBe(true)
          const r = await add.run(i)
          return { ...r, inner: inner.ref }
        },
      },
      addKeepGoing: {
        ...add,
        run: async (i) => {
          await api.write.fail!({ title: "rolled back" }).catch(() => {})
          return add.run(i)
        },
      },
      fail: { ...add, run: async (i) => (await add.run(i), Promise.reject(new Error("boom"))) },
    })
    const out = await inCtx(() => api.write.addTwo!({ title: "outer" }))
    expect(out).toEqual({ ref: "F-2", id: 2, inner: "F-1" })
    expect(titles()).toEqual(["outer (inner)", "outer"])
    await inCtx(() => api.write.addKeepGoing!({ title: "kept" }))
    expect(titles()).toEqual(["outer (inner)", "outer", "kept"])
  })

  test("record.changed is emitted once per write, after commit, never for a rolled-back write", async () => {
    const api = expose({
      addTwo: { ...add, run: async (i) => (await api.write.add!({ title: "inner" }), add.run(i)) },
    })
    await inCtx(() => api.write.add!({ title: "a" }))
    expect(changed).toEqual([{ plugin: "fixture", op: "add", ref: "F-1" }])
    await inCtx(() => api.write.addTwo!({ title: "b" }))
    expect(changed).toEqual([
      { plugin: "fixture", op: "add", ref: "F-1" },
      { plugin: "fixture", op: "add", ref: "F-2" },
      { plugin: "fixture", op: "addTwo", ref: "F-3" },
    ])
  })

  test("with origin inbox I-3, provenance records the new ref", async () => {
    const api = expose()
    await inCtx(() => api.write.add!({ title: "no origin" }))
    const out = await inCtx(() => api.write.add!({ title: "from inbox" }), { type: "inbox", ref: "I-3" })
    expect(out.ref).toBe("F-2")
    expect(await provenance.createdFrom("inbox", "I-3")).toEqual([{ recordType: "fixture_item", recordId: 2, ref: "F-2" }])
    expect(await provenance.createdFrom("inbox", "I-4")).toEqual([])
    expect(kdb.raw.prepare("SELECT * FROM kernel_record_origin").all([])).toEqual([
      { record_type: "fixture_item", record_id: 2, origin_type: "inbox", origin_ref: "I-3", created_at: "2026-11-13T10:00:00" },
    ])
  })

  // A delete returns { ref, deleted: true }: the record is gone, so nothing is recorded for it, and the origins
  // it had are forgotten (ids are rowids and get reused: a later record must not inherit them).
  const remove: WriteOp = {
    input: Type.Object({ ref: Type.String() }),
    output: Type.Object({ ref: Type.String(), deleted: Type.Literal(true) }),
    describe: (i) => `- item ${i.ref}`,
    run: async (i) => {
      await kdb.kysely.deleteFrom("fixture_item").where("id", "=", Number(i.ref.slice(2))).execute()
      return { ref: i.ref, deleted: true as const }
    },
  }
  const origins = () => kdb.raw.prepare("SELECT record_type, record_id, origin_ref FROM kernel_record_origin ORDER BY rowid").all([])

  test("a delete with an origin records no provenance and forgets the deleted record's origins", async () => {
    const api = expose({ remove })
    await inCtx(() => api.write.add!({ title: "a" }), { type: "inbox", ref: "I-3" })
    await inCtx(() => api.write.add!({ title: "b" }), { type: "inbox", ref: "I-3" })
    expect(await inCtx(() => api.write.remove!({ ref: "F-1" }), { type: "inbox", ref: "I-4" })).toEqual({ ref: "F-1", deleted: true })
    expect(origins()).toEqual([{ record_type: "fixture_item", record_id: 2, origin_ref: "I-3" }])
    expect(changed).toContainEqual({ plugin: "fixture", op: "remove", ref: "F-1" })
  })

  test("a delete without an origin forgets the record's origins too; a reused id starts clean", async () => {
    const api = expose({ remove })
    await inCtx(() => api.write.add!({ title: "a" }), { type: "inbox", ref: "I-3" })
    await inCtx(() => api.write.remove!({ ref: "F-1" }))
    await inCtx(() => api.write.add!({ title: "unrelated" }))
    expect(titles()).toEqual(["unrelated"])
    expect(await provenance.createdFrom("inbox", "I-3")).toEqual([])
  })

  test("a deleted ref of a type whose refs are not numeric fails", async () => {
    records.register({ name: "coded", plugin: "fixture", prefix: "#", resolve: async () => 1, label: async () => "x", search: async () => [], ref: async () => "#X" })
    const api = expose({ removeCoded: { ...remove, run: async () => ({ ref: "#X", deleted: true as const }) } })
    await expect(inCtx(() => api.write.removeCoded!({ ref: "#X" }))).rejects.toThrow(
      'write operation "fixture.removeCoded" deleted "#X", but only records with numeric refs can be deleted',
    )
  })

  test("a write whose ref is its own origin records no provenance", async () => {
    const api = expose()
    await inCtx(() => api.write.add!({ title: "a" }))
    await inCtx(() => api.write.add!({ title: "b" }), { type: "inbox", ref: "F-2" })
    expect(origins()).toEqual([])
  })

  test("parallel nested writes: the failing one rolls back alone; events and provenance only for survivors", async () => {
    const fail: WriteOp = { ...add, run: async (i) => (await add.run(i), await new Promise((r) => setTimeout(r, 5)), Promise.reject(new Error("boom"))) }
    const api = expose({
      fail,
      both: {
        ...add,
        run: async (i) => {
          const s = await Promise.allSettled([api.write.fail!({ title: "p" }), api.write.add!({ title: "q" })])
          expect(s.map((x) => x.status)).toEqual(["rejected", "fulfilled"])
          return add.run(i)
        },
      },
    })
    const out = await inCtx(() => api.write.both!({ title: "outer" }), { type: "inbox", ref: "I-7" })
    expect(titles()).toEqual(["q", "outer"])
    expect(changed).toEqual([
      { plugin: "fixture", op: "add", ref: "F-1" },
      { plugin: "fixture", op: "both", ref: out.ref },
    ])
    expect((await provenance.createdFrom("inbox", "I-7")).map((p) => p.ref)).toEqual(["F-1", out.ref])
  })

  test("a record.changed handler that writes, while another write is queued, does not absorb it", async () => {
    const api = expose({ fail: { ...add, run: async (i) => (await add.run(i), Promise.reject(new Error("boom"))) } })
    let fromHandler: Promise<unknown> | undefined
    events.on("record.changed", (p) => {
      if (p.ref === "F-1") fromHandler = inCtx(() => api.write.add!({ title: "from-handler" }))
    })
    const first = inCtx(() => api.write.add!({ title: "first" }))
    const queued = inCtx(() => api.write.fail!({ title: "fail-queued" }))
    await first
    await expect(queued).rejects.toThrow("boom")
    await fromHandler
    expect(titles()).toEqual(["first", "from-handler"])
  })

  test("a record.changed handler runs without the triggering write's origin: its writes record no provenance", async () => {
    const api = expose()
    let fromHandler: Promise<unknown> | undefined
    let seen: unknown
    events.on("record.changed", (p) => {
      if (p.ref !== "F-1") return
      seen = currentContext()
      fromHandler = api.write.add!({ title: "from-handler" }) // no runWithContext: the hook provides one
    })
    await inCtx(() => api.write.add!({ title: "from inbox" }), { type: "inbox", ref: "I-3" })
    await fromHandler
    expect(seen).toEqual({ actor: "me", today: "2026-11-13", now: "2026-11-13T10:00:00" })
    expect(titles()).toEqual(["from inbox", "from-handler"])
    expect((await provenance.createdFrom("inbox", "I-3")).map((p) => p.ref)).toEqual(["F-1"])
  })

  test("an operation called outside an operation context fails before it runs", async () => {
    let ran = false
    const api = expose({ spy: { ...add, run: async (i) => ((ran = true), add.run(i)) } })
    await expect(api.write.spy!({ title: "x" })).rejects.toThrow("no operation context")
    await expect(api.read.count!({})).rejects.toThrow("no operation context")
    expect(ran).toBe(false)
  })

  test("a write whose output lacks ref fails, naming the operation, and rolls back", async () => {
    const api = expose({ noRef: { ...add, output: Type.Object({}), run: async (i) => (await add.run(i), {}) } })
    await expect(inCtx(() => api.write.noRef!({ title: "x" }))).rejects.toThrow(
      'write operation "fixture.noRef" must return { ref: string }',
    )
    expect(titles()).toEqual([])
  })

  test("with output validation on, an output not matching the schema fails", async () => {
    const api = expose({ badOut: { ...add, run: async (i) => ({ ...(await add.run(i)), id: "one" }) } })
    await expect(inCtx(() => api.write.badOut!({ title: "x" }))).rejects.toThrow(
      'operation "fixture.badOut" returned invalid output: id must be integer',
    )
    expect(titles()).toEqual([])
  })

  test("a ref of an unregistered record type fails when an origin needs provenance", async () => {
    const api = expose({ alien: { ...add, run: async (i) => ({ ...(await add.run(i)), ref: "Z-1" }) } })
    await expect(inCtx(() => api.write.alien!({ title: "x" }), { type: "inbox", ref: "I-1" })).rejects.toThrow(
      'write operation "fixture.alien" returned ref "Z-1" of no registered record type',
    )
    expect(titles()).toEqual([])
  })
})

describe("OperationRegistry: registry", () => {
  test("describe validates the input and returns the line", async () => {
    expose()
    expect(await ops.describe("fixture", "add", { title: "x" })).toBe('+ item "x"')
    await expect(ops.describe("fixture", "add", {})).rejects.toBeInstanceOf(ValidationError)
    await expect(ops.describe("fixture", "count", {})).rejects.toBeInstanceOf(NotFoundError)
    await expect(ops.describe("nope", "add", {})).rejects.toBeInstanceOf(NotFoundError)
  })

  test("list, api of an unknown plugin, duplicates and remove", () => {
    expose()
    expect(ops.list()).toEqual([
      { plugin: "fixture", name: "count", kind: "read", input: count.input, output: count.output, assistant: false },
      { plugin: "fixture", name: "add", kind: "write", input: add.input, output: add.output, assistant: false },
    ])
    expect(ops.api("other")).toBeUndefined()
    expect(() => ops.expose("fixture", { write: { add } })).toThrow('operation "fixture.add" is already exposed')
    expect(() => ops.expose("fixture", { write: { count: add } })).toThrow('operation "fixture.count" is already exposed')
    ops.remove("fixture")
    expect(ops.api("fixture")).toBeUndefined()
    expect(ops.list()).toEqual([])
  })
})

describe("OperationRegistry: data changes need a write (R15)", () => {
  const fixtureDb = () =>
    kdb.pluginDb("fixture", {
      ownTables: () => new Set(["item"]),
      views: () => new Map(),
      migrating: () => false,
      ownerOf: (name) => (name === "item" || name === "fixture_item" ? "fixture" : undefined),
    })

  test("a read op that inserts is rejected; the same insert in a write op runs", async () => {
    const data = fixtureDb()
    const insert = (title: string) => data.insertInto("item").values({ title }).executeTakeFirstOrThrow()
    ops.expose("fixture", {
      read: { sneaky: { ...count, run: async () => (await insert("from read"), { n: 0 }) } },
      write: { add: { ...add, run: async (i) => ({ ref: "F-1", id: Number((await insert(i.title)).insertId) }) } },
    })
    const api = ops.api("fixture")!
    const err = await inCtx(() => api.read.sneaky!({})).catch((e) => e)
    expect(err).toBeInstanceOf(IsolationError)
    expect(err.message).toBe("data changes must run inside a write operation")
    expect(titles()).toEqual([])
    expect(await inCtx(() => api.write.add!({ title: "from write" }))).toEqual({ ref: "F-1", id: 1 })
    expect(titles()).toEqual(["from write"])
  })

  test("a read op called from inside a write op is part of that write", async () => {
    const data = fixtureDb()
    ops.expose("fixture", {
      read: { helper: { ...count, run: async () => (await data.insertInto("item").values({ title: "via read" }).execute(), { n: 1 }) } },
      write: { outer: { ...add, run: async () => (await ops.api("fixture")!.read.helper!({}), { ref: "F-1", id: 1 }) } },
    })
    expect(await inCtx(() => ops.api("fixture")!.write.outer!({ title: "x" }))).toEqual({ ref: "F-1", id: 1 })
    expect(titles()).toEqual(["via read"])
  })
})
