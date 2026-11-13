// Kysely drivers over RawDb. RawConnection/RawDriver serve the kernel's unscoped Kysely; PmConnection/PmDriver
// are a plugin's: layer 2 of data isolation checks the final compiled SQL with EXPLAIN before running it.
// The views a query may read through are derived from that query's own node tree, never from shared state.
import type { CompiledQuery, DatabaseConnection, Driver, OperationNode, QueryResult, TableNode } from "kysely"
import { IsolationError } from "../errors"
import type { TableChecker } from "./explain"
import { SCHEMA_NODE_KINDS, schemaChangesOnlyInMigrations, walk, type TableAccess } from "./scope"
import type { RawDb } from "./sqlite"

// One query on the raw connection.
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

const DML = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "WITH", "REPLACE", "VALUES"])
const DDL = new Set(["CREATE", "ALTER", "DROP"])
const TRANSACTION = new Set(["BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"])

// First keyword of the statement, past whitespace, comments and opening parentheses.
function leadingKeyword(sql: string): string {
  const s = sql.replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\()*/, "")
  return (/^[A-Za-z]+/.exec(s)?.[0] ?? "").toUpperCase()
}

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
  ) {
    super(raw)
  }

  override async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const keyword = leadingKeyword(compiled.sql)
    if (TRANSACTION.has(keyword)) throw kernelOwnsTransactions()
    const ddl = DDL.has(keyword) || SCHEMA_NODE_KINDS.has(compiled.query.kind)
    if (!ddl && !DML.has(keyword)) throw new IsolationError(`plugin "${this.pluginId}" may not run ${keyword || "this"} statements`)
    const migrating = this.access.migrating()
    if (ddl && !migrating) throw schemaChangesOnlyInMigrations()

    const own = new Set([...this.access.ownTables()].map((t) => `${this.pluginId}_${t}`))
    const allowed = new Set([...own, ...viewsUsed(compiled.query, this.access)])
    for (const t of this.checker.tablesTouched(compiled.sql)) {
      if (allowed.has(t)) continue
      if (migrating && ddl && (t === "sqlite_schema" || t.startsWith(`${this.pluginId}_`))) continue
      if (t === "sqlite_schema") throw schemaChangesOnlyInMigrations()
      throw new IsolationError(`plugin "${this.pluginId}" may not use table "${t}"`)
    }

    const result = await super.executeQuery<R>(compiled)
    if (ddl) this.onSchemaChange()
    return result
  }
}

// A plugin's driver: the raw driver (transactions stay kernel-only) over that plugin's checked connection.
export class PmDriver extends RawDriver {
  constructor(connection: PmConnection) {
    super(connection)
  }
}
