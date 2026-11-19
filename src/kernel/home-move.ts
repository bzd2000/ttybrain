// The one-time move of the data folder from before the rename: ~/.pm becomes ~/.ttybrain, its pm.db (with
// -wal and -shm, as one set, and pm.db.bak-v<N>) becomes ttybrain.db, and two symlinks point back (~/.pm →
// ~/.ttybrain, pm.db → ttybrain.db) so an old build still opens the same file. It renames, never copies (EXDEV is a
// failure like any other) and never overwrites. It never lets ttybrain start on an empty database while the data
// sits under the old name: a failed move is rolled back and blocks the start, a half-done move (the folder moved,
// pm.db not yet renamed) is finished on the next run, and a ~/.pm database that was not moved blocks the start until
// it is moved or chosen. A folder chosen with TTYBRAIN_HOME (or a ~/.ttybrain the user moved there by hand) whose
// pm.db has no ttybrain.db beside it gets the same rename. Nothing at all when TTYBRAIN_DB or --db names the file.
import { lstatSync, readdirSync, realpathSync, renameSync, statSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { resolvePaths } from "./paths"

export type MoveResult =
  | { kind: "nothing" }
  | { kind: "moved" | "resumed" | "renamed" | "warn"; notice: string }
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
const isRealDir = (path: string) => lstat(path)?.isDirectory() === true
// A folder, following links (a ~/.ttybrain that links to a synced folder is one).
const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

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

const SIDE = ["-wal", "-shm"] as const

// A failure that blocks the start, with what to tell the user.
class Blocked extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message)
  }
}

// What the user can do when `dir`'s pm.db set could not be renamed: use pm.db as it is while none of it was renamed,
// else finish by hand (pm.db alone would open without its WAL).
function hintFor(dir: string, start: string): string {
  const untouched = realFile(join(dir, "pm.db")) !== undefined && !["", ...SIDE].some((s) => exists(join(dir, `ttybrain.db${s}`)))
  if (!untouched) return `finish renaming the pm.db files in ${dir} to ttybrain.db by hand`
  return `${start}, or set TTYBRAIN_DB=${join(dir, "pm.db")}`
}

// Brings `dir`'s pm.db set under the ttybrain.db names. When there is no ttybrain.db and pm.db is a database (a file,
// or a link to one: the link itself is renamed, in the same folder, so a relative target stays valid), it renames
// -wal and -shm first, then pm.db, all or none (a failure undoes the ones done and throws), then the backups one by
// one (best-effort: they are copies), then links pm.db to ttybrain.db. When ttybrain.db is there but a rename left its
// -wal or -shm under the pm.db name (pm.db itself gone or a link to it), it finishes those. Never overwrites.
function settle(dir: string, rename: Rename): "none" | "renamed" | "finished" {
  const db = join(dir, "ttybrain.db")
  const old = join(dir, "pm.db")
  if (exists(db)) {
    const oldReal = realFile(old)
    if (oldReal !== undefined && oldReal !== realFile(db)) return "none" // a separate database: its -wal is its own
    const left = SIDE.filter((s) => exists(old + s))
    if (left.length === 0) return "none"
    for (const s of left) {
      if (exists(db + s)) {
        throw new Blocked(
          `both ${old}${s} and ${db}${s} exist beside ${db}`,
          `a rename was left half-done; keep the one with your latest changes as ${db}${s} and remove the other`,
        )
      }
    }
    for (const s of left) rename(old + s, db + s)
    return "finished"
  }
  if (realFile(old) === undefined) return "none"
  for (const s of SIDE) {
    if (exists(old + s) && exists(db + s)) throw new Error(`${db}${s} already exists`)
  }
  const done: Array<[string, string]> = []
  try {
    for (const s of [...SIDE, ""]) {
      const a = old + s
      if (!exists(a)) continue
      rename(a, db + s)
      done.push([a, db + s])
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
    symlinkSync("ttybrain.db", old)
  } catch {}
  return "renamed"
}

function linkBack(from: string): void {
  if (exists(from)) return
  try {
    symlinkSync(".ttybrain", from)
  } catch {}
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

// `db` is the --db flag; `rename` is a test seam (renameSync by default).
export function moveLegacyHome(env: Record<string, string | undefined>, opts: { db?: string; rename?: Rename } = {}): MoveResult {
  if (opts.db || env.TTYBRAIN_DB) return { kind: "nothing" }
  const rename = opts.rename ?? renameSync
  if (env.TTYBRAIN_HOME) return settleChosen(resolvePaths(env).home, rename)

  const { from, to } = legacyHomes(env)
  const notice = `moved your data from ${from} to ${to}`
  // `where`: the folder that holds the data after the failure.
  const failed = (e: unknown, where: string): MoveResult => ({
    kind: "blocked",
    message: e instanceof Blocked ? e.message : `could not move ${from} to ${to}: ${message(e)}`,
    hint: e instanceof Blocked ? e.hint : where === from ? hintFor(from, "move it by hand") : hintFor(where, `rename ${where}/pm.db to ${where}/ttybrain.db by hand`),
  })

  // A fresh move: only a real directory, and only when there is no ~/.ttybrain yet.
  if (isRealDir(from) && !exists(to)) {
    try {
      rename(from, to)
    } catch (e) {
      return failed(e, from)
    }
    try {
      settle(to, rename)
    } catch (e) {
      try {
        rename(to, from)
      } catch {
        return failed(e, to) // left half-done: the next run resumes it
      }
      return failed(e, from)
    }
    linkBack(from)
    return { kind: "moved", notice }
  }

  // A half-done move (the folder moved, its pm.db not yet renamed, or a rename left half-done), or a folder the user
  // moved to ~/.ttybrain by hand (a link to it counts).
  if (isDir(to)) {
    let done: ReturnType<typeof settle>
    try {
      done = settle(to, rename)
    } catch (e) {
      return failed(e, to)
    }
    if (done === "finished") return { kind: "resumed", notice: `finished renaming ${to}/pm.db to ${to}/ttybrain.db` }
    if (done === "renamed") {
      linkBack(from)
      return { kind: "resumed", notice }
    }
  }

  // A database left in ~/.pm (not ours through the links back).
  const oldDb = realFile(join(from, "pm.db"))
  if (oldDb === undefined) return { kind: "nothing" }
  const newDb = realFile(join(to, "ttybrain.db"))
  if (newDb === undefined) {
    return { kind: "blocked", message: `your data is still in ${from}; move its files into ${to} by hand, or set TTYBRAIN_DB=${join(from, "pm.db")}` }
  }
  if (newDb !== oldDb) return { kind: "warn", notice: `note: ${from} also holds a database; ttybrain uses ${to}` }
  return { kind: "nothing" }
}

// A folder chosen with TTYBRAIN_HOME: its pm.db becomes ttybrain.db, as in the move.
function settleChosen(home: string, rename: Rename): MoveResult {
  let done: ReturnType<typeof settle>
  try {
    done = settle(home, rename)
  } catch (e) {
    if (e instanceof Blocked) return { kind: "blocked", message: e.message, hint: e.hint }
    return {
      kind: "blocked",
      message: `could not rename ${home}/pm.db to ${home}/ttybrain.db: ${message(e)}`,
      hint: hintFor(home, `rename ${home}/pm.db to ${home}/ttybrain.db by hand`),
    }
  }
  if (done === "renamed") return { kind: "renamed", notice: `renamed ${home}/pm.db to ${home}/ttybrain.db` }
  if (done === "finished") return { kind: "renamed", notice: `finished renaming ${home}/pm.db to ${home}/ttybrain.db` }
  return { kind: "nothing" }
}
