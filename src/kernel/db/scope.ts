// Layer 1 of data isolation: rewrite and check a plugin's Kysely query tree before it is compiled.
// Short own-table names become `<pluginId>_<name>`, `<plugin>.<view>` becomes the view's physical name,
// everything else is rejected. Column references are checked against the query's sources.
import {
  OperationNodeTransformer,
  type CheckConstraintNode,
  type CreateIndexNode,
  type CreateViewNode,
  type DeleteQueryNode,
  type DropIndexNode,
  type DropViewNode,
  type ForeignKeyConstraintNode,
  type IdentifierNode,
  type InsertQueryNode,
  type KyselyPlugin,
  type OperationNode,
  type PrimaryKeyConstraintNode,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RootOperationNode,
  type SchemableIdentifierNode,
  type TableNode,
  type UniqueConstraintNode,
  type UnknownRow,
  type UpdateQueryNode,
} from "kysely"
import { IsolationError } from "../errors"

export interface PublishedView {
  physical: string
  columns: string[]
  baseTables: string[]
}

export interface TableAccess {
  ownTables(): Set<string> // short names
  views(): Map<string, PublishedView> // keyed "<plugin>.<view>"
  migrating(): boolean
  ownerOf(name: string): string | undefined // kernel-wide: which plugin owns this short or physical table name
}

export const SCHEMA_NODE_KINDS: ReadonlySet<string> = new Set([
  "CreateTableNode",
  "CreateIndexNode",
  "CreateViewNode",
  "AlterTableNode",
  "DropTableNode",
  "DropIndexNode",
  "DropViewNode",
])

export const schemaChangesOnlyInMigrations = () => new IsolationError("schema changes are only allowed in migrations")

// Generic walk over a node tree: every object-valued property is a child node or a list of them.
export function walk(node: unknown, visit: (n: OperationNode) => void): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit)
    return
  }
  if (!node || typeof node !== "object") return
  if (typeof (node as OperationNode).kind === "string") visit(node as OperationNode)
  for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, visit)
}

// Table aliases (`contract as c`, a derived table `(...) as sub`) and selection aliases (`count(*) as n`).
function collectAliases(root: OperationNode): { tables: Set<string>; columns: Set<string> } {
  const tables = new Set<string>()
  const columns = new Set<string>()
  walk(root, (n) => {
    if (n.kind !== "AliasNode") return
    const { node, alias } = n as unknown as { node: OperationNode; alias: OperationNode }
    if (alias.kind !== "IdentifierNode") return
    const name = (alias as IdentifierNode).name
    if (node.kind === "TableNode" || node.kind === "SelectQueryNode") tables.add(name)
    else columns.add(name)
  })
  return { tables, columns }
}

export class ScopeTransformer extends OperationNodeTransformer {
  private readonly prefix: string
  private readonly ddl: boolean

  constructor(
    private readonly pluginId: string,
    private readonly access: TableAccess,
    private readonly tableAliases: Set<string>,
    root: OperationNode,
  ) {
    super()
    this.prefix = `${pluginId}_`
    this.ddl = SCHEMA_NODE_KINDS.has(root.kind)
    if (this.ddl && !access.migrating()) throw schemaChangesOnlyInMigrations()
  }

  protected override transformTable(node: TableNode): TableNode {
    const schema = node.table.schema?.name
    const name = node.table.identifier.name
    if (!schema && this.tableAliases.has(name)) return node
    if (schema) {
      if (this.ddl) throw new IsolationError(`schema statements may not name ${schema}.${name}`)
      return this.rename(node, this.view(schema, name).physical)
    }
    // In a migration a plugin may name tables it is about to create; the prefix keeps them in its namespace.
    if (this.ddl || this.access.ownTables().has(name)) return this.rename(node, this.prefix + name)
    throw this.notOwned(name)
  }

  protected override transformInsertQuery(node: InsertQueryNode): InsertQueryNode {
    this.rejectViewTarget(node.into)
    return super.transformInsertQuery(node)
  }

  protected override transformUpdateQuery(node: UpdateQueryNode): UpdateQueryNode {
    this.rejectViewTarget(node.table)
    return super.transformUpdateQuery(node)
  }

  protected override transformDeleteQuery(node: DeleteQueryNode): DeleteQueryNode {
    this.rejectViewTarget(node.from)
    return super.transformDeleteQuery(node)
  }

  protected override transformCreateIndex(node: CreateIndexNode): CreateIndexNode {
    return super.transformCreateIndex({ ...node, name: this.prefixed(node.name) })
  }

  protected override transformDropIndex(node: DropIndexNode): DropIndexNode {
    return super.transformDropIndex({ ...node, name: this.prefixedSchemable(node.name) })
  }

