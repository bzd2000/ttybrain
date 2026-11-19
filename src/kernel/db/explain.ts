// Layer 2 of data isolation: ask SQLite which tables a statement would open (EXPLAIN OpenRead/OpenWrite), and
// reject virtual tables and table-valued functions (VOpen/VFilter).
// Views and indexes resolve to their underlying tables because root pages map to sqlite_schema.tbl_name.
import { IsolationError } from "../errors"
import type { RawDb } from "./sqlite"

// What a statement may be, by context. Preparing a statement can already change the connection (flag pragmas
// such as `PRAGMA query_only=1` take effect at prepare time, even under EXPLAIN), so plugin-originated SQL is
// checked against these lists BEFORE anything is prepared. Everything else (PRAGMA, ATTACH, DETACH, VACUUM,
// transaction control, REINDEX, ANALYZE, EXPLAIN, CTEs per R9) is rejected.
export type StatementContext = "view" | "dml" | "migration"
const DML_KEYWORDS = ["SELECT", "INSERT", "UPDATE", "DELETE", "REPLACE", "VALUES"]
export const ALLOWED_KEYWORDS: Record<StatementContext, ReadonlySet<string>> = {
  view: new Set(["SELECT", "VALUES"]),
  dml: new Set(DML_KEYWORDS),
  migration: new Set([...DML_KEYWORDS, "CREATE", "ALTER", "DROP"]),
}

export interface TableChecker {
  // Throws IsolationError, without preparing anything, unless `sql` is one statement allowed in `context`.
  tablesTouched(sql: string, context: StatementContext): string[]
  invalidate(): void
}

// Index past whitespace and comments starting at `i`; -1 for an unterminated block comment.
function skipTrivia(sql: string, i: number): number {
  for (;;) {
    while (i < sql.length && /\s/.test(sql[i]!)) i++
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i)
      if (end < 0) return sql.length
      i = end + 1
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2)
      if (end < 0) return -1
      i = end + 2
    } else return i
  }
}

// First keyword of the statement, past whitespace, comments and opening parentheses, upper-cased ("" if none).
export function firstKeyword(sql: string): string {
  let i = 0
  for (;;) {
    i = skipTrivia(sql, i)
    if (i < 0) return ""
    if (sql[i] !== "(") break
    i++
  }
  return (/^[A-Za-z]+/.exec(sql.slice(i))?.[0] ?? "").toUpperCase()
}

// Positions of the statement terminators (`;`) outside string literals, quoted identifiers and comments;
// undefined for an unterminated literal or comment.
function terminators(sql: string): number[] | undefined {
  const out: number[] = []
  let i = 0
  while (i < sql.length) {
    const c = sql[i]!
    if (c === ";") {
      out.push(i++)
    } else if (c === "-" || c === "/") {
      const next = skipTrivia(sql, i)
      if (next < 0) return undefined
      i = next > i ? next : i + 1
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c
      let j = i + 1
      for (;;) {
        j = sql.indexOf(close, j)
        if (j < 0) return undefined
        if (close !== "]" && sql[j + 1] === close) j += 2 // doubled quote is an escaped quote
        else break
      }
      i = j + 1
    } else i++
  }
  return out
}

// The keyword starting at `i` (after trivia), upper-cased, and the index after it.
function wordAt(sql: string, i: number): [string, number] {
  const at = skipTrivia(sql, i)
  if (at < 0) return ["", sql.length]
  const w = /^[A-Za-z]+/.exec(sql.slice(at))?.[0] ?? ""
  return [w.toUpperCase(), at + w.length]
}

// True if `sql` is exactly one statement: no terminator outside literals, quoted identifiers and comments, and
// no unterminated literal or comment. Checked by the kernel itself, so Bun and Node behave the same whatever
// their drivers do with the text after a first statement.
export function isSingleStatement(sql: string): boolean {
  return terminators(sql)?.length === 0
}

const TRIGGER_BODY = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "REPLACE", "VALUES", "WITH"])

