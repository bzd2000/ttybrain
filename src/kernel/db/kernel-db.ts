// KernelDb owns the one SQLite connection: kernel-managed transactions (savepoints when nested),
// the in-process write mutex, and the Kysely instances built on a minimal driver over RawDb.
import { Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, type Dialect, type Driver } from "kysely"
import { PmConnection, PmDriver, RawConnection, RawDriver } from "./driver"
import { assertPluginId } from "../plugin-id"
import { createTableChecker, type TableChecker } from "./explain"
import { assertMigrationHooks, scopePlugin, type TableAccess } from "./scope"
import type { RawDb } from "./sqlite"

export { RawConnection, RawDriver } from "./driver"

export function kyselyOver(driver: Driver): Kysely<any> {
  const dialect: Dialect = {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => driver,
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  }
  return new Kysely<any>({ dialect })
}

export class KernelDb {
  readonly raw: RawDb
  readonly kysely: Kysely<any> // unscoped: kernel code only
  readonly tables: TableChecker // layer 2, shared by all plugin drivers
  private readonly columns = new Map<string, Set<string>>()
  private depth = 0
  private savepoints = 0
  private lock: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(raw: RawDb) {
    this.raw = raw
    this.kysely = kyselyOver(new RawDriver(new RawConnection(raw)))
    this.tables = createTableChecker(raw)
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("database is closed")
    if (this.depth === 0) return this.outer(fn)
    return this.nested(fn)
  }

  private async outer<T>(fn: () => Promise<T>): Promise<T> {
    this.raw.exec("BEGIN IMMEDIATE")
    this.depth++
    try {
      const result = await fn()
      this.ensureOpen()
      this.raw.exec("COMMIT")
      return result
    } catch (e) {
      if (!this.closed && this.raw.inTransaction()) this.raw.exec("ROLLBACK")
      throw e
    } finally {
      this.depth--
    }
  }

  private async nested<T>(fn: () => Promise<T>): Promise<T> {
    const name = `sp_${++this.savepoints}`
    this.raw.exec(`SAVEPOINT ${name}`)
    this.depth++
    try {
      const result = await fn()
      this.ensureOpen()
      this.raw.exec(`RELEASE ${name}`)
      return result
    } catch (e) {
      if (!this.closed && this.raw.inTransaction()) {
        this.raw.exec(`ROLLBACK TO ${name}`)
        this.raw.exec(`RELEASE ${name}`)
      }
      throw e
    } finally {
      this.depth--
    }
  }

  private ensureOpen() {
    if (this.closed) throw new Error("database was closed during the transaction")
  }

  // Not re-entrant: callers take it once, for the outermost write operation.
  withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn)
    this.lock = run.catch(() => {})
    return run
  }

  // The plugin's `ctx.data`: layer 1 (query tree) as a Kysely plugin, layer 2 (EXPLAIN) in the connection.
  pluginDb(pluginId: string, access: TableAccess): Kysely<any> {
    assertPluginId(pluginId)
    assertMigrationHooks(access)
    const connection = new PmConnection(this.raw, pluginId, access, this.tables, () => this.invalidateSchema())
    return kyselyOver(new PmDriver(connection)).withPlugin(scopePlugin(pluginId, access, (t) => this.columnsOf(t)))
  }

  // Own-table columns for the layer 1 column check, cached until the schema changes.
  // Empty (no such table) is not cached, so a table created later is seen without an invalidation.
  columnsOf(physical: string): Set<string> {
    let cols = this.columns.get(physical)
    if (!cols) {
      cols = new Set(this.raw.prepare(`PRAGMA table_info("${physical.replace(/"/g, '""')}")`).all([]).map((r) => String(r.name)))
      if (cols.size > 0) this.columns.set(physical, cols)
    }
    return cols
  }

  // Call after any schema change made outside a plugin driver (plugin-driver DDL calls it itself).
  invalidateSchema(): void {
    this.tables.invalidate()
    this.columns.clear()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.raw.inTransaction()) this.raw.exec("ROLLBACK")
    this.raw.close()
  }
}
