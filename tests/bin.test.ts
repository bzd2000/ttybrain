import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
  const proc = Bun.spawn(["bun", bin, ...argv], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, TTYBRAIN_HOME: home } })
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

  // The default folder: HOME is the temp dir and no TTYBRAIN_HOME/TTYBRAIN_DB is set.
  async function atHome(...argv: string[]) {
    const env: Record<string, string | undefined> = { ...process.env, HOME: home }
    delete env.TTYBRAIN_HOME
    delete env.TTYBRAIN_DB
    const proc = Bun.spawn(["bun", bin, ...argv], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env })
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    return { code, out, err }
  }

  test("moves ~/.pm to ~/.ttybrain before boot and says so on stderr, once", async () => {
    mkdirSync(join(home, ".pm"))
    writeFileSync(join(home, ".pm", "config.json"), "{}")
    const r = await atHome("plugin", "list", "--json")
    expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: `moved your data from ${home}/.pm to ${home}/.ttybrain\n` })
    expect(existsSync(join(home, ".ttybrain", "config.json"))).toBe(true)
    expect(existsSync(join(home, ".ttybrain", "ttybrain.db"))).toBe(true)
    const again = await atHome("plugin", "list", "--json")
    expect({ code: again.code, err: again.err }).toEqual({ code: 0, err: "" })
  })

  test("a failed move is reported and ttybrain still starts", async () => {
    if (process.getuid?.() === 0) return // root ignores the permission that makes the move fail
    mkdirSync(join(home, ".pm"))
    writeFileSync(join(home, ".pm", "pm.db"), "")
    chmodSync(join(home, ".pm"), 0o555) // the folder moves, its pm.db cannot be renamed
    // The read-only folder could not hold a new database, so --db (which does not skip the move) puts it elsewhere.
    const db = mkdtempSync(join(tmpdir(), "pm-bin-db-"))
    try {
      const r = await atHome("plugin", "list", "--json", "--db", join(db, "x.db"))
      expect(r.code).toBe(0)
      expect(r.err).toStartWith(`could not move ${home}/.pm to ${home}/.ttybrain: `)
      expect(r.err).toContain("EACCES")
      expect(r.err.split("\n")).toHaveLength(2) // the one line
      expect(existsSync(join(db, "x.db"))).toBe(true)
    } finally {
      for (const d of [".pm", ".ttybrain"]) if (existsSync(join(home, d))) chmodSync(join(home, d), 0o755)
      rmSync(db, { recursive: true, force: true })
    }
  })

  test("--db is applied before boot", async () => {
    const db = join(home, "elsewhere", "other.db")
    expect((await pm("plugin", "list", "--db", db)).code).toBe(0)
    expect(existsSync(db)).toBe(true)
    expect(existsSync(join(home, "ttybrain.db"))).toBe(false)
  })
})
