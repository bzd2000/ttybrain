import { afterEach, describe, expect, test } from "bun:test"
import { alpha, bare, beta, broken, itemView, reader } from "../../tests/fixtures/plugins"
import { makeTestKernel, type TestKernel } from "../../tests/helpers"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { definePlugin, Type } from "./api"
import { fixedClock } from "./clock"
import { runWithContext } from "./context"
import { bootKernel } from "./host"
import { IsolationError, ViewUnavailableError } from "./errors"
import type { PluginApi } from "./operations"

let kernels: TestKernel[] = []
async function boot(opts: Parameters<typeof makeTestKernel>[0]) {
  const k = await makeTestKernel(opts)
  kernels.push(k)
  return k
}
afterEach(async () => {
  for (const k of kernels) await k.cleanup()
  kernels = []
})

const status = (k: TestKernel) => Object.fromEntries(k.plugins.map((p) => [p.id, p.error ? `${p.status}: ${p.error}` : p.status]))
const inCtx = <T>(k: TestKernel, fn: () => Promise<T>) => runWithContext(k.context(), fn)
const api = (k: TestKernel, id: string) => k.ops.api(id)!

async function error<E>(p: () => Promise<unknown>, type: new (...a: any[]) => E): Promise<E> {
  try {
    await p()
  } catch (e) {
    expect(e).toBeInstanceOf(type)
    return e as E
  }
  throw new Error(`expected ${type.name}`)
}

describe("load order and requirements", () => {
  test("the load order respects requires regardless of array order", async () => {
    const log: string[] = []
    const k = await boot({
      plugins: [bare("c", { requires: { b: "^1" }, log }), beta({ log }), bare("b", { requires: { alpha: "*" }, log }), alpha({ log })],
    })
    expect(log).toEqual(["alpha", "b", "c", "beta"])
    expect(status(k)).toEqual({ alpha: "ok", b: "ok", c: "ok", beta: "ok" })
    expect(k.plugins.map((p) => p.id)).toEqual(["alpha", "b", "c", "beta"])
    expect(k.plugins[0]).toEqual({ id: "alpha", version: "1.0.0", source: "built-in", status: "ok" })
  })

  test("a cycle a→b→a marks both failed with cycle", async () => {
    const log: string[] = []
    const k = await boot({ plugins: [bare("a", { requires: { b: "^1" }, log }), bare("b", { requires: { a: "^1" }, log }), alpha({ log })] })
    expect(status(k)).toEqual({ a: "failed: requires cycle: a → b → a", b: "failed: requires cycle: a → b → a", alpha: "ok" })
    expect(log).toEqual(["alpha"])
  })

  test("a plugin requiring a cycle member fails because of it", async () => {
    const k = await boot({ plugins: [bare("c", { requires: { a: "^1" } }), bare("a", { requires: { b: "^1" } }), bare("b", { requires: { a: "^1" } })] })
    expect(k.plugins.find((p) => p.id === "c")).toMatchObject({ status: "failed", error: 'requires "a" which failed' })
    expect(k.plugins.find((p) => p.id === "a")!.error).toContain("cycle")
  })

  test('requires { a: "^2" } with a at 1.0.0 → failed, naming the plugin and the range', async () => {
    const k = await boot({ plugins: [bare("a"), bare("b", { requires: { a: "^2" } })] })
    expect(status(k)).toEqual({ a: "ok", b: 'failed: requires "a" ^2, but a is 1.0.0' })
  })

  test("a missing requirement fails the plugin", async () => {
    const k = await boot({ plugins: [bare("b", { requires: { ghost: "^1" } })] })
    expect(status(k)).toEqual({ b: 'failed: requires "ghost" ^1, which is not installed' })
  })

  test("an unsupported apiVersion, an invalid id or a duplicate id fails that plugin only", async () => {
    const k = await boot({ plugins: [bare("future", { apiVersion: 2 }), bare("Bad_id"), bare("a"), bare("a", { version: "2.0.0" })] })
    expect(k.plugins).toEqual([
      { id: "future", version: "1.0.0", source: "built-in", status: "failed", error: "apiVersion 2 is not supported (this pm supports 1)" },
      { id: "Bad_id", version: "1.0.0", source: "built-in", status: "failed", error: 'plugin id "Bad_id" must match [a-z][a-z0-9-]*' },
      { id: "a", version: "1.0.0", source: "built-in", status: "ok" },
      { id: "a", version: "2.0.0", source: "built-in", status: "failed", error: 'duplicate plugin id "a"' },
    ])
  })
})

