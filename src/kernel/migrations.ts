// Per-plugin migrations: the only place a plugin may change the schema. Each migration runs in its own
// BEGIN IMMEDIATE transaction through the plugin's scoped Kysely (layer 1 + 2 in migration mode). Afterwards
// the runner diffs sqlite_schema, the last line of defence for schema-level isolation: on any violation the
// migration is rolled back with IsolationError.
import { existsSync, renameSync, rmSync } from "node:fs"
import type { Kysely } from "kysely"
import { systemClock, type Clock } from "./clock"
import type { KernelDb } from "./db/kernel-db"
import type { TableAccess } from "./db/scope"
import { IsolationError } from "./errors"
import { assertPluginId, isReservedName } from "./plugin-id"
import type { Paths } from "./paths"

export type Migration = { id: string; up: (db: Kysely<any>) => Promise<void> }


const KERNEL_TABLES = [
  `CREATE TABLE IF NOT EXISTS kernel_plugin_migration (
    plugin TEXT NOT NULL, id TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (plugin, id))`,
  `CREATE TABLE IF NOT EXISTS kernel_record_origin (
    record_type TEXT NOT NULL, record_id INTEGER NOT NULL, origin_type TEXT NOT NULL, origin_ref TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY (record_type, record_id, origin_type, origin_ref))`,
  `CREATE INDEX IF NOT EXISTS kernel_record_origin_origin ON kernel_record_origin (origin_type, origin_ref)`,
  `CREATE TABLE IF NOT EXISTS kernel_change_set (
    id INTEGER PRIMARY KEY, origin_type TEXT, origin_ref TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kernel_change_set_op (
    change_set_id INTEGER NOT NULL REFERENCES kernel_change_set (id), position INTEGER NOT NULL,
    plugin TEXT NOT NULL, operation TEXT NOT NULL, input_json TEXT NOT NULL, description TEXT NOT NULL,
    result_ref TEXT, PRIMARY KEY (change_set_id, position))`,
]

type SchemaObject = { type: string; name: string; tbl_name: string; sql: string | null }

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

// Root page -> the table it belonged to (for a table or index b-tree), taken before a migration. Names can be
// changed by ALTER TABLE RENAME, root pages cannot, so this is how a migration tells whose table it really is.
export type RootOwners = Map<number, string>

export function rootOwners(kdb: KernelDb): RootOwners {
  const rows = kdb.raw.prepare("SELECT rootpage, tbl_name FROM sqlite_schema WHERE rootpage > 0").all([])
  return new Map(rows.map((r) => [Number(r.rootpage), String(r.tbl_name)]))
}

const isOwnName = (pluginId: string, name: string) => name.toLowerCase().startsWith(`${pluginId}_`) && !isReservedName(name)

// A plugin's own tables, read from the live schema: `<pluginId>_<short>`, minus the kernel-reserved `<pluginId>__*`.
// With `roots` (during a migration), a table whose root page belonged to someone else before it is never own,
// whatever it is called now.
export function ownTablesOf(kdb: KernelDb, pluginId: string, roots?: RootOwners): Set<string> {
  const prefix = `${pluginId}_`
  const out = new Set<string>()
  for (const r of kdb.raw.prepare("SELECT name, rootpage FROM sqlite_schema WHERE type = 'table'").all([])) {
    const name = String(r.name)
    if (!isOwnName(pluginId, name) || name.toLowerCase().startsWith(`${pluginId}__`)) continue
    const was = roots?.get(Number(r.rootpage))
    if (was !== undefined && !isOwnName(pluginId, was)) continue
    out.add(name.slice(prefix.length))
  }
  return out
}

// Kernel-wide owner of a short or physical table name, for error messages.
export function ownerOf(kdb: KernelDb, name: string): string | undefined {
  for (const r of kdb.raw.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view')").all([])) {
    const physical = String(r.name)
    const i = physical.indexOf("_")
    if (i <= 0) continue
    const owner = physical.slice(0, i)
    if (owner === "kernel" || owner === "sqlite") continue
    if (physical === name || physical.slice(i + 1) === name) return owner
  }
  return undefined
}

export class MigrationRunner {
  private backedUp = false
  private appliedAtBoot?: number // migrations applied before this boot applied any: 0 means a new database

  constructor(
    private readonly kdb: KernelDb,
    private readonly paths: Paths,
    private readonly clock: Clock = systemClock,
  ) {}

  async ensureKernelTables(): Promise<void> {
    try {
      await this.kdb.withWriteLock(() =>
        this.kdb.transaction(async () => {
          for (const ddl of KERNEL_TABLES) this.kdb.raw.exec(ddl)
        }),
      )
    } finally {
      this.kdb.invalidateSchema()
    }
    this.bootCount()
  }

  pending(pluginId: string, migrations: Migration[]): Migration[] {
    const done = this.appliedIds(pluginId)
    return migrations.filter((m) => !done.has(m.id))
  }

