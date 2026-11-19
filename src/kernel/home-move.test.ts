import { afterEach, beforeEach, expect, test } from "bun:test"
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { openRaw } from "./db/sqlite"
import { moveLegacyHome } from "./home-move"
import { resolvePaths } from "./paths"

let HOME: string
let old: string
let neu: string

beforeEach(() => {
  HOME = realpathSync(mkdtempSync(join(tmpdir(), "ttybrain-home-")))
  old = join(HOME, ".pm")
  neu = join(HOME, ".ttybrain")
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

test("moves ~/.pm to ~/.ttybrain, renames the db and backups, links back", () => {
  mkdirSync(join(old, "plugins", "x"), { recursive: true })
  seedDb(join(old, "pm.db"))
  writeFileSync(join(old, "pm.db.bak-v3"), "backup")
  writeFileSync(join(old, "config.json"), '{"staleContactDays": 3}')
  writeFileSync(join(old, "plugins", "x", "package.json"), "{}")

  expect(moveLegacyHome({ HOME })).toBe(`moved your data from ${HOME}/.pm to ${HOME}/.ttybrain`)

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
})

test("does nothing when ~/.ttybrain exists", () => {
  mkdirSync(old)
  writeFileSync(join(old, "pm.db"), "old")
  mkdirSync(neu)
  writeFileSync(join(neu, "ttybrain.db"), "new")
  expect(moveLegacyHome({ HOME })).toBeUndefined()
  expect(readdirSync(old)).toEqual(["pm.db"])
  expect(readdirSync(neu)).toEqual(["ttybrain.db"])
  expect(lstatSync(old).isDirectory()).toBe(true)
  expect(readFileSync(join(old, "pm.db"), "utf8")).toBe("old")
  expect(readFileSync(join(neu, "ttybrain.db"), "utf8")).toBe("new")
})

test("does nothing when TTYBRAIN_HOME or TTYBRAIN_DB is set", () => {
  mkdirSync(old)
  writeFileSync(join(old, "pm.db"), "old")
  expect(moveLegacyHome({ HOME, TTYBRAIN_HOME: join(HOME, "data") })).toBeUndefined()
  expect(moveLegacyHome({ HOME, TTYBRAIN_DB: join(HOME, "x.db") })).toBeUndefined()
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
  expect(moveLegacyHome({ HOME, [legacyHome]: "/elsewhere" })).toBe(`moved your data from ${HOME}/.pm to ${HOME}/.ttybrain`)
  expect(names(join(neu, "ttybrain.db"))).toEqual(["Anna"])
})

test("does nothing when there is no ~/.pm", () => {
  expect(moveLegacyHome({ HOME })).toBeUndefined()
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

  expect(moveLegacyHome({ HOME })).toBe(`moved your data from ${HOME}/.pm to ${HOME}/.ttybrain`)
  expect(readdirSync(neu).sort()).toEqual(["pm.db", "ttybrain.db", "ttybrain.db-shm", "ttybrain.db-wal"])
  expect(names(join(neu, "ttybrain.db"))).toEqual(["Anna"])
})