describe("a working kernel", () => {
  test("migrations run, ops work across plugins through use(), views read across plugins", async () => {
    const k = await boot({ plugins: [beta(), alpha()] })
    const out = await inCtx(k, () => api(k, "beta").write.addVia!({ title: "Send contract" }))
    expect(out).toEqual({ ref: "AL-1", id: 1 })
    expect(await inCtx(k, () => api(k, "alpha").read.count!({}))).toEqual({ n: 1 })
    expect(await inCtx(k, () => api(k, "beta").read.titles!({}))).toEqual(["Send contract"])
    expect(k.db.raw.prepare("SELECT title, created_at FROM alpha_item").all([])).toEqual([{ title: "Send contract", created_at: "2026-11-13T09:00:00" }])
    expect(k.db.raw.prepare("SELECT plugin, id FROM kernel_plugin_migration").all([])).toEqual([{ plugin: "alpha", id: "001" }])
    expect(await k.records.label("AL-1")).toBe("Send contract")
    expect(k.commands.find("alpha", "add")?.plugin).toBe("alpha")
  })

  test("ctx.records.hasType tells whether a record type is registered", async () => {
    let has: ((n: string) => boolean) | undefined
    const probe = definePlugin({ id: "probe", name: "Probe", version: "1.0.0", apiVersion: 1, activate: (ctx) => void (has = ctx.records.hasType) })
    const k = await boot({ plugins: [alpha(), probe] })
    expect(k.plugins.map((p) => p.status)).toEqual(["ok", "ok"])
    expect(has!("alpha-item")).toBe(true)
    expect(has!("meeting")).toBe(false)
  })

  test("context() comes from the clock; an origin is carried", async () => {
    const k = await boot({ today: "2026-11-20" })
    expect(k.context()).toEqual({ actor: "me", today: "2026-11-20", now: "2026-11-20T09:00:00" })
    expect(k.context({ type: "inbox", ref: "I-2" })).toEqual({ actor: "me", today: "2026-11-20", now: "2026-11-20T09:00:00", origin: { type: "inbox", ref: "I-2" } })
  })

  test('use("x") for a plugin not in requires → undefined; self() is the own API', async () => {
    let seen: { other?: PluginApi; own?: PluginApi } = {}
    const probe = definePlugin({
      id: "probe",
      name: "Probe",
      version: "1.0.0",
      apiVersion: 1,
      activate(ctx) {
        ctx.expose({ read: { hi: { input: Type.Object({}), output: Type.String(), run: async () => "hi" } } })
        seen = { other: ctx.use("alpha"), own: ctx.self() }
      },
    })
    const k = await boot({ plugins: [alpha(), probe] })
    expect(status(k)).toEqual({ alpha: "ok", probe: "ok" })
    expect(seen.other).toBeUndefined()
    expect(Object.keys(seen.own!.read)).toEqual(["hi"])
  })

  test("ctx.data is scoped: another plugin's table is rejected", async () => {
    let data: any
    const k = await boot({ plugins: [alpha(), bare("snoop", { activate: (ctx) => void (data = ctx.data) })] })
    await error(() => data.selectFrom("alpha_item").selectAll().execute(), IsolationError)
  })
})

