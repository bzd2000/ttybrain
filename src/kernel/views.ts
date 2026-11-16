// Published views: the only way a plugin reads another plugin's data. A view is declared in code with
// `ctx.publish`, built with the owner's scoped db (so it reads only the owner's tables), and checked by the
// kernel at every startup, after migrations, as the SQLite view `<pluginId>__pub_<name>`; recreated only if it changed.
import type { CompiledQuery, Kysely } from "kysely"
import { firstKeyword, isSingleStatement } from "./db/explain"
import type { KernelDb } from "./db/kernel-db"
import type { PublishedView, TableAccess } from "./db/scope"
import { IsolationError, PmError, ValidationError } from "./errors"
import { ownerOf, ownTablesOf } from "./migrations"
import { assertPluginId, PLUGIN_ID } from "./plugin-id"

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
  private readonly hidden = new Map<string, Set<string>>() // reader → publishers whose version it does not accept
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
  // `unavailable` are those among them loaded at a version outside the reader's range: their views are hidden
  // from this reader, so it gets ViewUnavailableError as if they were not loaded.
  declareReads(pluginId: string, pluginIds: string[], unavailable: string[] = []): void {
    this.reads.set(pluginId, new Set(pluginIds))
    if (unavailable.length > 0) this.hidden.set(pluginId, new Set(unavailable))
    else this.hidden.delete(pluginId)
  }

  readsOf(pluginId: string): Set<string> {
    return this.reads.get(pluginId) ?? new Set()
  }

  // Brings the database's published views in line with the definitions, all of them or none on any error.
  // Every view is compiled and checked first, read-only. The write transaction is opened only if a view's stored
  // SQL differs from its compiled SQL, or a view is left by a plugin not published now (disabled, failed,
  // uninstalled): then only those are dropped and (re)created. So an unchanged boot never takes the write lock.
  async createAll(kdb: KernelDb): Promise<void> {
    const plans: Plan[] = []
    for (const [key, entry] of this.defs) {
      try {
        plans.push(this.compile(kdb, key, entry))
      } catch (e) {
        throw failure(e, key, entry)
      }
    }
    let built: Map<string, PublishedView>
    try {
      if (this.stale(kdb).length === 0 && plans.every((p) => storedSql(kdb, p.physical) === p.ddl)) {
        built = this.verifyAll(kdb, plans)
      } else {
        built = await kdb.withWriteLock(() =>
          kdb.transaction(async () => {
            // Compared again under the lock: another process may have updated the views meanwhile.
            for (const name of this.stale(kdb)) kdb.raw.prepare(`DROP VIEW ${quote(name)}`).run([])
            for (const p of plans) {
              if (storedSql(kdb, p.physical) === p.ddl) continue
              try {
                kdb.raw.prepare(`DROP VIEW IF EXISTS ${quote(p.physical)}`).run([])
                kdb.raw.prepare(p.ddl).run([])
              } catch (e) {
                throw failure(e, p.key, p.entry)
              }
            }
            kdb.invalidateSchema()
            return this.verifyAll(kdb, plans)
          }),
        )
      }
    } finally {
      kdb.invalidateSchema()
    }
    this.created = built
  }

  // The `views()` of a plugin's TableAccess: every created view, minus those of publishers whose version is
  // outside the reader's `reads` range. Otherwise `reads` only changes the error.
  forReader(pluginId: string): Map<string, PublishedView> {
    const hidden = this.hidden.get(pluginId)
    if (!hidden) return this.created
    return new Map([...this.created].filter(([key]) => !hidden.has(key.slice(0, key.indexOf(".")))))
  }

  remove(pluginId: string): void {
    for (const [key, e] of this.defs) if (e.pluginId === pluginId) this.defs.delete(key)
    this.created = new Map([...this.created].filter(([key]) => !key.startsWith(`${pluginId}.`)))
    this.reads.delete(pluginId)
    this.hidden.delete(pluginId)
  }

  // `<id>__pub_<view>` names are the kernel's (migrations reject `__` in plugin short names), so a view named so
  // that is not a current definition's is a leftover. Only that exact shape is stale: `<id>` is a valid plugin
  // id (no `_`) directly followed by `__pub_`.
  private stale(kdb: KernelDb): string[] {
    const current = new Set([...this.defs.values()].map((e) => `${e.pluginId}__pub_${e.name}`))
    const out: string[] = []
    for (const r of kdb.raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'view'").all([])) {
      const name = String(r.name)
      const at = name.indexOf("__pub_")
      if (at <= 0 || name.indexOf("_") !== at || !PLUGIN_ID.test(name.slice(0, at)) || current.has(name)) continue
      out.push(name)
    }
    return out
  }

  // Layer 1, the single-SELECT check and the tables the compiled SQL touches. Read-only: nothing is created.
  private compile(kdb: KernelDb, key: string, entry: Entry): Plan {
    const { pluginId, name, def } = entry
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
    const plan: Plan = { key, entry, own, physical: `${pluginId}__pub_${name}`, ddl: "" }
    for (const t of kdb.tables.tablesTouched(compiled.sql, "view")) if (notOwn(plan, t)) throw foreign(plan, t)
    plan.ddl = `CREATE VIEW ${quote(plan.physical)} AS ${compiled.sql}`
    return plan
  }

  private verifyAll(kdb: KernelDb, plans: Plan[]): Map<string, PublishedView> {
    const built = new Map<string, PublishedView>()
    for (const p of plans) {
      try {
        built.set(p.key, verify(kdb, p))
      } catch (e) {
        throw failure(e, p.key, p.entry)
      }
    }
    return built
  }
}

