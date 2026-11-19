// The one-time move of the data folder from before the rename: ~/.pm becomes ~/.ttybrain, its pm.db (with
// -wal, -shm and pm.db.bak-v<N>) becomes ttybrain.db, and two symlinks point back (~/.pm → ~/.ttybrain,
// pm.db → ttybrain.db) so an old build still opens the same file. Only for the default folder: nothing when
// TTYBRAIN_HOME or TTYBRAIN_DB is set, when ~/.ttybrain exists or when there is no ~/.pm. It renames, never
// copies: across filesystems (EXDEV) it leaves everything as it is. Other failures throw (the entry point
// reports them and starts anyway).
import { lstatSync, readdirSync, renameSync, symlinkSync } from "node:fs"
import { join } from "node:path"

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

// The old and the new default folder (from HOME, as resolvePaths finds it).
export function legacyHomes(env: Record<string, string | undefined>): { from: string; to: string } {
  const base = env.HOME || env.USERPROFILE || "/"
  return { from: join(base, ".pm"), to: join(base, ".ttybrain") }
}

// Returns the notice line when it moved something, else undefined.
export function moveLegacyHome(env: Record<string, string | undefined>): string | undefined {
  if (env.TTYBRAIN_HOME || env.TTYBRAIN_DB) return undefined
  const { from, to } = legacyHomes(env)
  if (!exists(from) || exists(to)) return undefined
  try {
    renameSync(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EXDEV") return undefined
    throw e
  }
  const files = readdirSync(to).filter((f) => f === "pm.db" || f === "pm.db-wal" || f === "pm.db-shm" || /^pm\.db\.bak-v\d+$/.test(f))
  for (const f of files) {
    const target = join(to, `ttybrain${f.slice("pm".length)}`)
    if (!exists(target)) renameSync(join(to, f), target)
  }
  // The links are a courtesy for old builds (and may be refused, e.g. on Windows without the privilege).
  try {
    symlinkSync(".ttybrain", from)
  } catch {}
  if (exists(join(to, "ttybrain.db")) && !exists(join(to, "pm.db"))) {
    try {
      symlinkSync("ttybrain.db", join(to, "pm.db"))
    } catch {}
  }
  return `moved your data from ${from} to ${to}`
}
