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

type Hooks = Array<() => void>
// One per open `write`. `queue` chains the nested writes started inside it; `hooks` are its after-commit hooks.
// `op` marks a write operation's own scope (operations.ts): plugin data changes (R15) need one, open, on the chain.
type WriteScope = { open: boolean; queue: Promise<unknown>; hooks: Hooks; parent?: WriteScope; op: boolean }
export type WriteOptions = { op?: boolean }
const newScope = (op: boolean, parent?: WriteScope): WriteScope => ({ open: true, queue: Promise.resolve(), hooks: [], parent, op })
const LATE = "write started after its parent write ended; await nested writes"
const NESTED_RUNNING = "a write ran a statement while one of its nested writes was running; await nested writes"
const ENDED = "a statement ran after its write ended; await all work inside a write"

const rootOf = (s: WriteScope): WriteScope => (s.parent ? rootOf(s.parent) : s)

function runHooks(hooks: Hooks): void {
  for (const hook of hooks) {
    try {
      hook()
    } catch (e) {
      console.error(`after-commit hook failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
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
  private readonly writing = new AsyncLocalStorage<WriteScope>() // the innermost `write`
  private readonly frames: Hooks[] = [] // after-commit hooks of plain (non-write) transactions
  private openRoot?: WriteScope // the outermost write whose transaction is open
  private readonly savepointOwners: WriteScope[] = [] // the nested writes whose savepoints are open, innermost last

  constructor(raw: RawDb) {
    this.raw = raw
    this.kysely = kyselyOver(new RawDriver(new RawConnection(raw, () => this.checkStatement())))
    this.tables = createTableChecker(raw)
  }

  // Inside a `write` this is a nested write. Otherwise (kernel code holding the lock: migrations, views) it is
  // a plain transaction, a savepoint when nested, with its after-commit hooks kept on `frames`.
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("database is closed")
    if (this.writing.getStore()) return this.write(fn)
    const parent = this.frames[this.frames.length - 1]
    const frame: Hooks = []
    this.frames.push(frame)
    let result: T
    try {
      result = this.depth > 0 ? await this.nested(fn) : await this.outer(fn)
    } finally {
      this.frames.pop()
    }
    if (parent) parent.push(...frame) // kept only if the parent commits
    else runHooks(frame)
    return result
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

  private async nested<T>(fn: () => Promise<T>, owner?: WriteScope): Promise<T> {
    const name = `sp_${++this.savepoints}`
    this.raw.exec(`SAVEPOINT ${name}`)
    this.depth++
    if (owner) this.savepointOwners.push(owner)
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
      if (owner) this.savepointOwners.pop()
      this.depth--
    }
  }

  // Every Kysely statement (kernel and plugins) passes here first. While a write's transaction is open, only
  // the innermost open nested write (or writes nested in it) may run statements: a statement from its parent
  // would land inside the child's savepoint and be undone if the child rolls back. Code outside any write
  // (a reader) is not part of the transaction's tree and is unaffected.
  private checkStatement(): void {
    const scope = this.writing.getStore()
    if (!scope) return
    for (let s: WriteScope | undefined = scope; s; s = s.parent) if (!s.open) throw new Error(ENDED)
    if (rootOf(scope) !== this.openRoot) return
    const owner = this.savepointOwners[this.savepointOwners.length - 1] ?? this.openRoot
    for (let s: WriteScope | undefined = scope; s; s = s.parent) if (s === owner) return
    throw new Error(NESTED_RUNNING)
  }

  // Runs `fn` after the outermost transaction commits; dropped if it (or the enclosing savepoint) rolls back.
  afterCommit(fn: () => void): void {
    const scope = this.writing.getStore()
    const frame = scope?.open ? scope.hooks : this.frames[this.frames.length - 1]
    if (!frame) throw new Error("afterCommit needs an open transaction")
    frame.push(fn)
  }

  // A kernel write.
  // - The outermost call takes the write lock and opens the transaction. "Outermost" follows the async call
  //   chain (AsyncLocalStorage), so concurrent outermost writes queue on the lock.
  // - A call made inside it (a write operation calling another plugin's write operation) is a savepoint,
  //   without the lock, which is not re-entrant. Sibling nested writes (`Promise.all`) queue on their parent's
  //   scope, so their savepoints never interleave.
  // - Before a write commits, releases or rolls back, it waits for every nested write started inside it, so
  //   an un-awaited nested write commits or rolls back with its parent. A write started from a scope that has
  //   already ended (a timer) is rejected.
  // - Rule: a nested write must be awaited before its parent issues further statements. A parent statement
  //   while a nested write it started is still running throws (see checkStatement) and fails the parent,
  //   which then rolls back with everything in it; nothing is lost silently.
  // - Known limit: a nested write that awaits a sibling started after it deadlocks (it queues behind itself).
  // - `op: true` only from the operation wrapper: a plain write (the TUI's act, a change set) is a transaction
  //   only, so plugin DML directly inside it is still rejected (R15); its operations' own scopes allow it.
  write<T>(fn: () => Promise<T>, opts: WriteOptions = {}): Promise<T> {
    const op = opts.op === true
    const parent = this.writing.getStore()
    if (!parent) return this.outermost(fn, op)
    if (!parent.open) return Promise.reject(new Error(LATE))
    const run = parent.queue.then(async () => {
      if (!parent.open) throw new Error(LATE)
      const scope = newScope(op, parent)
      const result = await this.writing.run(scope, () => this.nested(() => this.drained(scope, fn), scope))
      parent.hooks.push(...scope.hooks) // kept only if the parent commits
      return result
    })
    parent.queue = run.catch(() => {})
    return run
  }

  // After-commit hooks run once the lock is released and outside any write scope, so a hook that writes
  // (a `record.changed` handler) is a fresh outermost write.
  private async outermost<T>(fn: () => Promise<T>, op: boolean): Promise<T> {
    if (this.closed) throw new Error("database is closed")
    const scope = newScope(op)
    const result = await this.withWriteLock(async () => {
      this.openRoot = scope
      try {
        return await this.writing.run(scope, () => this.outer(() => this.drained(scope, fn)))
      } finally {
        this.openRoot = undefined
      }
    })
    this.writing.exit(() => runHooks(scope.hooks))
    return result
  }

  // `fn`, then every nested write queued on `scope` (including ones queued meanwhile), then the scope closes.
  // The outcome is fn's: nested writes that failed were already rolled back to their own savepoints.
  private async drained<T>(scope: WriteScope, fn: () => Promise<T>): Promise<T> {
    let outcome: { ok: true; value: T } | { ok: false; error: unknown }
    try {
      outcome = { ok: true, value: await fn() }
    } catch (error) {
      outcome = { ok: false, error }
    }
    for (let q = scope.queue; ; q = scope.queue) {
      await q
      if (q === scope.queue) break
    }
    scope.open = false
    if (!outcome.ok) throw outcome.error
    return outcome.value
  }

  // `PRAGMA data_version`: changes when another connection commits to the database file.
  dataVersion(): number {
    return Number(Object.values(this.raw.prepare("PRAGMA data_version").all([])[0] ?? {})[0])
  }

  inWrite(): boolean {
    return this.writing.getStore()?.open === true
  }

  // Inside a write operation: an open write scope on the chain that a write operation opened (R15).
  inOperation(): boolean {
    for (let s = this.writing.getStore(); s; s = s.parent) {
      if (!s.open) return false
      if (s.op) return true
    }
    return false
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
    const connection = new PmConnection(
      this.raw,
      pluginId,
      access,
      this.tables,
      () => this.invalidateSchema(),
      () => this.checkStatement(),
      () => this.inOperation(),
    )
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