describe("failure isolation", () => {
  test("a plugin whose activate throws: its registrations are gone, the others work, its dependant fails", async () => {
    const seen: string[] = []
    const k = await boot({ plugins: [alpha(), broken({ seen }), bare("after", { requires: { broken: "^1" } })] })
    expect(status(k)).toEqual({ alpha: "ok", broken: "failed: boom", after: 'failed: requires "broken" which failed' })
    expect(k.commands.find("broken", "go")).toBeUndefined()
    expect(k.commands.things()).toEqual(["alpha"])
    expect(k.ops.api("broken")).toBeUndefined()
    expect(k.records.byName("broken-thing")).toBeUndefined()
    expect(await k.tags.resolve("see $x")).toEqual({ links: [], unresolved: ["$x"] })
    expect(k.reports.list()).toEqual([])
    expect(k.guide.render("0.1.0")).not.toContain("never shown")
    expect(k.db.raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'view'").all([])).toEqual([{ name: "alpha__pub_item" }])
    await inCtx(k, () => api(k, "alpha").write.add!({ title: "still works" }))
    expect(seen).toEqual([])
  })

  test("a failed plugin's context can register nothing more", async () => {
    let kept: any
    const k = await boot({ plugins: [bare("late", { activate: (ctx) => {
      kept = ctx
      throw new Error("early exit")
    } })] })
    expect(status(k)).toEqual({ late: "failed: early exit" })
    expect(() => kept.command({ thing: "late", verb: "x", summary: "", run: async () => ({ json: null, text: "" }) })).toThrow(
      'plugin "late" failed and can no longer register anything',
    )
    expect(k.commands.things()).toEqual([])
  })

  test("registrations are sealed after boot: a late command or view throws IsolationError", async () => {
    let kept: any
    const k = await boot({ plugins: [alpha(), bare("late", { activate: (ctx) => void (kept = ctx) })] })
    expect(status(k)).toEqual({ alpha: "ok", late: "ok" })
    const sealed = "plugins can only register during activate"
    expect(() => kept.command({ thing: "late", verb: "x", summary: "", run: async () => ({ json: null, text: "" }) })).toThrow(new IsolationError(sealed))
    expect(() => kept.publish("v", itemView)).toThrow(new IsolationError(sealed))
    expect(k.commands.things()).toEqual(["alpha"])
  })

  test("a private view with __pub_ in its name cannot be created by a migration", async () => {
    const k = await boot({
      plugins: [
        bare("priv", {
          activate: (ctx) =>
            ctx.migration("001", async (db) => {
              await db.schema.createTable("t").addColumn("id", "integer", (c) => c.primaryKey()).execute()
              await db.schema.createView("x__pub_y").as(db.selectFrom("t").select("id")).execute()
            }),
        }),
      ],
    })
    expect(k.plugins[0]!.error).toContain("a short name may not contain __")
    expect(k.db.raw.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'priv%'").all([])).toEqual([])
  })

  test("a legitimate private view survives a reboot", async () => {
    const home = mkdtempSync(join(tmpdir(), "pm-host-"))
    const priv = bare("priv", {
      activate: (ctx) =>
        ctx.migration("001", async (db) => {
          await db.schema.createTable("t").addColumn("id", "integer", (c) => c.primaryKey()).execute()
          await db.schema.createView("tv").as(db.selectFrom("t").select("id")).execute()
        }),
    })
    try {
      for (let i = 0; i < 2; i++) {
        const k = await bootKernel({ env: { PM_HOME: home, PM_TEST: "1" }, plugins: [priv, alpha()], clock: fixedClock("2026-11-13") })
        expect(k.plugins.map((p) => p.status)).toEqual(["ok", "ok"])
        expect(k.db.raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'view' ORDER BY name").all([])).toEqual([
          { name: "alpha__pub_item" },
          { name: "priv_tv" },
        ])
        await k.shutdown()
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("a failing migration fails the plugin and rolls back; the others work", async () => {
    const k = await boot({
      plugins: [
        alpha(),
        bare("mig", {
          activate: (ctx) => {
            ctx.command({ thing: "mig", verb: "x", summary: "", run: async () => ({ json: null, text: "" }) })
            ctx.migration("001", async (db) => {
              await db.schema.createTable("t").addColumn("id", "integer", (c) => c.primaryKey()).execute()
              throw new Error("migration broke")
            })
          },
        }),
        bare("needsmig", { requires: { mig: "*" } }),
      ],
    })
    expect(status(k)).toEqual({ alpha: "ok", mig: "failed: migration broke", needsmig: 'failed: requires "mig" which failed' })
    expect(k.db.raw.prepare("SELECT name FROM sqlite_schema WHERE name = 'mig_t'").all([])).toEqual([])
    expect(k.commands.find("mig", "x")).toBeUndefined()
  })

  test("a view that fails to build fails its plugin and dependants; the other views are created", async () => {
    const bad = bare("badview", {
      activate: (ctx) => {
        ctx.migration("001", async (db) => void (await db.schema.createTable("t").addColumn("id", "integer", (c) => c.primaryKey()).execute()))
        ctx.publish("t", { version: 1, columns: { id: "integer", missing: "text" }, query: (db) => db.selectFrom("t").select("id") })
        ctx.command({ thing: "badview", verb: "x", summary: "", run: async () => ({ json: null, text: "" }) })
      },
    })
    const k = await boot({ plugins: [bad, beta(), alpha(), bare("needsbad", { requires: { badview: "^1" } })] })
    expect(status(k)).toEqual({
      badview: 'failed: view "badview.t" declares columns [id, missing] but its query returns [id]',
      needsbad: 'failed: requires "badview" which failed',
      alpha: "ok",
      beta: "ok",
    })
    expect(k.commands.things()).toEqual(["alpha"])
    expect(k.db.raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'view'").all([])).toEqual([{ name: "alpha__pub_item" }])
    await inCtx(k, () => api(k, "alpha").write.add!({ title: "x" }))
    expect(await inCtx(k, () => api(k, "beta").read.titles!({}))).toEqual(["x"])
  })

  test("an activated dependant of a plugin whose view fails is failed and unregistered too", async () => {
    const bad = definePlugin({
      ...alpha(),
      activate(ctx) {
        alpha().activate(ctx)
        ctx.publish("bad", { version: 1, columns: { nope: "text" }, query: (db) => db.selectFrom("item").select("title") })
      },
    })
    const k = await boot({ plugins: [bad, beta()] })
    expect(status(k)).toEqual({ alpha: expect.stringContaining('failed: view "alpha.bad"'), beta: 'failed: requires "alpha" which failed' })
    expect(k.ops.api("beta")).toBeUndefined()
    expect(k.commands.things()).toEqual([])
    expect(k.db.raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'view'").all([])).toEqual([])
  })
})

test("the database directory is created on first boot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-host-"))
  try {
    const k = await bootKernel({ env: { PM_HOME: join(dir, "a", "b") }, plugins: [], clock: fixedClock("2026-11-13") })
    expect(k.paths.db).toBe(join(dir, "a", "b", "pm.db"))
    expect(k.db.raw.prepare("SELECT count(*) AS n FROM kernel_plugin_migration").all([])).toEqual([{ n: 0 }])
    await k.shutdown()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("disabled plugins and reads", () => {
  test('config plugins.disabled: ["alpha"] → disabled, and its views are unavailable (even ones left from an earlier boot)', async () => {
    const home = mkdtempSync(join(tmpdir(), "pm-host-"))
    const clock = fixedClock("2026-11-13")
    try {
      const first = await bootKernel({ env: { PM_HOME: home, PM_TEST: "1" }, plugins: [alpha()], clock })
      await runWithContext(first.context(), () => first.ops.api("alpha")!.write.add!({ title: "x" }))
      await first.shutdown()
      const env = { PM_HOME: home, PM_TEST: "1", PM_CONFIG_JSON: JSON.stringify({ plugins: { disabled: ["alpha"] } }) }
      const k = await bootKernel({ env, plugins: [alpha(), reader({ alpha: "^1" }), beta()], clock })
      try {
        expect(Object.fromEntries(k.plugins.map((p) => [p.id, p.error ? `${p.status}: ${p.error}` : p.status]))).toEqual({
          alpha: "disabled",
          reader: "ok",
          beta: 'failed: requires "alpha", which is disabled',
        })
        const e = await error(() => runWithContext(k.context(), () => k.ops.api("reader")!.read.titles!({})), ViewUnavailableError)
        expect(e.message).toBe('view "alpha.item" is unavailable')
        expect(k.ops.api("alpha")).toBeUndefined()
        expect(k.db.raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'view'").all([])).toEqual([])
      } finally {
        await k.shutdown()
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("a reader whose reads range the publisher's version does not satisfy gets ViewUnavailableError", async () => {
    const k = await boot({ plugins: [alpha({ version: "1.4.0" }), reader({ alpha: "^2" })] })
    expect(status(k)).toEqual({ alpha: "ok", reader: "ok" })
    await error(() => inCtx(k, () => api(k, "reader").read.titles!({})), ViewUnavailableError)
  })

  test("a satisfied reads range reads the view", async () => {
    const k = await boot({ plugins: [reader({ alpha: "^1.2" }), alpha({ version: "1.4.0" })] })
    await inCtx(k, () => api(k, "alpha").write.add!({ title: "seen" }))
    expect(await inCtx(k, () => api(k, "reader").read.titles!({}))).toEqual(["seen"])
  })
})
