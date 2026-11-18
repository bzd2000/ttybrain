import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Type from "typebox"
import { builtinPlugins } from "../../tests/builtins"
import { makeTestKernel } from "../../tests/helpers"
import { ChangeSetService, type ChangeSetDeps } from "./changesets"
import { runCli } from "./cli/dispatch"
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
let deps: ChangeSetDeps
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
  // Origins are checked by the kernel's checkOrigin (host.ts); these unit tests accept every origin.
  deps = { db: kdb, ops, records, provenance, checkOrigin: async () => {} }
  changeSets = new ChangeSetService(deps)
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
    const cs = new ChangeSetService({ ...deps, ops, records, provenance: new ProvenanceStore(kdb, records) })
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

  test("a forged delete of another plugin's record in a set fails the set and leaves its origins alone", async () => {
    const records = new RecordTypeRegistry()
    records.register({ name: "fixture_item", plugin: "fixture", prefix: "F-", resolve: async (r) => Number(r.slice(2)), label: async () => "", search: async () => [] })
    records.register({ name: "other_item", plugin: "other", prefix: "O-", resolve: async (r) => Number(r.slice(2)), label: async () => "", search: async () => [] })
    records.register({ name: "other_coded", plugin: "other", prefix: "$", resolve: async () => 42, label: async () => "", search: async () => [], ref: async () => "$CRM" })
    const prov = new ProvenanceStore(kdb, records)
    const ops = new OperationRegistry({ db: kdb, events: new EventBus(), records, provenance: prov, validateOutputs: true })
    ops.expose("fixture", {
      write: {
        add,
        forgeNumeric: { ...remove, run: async () => ({ ref: "O-12", deleted: true as const }) },
        forgeCoded: { ...remove, run: async () => ({ ref: "$CRM", deleted: true as const, id: 42 }) },
      },
    })
    const cs = new ChangeSetService({ ...deps, ops, records, provenance: prov })
    await inCtx(async () => {
      await prov.record("other_item", 12, { type: "inbox", ref: "I-3" })
      await prov.record("other_coded", 42, { type: "inbox", ref: "I-3" })
    })
    const before = rows("SELECT * FROM kernel_record_origin ORDER BY rowid")
    for (const [operation, ref] of [["forgeNumeric", "O-12"], ["forgeCoded", "$CRM"]] as const) {
      const err = await inCtx(() =>
        cs.apply([{ plugin: "fixture", operation: "add", input: { title: "x" } }, { plugin: "fixture", operation, input: { ref } }], { type: "inbox", ref: "I-3" }),
      ).catch((e) => e)
      expect(err.message).toBe(`write operation "fixture.${operation}" deleted "${ref}", a record of plugin "other": a write may only delete its own plugin's records`)
      expect(err.details).toEqual({ index: 1 })
    }
    expect(rows("SELECT * FROM kernel_record_origin ORDER BY rowid")).toEqual(before)
    expect(before).toHaveLength(2)
    expect(titles()).toEqual([])
    expect(rows("SELECT * FROM kernel_change_set")).toEqual([])
  })

  test("the set's origin is checked before anything is written", async () => {
    const checked: unknown[] = []
    const cs = new ChangeSetService({
      ...deps,
      checkOrigin: async (o) => {
        checked.push(o)
        throw new NotFoundError(`no record "${o.ref}"`)
      },
    })
    const op = { plugin: "fixture", operation: "add", input: { title: "x" } }
    await expect(inCtx(() => cs.apply([op], { type: "inbox", ref: "I-99" }))).rejects.toThrow('no record "I-99"')
    expect(checked).toEqual([{ type: "inbox", ref: "I-99" }])
    expect(titles()).toEqual([])
    expect(rows("SELECT * FROM kernel_change_set")).toEqual([])
    await inCtx(() => cs.apply([op]))
    expect(checked).toHaveLength(1) // no origin, nothing to check
  })
})

describe("origins are checked by the kernel, not only by the CLI", () => {
  test("every origin is checked, not only the CLI's", async () => {
    const k = await makeTestKernel({ plugins: builtinPlugins })
    try {
      const capture = { plugin: "inbox", operation: "capture", input: { text: "x" } }
      const inK = <T>(fn: () => Promise<T>) => runWithContext(k.context(), fn)
      const count = (t: string) => k.db.raw.prepare(`SELECT count(*) AS n FROM ${t}`).all([])[0]!.n
      expect((await inK(() => k.changeSets.apply([capture]))).refs).toEqual(["I-1"])
      const err = await inK(() => k.changeSets.apply([capture], { type: "inbox", ref: "I-99" })).catch((e) => e)
      expect(err).toBeInstanceOf(NotFoundError)
      expect(err.message).toBe('no record "I-99"')
      expect(err.hint).toBe('run "pm inbox list"')
      expect([count("kernel_change_set"), count("inbox_item")]).toEqual([1, 1])
      // An existing item is fine, and so is an origin that is no record (a change set's CS-<id>).
      expect((await inK(() => k.changeSets.apply([capture], { type: "inbox", ref: "I-1" }))).refs).toEqual(["I-2"])
      expect((await inK(() => k.changeSets.apply([capture], { type: "changeset", ref: "CS-1" }))).refs).toEqual(["I-3"])
      // The CLI keeps its own text.
      let out = ""
      const code = await runCli(["inbox", "add", "y", "--from-inbox", "I-99", "--json"], k, { out: (s) => void (out += s), err: () => {}, stdin: async () => "" })
      expect(code).toBe(2)
      expect(JSON.parse(out).error).toEqual({ code: "not_found", message: '--from-inbox: no record "I-99"', hint: 'run "pm inbox list"' })
    } finally {
      await k.cleanup()
    }
  })
})
