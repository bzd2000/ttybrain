// Repeats the core data-isolation cases on the current runtime, with two fixture plugins on a temp database.
// Run: `bun src/kernel/isolation-selfcheck.ts` or, after the Node build, `node dist-node/kernel/isolation-selfcheck.js`.
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { sql, type Kysely } from "kysely"
import { definePlugin, Type, type PluginDef } from "./api"
import { fixedClock } from "./clock"
import { runWithContext } from "./context"
import { IsolationError } from "./errors"
import { bootKernel } from "./host"

export type SelfCheckResult = { name: string; ok: boolean; message?: string }

const PRAGMAS = ["query_only", "ignore_check_constraints", "recursive_triggers", "trusted_schema", "foreign_keys"]

export async function runIsolationSelfCheck(): Promise<{ ok: boolean; results: SelfCheckResult[] }> {
  const dir = mkdtempSync(join(tmpdir(), "pm-isolation-"))
  const results: SelfCheckResult[] = []
  let probeDb!: Kysely<any>
  let ownerDb!: Kysely<any>

  const owner: PluginDef = definePlugin({
    id: "owner",
    name: "Owner",
    version: "1.0.0",
    apiVersion: 1,
    activate(ctx) {
      ownerDb = ctx.data
      ctx.migration("001", async (db) => {
        await db.schema
          .createTable("thing")
          .addColumn("id", "integer", (c) => c.primaryKey())
          .addColumn("title", "text", (c) => c.notNull())
          .addColumn("secret", "text")
          .execute()
      })
      ctx.publish("thing", {
        version: 1,
        columns: { id: "integer", title: "text" },
        query: (db) => db.selectFrom("thing").select(["id", "title"]),
      })
      ctx.expose({
        write: {
          add: {
            input: Type.Object({ title: Type.String({ minLength: 1 }) }),
            output: Type.Object({ ref: Type.String(), id: Type.Integer() }),
            describe: (i) => `+ thing "${i.title}"`,
            run: async (i) => {
              const r = await ctx.data.insertInto("thing").values({ title: i.title, secret: "hidden" }).executeTakeFirstOrThrow()
              return { ref: `T-${r.insertId}`, id: Number(r.insertId) }
            },
          },
        },
      })
    },
  })

  const probe: PluginDef = definePlugin({
    id: "probe",
    name: "Probe",
    version: "1.0.0",
    apiVersion: 1,
    reads: { owner: "^1.0.0" },
    activate(ctx) {
      probeDb = ctx.data
      ctx.migration("001", async (db) => {
        await db.schema
          .createTable("note")
          .addColumn("id", "integer", (c) => c.primaryKey())
          .addColumn("thing_id", "integer")
          .addColumn("body", "text")
          .execute()
      })
      ctx.expose({
        write: {
          add: {
            input: Type.Object({ thingId: Type.Integer(), body: Type.String({ minLength: 1 }) }),
            output: Type.Object({ ref: Type.String() }),
            describe: (i) => `+ note "${i.body}"`,
            run: async (i) => {
              const r = await ctx.data.insertInto("note").values({ thing_id: i.thingId, body: i.body }).executeTakeFirstOrThrow()
              return { ref: `N-${r.insertId}` }
            },
          },
        },
      })
    },
  })

  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (e) {
      results.push({ name, ok: false, message: e instanceof Error ? e.message : String(e) })
    }
  }
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg)
  }
  const rejects = async (run: () => Promise<unknown>, expected?: string) => {
    try {
      await run()
    } catch (e) {
      assert(e instanceof IsolationError, `expected an IsolationError, got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
      if (expected) assert((e as Error).message.includes(expected), `message "${(e as Error).message}" lacks "${expected}"`)
      return
    }
    throw new Error("the query ran, but it should have been rejected")
  }

  let kernel: Awaited<ReturnType<typeof bootKernel>> | undefined
  try {
    kernel = await bootKernel({ env: { TTYBRAIN_HOME: dir, TTYBRAIN_TEST: "1" }, plugins: [owner, probe], clock: fixedClock("2026-11-13") })
    const k = kernel
    const bad = k.plugins.filter((p) => p.status !== "ok")
    assert(bad.length === 0, `fixture plugins failed to load: ${bad.map((p) => `${p.id}: ${p.error}`).join("; ")}`)

    const asMe = <T>(fn: () => Promise<T>) => runWithContext(k.context(), fn)
    const thing = await asMe(() => k.ops.api("owner")!.write.add!({ title: "First" }))
    await asMe(() => k.ops.api("probe")!.write.add!({ thingId: thing.id, body: "note one" }))
    const pragmas = () =>
      Object.fromEntries(PRAGMAS.map((p) => [p, Object.values(k.db.raw.prepare(`PRAGMA ${p}`).all([])[0] ?? {})[0]]))
    const before = pragmas()

    await check("own table read", async () => {
      const rows = await probeDb.selectFrom("note").select(["id", "body"]).execute()
      assert(JSON.stringify(rows) === JSON.stringify([{ id: 1, body: "note one" }]), `got ${JSON.stringify(rows)}`)
    })
    await check("published view read, and a join with an own table", async () => {
      const rows = await probeDb
        .selectFrom("note as n")
        .innerJoin("owner.thing as t", "t.id", "n.thing_id")
        .select(["n.body", "t.title"])
        .execute()
      assert(JSON.stringify(rows) === JSON.stringify([{ body: "note one", title: "First" }]), `got ${JSON.stringify(rows)}`)
    })
    await check("another plugin's table: select", () => rejects(() => probeDb.selectFrom("thing").selectAll().execute(), 'table "thing" is not owned by plugin "probe"'))
    await check("another plugin's table: join", () =>
      rejects(() => probeDb.selectFrom("note").innerJoin("thing", "thing.id", "note.thing_id").selectAll().execute()),
    )
    await check("another plugin's table: update", () => rejects(() => probeDb.updateTable("thing").set({ title: "X" }).execute()))
    await check("another plugin's table: sub-query", () =>
      rejects(() =>
        probeDb
          .selectFrom("note")
          .selectAll()
          .where("thing_id", "in", (eb: any) => eb.selectFrom("thing").select("id"))
          .execute(),
      ),
    )
    await check("another plugin's table: DELETE without WHERE", () => rejects(() => probeDb.deleteFrom("thing").execute()))
    await check("raw sql on another plugin's table", () =>
      rejects(() => sql`SELECT * FROM owner_thing`.execute(probeDb), 'plugin "probe" may not use table "owner_thing"'),
    )
    await check("raw sql on a kernel table", () => rejects(() => sql`SELECT * FROM kernel_plugin_migration`.execute(probeDb)))
    await check("raw sql with a table-valued function or virtual table", async () => {
      await rejects(() => sql`SELECT * FROM pragma_table_info('owner_thing')`.execute(probeDb), "table-valued functions and virtual tables are not allowed")
      await rejects(() => sql`SELECT * FROM dbstat`.execute(probeDb), "table-valued functions and virtual tables are not allowed")
    })
    await check("a view is read-only", () =>
      rejects(() => probeDb.updateTable("owner.thing").set({ title: "X" }).execute(), "owner.thing is a published view and is read-only"),
    )
    await check("a column the view does not publish", () =>
      rejects(() => probeDb.selectFrom("owner.thing").select("secret").execute(), 'unknown column "secret"'),
    )
    await check("raw PRAGMA is rejected and the connection pragmas are unchanged", async () => {
      for (const q of ["PRAGMA query_only=1", "PRAGMA foreign_keys = OFF", "/* x */ PRAGMA ignore_check_constraints=1"]) {
        await rejects(() => sql.raw(q).execute(probeDb))
      }
      assert(JSON.stringify(pragmas()) === JSON.stringify(before), `pragmas changed: ${JSON.stringify(before)} -> ${JSON.stringify(pragmas())}`)
    })
    await check("plugin DML outside a write operation", async () => {
      await rejects(() => probeDb.insertInto("note").values({ body: "x" }).execute(), "data changes must run inside a write operation")
      await rejects(() => sql`DELETE FROM probe_note`.execute(probeDb), "data changes must run inside a write operation")
    })
    await check("plugin DML inside a bare kernel write that is not an operation (the TUI's act)", async () => {
      await rejects(() => k.db.write(() => probeDb.insertInto("note").values({ body: "x" }).execute()), "data changes must run inside a write operation")
      await rejects(() => asMe(() => k.db.write(() => sql`DELETE FROM probe_note`.execute(probeDb))), "data changes must run inside a write operation")
    })
    await check("schema changes outside a migration", () =>
      rejects(() => probeDb.schema.createTable("x").addColumn("id", "integer").execute(), "schema changes are only allowed in migrations"),
    )
    await check("raw transaction control", () => rejects(() => sql`BEGIN`.execute(probeDb), "transactions are managed by the kernel"))
    await check("kysely.transaction()", () => rejects(() => probeDb.transaction().execute(async () => {})))
    await check("nothing leaked into the other plugin's data", async () => {
      const t = await ownerDb.selectFrom("thing").select(["id", "title", "secret"]).execute()
      assert(JSON.stringify(t) === JSON.stringify([{ id: 1, title: "First", secret: "hidden" }]), `got ${JSON.stringify(t)}`)
      const n = await probeDb.selectFrom("note").select("id").execute()
      assert(n.length === 1, `expected 1 note, got ${n.length}`)
    })
  } catch (e) {
    results.push({ name: "boot", ok: false, message: e instanceof Error ? e.message : String(e) })
  } finally {
    try {
      await kernel?.shutdown()
    } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
  await checkDataSteps(check, assert)
  return { ok: results.length > 0 && results.every((r) => r.ok), results }
}

// Data steps (ctx.upgrade) on this runtime: a boot that finds the write lock taken leaves a pending step for later
// without waiting; the next boot runs it once, with own DML and a read of a `reads`-only plugin through ctx.use.
async function checkDataSteps(check: (name: string, fn: () => Promise<void>) => Promise<void>, assert: (cond: boolean, msg: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "pm-steps-"))
  let runs = 0
  const giver = definePlugin({
    id: "giver",
    name: "Giver",
    version: "1.0.0",
    apiVersion: 1,
    activate(ctx) {
      ctx.expose({ read: { ready: { input: Type.Object({}), output: Type.Boolean(), run: async () => true } } })
    },
  })
  const taker = (withStep: boolean) =>
    definePlugin({
      id: "taker",
      name: "Taker",
      version: "1.0.0",
      apiVersion: 1,
      reads: { giver: "^1.0.0" },
      activate(ctx) {
        ctx.migration("001", async (db) => {
          await db.schema.createTable("row").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("note", "text").execute()
        })
        if (!withStep) return
        ctx.upgrade("s1", async () => {
          runs++
          const g = ctx.use("giver")
          if (!g || g.write !== undefined || !(await g.read.ready!({}))) return "later"
          await ctx.data.insertInto("row").values({ note: "moved" }).execute()
          return "done"
        })
      },
    })
  const boot = (withStep: boolean) =>
    bootKernel({ env: { TTYBRAIN_HOME: dir, TTYBRAIN_TEST: "1" }, plugins: [giver, taker(withStep)], clock: fixedClock("2026-11-13") })
  let first: Awaited<ReturnType<typeof bootKernel>> | undefined
  try {
    first = await boot(false)
    const k = first
    await check("a pending data step does not wait for another connection's write lock", async () => {
      k.db.raw.exec("BEGIN IMMEDIATE")
      try {
        const started = performance.now()
        const b = await boot(true)
        const ms = performance.now() - started
        await b.shutdown()
        assert(ms < 1000 && runs === 0, `boot took ${Math.round(ms)} ms and ran the step ${runs} times`)
      } finally {
        k.db.raw.exec("ROLLBACK")
      }
    })
    await check("a data step runs once, then is recorded", async () => {
      for (let i = 0; i < 2; i++) await (await boot(true)).shutdown()
      const rows = k.db.raw.prepare("SELECT note FROM taker_row").all([])
      const ids = k.db.raw.prepare("SELECT id FROM kernel_plugin_migration WHERE plugin = 'taker' ORDER BY id").all([]).map((r) => r.id)
      assert(runs === 1 && JSON.stringify(rows) === '[{"note":"moved"}]' && JSON.stringify(ids) === '["001","upgrade:s1"]', `runs ${runs}, rows ${JSON.stringify(rows)}, ids ${JSON.stringify(ids)}`)
    })
  } catch (e) {
    await check("data steps boot", async () => {
      throw e
    })
  } finally {
    try {
      await first?.shutdown()
    } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
}

// Runtime-neutral "am I the entry module" (no import.meta.main): compare real paths.
function isEntry(): boolean {
  const script = process.argv[1]
  if (!script) return false
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntry()) {
  runIsolationSelfCheck().then(
    ({ ok, results }) => {
      for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.message ? `: ${r.message}` : ""}`)
      if (ok) console.log("isolation ok")
      else console.error("isolation FAILED")
      process.exit(ok ? 0 : 1)
    },
    (e) => {
      console.error("isolation FAILED:", e)
      process.exit(1)
    },
  )
}
