// Boot is read-only when nothing changed (I4/R20): no write transaction when the kernel tables exist, no
// migration is pending and every published view is current. And `ctx.emit` inside a write fires after commit.
import { afterEach, describe, expect, test } from "bun:test"
import { builtinPlugins } from "../../tests/builtins"
import { makeTestKernel, type TestKernel } from "../../tests/helpers"
import { definePlugin, Type, type PluginDef } from "./api"
import { fixedClock } from "./clock"
import { runWithContext } from "./context"
import { bootKernel, type Kernel } from "./host"
import { runCli } from "./cli/dispatch"

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

// Publishes view `v` selecting the literal `value`.
// Its `x.done` handler logs whether the kernel in `probe` is inside a write.
function fixture(value: number | undefined, log: boolean[] = [], probe: { k?: Kernel } = {}): PluginDef {
  return definePlugin({
    id: "fixture",
    name: "Fixture",
    version: "1.0.0",
    apiVersion: 1,
    activate(ctx) {
      if (value !== undefined) {
        ctx.publish("v", { version: 1, columns: { a: "integer" }, query: (db) => db.selectNoFrom((eb) => eb.lit(value).as("a")) })
      }
      ctx.on("x.done", () => void log.push(probe.k!.db.inWrite()))
      ctx.expose({
        write: {
          done: {
            input: Type.Object({ fail: Type.Boolean() }),
            output: Type.Object({ ref: Type.String() }),
            describe: () => "done",
            run: async (i) => {
              ctx.emit("x.done", 1)
              if (i.fail) throw new Error("boom")
              return { ref: "X-1" }
            },
          },
        },
      })
    },
  })
}

describe("read-only boot", () => {
  test("second boot does not write", async () => {
    const a = await first(builtinPlugins)
    const before = a.db.dataVersion()
    await again(a.home, builtinPlugins)
    expect(a.db.dataVersion()).toBe(before)
  })

  test("help works while another connection holds the write lock", async () => {
    const a = await first(builtinPlugins)
    a.db.raw.exec("BEGIN IMMEDIATE")
    try {
      const started = performance.now()
      const b = await again(a.home, builtinPlugins)
      const { io: cli } = io()
      expect(await runCli(["help"], b, cli)).toBe(0)
      expect(performance.now() - started).toBeLessThan(1000)
    } finally {
      a.db.raw.exec("ROLLBACK")
    }
  })

  test("project list works while locked", async () => {
    const a = await first(builtinPlugins)
    a.db.raw.exec("BEGIN IMMEDIATE")
    try {
      const b = await again(a.home, builtinPlugins)
      const { o, io: cli } = io()
      expect(await runCli(["project", "list", "--json"], b, cli)).toBe(0)
      expect(o.err).toBe("")
    } finally {
      a.db.raw.exec("ROLLBACK")
    }
  })

  test("changed view definition is recreated", async () => {
    const a = await first([fixture(1)])
    expect(a.db.raw.prepare("SELECT * FROM fixture__pub_v").all([])).toEqual([{ a: 1 }])
    const b = await again(a.home, [fixture(2)])
    expect(b.db.raw.prepare("SELECT * FROM fixture__pub_v").all([])).toEqual([{ a: 2 }])
  })

  test("stale view is dropped", async () => {
    const a = await first([fixture(1)])
    const b = await again(a.home, [fixture(undefined)])
    expect(b.db.raw.prepare("SELECT name FROM sqlite_schema WHERE name = 'fixture__pub_v'").all([])).toEqual([])
  })
})

describe("emit inside a write", () => {
  test("emit inside a write fires after commit", async () => {
    const log: boolean[] = []
    const probe: { k?: Kernel } = {}
    const k = await first([fixture(undefined, log, probe)])
    probe.k = k
    const done = k.ops.api("fixture")!.write.done!
    await runWithContext(k.context(), () => done({ fail: false }))
    expect(log).toEqual([false])
    await expect(runWithContext(k.context(), () => done({ fail: true }))).rejects.toThrow("boom")
    expect(log).toEqual([false])
  })
})
