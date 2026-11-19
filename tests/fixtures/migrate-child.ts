// Child process for the `concurrent first boot` test: boots against TTYBRAIN_HOME=<dir> at time <start> (ms) and
// applies the contracts migrations. 001 holds its transaction for a while so the other process overlaps it.
import { KernelDb } from "../../src/kernel/db/kernel-db"
import { openRaw } from "../../src/kernel/db/sqlite"
import { MigrationRunner, type Migration } from "../../src/kernel/migrations"
import { resolvePaths } from "../../src/kernel/paths"

const [dir, start] = process.argv.slice(2)
const paths = resolvePaths({ TTYBRAIN_HOME: dir })

const migrations: Migration[] = [
  {
    id: "001",
    up: async (db) => {
      await db.schema.createTable("contract").addColumn("id", "integer", (c) => c.primaryKey()).execute()
      await new Promise((r) => setTimeout(r, 300))
    },
  },
  {
    id: "002",
    up: async (db) => {
      await db.schema.createTable("party").addColumn("id", "integer", (c) => c.primaryKey()).execute()
    },
  },
]

await new Promise((r) => setTimeout(r, Math.max(0, Number(start) - Date.now())))
const kdb = new KernelDb(openRaw(paths.db))
try {
  const runner = new MigrationRunner(kdb, paths)
  await runner.ensureKernelTables()
  await runner.run("contracts", migrations, false)
} finally {
  await kdb.close()
}
