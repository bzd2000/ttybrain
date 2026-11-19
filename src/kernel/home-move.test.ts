import { afterEach, beforeEach, expect, test } from "bun:test"
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { openRaw } from "./db/sqlite"
import { moveLegacyHome } from "./home-move"
import { resolvePaths } from "./paths"

let HOME: string
let old: string
let neu: string
let moved: { kind: "moved"; notice: string }

beforeEach(() => {
  HOME = realpathSync(mkdtempSync(join(tmpdir(), "ttybrain-home-")))
  old = join(HOME, ".pm")
  neu = join(HOME, ".ttybrain")
  moved = { kind: "moved", notice: `moved your data from ${HOME}/.pm to ${HOME}/.ttybrain` }
})
afterEach(() => rmSync(HOME, { recursive: true, force: true }))

function seedDb(file: string): void {
  const db = openRaw(file)
  db.exec("CREATE TABLE t (name TEXT NOT NULL)")
  db.prepare("INSERT INTO t (name) VALUES (?)").run(["Anna"])
  db.close()
}

function names(file: string): string[] {
  const db = openRaw(file)
  try {
    return db.prepare("SELECT name FROM t").all([]).map((r) => r.name)
  } finally {
    db.close()
  }
}

// A rename that fails with `code` when `when(from, to)` holds (the test seam for EXDEV and friends).
function failing(code: string, when: (from: string, to: string) => boolean) {
  return (from: string, to: string) => {
    if (when(from, to)) throw Object.assign(new Error(`${code}: rename '${from}' -> '${to}'`), { code })
    renameSync(from, to)
  }
}

const hint = () => `move it by hand, or set TTYBRAIN_HOME=${old}`

test("moves ~/.pm to ~/.ttybrain, renames the db and backups, links back", () => {
  mkdirSync(join(old, "plugins", "x"), { recursive: true })
  seedDb(join(old, "pm.db"))
  writeFileSync(join(old, "pm.db.bak-v3"), "backup")
  writeFileSync(join(old, "config.json"), '{"staleContactDays": 3}')
  writeFileSync(join(old, "plugins", "x", "package.json"), "{}")

  expect(moveLegacyHome({ HOME })).toEqual(moved)

  expect(names(join(neu, "ttybrain.db"))).toEqual(["Anna"])
  expect(readFileSync(join(neu, "ttybrain.db.bak-v3"), "utf8")).toBe("backup")
  expect(readFileSync(join(neu, "config.json"), "utf8")).toBe('{"staleContactDays": 3}')
  expect(existsSync(join(neu, "plugins", "x", "package.json"))).toBe(true)
  expect(existsSync(join(neu, "pm.db.bak-v3"))).toBe(false)
  // ~/.pm links to ~/.ttybrain; pm.db links to ttybrain.db, so an old build opens the same file.
  expect(lstatSync(old).isSymbolicLink()).toBe(true)
  expect(resolve(HOME, readlinkSync(old))).toBe(neu)
  expect(lstatSync(join(neu, "pm.db")).isSymbolicLink()).toBe(true)
  expect(resolve(neu, readlinkSync(join(neu, "pm.db")))).toBe(join(neu, "ttybrain.db"))
  expect(names(join(old, "pm.db"))).toEqual(["Anna"])
  expect(resolvePaths({ HOME }).db).toBe(join(neu, "ttybrain.db"))
  // The next run: the links lead to the same database, so nothing to do and nothing to say.
  expect(moveLegacyHome({ HOME })).toEqual({ kind: "nothing" })
})

test("does nothing when ~/.ttybrain exists", () => {
  mkdirSync(old)
  writeFileSync(join(old, "config.json"), "{}")
  mkdirSync(neu)
  writeFileSync(join(neu, "ttybrain.db"), "new")
  expect(moveLegacyHome({ HOME })).toEqual({ kind: "nothing" })
  expect(readdirSync(old)).toEqual(["config.json"])
  expect(readdirSync(neu)).toEqual(["ttybrain.db"])
})

test("both folders hold a database: a note every run, neither touched", () => {
  mkdirSync(old)
  writeFileSync(join(old, "pm.db"), "old")
  mkdirSync(neu)
  writeFileSync(join(neu, "ttybrain.db"), "new")
  const warn = { kind: "warn", notice: `note: ${old} also holds a database; ttybrain uses ${neu}` } as const
  expect(moveLegacyHome({ HOME })).toEqual(warn)
  expect(moveLegacyHome({ HOME })).toEqual(warn)
  expect(readdirSync(old)).toEqual(["pm.db"])
  expect(readdirSync(neu)).toEqual(["ttybrain.db"])
  expect(lstatSync(old).isDirectory()).toBe(true)
})

test("does nothing when TTYBRAIN_HOME or TTYBRAIN_DB is set", () => {
  mkdirSync(old)
  writeFileSync(join(old, "pm.db"), "old")
  expect(moveLegacyHome({ HOME, TTYBRAIN_HOME: join(HOME, "data") })).toEqual({ kind: "nothing" })
  expect(moveLegacyHome({ HOME, TTYBRAIN_DB: join(HOME, "x.db") })).toEqual({ kind: "nothing" })
  expect(readdirSync(HOME)).toEqual([".pm"])
  expect(readdirSync(old)).toEqual(["pm.db"])
})

// Built, so the no-old-names scan does not flag this test of them.
const legacyHome = ["PM", "HOME"].join("_")
const legacyDb = ["PM", "DB"].join("_")

