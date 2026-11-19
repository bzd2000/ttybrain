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
    const r = await pm("nope", "--json")
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out).error.code).toBe("validation")
  })

  test("pm boots the built-ins through discovery", async () => {
    const r = await pm("plugin", "list", "--json")
    expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: "" })
    // Load order: built-ins by folder name (inbox, meetings, people, projects), then the requires sort.
    expect(JSON.parse(r.out).map((p: { id: string; source: string; status: string }) => `${p.id} ${p.source} ${p.status}`)).toEqual([
      "inbox built-in ok",
      "people built-in ok",
      "projects built-in ok",
      "meetings built-in ok",
    ])
  })

  test("--db is applied before boot", async () => {
    const db = join(home, "elsewhere", "other.db")
    expect((await pm("plugin", "list", "--db", db)).code).toBe(0)
    expect(existsSync(db)).toBe(true)
    expect(existsSync(join(home, "pm.db"))).toBe(false)
  })
})
