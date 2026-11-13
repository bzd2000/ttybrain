// The only module that touches a runtime-specific SQLite API: bun:sqlite under Bun, node:sqlite under Node.
// Both are presented as RawDb, with identical row shapes (plain objects, numbers never bigint).
import { BusyError } from "../errors"

export interface RawStatement {
  reader: boolean
  all(params: unknown[]): any[]
  run(params: unknown[]): { changes: number; lastInsertRowid: number }
}

export interface RawDb {
  exec(sql: string): void
  prepare(sql: string): RawStatement
  close(): void
  inTransaction(): boolean
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
const bunSqlite = isBun ? await import("bun:sqlite") : undefined
const nodeSqlite = isBun ? undefined : await import("node:sqlite")

function isBusy(e: unknown): boolean {
  const err = e as { code?: unknown; errcode?: unknown; errno?: unknown }
  if (typeof err?.code === "string" && err.code.startsWith("SQLITE_BUSY")) return true // bun:sqlite
  const primary = typeof err?.errcode === "number" ? err.errcode : err?.code === "ERR_SQLITE_ERROR" ? err.errno : undefined
  return typeof primary === "number" && (primary & 0xff) === 5 // node:sqlite; 5 = SQLITE_BUSY
}

function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (isBusy(e)) throw new BusyError(`database is busy: ${(e as Error).message}`)
    throw e
  }
}

function toNumber(v: unknown): unknown {
  return typeof v === "bigint" ? Number(v) : v
}

function bindable(params: unknown[]): any[] {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p))
}

function plainRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(row)) out[k] = toNumber(row[k])
  return out
}

function runResult(r: { changes: number | bigint; lastInsertRowid: number | bigint }) {
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
}

const PRAGMAS = ["PRAGMA busy_timeout = 3000", "PRAGMA foreign_keys = ON"]

function isFileDb(path: string): boolean {
  return path !== "" && path !== ":memory:" && !path.startsWith("file::memory:")
}

function openBun(path: string): RawDb {
  const db = new bunSqlite!.Database(path, { create: true })
  return {
    exec: (sql) => guard(() => void db.run(sql)),
    prepare(sql) {
      const stmt = guard(() => db.query(sql))
      return {
        reader: stmt.columnNames.length > 0,
        // iterate(), not all(): all() leaves EXPLAIN of a write statement un-reset, so a later COMMIT fails
        // with "SQL statements in progress". A fully consumed iterate() resets the statement.
        all: (params) => guard(() => [...stmt.iterate(...bindable(params))]).map((r) => plainRow(r as Record<string, unknown>)),
        run: (params) => runResult(guard(() => stmt.run(...bindable(params)))),
      }
    },
    close: () => db.close(),
    inTransaction: () => db.inTransaction,
  }
}

function openNode(path: string): RawDb {
  const db = new nodeSqlite!.DatabaseSync(path)
  return {
    exec: (sql) => guard(() => db.exec(sql)),
    prepare(sql) {
      const stmt = guard(() => db.prepare(sql))
      return {
        reader: stmt.columns().length > 0,
        all: (params) => guard(() => stmt.all(...bindable(params))).map((r) => plainRow(r as Record<string, unknown>)),
        run: (params) => runResult(guard(() => stmt.run(...bindable(params)))),
      }
    },
    close: () => db.close(),
    inTransaction: () => db.isTransaction,
  }
}

// Switching a new file to WAL needs an exclusive lock and SQLite does not call the busy handler for it, so two
// processes creating the database at the same time get SQLITE_BUSY at once. Retry for as long as busy_timeout.
function enableWal(raw: RawDb): void {
  const deadline = Date.now() + 3000
  const pause = new Int32Array(new SharedArrayBuffer(4))
  for (;;) {
    try {
      raw.exec("PRAGMA journal_mode = WAL")
      return
    } catch (e) {
      if (!(e instanceof BusyError) || Date.now() > deadline) throw e
    }
    Atomics.wait(pause, 0, 0, 20)
  }
}

export function openRaw(path: string): RawDb {
  const raw = isBun ? openBun(path) : openNode(path)
  for (const p of PRAGMAS) raw.exec(p)
  if (isFileDb(path)) enableWal(raw)
  return raw
}