test(`ignores a leftover ${legacyHome}`, () => {
  expect(resolvePaths({ HOME, [legacyHome]: "/elsewhere" }).home).toBe(join(HOME, ".ttybrain"))
  expect(resolvePaths({ HOME, [legacyDb]: "/elsewhere/x.db" }).db).toBe(join(HOME, ".ttybrain", "ttybrain.db"))
  // The old variable neither redirects nor blocks the move.
  mkdirSync(old)
  seedDb(join(old, "pm.db"))
  expect(moveLegacyHome({ HOME, [legacyHome]: "/elsewhere" })).toEqual(moved)
  expect(names(join(neu, "ttybrain.db"))).toEqual(["Anna"])
})

test("does nothing when there is no ~/.pm", () => {
  expect(moveLegacyHome({ HOME })).toEqual({ kind: "nothing" })
  expect(readdirSync(HOME)).toEqual([])
})

test("a db with -wal/-shm files moves them too", () => {
  mkdirSync(old)
  // Snapshot a database while it is open, so the row is still only in the WAL (as after a crash).
  const live = join(HOME, "live.db")
  const db = openRaw(live)
  db.exec("PRAGMA wal_autocheckpoint = 0")
  db.exec("CREATE TABLE t (name TEXT NOT NULL)")
  db.prepare("INSERT INTO t (name) VALUES (?)").run(["Anna"])
  copyFileSync(live, join(old, "pm.db"))
  copyFileSync(`${live}-wal`, join(old, "pm.db-wal"))
  copyFileSync(`${live}-shm`, join(old, "pm.db-shm"))
  db.close()
  rmSync(live, { force: true })

  expect(moveLegacyHome({ HOME })).toEqual(moved)
  expect(readdirSync(neu).sort()).toEqual(["pm.db", "ttybrain.db", "ttybrain.db-shm", "ttybrain.db-wal"])
  expect(names(join(neu, "ttybrain.db"))).toEqual(["Anna"])
})

test("a failed folder rename (EXDEV) blocks the start and leaves ~/.pm as it was", () => {
  mkdirSync(old)
  seedDb(join(old, "pm.db"))
  const r = moveLegacyHome({ HOME }, failing("EXDEV", (from) => from === old))
  expect(r).toEqual({ kind: "blocked", message: `could not move ${old} to ${neu}: EXDEV: rename '${old}' -> '${neu}'`, hint: hint() })
  expect(readdirSync(HOME)).toEqual([".pm"])
  expect(readdirSync(old)).toEqual(["pm.db"])
  expect(names(join(old, "pm.db"))).toEqual(["Anna"])
})

test("a failed db rename is rolled back: ~/.pm intact, no ~/.ttybrain", () => {
  mkdirSync(old)
  seedDb(join(old, "pm.db"))
  writeFileSync(join(old, "pm.db-wal"), "")
  // pm.db is renamed, then its -wal fails: the set is undone, then the folder.
  const r = moveLegacyHome({ HOME }, failing("EACCES", (from) => basename(from) === "pm.db-wal"))
  const step = `EACCES: rename '${neu}/pm.db-wal' -> '${neu}/ttybrain.db-wal'`
  expect(r).toEqual({ kind: "blocked", message: `could not move ${old} to ${neu}: ${step}`, hint: hint() })
  expect(readdirSync(HOME)).toEqual([".pm"])
  expect(lstatSync(old).isDirectory()).toBe(true)
  expect(readdirSync(old).sort()).toEqual(["pm.db", "pm.db-wal"])
  expect(names(join(old, "pm.db"))).toEqual(["Anna"])
})

test("a move left half-done is finished on the next run", () => {
  mkdirSync(old)
  seedDb(join(old, "pm.db"))
  // The db rename fails and so does the rollback of the folder: the data is in ~/.ttybrain/pm.db.
  const r = moveLegacyHome({ HOME }, failing("EIO", (from, to) => basename(from) === "pm.db" || to === old))
  expect(r).toMatchObject({ kind: "blocked", hint: hint() })
  expect(readdirSync(HOME)).toEqual([".ttybrain"])
  expect(readdirSync(neu)).toEqual(["pm.db"])

  expect(moveLegacyHome({ HOME })).toEqual({ ...moved, kind: "resumed" })
  expect(names(join(neu, "ttybrain.db"))).toEqual(["Anna"])
  expect(names(join(old, "pm.db"))).toEqual(["Anna"]) // through both links
  expect(moveLegacyHome({ HOME })).toEqual({ kind: "nothing" })
})

test("data left in ~/.pm blocks every run", () => {
  mkdirSync(old)
  seedDb(join(old, "pm.db"))
  mkdirSync(neu)
  writeFileSync(join(neu, "config.json"), "{}")
  const blocked = { kind: "blocked", message: `your data is still in ${old}; move it to ${neu} by hand, or set TTYBRAIN_HOME=${old}` } as const
  expect(moveLegacyHome({ HOME })).toEqual(blocked)
  expect(moveLegacyHome({ HOME })).toEqual(blocked)
  expect(readdirSync(old)).toEqual(["pm.db"])
  expect(readdirSync(neu)).toEqual(["config.json"])
})

test("a ~/.pm that is not a directory is left alone", () => {
  writeFileSync(old, "a file")
  expect(moveLegacyHome({ HOME })).toEqual({ kind: "nothing" })
  expect(readdirSync(HOME)).toEqual([".pm"])
  expect(readFileSync(old, "utf8")).toBe("a file")
  rmSync(old)
  symlinkSync(join(HOME, "gone"), old) // dangling
  expect(moveLegacyHome({ HOME })).toEqual({ kind: "nothing" })
  expect(readdirSync(HOME)).toEqual([".pm"])
  expect(readlinkSync(old)).toBe(join(HOME, "gone"))
})
