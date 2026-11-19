import { join, resolve } from "node:path"

export type Paths = { home: string; db: string; config: string; plugins: string; exports: string }

export function resolvePaths(env: Record<string, string | undefined>, flags: { db?: string } = {}): Paths {
  const home = resolve(env.TTYBRAIN_HOME || join(env.HOME || env.USERPROFILE || "/", ".ttybrain"))
  return {
    home,
    db: resolve(flags.db || env.TTYBRAIN_DB || join(home, "ttybrain.db")),
    config: resolve(env.TTYBRAIN_CONFIG || join(home, "config.json")),
    plugins: resolve(env.TTYBRAIN_PLUGINS || join(home, "plugins")),
    exports: resolve(env.TTYBRAIN_EXPORTS || join(home, "exports")),
  }
}
