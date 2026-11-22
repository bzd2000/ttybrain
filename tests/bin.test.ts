import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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
    // Load order: built-ins by folder name (actions, inbox, meetings, people, projects), then the requires sort.
    expect(JSON.parse(r.out).map((p: { id: string; source: string; status: string }) => `${p.id} ${p.source} ${p.status}`)).toEqual([
      "actions built-in ok",
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

  test("a failed move is rolled back and stops ttybrain before boot, every run", async () => {
    if (process.getuid?.() === 0) return // root ignores the permission that makes the move fail
    const old = join(home, ".pm")
    mkdirSync(old)
    writeFileSync(join(old, "pm.db"), "data")
    chmodSync(old, 0o555) // the folder moves, its pm.db cannot be renamed: the folder is moved back
    try {
      const step = `EACCES: permission denied, rename '${home}/.ttybrain/pm.db' -> '${home}/.ttybrain/ttybrain.db'`
      const r = await atHome("plugin", "list")
      expect(r).toEqual({
        code: 1,
        out: "",
        err: `error: could not move ${old} to ${home}/.ttybrain: ${step}\nhint: move it by hand, or set TTYBRAIN_DB=${old}/pm.db\n`,
      })
      const json = await atHome("plugin", "list", "--json")
      expect({ code: json.code, err: json.err }).toEqual({ code: 1, err: "" })
      expect(JSON.parse(json.out).error).toEqual({
        code: "data_move",
        message: `could not move ${old} to ${home}/.ttybrain: ${step}`,
        hint: `move it by hand, or set TTYBRAIN_DB=${old}/pm.db`,
      })
      // No empty database anywhere: ~/.pm is as it was and there is no ~/.ttybrain.
      expect(lstatSync(old).isDirectory()).toBe(true)
      expect(existsSync(join(home, ".ttybrain"))).toBe(false)
      expect(readdirSync(old)).toEqual(["pm.db"])
      expect(readFileSync(join(old, "pm.db"), "utf8")).toBe("data")
    } finally {
      for (const d of [".pm", ".ttybrain"]) if (existsSync(join(home, d))) chmodSync(join(home, d), 0o755)
    }
  })

  test("data left in ~/.pm stops ttybrain; a half-done move is finished", async () => {
    const old = join(home, ".pm")
    const neu = join(home, ".ttybrain")
    mkdirSync(old)
    writeFileSync(join(old, "pm.db"), "")
    mkdirSync(neu)
    const r = await atHome("plugin", "list")
    expect(r).toEqual({ code: 1, out: "", err: `error: your data is still in ${old}; move its files into ${neu} by hand, or set TTYBRAIN_DB=${old}/pm.db\n` })
    expect(readdirSync(neu)).toEqual([])
    // Half-done: the folder is in place with its pm.db (an empty file is a valid empty SQLite database).
    rmSync(neu, { recursive: true })
    renameSync(old, neu)
    const resumed = await atHome("plugin", "list", "--json")
    expect({ code: resumed.code, err: resumed.err }).toEqual({ code: 0, err: `moved your data from ${old} to ${neu}\n` })
    expect(readdirSync(neu).sort()).toEqual(["pm.db", "ttybrain.db"])
    expect(lstatSync(old).isSymbolicLink()).toBe(true)
  })

  test("--db is applied before boot", async () => {
    const db = join(home, "elsewhere", "other.db")
    expect((await pm("plugin", "list", "--db", db)).code).toBe(0)
    expect(existsSync(db)).toBe(true)
    expect(existsSync(join(home, "ttybrain.db"))).toBe(false)
  })

  async function at(env: Record<string, string>, ...argv: string[]) {
    const e: Record<string, string | undefined> = { ...process.env, HOME: home, ...env }
    if (!env.TTYBRAIN_HOME) delete e.TTYBRAIN_HOME
    if (!env.TTYBRAIN_DB) delete e.TTYBRAIN_DB
    const proc = Bun.spawn(["bun", bin, ...argv], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: e })
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    return { code, out, err }
  }
  async function count(env: Record<string, string>, ...argv: string[]) {
    const r = await at(env, "person", "list", "--json", ...argv)
    return { code: r.code, err: r.err, count: r.code === 0 ? (JSON.parse(r.out) as unknown[]).length : undefined }
  }
  // A real pm.db with one person, seeded through the CLI (TTYBRAIN_DB: nothing is moved).
  async function seed(file: string) {
    expect((await at({ TTYBRAIN_DB: file }, "person", "add", "Anna")).code).toBe(0)
  }

  test("C1: following the hint of a blocked start opens the data, both ways", async () => {
    const old = join(home, ".pm")
    const neu = join(home, ".ttybrain")
    mkdirSync(old)
    await seed(join(old, "pm.db"))
    mkdirSync(neu)
    const blocked = await at({}, "person", "list")
    expect(blocked).toEqual({ code: 1, out: "", err: `error: your data is still in ${old}; move its files into ${neu} by hand, or set TTYBRAIN_DB=${old}/pm.db\n` })
    // The hint as printed.
    expect(await count({ TTYBRAIN_DB: `${old}/pm.db` })).toEqual({ code: 0, err: "", count: 1 })
    expect(readdirSync(old)).toEqual(["pm.db"])
    // TTYBRAIN_HOME on the old folder: its pm.db is renamed, and no empty database is created beside it.
    expect(await count({ TTYBRAIN_HOME: old })).toEqual({ code: 0, err: `renamed ${old}/pm.db to ${old}/ttybrain.db\n`, count: 1 })
    expect(readdirSync(old).sort()).toEqual(["pm.db", "ttybrain.db"])
    expect(lstatSync(join(old, "pm.db")).isSymbolicLink()).toBe(true)
    expect(await count({ TTYBRAIN_HOME: old })).toEqual({ code: 0, err: "", count: 1 })
  })

  test("I2: a linked ~/.pm moved by hand to ~/.ttybrain opens the data", async () => {
    const old = join(home, ".pm")
    const neu = join(home, ".ttybrain")
    const sync = join(home, "sync")
    mkdirSync(sync)
    await seed(join(sync, "pm.db"))
    symlinkSync(sync, old)
    expect((await count({})).code).toBe(1)
    renameSync(old, neu)
    expect(await count({})).toEqual({ code: 0, err: `moved your data from ${old} to ${neu}\n`, count: 1 })
    expect(readdirSync(sync).sort()).toEqual(["pm.db", "ttybrain.db"])
    expect(await count({})).toEqual({ code: 0, err: "", count: 1 })
  })

  test("M7: --db with data left in ~/.pm is not blocked and moves nothing", async () => {
    const old = join(home, ".pm")
    mkdirSync(old)
    await seed(join(old, "pm.db"))
    mkdirSync(join(home, ".ttybrain"))
    const db = join(home, "x.db")
    await seed(db)
    expect(await count({}, "--db", db)).toEqual({ code: 0, err: "", count: 1 })
    expect(readdirSync(old)).toEqual(["pm.db"])
    expect(readdirSync(join(home, ".ttybrain"))).toEqual([])
  })
})