  // Copies the database to `pm.db.bak-v<N>` (N = migrations applied so far, all plugins) once per boot, before
  // the first migration is applied to a database that existed with some applied. Called by run() itself; with a
  // plugin and its migrations it backs up only if one is pending, without them the caller states that something is.
  backupIfNeeded(pluginId?: string, migrations?: Migration[]): void {
    if (this.backedUp || this.bootCount() === 0) return
    if (pluginId !== undefined && migrations !== undefined && this.pending(pluginId, migrations).length === 0) return
    if (!existsSync(this.paths.db)) return
    const n = this.appliedCount()
    const target = `${this.paths.db}.bak-v${n}`
    const tmp = `${target}.tmp-${process.pid}`
    // VACUUM INTO gives a consistent copy, including pages still in the WAL; the rename makes it appear atomically.
    rmSync(tmp, { force: true })
    this.kdb.raw.prepare("VACUUM INTO ?").run([tmp])
    renameSync(tmp, target)
    this.backedUp = true
  }

  async run(pluginId: string, migrations: Migration[], external: boolean): Promise<void> {
    assertPluginId(pluginId)
    const ids = new Set<string>()
    for (const m of migrations) {
      if (!m.id || ids.has(m.id)) throw new IsolationError(`plugin "${pluginId}": migration id "${m.id}" is empty or duplicated`)
      ids.add(m.id)
    }
    if (this.kdb.raw.inTransaction()) throw new Error("migrations cannot run inside a transaction")
    this.bootCount()
    const todo = this.pending(pluginId, migrations)
    if (todo.length === 0) return
    this.backupIfNeeded(pluginId, migrations)
    for (const m of todo) await this.apply(pluginId, m, external)
  }

  private appliedCount(): number {
    return Number(this.kdb.raw.prepare("SELECT count(*) AS n FROM kernel_plugin_migration").all([])[0]?.n ?? 0)
  }

  private bootCount(): number {
    this.appliedAtBoot ??= this.appliedCount()
    return this.appliedAtBoot
  }

  private appliedIds(pluginId: string): Set<string> {
    const rows = this.kdb.raw.prepare("SELECT id FROM kernel_plugin_migration WHERE plugin = ?").all([pluginId])
    return new Set(rows.map((r) => String(r.id)))
  }

  private async apply(pluginId: string, m: Migration, external: boolean): Promise<void> {
    let active = true // the db handed to `up` may outlive the migration; it loses migration mode with it
    let roots: RootOwners = new Map()
    let before = new Map<string, SchemaObject>()
    let beforeTemp = new Map<string, SchemaObject>()
    let violation: string | undefined // sticky: a plugin that catches the error still gets rolled back
    const fail = (problem: string) => new IsolationError(`migration "${m.id}" of plugin "${pluginId}" rolled back: ${problem}`)
    const access: TableAccess = {
      ownTables: () => ownTablesOf(this.kdb, pluginId, roots),
      views: () => new Map(), // published views are created after migrations
      migrating: () => active && violation === undefined,
      ownerOf: (name) => ownerOf(this.kdb, name),
      ownsPhysical: (physical) => this.ownsPhysical(pluginId, physical, roots),
      // Every schema statement is checked at once, so no intermediate state (a foreign table renamed into the
      // plugin's namespace, a trigger created and dropped again) can be used before the final diff.
      afterSchemaChange: () => {
        const problem = this.checkRoots(pluginId, roots) ?? this.check(pluginId, external, before, beforeTemp)
        if (problem) {
          violation ??= problem
          throw fail(problem)
        }
      },
    }
    try {
      await this.kdb.withWriteLock(() =>
        this.kdb.transaction(async () => {
          this.kdb.invalidateSchema() // another process may have migrated while we waited for the lock
          if (this.appliedIds(pluginId).has(m.id)) return // ...and applied this one
          roots = rootOwners(this.kdb)
          before = this.snapshot("sqlite_schema")
          beforeTemp = this.snapshot("sqlite_temp_schema")
          await m.up(this.kdb.pluginDb(pluginId, access))
          active = false
          this.kdb.invalidateSchema()
          const problem = violation ?? this.checkRoots(pluginId, roots) ?? this.check(pluginId, external, before, beforeTemp)
          if (problem) throw fail(problem)
          this.kdb.raw
            .prepare("INSERT INTO kernel_plugin_migration (plugin, id, applied_at) VALUES (?, ?, ?)")
            .run([pluginId, m.id, this.clock.now()])
        }),
      )
    } finally {
      active = false
      this.kdb.invalidateSchema()
    }
  }

  // False if `physical` is (now) the name of a b-tree that belonged to another plugin or the kernel before the migration.
  private ownsPhysical(pluginId: string, physical: string, roots: RootOwners): boolean {
    const row = this.kdb.raw.prepare("SELECT rootpage FROM sqlite_schema WHERE name = ? COLLATE NOCASE AND rootpage > 0").all([physical])[0]
    const was = row ? roots.get(Number(row.rootpage)) : undefined
    return was === undefined || isOwnName(pluginId, was)
  }

  // Every b-tree that was not the plugin's before the migration must still exist under the same table name.
  private checkRoots(pluginId: string, roots: RootOwners): string | undefined {
    const now = rootOwners(this.kdb)
    for (const [root, table] of roots) {
      if (isOwnName(pluginId, table)) continue
      const current = now.get(root)
      if (current !== table) return `table "${table}" may not be ${current === undefined ? "dropped" : `renamed to "${current}"`}`
    }
    return undefined
  }

