// Published views: the only way a plugin reads another plugin's data. A view is declared in code with
// `ctx.publish`, built with the owner's scoped db (so it reads only the owner's tables), and recreated by
// the kernel at every startup, after migrations, as the SQLite view `<pluginId>__pub_<name>`.
import type { CompiledQuery, Kysely } from "kysely"
import { firstKeyword, isSingleStatement } from "./db/explain"
import type { KernelDb } from "./db/kernel-db"
import type { PublishedView, TableAccess } from "./db/scope"
import { IsolationError, PmError, ValidationError } from "./errors"
import { ownerOf, ownTablesOf } from "./migrations"
import { assertPluginId } from "./plugin-id"

export type ColumnType = "integer" | "text" | "real" | "boolean" | "date"

export type ViewDef = {
  version: number
  columns: Record<string, ColumnType>
  query: (db: Kysely<any>) => { compile(): CompiledQuery }
  assistant?: boolean
}

const VIEW_NAME = /^[a-z][a-z0-9_]*$/
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

type Entry = { pluginId: string; name: string; def: ViewDef }

export class ViewRegistry {
  private readonly defs = new Map<string, Entry>() // keyed "<plugin>.<view>"
  private readonly reads = new Map<string, Set<string>>()
  private created = new Map<string, PublishedView>() // replaced, never mutated: readers may hold it

  publish(pluginId: string, name: string, def: ViewDef): void {
    assertPluginId(pluginId)
    const key = `${pluginId}.${name}`
    if (!VIEW_NAME.test(name)) throw new ValidationError(`view name "${name}" must match [a-z][a-z0-9_]*`)
    if (this.defs.has(key)) throw new ValidationError(`view "${key}" is already published`)
    if (Object.keys(def.columns).length === 0) throw new ValidationError(`view "${key}" declares no columns`)
    this.defs.set(key, { pluginId, name, def })
  }

  // The plugins whose views `pluginId` reads (its `reads`): a missing view of theirs is ViewUnavailableError.
  declareReads(pluginId: string, pluginIds: string[]): void {
    this.reads.set(pluginId, new Set(pluginIds))
  }

  readsOf(pluginId: string): Set<string> {
    return this.reads.get(pluginId) ?? new Set()
  }

  // Drops and recreates every published view in one transaction: all of them, or none on any error.
  async createAll(kdb: KernelDb): Promise<void> {
    const built = new Map<string, PublishedView>()
    try {
      await kdb.withWriteLock(() =>
        kdb.transaction(async () => {
          for (const [key, entry] of this.defs) {
            try {
              built.set(key, this.create(kdb, key, entry))
            } catch (e) {
              throw failure(e, key, entry)
            }
          }
        }),
      )
    } finally {
      kdb.invalidateSchema()
    }
    this.created = built
  }

  // The `views()` of a plugin's TableAccess. Every created view is readable; `reads` only changes the error.
  forReader(_pluginId: string): Map<string, PublishedView> {
    return this.created
  }

  remove(pluginId: string): void {
    for (const [key, e] of this.defs) if (e.pluginId === pluginId) this.defs.delete(key)
    this.created = new Map([...this.created].filter(([key]) => !key.startsWith(`${pluginId}.`)))
    this.reads.delete(pluginId)
  }

  private create(kdb: KernelDb, key: string, { pluginId, name, def }: Entry): PublishedView {
    const own = ownTablesOf(kdb, pluginId)
    const access: TableAccess = {
      ownTables: () => own,
      views: () => new Map(), // a view reads its owner's own tables only
      migrating: () => false,
      ownerOf: (t) => ownerOf(kdb, t),
    }
    const compiled = def.query(kdb.pluginDb(pluginId, access)).compile() // layer 1 runs here
    if (compiled.parameters.length > 0) {
      throw new ValidationError("view query may not use parameters", { hint: `view "${key}": use eb.lit(...) or sql.lit(...) for constants` })
    }
    // Raw fragments and hand-made compile() results bypass layer 1, and this SQL runs on the kernel's connection:
    // it must be exactly one SELECT, and reads only the owner's tables (EXPLAIN executes nothing).
    // The node kind is self-reported by compile(), so the text itself is checked too.
    const keyword = firstKeyword(compiled.sql)
    if (compiled.query?.kind !== "SelectQueryNode" || !isSingleStatement(compiled.sql) || (keyword !== "SELECT" && keyword !== "VALUES")) {
      throw new ValidationError(`view "${key}": the query must be a single SELECT statement`)
    }
    const notOwn = (t: string) => !(t.startsWith(`${pluginId}_`) && own.has(t.slice(pluginId.length + 1)))
    const foreign = (t: string) => new IsolationError(`view "${key}" reads table "${t}", which plugin "${pluginId}" does not own`)
    for (const t of kdb.tables.tablesTouched(compiled.sql, "view")) if (notOwn(t)) throw foreign(t)

    const physical = `${pluginId}__pub_${name}`
    kdb.raw.prepare(`DROP VIEW IF EXISTS ${quote(physical)}`).run([])
    kdb.raw.prepare(`CREATE VIEW ${quote(physical)} AS ${compiled.sql}`).run([])
    kdb.invalidateSchema()

    const declared = Object.keys(def.columns)
    const actual = kdb.raw.prepare(`PRAGMA table_info(${quote(physical)})`).all([]).map((r) => String(r.name))
    if (declared.length !== actual.length || !declared.every((c) => actual.includes(c))) {
      throw new ValidationError(`view "${key}" declares columns [${declared.join(", ")}] but its query returns [${actual.join(", ")}]`)
    }

    // Raw `sql` fragments are invisible to layer 1, so the tables SQLite actually reads are checked too.
    const baseTables = kdb.tables.tablesTouched(`SELECT * FROM ${quote(physical)}`, "view").sort()
    for (const t of baseTables) if (notOwn(t)) throw foreign(t)
    return { physical, columns: declared, baseTables }
  }
}

// Every createAll error names the failing view in `details`, so the host can isolate its plugin (R13).
function failure(e: unknown, key: string, { pluginId, name }: Entry): PmError {
  const err = e instanceof PmError ? e : new ValidationError(`view "${key}": ${e instanceof Error ? e.message : String(e)}`)
  const prior = err.details && typeof err.details === "object" ? err.details : {}
  err.details = { ...prior, plugin: pluginId, view: name }
  return err
}
