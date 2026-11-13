// KernelDb owns the one SQLite connection: kernel-managed transactions (savepoints when nested),
// the in-process write mutex, and the Kysely instances built on a minimal driver over RawDb.
import { AsyncLocalStorage } from "node:async_hooks"
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
  private readonly writing = new AsyncLocalStorage<{ open: boolean }>() // set by the outermost `write`
  private readonly commitHooks: Array<Array<() => void>> = [] // one frame per open transaction/savepoint

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
    this.commitHooks.push([])
    let hooks: Array<() => void> = []
    try {
      const result = await fn()
      this.ensureOpen()
      this.raw.exec("COMMIT")
      hooks = this.commitHooks[this.commitHooks.length - 1]!
      return result
    } catch (e) {
      if (!this.closed && this.raw.inTransaction()) this.raw.exec("ROLLBACK")
      throw e
    } finally {
      this.commitHooks.pop()
      this.depth--
      for (const hook of hooks) {
        try {
          hook()
        } catch (e) {
          console.error(`after-commit hook failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }

  private async nested<T>(fn: () => Promise<T>): Promise<T> {
    const name = `sp_${++this.savepoints}`
    this.raw.exec(`SAVEPOINT ${name}`)
    this.depth++
    this.commitHooks.push([])
    let released = false
    try {
      const result = await fn()
      this.ensureOpen()
      this.raw.exec(`RELEASE ${name}`)
      released = true
      return result
    } catch (e) {
      if (!this.closed && this.raw.inTransaction()) {
        this.raw.exec(`ROLLBACK TO ${name}`)
        this.raw.exec(`RELEASE ${name}`)
      }
      throw e
    } finally {
      const hooks = this.commitHooks.pop()!
      if (released) this.commitHooks[this.commitHooks.length - 1]!.push(...hooks) // kept only if the parent commits
      this.depth--
    }
  }

  // Runs `fn` after the outermost transaction commits; dropped if it (or the enclosing savepoint) rolls back.
  afterCommit(fn: () => void): void {
    const frame = this.commitHooks[this.commitHooks.length - 1]
    if (!frame) throw new Error("afterCommit needs an open transaction")
    frame.push(fn)
  }

  // A kernel write: the outermost call takes the write lock and opens the transaction; a call made inside
  // it (a write operation calling another plugin's write operation) reuses it as a savepoint, without the
  // lock, which is not re-entrant. "Inside" follows the async call chain, so concurrent outermost writes
  // queue on the lock instead of being mistaken for nested ones.
  write<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inWrite()) return this.transaction(fn)
    return this.withWriteLock(() => {
      const scope = { open: true } // closed when the write ends, so a leaked continuation takes the lock again
      return this.writing.run(scope, () => this.transaction(fn)).finally(() => (scope.open = false))
    })
  }

  inWrite(): boolean {
    return this.writing.getStore()?.open === true
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