  private snapshot(table: "sqlite_schema" | "sqlite_temp_schema"): Map<string, SchemaObject> {
    const rows = this.kdb.raw.prepare(`SELECT type, name, tbl_name, sql FROM ${table}`).all([]) as SchemaObject[]
    return new Map(rows.map((r) => [r.name.toLowerCase(), r]))
  }

  // The first violation of the schema rules, or undefined.
  private check(
    pluginId: string,
    external: boolean,
    before: Map<string, SchemaObject>,
    beforeTemp: Map<string, SchemaObject>,
  ): string | undefined {
    const prefix = `${pluginId}_`
    const own = (name: string) => name.toLowerCase().startsWith(prefix) && !isReservedName(name)
    const after = this.snapshot("sqlite_schema")
    const same = (a?: SchemaObject, b?: SchemaObject) => JSON.stringify(a) === JSON.stringify(b)

    const afterTemp = this.snapshot("sqlite_temp_schema")
    for (const name of new Set([...beforeTemp.keys(), ...afterTemp.keys()])) {
      if (!same(beforeTemp.get(name), afterTemp.get(name))) return `temporary schema objects are not allowed ("${name}")`
    }

    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const b = before.get(key)
      const a = after.get(key)
      if (same(a, b)) continue
      const obj = (a ?? b)!
      const change = !a ? "removed" : !b ? "created" : "changed"
      // Implicit indexes for UNIQUE / PRIMARY KEY constraints are named by SQLite; they belong to their table.
      const auto = obj.name.startsWith("sqlite_autoindex_") && obj.sql === null
      if (!(auto ? own(obj.tbl_name) : own(obj.name))) return `${change} ${obj.type} "${obj.name}" is not named ${prefix}*`
      if (!a) continue

      if (!own(a.tbl_name)) return `${a.type} "${a.name}" is on "${a.tbl_name}", which plugin "${pluginId}" does not own`
      if (!b && !auto && a.name.toLowerCase().startsWith(`${pluginId}__`)) return `"${a.name}" uses the kernel-reserved prefix ${pluginId}__`
      // `__` is kept for kernel names (`<id>__pub_<view>`), so no plugin object can look like one.
      if (!b && !auto && a.name.slice(prefix.length).includes("__")) return `"${a.name}": a short name may not contain __`
      if (!b && (a.type === "table" || a.type === "view") && own(a.name.slice(prefix.length))) {
        return `"${a.name}": a short name may not start with ${prefix}`
      }
      const problem =
        a.type === "trigger" ? this.checkTrigger(a, external, own, after)
        : a.type === "view" ? this.checkReads(a, `SELECT * FROM ${quote(a.name)}`, own)
        : a.type === "table" ? this.checkForeignKeys(a, own)
        : undefined
      if (problem) return problem
    }
    return undefined
  }

  private checkTrigger(t: SchemaObject, external: boolean, own: (n: string) => boolean, after: Map<string, SchemaObject>) {
    if (external) return `external plugins may not create triggers ("${t.name}")`
    const table = after.get(t.tbl_name.toLowerCase())
    if (table?.type !== "table") return `trigger "${t.name}" must be on one of the plugin's own tables, not "${t.tbl_name}"`
    // EXPLAIN includes the trigger programs, so whatever a trigger body touches shows up for the statements that fire it.
    const cols = (this.kdb.raw.prepare(`PRAGMA table_info(${quote(table.name)})`).all([]) as Array<{ name: string }>).map((c) => quote(c.name))
    const firing = [
      `INSERT INTO ${quote(table.name)} DEFAULT VALUES`,
      `UPDATE ${quote(table.name)} SET ${cols.map((c) => `${c} = ${c}`).join(", ")}`,
      `DELETE FROM ${quote(table.name)} WHERE 1`,
    ]
    for (const s of firing) {
      const problem = this.checkReads(t, s, own)
      if (problem) return problem
    }
    return undefined
  }

  // Every table the statement would open must be one of the plugin's own.
  private checkReads(obj: SchemaObject, statement: string, own: (n: string) => boolean): string | undefined {
    let touched: string[]
    try {
      touched = this.kdb.tables.tablesTouched(statement, "dml") // kernel-built statements over plugin objects
    } catch (e) {
      return `${obj.type} "${obj.name}" could not be checked: ${(e as Error).message}`
    }
    const foreign = touched.find((t) => !own(t))
    return foreign ? `${obj.type} "${obj.name}" uses "${foreign}", which is not one of the plugin's own tables` : undefined
  }

  private checkForeignKeys(table: SchemaObject, own: (n: string) => boolean): string | undefined {
    for (const fk of this.kdb.raw.prepare(`PRAGMA foreign_key_list(${quote(table.name)})`).all([])) {
      const target = String(fk.table)
      if (!own(target)) {
        return `table "${table.name}" has a foreign key to "${target}"; reference other plugins by a plain id column`
      }
    }
    return undefined
  }
}
