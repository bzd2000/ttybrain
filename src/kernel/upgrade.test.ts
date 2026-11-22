// One-time data steps (`ctx.upgrade`) and read access through `ctx.use` for plugins in `reads`.
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { makeTestKernel, type TestKernel } from "../../tests/helpers"
import { definePlugin, sql, Type, type PluginContext, type PluginDef } from "./api"
import { runCli } from "./cli/dispatch"
import { fixedClock } from "./clock"
import { runWithContext } from "./context"
import { openRaw } from "./db/sqlite"
import { bootKernel, type Kernel } from "./host"
import { MigrationRunner } from "./migrations"

let cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.reverse()) await c()
  cleanups = []
})

async function first(plugins: PluginDef[]): Promise<TestKernel> {
  const k = await makeTestKernel({ plugins })
  cleanups.push(() => k.cleanup())
  return k
}

async function again(home: string, plugins: PluginDef[]): Promise<Kernel> {
  const k = await bootKernel({ env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1" }, plugins, clock: fixedClock("2026-11-13") })
  cleanups.push(() => k.shutdown())
  return k
}

function io() {
  const o = { out: "", err: "" }
  return { o, io: { out: (s: string) => void (o.out += s), err: (s: string) => void (o.err += s), stdin: async () => "" } }
}

type Step = (ctx: PluginContext) => Promise<"done" | "later">

// A plugin with one own table `row (id, note)`, a write op `add`, a read op `count`, and, when given, a data step "s1".
function plugin(id: string, step?: Step, more: Partial<PluginDef> = {}): PluginDef {
  return definePlugin({
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 1,
    ...more,
    activate(ctx) {
      ctx.migration("001", async (db) => {
        await db.schema.createTable("row").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("note", "text").execute()
      })
      ctx.expose({
        read: {
          count: { input: Type.Object({}), output: Type.Object({ n: Type.Number() }), run: async () => ({ n: await count(ctx) }) },
        },
        write: {
          add: {
            input: Type.Object({ note: Type.String() }),
            output: Type.Object({ ref: Type.String() }),
            describe: (i) => `+ ${i.note}`,
            run: async (i) => {
              const r = await ctx.data.insertInto("row").values({ note: i.note }).executeTakeFirst()
              return { ref: `R-${Number(r.insertId)}` }
            },
          },
        },
      })
      if (step) ctx.upgrade("s1", () => step(ctx))
    },
  })
}

async function count(ctx: Pick<PluginContext, "data">): Promise<number> {
  const r = await ctx.data.selectFrom("row").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow()
  return Number(r.n)
}

const notes = (k: Kernel, id: string) => k.db.raw.prepare(`SELECT note FROM ${id}_row ORDER BY id`).all([]).map((r) => r.note)
const recorded = (k: Kernel, id: string) =>
  k.db.raw.prepare("SELECT id FROM kernel_plugin_migration WHERE plugin = ? ORDER BY id").all([id]).map((r) => r.id)

describe("data steps", () => {
  test("a step runs once and is recorded", async () => {
    let runs = 0
    const step: Step = async (ctx) => {
      runs++
      await ctx.data.insertInto("row").values({ note: "direct" }).execute() // own DML, like a migration's data part
      await ctx.self().write.add!({ note: "via op" })
      return "done"
    }
    const a = await first([plugin("alpha", step)])
    expect(runs).toBe(1)
    expect(notes(a, "alpha")).toEqual(["direct", "via op"])
    expect(recorded(a, "alpha")).toEqual(["001", "upgrade:s1"])
    expect(a.plugins.find((p) => p.id === "alpha")).toEqual({ id: "alpha", version: "1.0.0", source: "built-in", status: "ok" })

    const before = a.db.dataVersion()
    const b = await again(a.home, [plugin("alpha", step)])
    expect(runs).toBe(1)
    expect(a.db.dataVersion()).toBe(before) // the second boot does not write
    expect(notes(b, "alpha")).toEqual(["direct", "via op"])
    expect(b.plugins.find((p) => p.id === "alpha")?.status).toBe("ok")
  })

  test("later leaves it pending and it runs on a later boot", async () => {
    let ready = false
    let runs = 0
    const step: Step = async (ctx) => {
      runs++
      await ctx.self().write.add!({ note: `run ${runs}` }) // committed only with "done"
      return ready ? "done" : "later"
    }
    const a = await first([plugin("alpha", step)])
    expect(runs).toBe(2) // the first pass and the second pass of the same boot
    expect(notes(a, "alpha")).toEqual([])
    expect(recorded(a, "alpha")).toEqual(["001"])
    expect(a.plugins.find((p) => p.id === "alpha")).toEqual({ id: "alpha", version: "1.0.0", source: "built-in", status: "ok" })

    await again(a.home, [plugin("alpha", step)])
    expect(runs).toBe(4)
    ready = true
    const c = await again(a.home, [plugin("alpha", step)])
    expect(runs).toBe(5)
    expect(notes(c, "alpha")).toEqual(["run 5"])
    expect(recorded(c, "alpha")).toEqual(["001", "upgrade:s1"])
    await again(a.home, [plugin("alpha", step)])
    expect(runs).toBe(5)
  })

  // Giver hands its rows over: taker copies them once giver reports them (taker reads giver); giver empties its
  // table once taker reports it holds them (giver reads taker). Neither requires the other.
  function handover(log: string[]): PluginDef[] {
    const giver = plugin(
      "giver",
      async (ctx) => {
        const taker = ctx.read("taker")
        if (!taker) return "later"
        const { n } = await taker.count!({})
        log.push(`giver sees ${n}`)
        if (n === 0) return "later"
        await ctx.data.deleteFrom("row").execute()
        return "done"
      },
      { reads: { taker: "^1.0.0" } },
    )
    const taker = plugin(
      "taker",
      async (ctx) => {
        const giver = ctx.read("giver")
        if (!giver) return "later"
        const { n } = await giver.count!({})
        log.push(`taker sees ${n}`)
        if (n === 0) return "later"
        for (let i = 0; i < n; i++) await ctx.self().write.add!({ note: `copied ${i + 1}` })
        return "done"
      },
      { reads: { giver: "^1.0.0" } },
    )
    return [giver, taker]
  }

  // The giver's rows exist before either step can run: seed them on a boot where the taker is disabled.
  async function seeded(order: "giver first" | "taker first") {
    const log: string[] = []
    const [giver, taker] = handover(log)
    const plugins = order === "giver first" ? [giver!, taker!] : [taker!, giver!]
    const a = await makeTestKernel({ plugins, env: { TTYBRAIN_CONFIG_JSON: JSON.stringify({ plugins: { disabled: ["taker"] } }) } })
    cleanups.push(() => a.cleanup())
    await runWithContext(a.context(), async () => {
      await a.ops.api("giver")!.write.add!({ note: "x" })
      await a.ops.api("giver")!.write.add!({ note: "y" })
    })
    expect(log).toEqual([]) // the giver's step waited for the taker (not loaded)
    return { a, plugins, log }
  }

  for (const order of ["giver first", "taker first"] as const) {
    test(`two plugins hand data over in either load order (${order})`, async () => {
      const { a, plugins, log } = await seeded(order)
      const b = await again(a.home, plugins)
      expect(notes(b, "taker")).toEqual(["copied 1", "copied 2"])
      expect(notes(b, "giver")).toEqual([])
      expect(recorded(b, "giver")).toEqual(["001", "upgrade:s1"])
      expect(recorded(b, "taker")).toEqual(["001", "upgrade:s1"])
      expect(log).toEqual(order === "giver first" ? ["giver sees 0", "taker sees 2", "giver sees 2"] : ["taker sees 2", "giver sees 2"])
    })
  }

  test("a throwing step rolls back, stays pending, plugin stays ok, error listed", async () => {
    let fail = true
    const step: Step = async (ctx) => {
      await ctx.self().write.add!({ note: "half" })
      if (fail) throw new Error("boom")
      return "done"
    }
    const a = await first([plugin("alpha", step), plugin("beta")])
    expect(notes(a, "alpha")).toEqual([])
    expect(recorded(a, "alpha")).toEqual(["001"])
    expect(a.plugins.find((p) => p.id === "alpha")).toEqual({
      id: "alpha",
      version: "1.0.0",
      source: "built-in",
      status: "ok",
      error: 'data step "s1" failed: boom',
    })
    // The plugin stays loaded: its operations work.
    await runWithContext(a.context(), () => a.ops.api("alpha")!.write.add!({ note: "later on" }))
    expect(notes(a, "alpha")).toEqual(["later on"])
    const { o, io: cli } = io()
    expect(await runCli(["plugin", "list", "--json"], a, cli)).toBe(0)
    expect(JSON.parse(o.out)).toEqual([
      { id: "alpha", version: "1.0.0", source: "built-in", status: "ok", error: 'data step "s1" failed: boom' },
      { id: "beta", version: "1.0.0", source: "built-in", status: "ok", error: null },
    ])

    fail = false
    const b = await again(a.home, [plugin("alpha", step), plugin("beta")])
    expect(notes(b, "alpha")).toEqual(["later on", "half"])
    expect(recorded(b, "alpha")).toEqual(["001", "upgrade:s1"])
    expect(b.plugins.find((p) => p.id === "alpha")?.error).toBeUndefined()
  })

  test("a step may not change the schema", async () => {
    const builder: Step = async (ctx) => {
      await ctx.data.schema.createTable("extra").addColumn("id", "integer").execute()
      return "done"
    }
    const a = await first([plugin("alpha", builder)])
    expect(a.plugins[0]).toMatchObject({ status: "ok", error: 'data step "s1" failed: schema changes are only allowed in migrations' })
    const raw: Step = async (ctx) => {
      await sql`CREATE TABLE alpha_extra (id INTEGER)`.execute(ctx.data)
      return "done"
    }
    const b = await again(a.home, [plugin("alpha", raw)])
    expect(b.plugins[0]?.status).toBe("ok")
    expect(b.plugins[0]?.error).toStartWith('data step "s1" failed: ')
    expect(b.db.raw.prepare("SELECT name FROM sqlite_schema WHERE name = 'alpha_extra'").all([])).toEqual([])
    expect(recorded(b, "alpha")).toEqual(["001"])
  })

  test("ids: duplicated or empty ids fail the plugin; a migration may not use the upgrade: prefix", async () => {
    const dup = definePlugin({
      id: "alpha",
      name: "a",
      version: "1.0.0",
      apiVersion: 1,
      activate(ctx) {
        ctx.upgrade("s1", async () => "done")
        ctx.upgrade("s1", async () => "done")
      },
    })
    const empty = definePlugin({ ...dup, id: "beta", activate: (ctx) => ctx.upgrade("", async () => "done") })
    const prefixed = definePlugin({ ...dup, id: "gamma", activate: (ctx) => ctx.migration("upgrade:x", async () => {}) })
    const k = await first([dup, empty, prefixed])
    expect(k.plugins.map((p) => [p.id, p.status, p.error])).toEqual([
      ["alpha", "failed", 'data step id "s1" is empty or duplicated'],
      ["beta", "failed", 'data step id "" is empty or duplicated'],
      ["gamma", "failed", 'plugin "gamma": migration id "upgrade:x" may not start with "upgrade:" (kept for data steps)'],
    ])
  })

  test("upgrade() after activate throws", async () => {
    let late: PluginContext | undefined
    const k = await first([definePlugin({ id: "alpha", name: "a", version: "1.0.0", apiVersion: 1, activate: (ctx) => void (late = ctx) })])
    expect(k.plugins[0]?.status).toBe("ok")
    expect(() => late!.upgrade("s1", async () => "done")).toThrow("plugins can only register during activate")
  })

  test("a pending step does not hold up a boot while another process writes; it runs on the next boot", async () => {
    let runs = 0
    const step: Step = async (ctx) => {
      runs++
      await ctx.self().write.add!({ note: "moved" })
      return "done"
    }
    const a = await first([plugin("alpha")])
    a.db.raw.exec("BEGIN IMMEDIATE")
    let b: Kernel
    try {
      const started = performance.now()
      b = await again(a.home, [plugin("alpha", step)])
      expect(performance.now() - started).toBeLessThan(1000)
      expect(runs).toBe(0)
      expect(b.plugins[0]).toEqual({ id: "alpha", version: "1.0.0", source: "built-in", status: "ok" })
      const { io: cli } = io()
      expect(await runCli(["help"], b, cli)).toBe(0)
    } finally {
      a.db.raw.exec("ROLLBACK")
    }
    expect(recorded(a, "alpha")).toEqual(["001"])
    const c = await again(a.home, [plugin("alpha", step)])
    expect(runs).toBe(1)
    expect(notes(c, "alpha")).toEqual(["moved"])
    expect(recorded(c, "alpha")).toEqual(["001", "upgrade:s1"])
  })

  test("a failed plugin's steps do not run; a migration runner ignores step rows", async () => {
    let runs = 0
    const broken = definePlugin({
      id: "alpha",
      name: "a",
      version: "1.0.0",
      apiVersion: 1,
      activate(ctx) {
        ctx.upgrade("s1", async () => (runs++, "done"))
        throw new Error("nope")
      },
    })
    const k = await first([broken])
    expect(runs).toBe(0)
    expect(k.plugins[0]).toMatchObject({ status: "failed", error: "nope" })
    // A step row does not count as an applied migration (backups are named by migrations applied).
    const a = await first([plugin("alpha", async () => "done")])
    expect(recorded(a, "alpha")).toEqual(["001", "upgrade:s1"])
    const b = await again(a.home, [plugin("alpha", async () => "done")])
    expect(b.plugins[0]?.status).toBe("ok")
  })
})

describe("data step backups", () => {
  const backups = (k: Kernel) => readdirSync(k.paths.home).filter((f) => f.includes(".bak-")).sort()

  test("a step-only boot backs the database up once; later boots of a pending step add none", async () => {
    let ready = false
    const step: Step = async (ctx) => {
      if (!ready) return "later"
      await ctx.self().write.add!({ note: "after" })
      return "done"
    }
    const a = await first([plugin("alpha")]) // a new database: nothing to back up
    await runWithContext(a.context(), () => a.ops.api("alpha")!.write.add!({ note: "before" }))
    expect(backups(a)).toEqual([])

    await again(a.home, [plugin("alpha", step)]) // no migration pending, a step is
    expect(backups(a)).toEqual(["ttybrain.db.bak-v1"])
    const file = join(a.home, "ttybrain.db.bak-v1")
    const stamp = statSync(file).mtimeMs
    await again(a.home, [plugin("alpha", step)])
    ready = true
    const c = await again(a.home, [plugin("alpha", step)])
    expect(backups(c)).toEqual(["ttybrain.db.bak-v1"])
    expect(statSync(file).mtimeMs).toBe(stamp) // kept, not rewritten
    expect(notes(c, "alpha")).toEqual(["before", "after"])
    // The backup is the database as it was before any step ran.
    const copy = openRaw(file)
    try {
      expect(copy.prepare("SELECT note FROM alpha_row").all([])).toEqual([{ note: "before" }])
      expect(copy.prepare("SELECT id FROM kernel_plugin_migration ORDER BY id").all([])).toEqual([{ id: "001" }])
    } finally {
      copy.close()
    }
  })

  test("with nothing pending no step is attempted, even while another connection holds the write lock", async () => {
    const a = await first([plugin("alpha", async () => "done")])
    expect(recorded(a, "alpha")).toEqual(["001", "upgrade:s1"])
    const runStep = spyOn(MigrationRunner.prototype, "runStep")
    a.db.raw.exec("BEGIN IMMEDIATE")
    try {
      const started = performance.now()
      const b = await again(a.home, [plugin("alpha", async () => "done")])
      expect(performance.now() - started).toBeLessThan(1000)
      expect(runStep).not.toHaveBeenCalled()
      expect(b.plugins[0]).toEqual({ id: "alpha", version: "1.0.0", source: "built-in", status: "ok" })
    } finally {
      a.db.raw.exec("ROLLBACK")
      runStep.mockRestore()
    }
    expect(backups(a)).toEqual([])
  })
})

describe("read() and use()", () => {
  test("read() gives the read operations of a plugin in reads or requires; use() stays requires-only", async () => {
    let seen: Record<string, unknown> = {}
    const reader = definePlugin({
      id: "reader",
      name: "r",
      version: "1.0.0",
      apiVersion: 1,
      requires: { beta: "^1.0.0" },
      reads: { alpha: "^1.0.0", ghost: "^1.0.0", old: "^2.0.0" },
      activate(ctx) {
        ctx.expose({
          read: {
            probe: {
              input: Type.Object({}),
              output: Type.Object({}),
              run: async () => {
                const alpha = ctx.read("alpha")
                seen = {
                  alpha: alpha && Object.keys(alpha),
                  count: await alpha?.count!({}),
                  useAlpha: ctx.use("alpha"), // only read: no use()
                  beta: Object.keys(ctx.read("beta") ?? {}), // required: read() works too
                  useBeta: Object.keys(ctx.use("beta")?.write ?? {}),
                  ghost: ctx.read("ghost"), // not loaded
                  old: ctx.read("old"), // loaded, outside the range
                  other: ctx.read("other"), // neither required nor read
                }
                return {}
              },
            },
          },
        })
      },
    })
    const k = await first([plugin("alpha"), plugin("old"), plugin("beta"), plugin("other"), reader])
    await runWithContext(k.context(), () => k.ops.api("reader")!.read.probe!({}))
    expect(seen).toEqual({
      alpha: ["count"],
      count: { n: 0 },
      useAlpha: undefined,
      beta: ["count"],
      useBeta: ["add"],
      ghost: undefined,
      old: undefined,
      other: undefined,
    })
    // The TUI runtime carries it too.
    const rt = k.runtime("reader")!
    expect(Object.keys(rt.read("alpha") ?? {})).toEqual(["count"])
    expect(rt.read("other")).toBeUndefined()
  })
})
