// Upkeep (`ctx.upkeep`): recurring data work that runs on every write-capable boot, after the data steps, each in
// its own write transaction, without waiting for a write lock another process holds. A read-only boot skips it.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../tests/helpers"
import { definePlugin, Type, ValidationError, type PluginContext, type PluginDef } from "./api"
import { runCli } from "./cli/dispatch"
import { fixedClock, type Clock } from "./clock"
import { runWithContext } from "./context"
import { bootKernel, type Kernel } from "./host"

let cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.reverse()) await c()
  cleanups = []
})

async function first(plugins: PluginDef[], clock?: Clock): Promise<TestKernel> {
  const k = await makeTestKernel({ plugins, ...(clock ? { clock } : {}) })
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

type Run = (ctx: PluginContext) => Promise<void>

// A plugin with one own table `row (id, note)`, a write op `add`, a read op `count`, an optional data step "s1"
// and an optional upkeep "u1"; `log` hears both.
function plugin(id: string, opts: { upkeep?: Run; step?: Run; log?: string[] } = {}): PluginDef {
  return definePlugin({
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 1,
    activate(ctx) {
      ctx.migration("001", async (db) => {
        await db.schema.createTable("row").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("note", "text").execute()
      })
      ctx.expose({
        read: {
          count: { input: Type.Object({}), output: Type.Object({ n: Type.Number() }), run: async () => ({ n: (await ctx.data.selectFrom("row").select("id").execute()).length }) },
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
      ctx.command({
        thing: id,
        verb: "add",
        summary: "add a row",
        args: [{ name: "note", required: true }],
        run: async ({ args }) => {
          const out = await ctx.self().write.add!({ note: args.note })
          return { json: out, text: out.ref }
        },
      })
      ctx.command({
        thing: id,
        verb: "count",
        summary: "count rows",
        run: async () => {
          const out = await ctx.self().read.count!({})
          return { json: out, text: String(out.n) }
        },
      })
      if (opts.step) {
        const step = opts.step
        ctx.upgrade("s1", async () => {
          opts.log?.push("step")
          await step(ctx)
          return "done"
        })
      }
      if (opts.upkeep) {
        const run = opts.upkeep
        ctx.upkeep("u1", async () => {
          opts.log?.push("upkeep")
          await run(ctx)
        })
      }
    },
  })
}

const notes = (k: Kernel, id: string) => k.db.raw.prepare(`SELECT note FROM ${id}_row ORDER BY id`).all([]).map((r) => r.note)
const addRow: Run = async (ctx) => void (await ctx.self().write.add!({ note: "upkept" }))

describe("upkeep", () => {
  test("runs on every write-capable boot: before the first write, after the data steps, once per boot", async () => {
    const log: string[] = []
    const a = await first([plugin("alpha", { upkeep: addRow, step: async () => {}, log })])
    expect(log).toEqual(["step"]) // booting alone writes nothing more
    const { o, io: cli } = io()
    expect(await runCli(["alpha", "add", "first"], a, cli)).toBe(0)
    expect(o.out).toBe("R-2\n") // the upkeep's own row came first, in its own transaction
    expect(await runCli(["alpha", "add", "second"], a, cli)).toBe(0)
    expect(log).toEqual(["step", "upkeep"])
    expect(notes(a, "alpha")).toEqual(["upkept", "first", "second"])

    const b = await again(a.home, [plugin("alpha", { upkeep: addRow, step: async () => {}, log })])
    await runWithContext(b.context(), () => b.ops.api("alpha")!.write.add!({ note: "third" }))
    expect(log).toEqual(["step", "upkeep", "upkeep"])
    expect(notes(b, "alpha")).toEqual(["upkept", "first", "second", "upkept", "third"])
  })

  test("a read-only boot skips it and writes nothing", async () => {
    const log: string[] = []
    const a = await first([plugin("alpha", { upkeep: addRow, log })])
    const before = a.db.dataVersion()
    const b = await again(a.home, [plugin("alpha", { upkeep: addRow, log })])
    const { o, io: cli } = io()
    expect(await runCli(["alpha", "count"], b, cli)).toBe(0)
    expect(await runCli(["help"], b, cli)).toBe(0)
    expect(o.out.startsWith("0\n")).toBe(true)
    expect(log).toEqual([])
    expect(a.db.dataVersion()).toBe(before)
  })

  test("kernel.upkeep() runs every plugin's upkeeps in load order, once a day", async () => {
    let today = "2026-11-13"
    const clock: Clock = { today: () => today, now: () => `${today}T09:00:00` }
    const log: string[] = []
    const a = await first([plugin("alpha", { upkeep: async () => void log.push("alpha") }), plugin("beta", { upkeep: async () => void log.push("beta") })], clock)
    await a.upkeep()
    await a.upkeep()
    expect(log).toEqual(["alpha", "beta"])
    today = "2026-11-14"
    await Promise.all([a.upkeep(), a.upkeep()]) // concurrent callers share one run
    expect(log).toEqual(["alpha", "beta", "alpha", "beta"])
    // A write on a day already upkept does not run it again.
    await runWithContext(a.context(), () => a.ops.api("alpha")!.write.add!({ note: "x" }))
    expect(log).toHaveLength(4)
  })

  test("skipped for this boot when another process holds the write lock", async () => {
    const log: string[] = []
    const a = await first([plugin("alpha", { upkeep: addRow, log })])
    const b = await again(a.home, [plugin("alpha", { upkeep: addRow, log })])
    a.db.raw.exec("BEGIN IMMEDIATE")
    try {
      const started = performance.now()
      await b.upkeep()
      expect(performance.now() - started).toBeLessThan(1000)
      expect(log).toEqual([]) // never started
    } finally {
      a.db.raw.exec("ROLLBACK")
    }
    expect(b.plugins[0]).toEqual({ id: "alpha", version: "1.0.0", source: "built-in", status: "ok" })
    await runWithContext(b.context(), () => b.ops.api("alpha")!.write.add!({ note: "x" }))
    expect(log).toEqual([]) // skipped this boot, not retried on the next write
    const c = await again(a.home, [plugin("alpha", { upkeep: addRow, log })])
    await runWithContext(c.context(), () => c.ops.api("alpha")!.write.add!({ note: "y" }))
    expect(log).toEqual(["upkeep"])
    expect(notes(c, "alpha")).toEqual(["x", "upkept", "y"])
  })

  test("a throw rolls back, the plugin stays ok, the error shows in plugin list, and the write goes on", async () => {
    const failing: Run = async (ctx) => {
      await ctx.self().write.add!({ note: "half" })
      throw new Error("boom")
    }
    const a = await first([plugin("alpha", { upkeep: failing }), plugin("beta", { upkeep: addRow })])
    const { io: cli } = io()
    expect(await runCli(["alpha", "add", "kept"], a, cli)).toBe(0)
    expect(notes(a, "alpha")).toEqual(["kept"])
    expect(notes(a, "beta")).toEqual(["upkept"]) // one plugin's failure does not stop the next
    const { o, io: list } = io()
    expect(await runCli(["plugin", "list", "--json"], a, list)).toBe(0)
    expect(JSON.parse(o.out)).toEqual([
      { id: "alpha", version: "1.0.0", source: "built-in", status: "ok", error: 'upkeep "u1" failed: boom' },
      { id: "beta", version: "1.0.0", source: "built-in", status: "ok", error: null },
    ])
  })

  test("the CLI command whose write ran a failing upkeep warns on stderr, hint included; the exit code is the command's", async () => {
    const failing: Run = async () => {
      throw new ValidationError("counter is stuck", { hint: "run alpha reset" })
    }
    const a = await first([plugin("alpha", { upkeep: failing }), plugin("beta", { upkeep: async () => { throw new Error("boom") } })])
    const run = io()
    expect(await runCli(["alpha", "add", "kept", "--json"], a, run.io)).toBe(0)
    expect(JSON.parse(run.o.out)).toEqual({ ref: "R-1" })
    expect(run.o.err).toBe('warning: upkeep "u1" failed: counter is stuck\nhint: run alpha reset\nwarning: upkeep "u1" failed: boom\n')
    // Raised once: the next command of this process says nothing more (the error stays on the plugin's status).
    const next = io()
    expect(await runCli(["alpha", "add", "again"], a, next.io)).toBe(0)
    expect(next.o.err).toBe("")
    // A failing command still warns, and keeps its own exit code.
    const b = await again(a.home, [plugin("alpha", { upkeep: failing })])
    const bad = io()
    expect(await runCli(["alpha", "add"], b, bad.io)).toBe(1) // missing <note>: no write, so no upkeep either
    expect(bad.o.err).not.toContain("warning:")
    await runWithContext(b.context(), () => b.ops.api("alpha")!.write.add!({ note: "x" })) // the upkeep ran (and failed) outside a command
    const later = io()
    expect(await runCli(["alpha", "count"], b, later.io)).toBe(0)
    expect(later.o.err).toBe("") // only failures raised during the command itself
    expect(b.upkeepFailures()).toEqual([{ plugin: "alpha", text: 'upkeep "u1" failed: counter is stuck', hint: "run alpha reset" }])
  })

  test("a failed plugin's upkeeps never run; ids must be unique and non-empty; registering after activate throws", async () => {
    let runs = 0
    let late: PluginContext | undefined
    const broken = definePlugin({
      id: "broken",
      name: "b",
      version: "1.0.0",
      apiVersion: 1,
      activate(ctx) {
        ctx.upkeep("u1", async () => void runs++)
        throw new Error("nope")
      },
    })
    const dup = definePlugin({
      id: "dup",
      name: "d",
      version: "1.0.0",
      apiVersion: 1,
      activate(ctx) {
        ctx.upkeep("u1", async () => void runs++)
        ctx.upkeep("u1", async () => void runs++)
      },
    })
    const empty = definePlugin({ ...dup, id: "empty", activate: (ctx) => ctx.upkeep("", async () => void runs++) })
    const keeper = definePlugin({ ...dup, id: "keeper", activate: (ctx) => void (late = ctx) })
    const k = await first([broken, dup, empty, keeper])
    expect(k.plugins.map((p) => [p.id, p.status, p.error])).toEqual([
      ["broken", "failed", "nope"],
      ["dup", "failed", 'upkeep id "u1" is empty or duplicated'],
      ["empty", "failed", 'upkeep id "" is empty or duplicated'],
      ["keeper", "ok", undefined],
    ])
    await k.upkeep()
    expect(runs).toBe(0)
    expect(() => late!.upkeep("u2", async () => {})).toThrow("plugins can only register during activate")
  })
})
