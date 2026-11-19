// The one-time move of the data folder from before the rename: ~/.pm becomes ~/.ttybrain, its pm.db (with
// -wal and -shm, as one set, and pm.db.bak-v<N>) becomes ttybrain.db, and two symlinks point back (~/.pm →
// ~/.ttybrain, pm.db → ttybrain.db) so an old build still opens the same file. Only for the default folder:
// nothing when TTYBRAIN_HOME or TTYBRAIN_DB is set. It renames, never copies (EXDEV is a failure like any other).
// It never lets ttybrain start on an empty database while the data sits under the old name: a failed move is
// rolled back and blocks the start, a half-done move (the folder moved, pm.db not yet renamed) is finished on
// the next run, and a ~/.pm database that was not moved blocks the start until it is moved or chosen.
import { lstatSync, readdirSync, realpathSync, renameSync, statSync, symlinkSync } from "node:fs"
import { join } from "node:path"

export type MoveResult =
  | { kind: "nothing" }
  | { kind: "moved" | "resumed" | "warn"; notice: string }
  | { kind: "blocked"; message: string; hint?: string }

type Rename = (from: string, to: string) => void

function lstat(path: string) {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

const exists = (path: string) => lstat(path) !== undefined
const isFile = (path: string) => lstat(path)?.isFile() === true
const isRealDir = (path: string) => lstat(path)?.isDirectory() === true

// A database file at `path`, following links: its real path, else undefined.
function realFile(path: string): string | undefined {
  try {
    return statSync(path).isFile() ? realpathSync(path) : undefined
  } catch {
    return undefined
  }
}

// The old and the new default folder (from HOME, as resolvePaths finds it).
export function legacyHomes(env: Record<string, string | undefined>): { from: string; to: string } {
  const base = env.HOME || env.USERPROFILE || "/"
  return { from: join(base, ".pm"), to: join(base, ".ttybrain") }
}

// Renames pm.db with its -wal and -shm to the ttybrain.db names, all or none (a failure undoes the ones done and
// throws), then the backups one by one (best-effort: they are copies), then links pm.db to ttybrain.db.
function renameDb(dir: string, rename: Rename): void {
  if (exists(join(dir, "ttybrain.db")) || !isFile(join(dir, "pm.db"))) return
  const done: Array<[string, string]> = []
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      const a = join(dir, `pm.db${suffix}`)
      if (!exists(a)) continue
      const b = join(dir, `ttybrain.db${suffix}`)
      rename(a, b)
      done.push([a, b])
    }
  } catch (e) {
    for (const [a, b] of done.reverse()) {
      try {
        rename(b, a)
      } catch {}
    }
    throw e
  }
  for (const f of readdirSync(dir).filter((f) => /^pm\.db\.bak-v\d+$/.test(f))) {
    const target = join(dir, `ttybrain${f.slice("pm".length)}`)
    try {
      if (!exists(target)) rename(join(dir, f), target)
    } catch {}
  }
  // A courtesy for old builds (and may be refused, e.g. on Windows without the privilege).
  try {
    symlinkSync("ttybrain.db", join(dir, "pm.db"))
  } catch {}
}

function linkBack(from: string): void {
  if (exists(from)) return
  try {
    symlinkSync(".ttybrain", from)
  } catch {}
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

// `rename` is a test seam (renameSync by default).
export function moveLegacyHome(env: Record<string, string | undefined>, rename: Rename = renameSync): MoveResult {
  if (env.TTYBRAIN_HOME || env.TTYBRAIN_DB) return { kind: "nothing" }
  const { from, to } = legacyHomes(env)
  const notice = `moved your data from ${from} to ${to}`
  const failed = (e: unknown): MoveResult => ({
    kind: "blocked",
    message: `could not move ${from} to ${to}: ${message(e)}`,
    hint: `move it by hand, or set TTYBRAIN_HOME=${from}`,
  })

  // A fresh move: only a real directory, and only when there is no ~/.ttybrain yet.
  if (isRealDir(from) && !exists(to)) {
    try {
      rename(from, to)
    } catch (e) {
      return failed(e)
    }
    try {
      renameDb(to, rename)
    } catch (e) {
      try {
        rename(to, from)
      } catch {} // left half-done: the next run resumes it
      return failed(e)
    }
    linkBack(from)
    return { kind: "moved", notice }
  }

  // A half-done move: the folder moved, its pm.db not yet renamed.
  if (isRealDir(to) && isFile(join(to, "pm.db")) && !exists(join(to, "ttybrain.db"))) {
    try {
      renameDb(to, rename)
    } catch (e) {
      return failed(e)
    }
    linkBack(from)
    return { kind: "resumed", notice }
  }

  // A database left in ~/.pm (not ours through the links back).
  const oldDb = realFile(join(from, "pm.db"))
  if (oldDb === undefined) return { kind: "nothing" }
  const newDb = realFile(join(to, "ttybrain.db"))
  if (newDb === undefined) return { kind: "blocked", message: `your data is still in ${from}; move it to ${to} by hand, or set TTYBRAIN_HOME=${from}` }
  if (newDb !== oldDb) return { kind: "warn", notice: `note: ${from} also holds a database; ttybrain uses ${to}` }
  return { kind: "nothing" }
}
