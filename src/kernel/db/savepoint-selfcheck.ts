// Confirms nested kernel transactions (savepoints) on the current runtime.
// Run: `bun src/kernel/db/savepoint-selfcheck.ts` or, after the Node build, `node dist-node/kernel/db/savepoint-selfcheck.js`.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { KernelDb } from "./kernel-db"
import { openRaw } from "./sqlite"

export async function savepointSelfcheck(): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "pm-savepoints-"))
  const kdb = new KernelDb(openRaw(join(dir, "pm.db")))
  try {
    await kdb.kysely.schema.createTable("t").addColumn("name", "text").execute()
    await kdb.transaction(async () => {
      await kdb.kysely.insertInto("t").values({ name: "A" }).execute()
      try {
        await kdb.transaction(async () => {
          await kdb.kysely.insertInto("t").values({ name: "B" }).execute()
          throw new Error("inner rollback")
        })
      } catch {}
    })
    const rows = await kdb.kysely.selectFrom("t").select("name").orderBy("name").execute()
    return rows.map((r) => r.name as string)
  } finally {
    await kdb.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  savepointSelfcheck().then(
    (names) => {
      if (names.length === 1 && names[0] === "A") {
        console.log("savepoints ok")
        process.exit(0)
      }
      console.error(`savepoints FAILED: expected ["A"], got ${JSON.stringify(names)}`)
      process.exit(1)
    },
    (e) => {
      console.error("savepoints FAILED:", e)
      process.exit(1)
    },
  )
}
