// KernelDb owns the one SQLite connection: kernel-managed transactions (savepoints when nested),
// the in-process write mutex, and the Kysely instances built on a minimal driver over RawDb.
import {
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from "kysely"
import { IsolationError } from "../errors"
import type { RawDb } from "./sqlite"

// One query on the raw connection. Task 5's per-plugin driver wraps this with its isolation checks.
export class RawConnection implements DatabaseConnection {
  constructor(protected readonly raw: RawDb) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const stmt = this.raw.prepare(compiled.sql)
    const params = compiled.parameters as unknown[]
    if (stmt.reader) return { rows: stmt.all(params) as R[] }
    const { changes, lastInsertRowid } = stmt.run(params)
    return { rows: [], numAffectedRows: BigInt(changes), insertId: BigInt(lastInsertRowid) }
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("streaming queries are not supported")
  }
}

const kernelOwnsTransactions = () => new IsolationError("transactions are managed by the kernel")

// The connection is shared and synchronous, so there is no pool and no connection mutex.
// Transactions go through KernelDb.transaction, never through Kysely.
export class RawDriver implements Driver {
  constructor(protected readonly connection: DatabaseConnection) {}
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return this.connection
  }
  async beginTransaction(): Promise<void> {
    throw kernelOwnsTransactions()
  }
  async commitTransaction(): Promise<void> {
    throw kernelOwnsTransactions()
  }
  async rollbackTransaction(): Promise<void> {
    throw kernelOwnsTransactions()
  }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {} // KernelDb.close closes the raw connection
}

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
  private depth = 0
  private savepoints = 0
  private lock: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(raw: RawDb) {
    this.raw = raw
    this.kysely = kyselyOver(new RawDriver(new RawConnection(raw)))
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

  pluginDb(_pluginId: string): Kysely<any> {
    throw new Error("pluginDb is implemented in Task 5")
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.raw.inTransaction()) this.raw.exec("ROLLBACK")
    this.raw.close()
  }
}