// `CREATE [TEMP|TEMPORARY] TRIGGER ... BEGIN stmt; ... END` is one statement although its body has `;`.
// SQLite ends the trigger at the first END that follows a `;`, so every `;` must be followed by another body
// statement or by the END that closes the input; nothing can come after the trigger.
export function isSingleTrigger(sql: string): boolean {
  let [w, i] = wordAt(sql, 0)
  if (w !== "CREATE") return false
  ;[w, i] = wordAt(sql, i)
  if (w === "TEMP" || w === "TEMPORARY") [w, i] = wordAt(sql, i)
  if (w !== "TRIGGER") return false
  const ts = terminators(sql)
  if (!ts || ts.length === 0) return false
  for (const t of ts) {
    const [next, after] = wordAt(sql, t + 1)
    if (TRIGGER_BODY.has(next)) continue
    if (next === "END" && skipTrivia(sql, after) === sql.length) continue
    return false
  }
  return true
}

// The check every EXPLAIN of plugin-originated SQL goes through, before anything is prepared.
export function assertStatementAllowed(sql: string, context: StatementContext): void {
  if (!isSingleStatement(sql) && !(context === "migration" && isSingleTrigger(sql))) throw new IsolationError("only a single SQL statement is allowed")
  const keyword = firstKeyword(sql)
  if (!ALLOWED_KEYWORDS[context].has(keyword)) {
    throw new IsolationError(`${keyword || "this"} statements are not allowed here`)
  }
}

// EXPLAIN needs a value bound for every `?`; count them outside string literals and quoted identifiers.
function countPlaceholders(sql: string): number {
  return (sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]/g, "").match(/\?/g) ?? []).length
}

export function createTableChecker(raw: RawDb): TableChecker {
  let pages: Map<number, string> | undefined
  const cache = new Map<string, string[]>()

  function rootPages(): Map<number, string> {
    if (!pages) {
      pages = new Map()
      const rows = raw.prepare("SELECT rootpage, tbl_name FROM sqlite_schema WHERE rootpage > 0").all([])
      for (const r of rows) pages.set(Number(r.rootpage), String(r.tbl_name))
      pages.set(1, "sqlite_schema")
    }
    return pages
  }

  return {
    tablesTouched(sql, context) {
      assertStatementAllowed(sql, context)
      // A view body is explained as a sub-query, so only a query can even parse.
      const explained = context === "view" ? `SELECT * FROM (${sql})` : sql
      const hit = cache.get(explained)
      if (hit) return hit
      const ops = raw.prepare(`EXPLAIN ${explained}`).all(new Array(countPlaceholders(sql)).fill(null))
      const map = rootPages()
      const out = new Set<string>()
      for (const op of ops) {
        // A table-valued function (pragma_table_info, pragma_table_list, json_each …) or a virtual table (dbstat)
        // opens no b-tree by root page, so it would read the schema metadata of other plugins unseen: reject it.
        if (op.opcode === "VOpen" || op.opcode === "VFilter") {
          throw new IsolationError(`table-valued functions and virtual tables are not allowed: ${sql}`)
        }
        // Opcodes that address an existing b-tree by root page: [root page, database index].
        // Clear is what `DELETE FROM t` (no WHERE) compiles to, with no OpenWrite at all; Destroy is DROP.
        let root: number, db: number
        if (op.opcode === "OpenRead" || op.opcode === "OpenWrite") [root, db] = [Number(op.p2), Number(op.p3)]
        else if (op.opcode === "Clear") [root, db] = [Number(op.p1), Number(op.p2)]
        else if (op.opcode === "Destroy") [root, db] = [Number(op.p1), Number(op.p3)]
        else if (op.opcode === "Vacuum") [root, db] = [1, 0] // rewrites the whole file: report as the schema table
        else continue
        // db 0 = main. Anything else (temp/attached) is reported unmapped, never guessed (fail closed).
        out.add(db === 0 ? (map.get(root) ?? `page${root}`) : `db${db}:page${root}`)
      }
      const result = [...out]
      cache.set(explained, result)
      return result
    },
    invalidate() {
      pages = undefined
      cache.clear()
    },
  }
}
