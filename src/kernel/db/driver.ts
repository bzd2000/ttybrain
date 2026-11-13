// Kysely drivers over RawDb. RawConnection/RawDriver serve the kernel's unscoped Kysely; PmConnection/PmDriver
// are a plugin's: layer 2 of data isolation checks the final compiled SQL with EXPLAIN before running it.
// The views a query may read through are derived from that query's own node tree, never from shared state.
import type { CompiledQuery, DatabaseConnection, Driver, OperationNode, QueryResult, TableNode } from "kysely"
import { IsolationError } from "../errors"
import { isReservedName } from "../plugin-id"
import { ALLOWED_KEYWORDS, firstKeyword, type TableChecker } from "./explain"
import { assertMigrationHooks, SCHEMA_NODE_KINDS, schemaChangesOnlyInMigrations, walk, type TableAccess } from "./scope"
import type { RawDb } from "./sqlite"

// One query on the raw connection. `guard` runs before every statement (KernelDb's nested-write rule).
export class RawConnection implements DatabaseConnection {
  constructor(
    protected readonly raw: RawDb,
    private readonly guard: () => void = () => {},
  ) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    this.guard()
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

const DDL = new Set(["CREATE", "ALTER", "DROP"])
const TRANSACTION = new Set(["BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"])

function viewsUsed(query: OperationNode, access: TableAccess): string[] {
  const byPhysical = new Map([...access.views().values()].map((v) => [v.physical, v]))
  const base = new Set<string>()
  walk(query, (n) => {
    if (n.kind !== "TableNode") return
    const view = byPhysical.get((n as TableNode).table.identifier.name)
    if (view) for (const t of view.baseTables) base.add(t)
  })
  return [...base]
}

export class PmConnection extends RawConnection {
  constructor(
    raw: RawDb,
    private readonly pluginId: string,
    private readonly access: TableAccess,
    private readonly checker: TableChecker,
    private readonly onSchemaChange: () => void,
    private readonly statementGuard: () => void = () => {},
  ) {
    super(raw, statementGuard)
  }

  override async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    this.statementGuard() // before the EXPLAIN checks too, so the error is the guard's
    const keyword = firstKeyword(compiled.sql)
    if (TRANSACTION.has(keyword)) throw kernelOwnsTransactions()
    const ddl = DDL.has(keyword) || SCHEMA_NODE_KINDS.has(compiled.query.kind)
    if (!ddl && !ALLOWED_KEYWORDS.dml.has(keyword)) throw new IsolationError(`plugin "${this.pluginId}" may not run ${keyword || "this"} statements`)
    assertMigrationHooks(this.access)
    const migrating = this.access.migrating()
    if (ddl && !migrating) throw schemaChangesOnlyInMigrations()

    const own = new Set([...this.access.ownTables()].map((t) => `${this.pluginId}_${t}`))
    const allowed = new Set([...own, ...viewsUsed(compiled.query, this.access)])
    for (const t of this.checker.tablesTouched(compiled.sql, migrating && ddl ? "migration" : "dml")) {
      // Kernel and SQLite tables are never a plugin's, whatever its id (defence in depth for assertPluginId).
      const owns = this.access.ownsPhysical?.(t) ?? true
      if (allowed.has(t) && !isReservedName(t) && owns) continue
      if (migrating && ddl && migrationMayTouch(this.pluginId, t) && owns) continue
      if (t === "sqlite_schema") throw schemaChangesOnlyInMigrations()
      throw new IsolationError(`plugin "${this.pluginId}" may not use table "${t}"`)
    }

    const result = await super.executeQuery<R>(compiled)
    if (ddl) {
      this.onSchemaChange()
      this.access.afterSchemaChange?.()
    }
    return result
  }
}

// Schema statements in a migration may also touch tables the plugin is creating, and the schema tables:
// sqlite_schema, and the temp schema's root page (db1:page1), which ALTER TABLE RENAME / DROP COLUMN read.
// What a migration actually changes is checked afterwards by the MigrationRunner's schema diff.
function migrationMayTouch(pluginId: string, t: string): boolean {
  if (t === "sqlite_schema" || t === "db1:page1") return true
  return t.toLowerCase().startsWith(`${pluginId}_`) && !isReservedName(t)
}

// A plugin's driver: the raw driver (transactions stay kernel-only) over that plugin's checked connection.
export class PmDriver extends RawDriver {
  constructor(connection: PmConnection) {
    super(connection)
  }
}
