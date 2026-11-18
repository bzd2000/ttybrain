import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const bin = join(import.meta.dir, "../src/bin/pm.ts")
let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pm-bin-"))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

async function pm(...argv: string[]) {
  const proc = Bun.spawn(["bun", bin, ...argv], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, PM_HOME: home } })
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code, out, err }
}

describe("bin/pm.ts", () => {
  test("no arguments with a non-TTY stdout prints the help", async () => {
    const r = await pm()
    expect(r.code).toBe(0)
    expect(r.err).toBe("")
    expect(r.out).toContain("  plugin list")
    expect(r.out).not.toContain("phase 2")
  })

  test("runs a command and exits with its code", async () => {
    const list = await pm("plugin", "list", "--json")
    expect({ code: list.code, err: list.err }).toEqual({ code: 0, err: "" })
    expect(JSON.parse(list.out).map((p: { id: string; status: string }) => `${p.id} ${p.status}`)).toEqual(["people ok", "projects ok", "meetings ok", "inbox ok"])
    const r = await pm("nope", "--json")
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out).error.code).toBe("validation")
  })

  test("--db is applied before boot", async () => {
    const db = join(home, "elsewhere", "other.db")
    expect((await pm("plugin", "list", "--db", db)).code).toBe(0)
    expect(existsSync(db)).toBe(true)
    expect(existsSync(join(home, "pm.db"))).toBe(false)
  })
})
