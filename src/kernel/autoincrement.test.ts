// AUTOINCREMENT tables: a plugin may create one (SQLite then creates its shared `sqlite_sequence`) and insert into it,
// so ids are never reused after a delete; but no plugin SQL may name `sqlite_sequence` (its rows name every plugin's
// AUTOINCREMENT tables), neither through Kysely nor in raw SQL, reads or writes.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../tests/helpers"
import { definePlugin, sql, Type, type PluginContext } from "./api"
import { runWithContext } from "./context"

let k: TestKernel | undefined
afterEach(async () => {
  await k?.cleanup()
  k = undefined
})

let ctx: PluginContext | undefined
const counter = definePlugin({
  id: "counter",
  name: "Counter",
  version: "1.0.0",
  apiVersion: 1,
  activate(c) {
    ctx = c
    c.migration("001", async (db) => {
      await db.schema.createTable("item").addColumn("id", "integer", (col) => col.primaryKey().autoIncrement()).addColumn("t", "text").execute()
    })
    c.expose({
      write: {
        add: {
          input: Type.Object({ t: Type.String() }),
          output: Type.Object({ ref: Type.String() }),
          describe: (i) => `+ ${i.t}`,
          run: async (i) => ({ ref: `I-${Number((await c.data.insertInto("item").values({ t: i.t }).executeTakeFirstOrThrow()).insertId)}` }),
        },
        remove: {
          input: Type.Object({ id: Type.Integer() }),
          output: Type.Object({ ref: Type.String() }),
          describe: (i) => `- ${i.id}`,
          run: async (i) => {
            await c.data.deleteFrom("item").where("id", "=", i.id).execute()
            return { ref: `I-${i.id}` }
          },
        },
        raw: {
          input: Type.Object({ q: Type.String() }),
          output: Type.Object({ ref: Type.String() }),
          describe: () => "raw",
          run: async (i) => {
            await sql.raw(i.q).execute(c.data)
            return { ref: "I-0" }
          },
        },
      },
    })
  },
})

const w = (op: string, input: unknown) => runWithContext(k!.context(), () => k!.ops.api("counter")!.write[op]!(input))
const failure = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as Error
  }
  throw new Error("expected a failure")
}

describe("AUTOINCREMENT", () => {
  test("a plugin's AUTOINCREMENT table migrates and never reuses an id", async () => {
    k = await makeTestKernel({ plugins: [counter] })
    expect(k.plugins[0]).toMatchObject({ status: "ok" })
    expect((await w("add", { t: "a" })).ref).toBe("I-1")
    expect((await w("add", { t: "b" })).ref).toBe("I-2")
    await w("remove", { id: 2 })
    expect((await w("add", { t: "c" })).ref).toBe("I-3")
  })

  test("sqlite_sequence cannot be named: Kysely or raw, read or write", async () => {
    k = await makeTestKernel({ plugins: [counter] })
    await w("add", { t: "a" })
    for (const q of ["SELECT * FROM sqlite_sequence", "UPDATE sqlite_sequence SET seq = 0", 'DELETE FROM "SQLITE_SEQUENCE"', "INSERT INTO counter_item (t) SELECT name FROM main.[sqlite_sequence]"]) {
      const e = await failure(w("raw", { q }))
      expect([e.name, e.message]).toEqual(["IsolationError", "sqlite_sequence is SQLite's own table; plugins may not name it"])
    }
    const read = await failure(runWithContext(k.context(), () => ctx!.data.selectFrom("sqlite_sequence").selectAll().execute()))
    expect(read.name).toBe("IsolationError")
    expect(k.db.raw.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'counter_item'").all([])).toEqual([{ seq: 1 }])
  })
})