  protected override transformCreateView(node: CreateViewNode): CreateViewNode {
    return super.transformCreateView({ ...node, name: this.prefixedSchemable(node.name) })
  }

  protected override transformDropView(node: DropViewNode): DropViewNode {
    return super.transformDropView({ ...node, name: this.prefixedSchemable(node.name) })
  }

  // Constraint names get the same prefix as tables and indexes.
  protected override transformPrimaryKeyConstraint(node: PrimaryKeyConstraintNode): PrimaryKeyConstraintNode {
    return super.transformPrimaryKeyConstraint(this.withPrefixedName(node))
  }
  protected override transformUniqueConstraint(node: UniqueConstraintNode): UniqueConstraintNode {
    return super.transformUniqueConstraint(this.withPrefixedName(node))
  }
  protected override transformForeignKeyConstraint(node: ForeignKeyConstraintNode): ForeignKeyConstraintNode {
    return super.transformForeignKeyConstraint(this.withPrefixedName(node))
  }
  protected override transformCheckConstraint(node: CheckConstraintNode): CheckConstraintNode {
    return super.transformCheckConstraint(this.withPrefixedName(node))
  }

  private view(schema: string, name: string): PublishedView {
    const v = this.access.views().get(`${schema}.${name}`)
    if (!v) throw new IsolationError(`${schema}.${name} is not a published view`)
    return v
  }

  private rejectViewTarget(target: OperationNode | undefined) {
    walk(target, (n) => {
      if (n.kind !== "TableNode") return
      const t = (n as TableNode).table
      if (t.schema) throw new IsolationError(`${t.schema.name}.${t.identifier.name} is a published view and is read-only`)
    })
  }

  private notOwned(name: string): IsolationError {
    const msg = `table "${name}" is not owned by plugin "${this.pluginId}"`
    const owner = this.access.ownerOf(name)
    if (!owner) return new IsolationError(msg)
    const short = name.startsWith(`${owner}_`) ? name.slice(owner.length + 1) : name
    return new IsolationError(`${msg}; read ${owner}.${short} if published, or use ${owner}.<operation>`)
  }

  private rename(node: TableNode, physical: string): TableNode {
    return {
      ...node,
      table: { ...node.table, schema: undefined, identifier: { ...node.table.identifier, name: physical } },
    }
  }

  private prefixed(id: IdentifierNode): IdentifierNode {
    return { ...id, name: this.prefix + id.name }
  }

  private prefixedSchemable(id: SchemableIdentifierNode): SchemableIdentifierNode {
    if (id.schema) throw new IsolationError(`schema statements may not name ${id.schema.name}.${id.identifier.name}`)
    return { ...id, identifier: this.prefixed(id.identifier) }
  }

  private withPrefixedName<T extends { name?: IdentifierNode }>(node: T): T {
    return node.name ? { ...node, name: this.prefixed(node.name) } : node
  }
}

// Every ColumnNode must name a column of one of the query's (rewritten) sources, or a selection alias.
// Bun's SQLite would otherwise read an unknown double-quoted name as a string literal (§3.3.3).
function checkColumns(
  root: OperationNode,
  pluginId: string,
  access: TableAccess,
  aliases: { tables: Set<string>; columns: Set<string> },
  columnsOf: (physical: string) => Set<string>,
) {
  const viewsByPhysical = new Map([...access.views().values()].map((v) => [v.physical, v]))
  const known = new Set(aliases.columns)
  const sources = new Set<string>()
  walk(root, (n) => {
    if (n.kind === "TableNode") sources.add((n as TableNode).table.identifier.name)
  })
  for (const s of sources) {
    if (aliases.tables.has(s)) continue
    const view = viewsByPhysical.get(s)
    const cols = view ? view.columns : s.startsWith(`${pluginId}_`) ? columnsOf(s) : []
    for (const c of cols) known.add(c)
  }
  walk(root, (n) => {
    if (n.kind !== "ColumnNode") return
    const name = (n as unknown as { column: IdentifierNode }).column.name
    if (!known.has(name)) throw new IsolationError(`unknown column "${name}"`)
  })
}

export function scopePlugin(pluginId: string, access: TableAccess, columnsOf: (physical: string) => Set<string>): KyselyPlugin {
  return {
    transformQuery({ node }: PluginTransformQueryArgs): RootOperationNode {
      const aliases = collectAliases(node)
      for (const a of aliases.tables) {
        if (a.includes("__pub_")) throw new IsolationError(`alias "${a}" is reserved`)
      }
      const out = new ScopeTransformer(pluginId, access, aliases.tables, node).transformNode(node)
      if (!SCHEMA_NODE_KINDS.has(out.kind)) checkColumns(out, pluginId, access, aliases, columnsOf)
      return out
    },
    async transformResult({ result }: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
      return result
    },
  }
}