// A compiled, checked view definition and the statement that creates it.
type Plan = { key: string; entry: Entry; own: Set<string>; physical: string; ddl: string }

const notOwn = ({ entry, own }: Plan, t: string) => !(t.startsWith(`${entry.pluginId}_`) && own.has(t.slice(entry.pluginId.length + 1)))
const foreign = ({ key, entry }: Plan, t: string) => new IsolationError(`view "${key}" reads table "${t}", which plugin "${entry.pluginId}" does not own`)

function storedSql(kdb: KernelDb, physical: string): string | undefined {
  const row = kdb.raw.prepare("SELECT sql FROM sqlite_schema WHERE type = 'view' AND name = ?").all([physical])[0]
  return row ? String(row.sql) : undefined
}

// The declared-columns and base-table checks on the view as it exists. Both read-only.
function verify(kdb: KernelDb, p: Plan): PublishedView {
  const declared = Object.keys(p.entry.def.columns)
  const actual = kdb.raw.prepare(`PRAGMA table_info(${quote(p.physical)})`).all([]).map((r) => String(r.name))
  if (declared.length !== actual.length || !declared.every((c) => actual.includes(c))) {
    throw new ValidationError(`view "${p.key}" declares columns [${declared.join(", ")}] but its query returns [${actual.join(", ")}]`)
  }
  // Raw `sql` fragments are invisible to layer 1, so the tables SQLite actually reads are checked too.
  const baseTables = kdb.tables.tablesTouched(`SELECT * FROM ${quote(p.physical)}`, "view").sort()
  for (const t of baseTables) if (notOwn(p, t)) throw foreign(p, t)
  return { physical: p.physical, columns: declared, baseTables }
}

// Every createAll error names the failing view in `details`, so the host can isolate its plugin (R13).
function failure(e: unknown, key: string, { pluginId, name }: Entry): PmError {
  const err = e instanceof PmError ? e : new ValidationError(`view "${key}": ${e instanceof Error ? e.message : String(e)}`)
  const prior = err.details && typeof err.details === "object" ? err.details : {}
  err.details = { ...prior, plugin: pluginId, view: name }
  return err
}
