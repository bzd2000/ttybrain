import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Type from "typebox"
import { ChangeSetService } from "./changesets"
import { fixedClock } from "./clock"
import { runWithContext, type OpContext } from "./context"
import { KernelDb } from "./db/kernel-db"
import { openRaw } from "./db/sqlite"
import { NotFoundError, PmError, ValidationError } from "./errors"
import { EventBus } from "./events"
import { MigrationRunner } from "./migrations"
import { OperationRegistry, type WriteOp } from "./operations"
import { resolvePaths } from "./paths"
import { ProvenanceStore } from "./provenance"
import { RecordTypeRegistry } from "./records"

let dir: string
let kdb: KernelDb
let provenance: ProvenanceStore
let changeSets: ChangeSetService
let changed: unknown[]

const ctx: OpContext = { actor: "me", today: "2026-11-13", now: "2026-11-13T10:00:00" }
const inCtx = <T>(fn: () => Promise<T>) => runWithContext(ctx, fn)
const rows = (sql: string) => kdb.raw.prepare(sql).all([])
const titles = () => rows("SELECT title FROM fixture_item ORDER BY id").map((r) => r.title)

const add: WriteOp = {
  input: Type.Object({ title: Type.String({ minLength: 1 }) }),
  output: Type.Object({ ref: Type.String() }),
  describe: (i) => `+ item "${i.title}"`,
  run: async (i) => {
    const r = await kdb.kysely.insertInto("fixture_item").values({ title: i.title }).executeTakeFirstOrThrow()
    return { ref: `F-${r.insertId}` }
  },
}
const fail: WriteOp = { ...add, describe: () => "! fail", run: async () => Promise.reject(new Error("boom")) }
const remove: WriteOp = {
  input: Type.Object({ ref: Type.String() }),
  output: Type.Object({ ref: Type.String(), deleted: Type.Literal(true) }),
  describe: (i) => `- item ${i.ref}`,
  run: async (i) => {
    await kdb.kysely.deleteFrom("fixture_item").where("id", "=", Number(i.ref.slice(2))).execute()
    return { ref: i.ref, deleted: true as const }
  },
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pm-cs-"))
  const paths = resolvePaths({ PM_HOME: dir })
  kdb = new KernelDb(openRaw(paths.db))
  await new MigrationRunner(kdb, paths, fixedClock("2026-11-13")).ensureKernelTables()
  kdb.raw.exec("CREATE TABLE fixture_item (id INTEGER PRIMARY KEY, title TEXT NOT NULL)")
  const events = new EventBus()
  changed = []
  events.on("record.changed", (p) => changed.push(p))
  const records = new RecordTypeRegistry()
  records.register({
    name: "fixture_item",
    plugin: "fixture",
    prefix: "F-",
    resolve: async (ref) => Number(ref.slice(2)),
    label: async (id) => `item ${id}`,
    search: async () => [],
  })
  provenance = new ProvenanceStore(kdb, records)
  const ops = new OperationRegistry({ db: kdb, events, records, provenance, validateOutputs: true })
  ops.expose("fixture", { write: { add, fail, remove } })
  changeSets = new ChangeSetService({ db: kdb, ops, records, provenance })
})

afterEach(async () => {
  await kdb.close()
  rmSync(dir, { recursive: true, force: true })
})

describe("ChangeSetService.preview", () => {
  test("returns the describe lines in order", async () => {
    const lines = await inCtx(() =>
      changeSets.preview([
        { plugin: "fixture", operation: "add", input: { title: "a" } },
        { plugin: "fixture", operation: "fail", input: { title: "b" } },
      ]),
    )
    expect(lines).toEqual(['+ item "a"', "! fail"])
  })

  test("an invalid input fails with its index", async () => {
    const err = await inCtx(() =>
      changeSets.preview([
        { plugin: "fixture", operation: "add", input: { title: "a" } },
        { plugin: "fixture", operation: "add", input: {} },
      ]),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.field).toBe("title")
    expect(err.details).toEqual({ index: 1 })
  })
})

