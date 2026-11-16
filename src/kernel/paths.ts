import { join, resolve } from "node:path"

export type Paths = { home: string; db: string; config: string; plugins: string; exports: string }

export function resolvePaths(env: Record<string, string | undefined>, flags: { db?: string } = {}): Paths {
  const home = resolve(env.PM_HOME || join(env.HOME || env.USERPROFILE || "/", ".pm"))
  return {
    home,
    db: resolve(flags.db || env.PM_DB || join(home, "pm.db")),
    config: resolve(env.PM_CONFIG || join(home, "config.json")),
    plugins: resolve(env.PM_PLUGINS || join(home, "plugins")),
    exports: resolve(env.PM_EXPORTS || join(home, "exports")),
  }
}
