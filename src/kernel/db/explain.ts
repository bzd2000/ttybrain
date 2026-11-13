// Layer 2 of data isolation: ask SQLite which tables a statement would open (EXPLAIN OpenRead/OpenWrite).
// Views and indexes resolve to their underlying tables because root pages map to sqlite_schema.tbl_name.
import type { RawDb } from "./sqlite"

export interface TableChecker {
  tablesTouched(sql: string): string[]
  invalidate(): void
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
    tablesTouched(sql) {
      const hit = cache.get(sql)
      if (hit) return hit
      const ops = raw.prepare(`EXPLAIN ${sql}`).all(new Array(countPlaceholders(sql)).fill(null))
      const map = rootPages()
      const out = new Set<string>()
      for (const op of ops) {
        if (op.opcode !== "OpenRead" && op.opcode !== "OpenWrite") continue
        // p3 is the database index (0 = main). Anything else (temp/attached) is reported unmapped, never guessed.
        out.add(Number(op.p3) === 0 ? (map.get(Number(op.p2)) ?? `page${op.p2}`) : `db${op.p3}:page${op.p2}`)
      }
      const result = [...out]
      cache.set(sql, result)
      return result
    },
    invalidate() {
      pages = undefined
      cache.clear()
    },
  }
}