describe("ChangeSetService.apply", () => {
  test("the second op throws: nothing from the first remains, details.index === 1", async () => {
    const err = await inCtx(() =>
      changeSets.apply(
        [
          { plugin: "fixture", operation: "add", input: { title: "first" } },
          { plugin: "fixture", operation: "fail", input: { title: "second" } },
        ],
        { type: "inbox", ref: "I-3" },
      ),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(PmError)
    expect(err.message).toBe("boom")
    expect(err.details).toEqual({ index: 1 })
    expect(titles()).toEqual([])
    expect(rows("SELECT * FROM kernel_change_set")).toEqual([])
    expect(rows("SELECT * FROM kernel_change_set_op")).toEqual([])
    expect(rows("SELECT * FROM kernel_record_origin")).toEqual([])
    expect(changed).toEqual([])
  })

  test("an unknown operation fails as not found with its index, keeping its own details", async () => {
    const err = await inCtx(() =>
      changeSets.apply([
        { plugin: "fixture", operation: "add", input: { title: "first" } },
        { plugin: "fixture", operation: "nope", input: {} },
      ]),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.message).toBe('no write operation "fixture.nope"')
    expect(err.details).toEqual({ index: 1 })
    expect(titles()).toEqual([])
  })

  test("a successful apply writes 1 + 2 log rows and records provenance with origin changeset", async () => {
    const result = await inCtx(() =>
      changeSets.apply(
        [
          { plugin: "fixture", operation: "add", input: { title: "first" } },
          { plugin: "fixture", operation: "add", input: { title: "second" } },
        ],
        { type: "inbox", ref: "I-3" },
      ),
    )
    expect(result).toEqual({ id: 1, refs: ["F-1", "F-2"] })
    expect(titles()).toEqual(["first", "second"])
    expect(rows("SELECT * FROM kernel_change_set")).toEqual([
      { id: 1, origin_type: "inbox", origin_ref: "I-3", created_at: "2026-11-13T10:00:00" },
    ])
    expect(rows("SELECT * FROM kernel_change_set_op ORDER BY position")).toEqual([
      {
        change_set_id: 1,
        position: 0,
        plugin: "fixture",
        operation: "add",
        input_json: '{"title":"first"}',
        description: '+ item "first"',
        result_ref: "F-1",
      },
      {
        change_set_id: 1,
        position: 1,
        plugin: "fixture",
        operation: "add",
        input_json: '{"title":"second"}',
        description: '+ item "second"',
        result_ref: "F-2",
      },
    ])
    const created = await provenance.createdFrom("changeset", "CS-1")
    expect(created.map((c) => c.ref)).toEqual(["F-1", "F-2"])
    // The change set's own origin is recorded too, so an inbox item processed through a change set
    // still shows what it became.
    expect((await provenance.createdFrom("inbox", "I-3")).map((c) => c.ref)).toEqual(["F-1", "F-2"])
    expect(changed).toEqual([
      { plugin: "fixture", op: "add", ref: "F-1" },
      { plugin: "fixture", op: "add", ref: "F-2" },
    ])
  })

  test("a delete in a set records no provenance for its ref and forgets the record's origins", async () => {
    const result = await inCtx(() =>
      changeSets.apply(
        [
          { plugin: "fixture", operation: "add", input: { title: "first" } },
          { plugin: "fixture", operation: "add", input: { title: "second" } },
          { plugin: "fixture", operation: "remove", input: { ref: "F-1" } },
        ],
        { type: "inbox", ref: "I-3" },
      ),
    )
    expect(result).toEqual({ id: 1, refs: ["F-1", "F-2", "F-1"] })
    expect(rows("SELECT record_id, origin_type, origin_ref FROM kernel_record_origin ORDER BY rowid")).toEqual([
      { record_id: 2, origin_type: "changeset", origin_ref: "CS-1" },
      { record_id: 2, origin_type: "inbox", origin_ref: "I-3" },
    ])
  })

  test("a result ref that does not resolve fails the set (no silent skip)", async () => {
    const records = new RecordTypeRegistry()
    records.register({ name: "fixture_item", plugin: "fixture", prefix: "F-", resolve: async () => null, label: async () => "", search: async () => [] })
    const events = new EventBus()
    const ops = new OperationRegistry({ db: kdb, events, records, provenance: new ProvenanceStore(kdb, records), validateOutputs: true })
    ops.expose("fixture", { write: { add } })
    const cs = new ChangeSetService({ db: kdb, ops, records, provenance: new ProvenanceStore(kdb, records) })
    await expect(inCtx(() => cs.apply([{ plugin: "fixture", operation: "add", input: { title: "x" } }], { type: "inbox", ref: "I-3" }))).rejects.toThrow(
      'write operation "fixture.add" returned ref "F-1", which does not resolve',
    )
    expect(titles()).toEqual([])
  })

  test("without an origin the change set is logged with null origin", async () => {
    const result = await inCtx(() => changeSets.apply([{ plugin: "fixture", operation: "add", input: { title: "x" } }]))
    expect(result).toEqual({ id: 1, refs: ["F-1"] })
    expect(rows("SELECT origin_type, origin_ref FROM kernel_change_set")).toEqual([{ origin_type: null, origin_ref: null }])
    expect((await provenance.createdFrom("changeset", "CS-1")).map((c) => c.ref)).toEqual(["F-1"])
  })

  test("an empty change set is refused", async () => {
    await expect(inCtx(() => changeSets.apply([]))).rejects.toThrow(ValidationError)
    expect(rows("SELECT * FROM kernel_change_set")).toEqual([])
  })
})
