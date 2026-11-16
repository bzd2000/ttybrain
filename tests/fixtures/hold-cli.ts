// Child process for the shutdown test: boots against PM_HOME=<dir> with a plugin whose write operation inserts
// a row, prints "ready" and then never finishes, so its kernel transaction stays open until a signal arrives.
import { bootKernel } from "../../src/kernel/host"
import { definePlugin, Type } from "../../src/kernel/api"
import { runCli } from "../../src/kernel/cli/dispatch"
import { installShutdownHandlers } from "../../src/kernel/shutdown"

const holder = definePlugin({
  id: "holder",
  name: "Holder",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.migration("001", async (db) => {
      await db.schema
        .createTable("row")
        .addColumn("id", "integer", (c) => c.primaryKey())
        .addColumn("created_at", "text", (c) => c.notNull())
        .addColumn("updated_at", "text", (c) => c.notNull())
        .execute()
    })
    ctx.expose({
      write: {
        hold: {
          input: Type.Object({}),
          output: Type.Object({ ref: Type.String() }),
          describe: () => "+ row",
          run: async () => {
            const now = ctx.clock.now()
            await ctx.data.insertInto("row").values({ created_at: now, updated_at: now }).execute()
            process.stdout.write("ready\n")
            return new Promise<{ ref: string }>(() => {}) // never settles: the transaction stays open
          },
        },
      },
    })
    ctx.command({
      thing: "row",
      verb: "hold",
      summary: "insert a row and hold the transaction open",
      run: async () => {
        await ctx.self().write.hold!({})
        return { json: null, text: "" }
      },
    })
  },
})

const kernel = await bootKernel({ env: { PM_HOME: process.argv[2] }, plugins: [holder] })
installShutdownHandlers(kernel)
setInterval(() => {}, 1 << 30) // keep the event loop alive while the command waits
await runCli(["row", "hold"], kernel, { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s), stdin: async () => "" })
