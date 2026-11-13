import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openRaw } from "../src/kernel/db/sqlite"

const fixture = join(import.meta.dir, "fixtures/hold-cli.ts")
let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pm-shutdown-"))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

async function untilReady(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let seen = ""
  while (!seen.includes("ready\n")) {
    const { value, done } = await reader.read()
    if (done) break
    seen += decoder.decode(value)
  }
  reader.releaseLock()
  return seen
}

describe("shutdown", () => {
  for (const signal of ["SIGHUP", "SIGTERM"] as const) {
    test(`${signal} during a write rolls the transaction back, closes the database and exits 0`, async () => {
      const proc = Bun.spawn(["bun", fixture, home], { stdout: "pipe", stderr: "pipe" })
      expect(await untilReady(proc.stdout)).toBe("ready\n")
      proc.kill(signal)
      const code = await proc.exited
      expect({ code, stderr: await new Response(proc.stderr).text() }).toEqual({ code: 0, stderr: "" })
      const raw = openRaw(join(home, "pm.db"))
      try {
        expect(raw.prepare("SELECT count(*) AS n FROM holder_row").all([])).toEqual([{ n: 0 }])
        expect(raw.prepare("PRAGMA integrity_check").all([])).toEqual([{ integrity_check: "ok" }])
      } finally {
        raw.close()
      }
    })
  }
})
