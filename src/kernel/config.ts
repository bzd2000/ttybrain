import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { ValidationError } from "./errors"
import type { Paths } from "./paths"

export type Config = {
  exportDir: string
  staleContactDays: number
  assistant: { provider: string }
  plugins: { disabled: string[]; allow: string[] }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

function merge(base: Obj, over: Obj): Obj {
  const out: Obj = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k] as Obj, v) : v
  return out
}

function parse(text: string, source: string): Obj {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch (e) {
    throw new ValidationError(`invalid JSON in ${source}: ${(e as Error).message}`, { hint: `fix or remove ${source}` })
  }
  if (!isObj(v)) throw new ValidationError(`${source} must contain a JSON object`)
  return v
}

export function loadConfig(paths: Paths, env: Record<string, string | undefined>): Config {
  let cfg: Obj = {
    exportDir: paths.exports,
    staleContactDays: 30,
    assistant: { provider: "copilot" },
    plugins: { disabled: [], allow: [] },
  }
  let text: string | undefined
  try {
    text = readFileSync(paths.config, "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
  }
  if (text !== undefined) cfg = merge(cfg, parse(text, paths.config))
  if (env.PM_CONFIG_JSON) cfg = merge(cfg, parse(env.PM_CONFIG_JSON, "PM_CONFIG_JSON"))
  return cfg as Config
}

// Edits the config file in place: reads it (missing: `{}`; invalid: the same ValidationError as loadConfig),
// lets `change` mutate the object, and writes it back (atomically) as 2-space JSON with a trailing newline.
// Keys `change` leaves alone keep their order and values; defaults and PM_CONFIG_JSON are not written.
export function updateConfigFile(paths: Paths, change: (cfg: Record<string, unknown>) => void): void {
  let cfg: Obj = {}
  let text: string | undefined
  try {
    text = readFileSync(paths.config, "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
  }
  if (text !== undefined) cfg = parse(text, paths.config)
  change(cfg)
  mkdirSync(dirname(paths.config), { recursive: true })
  // Atomically: a temp file in the same directory, renamed over the config, so a kill mid-write never leaves a
  // truncated config (which would break every boot).
  const temp = `${paths.config}.${process.pid}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(cfg, null, 2) + "\n")
    renameSync(temp, paths.config)
  } catch (e) {
    try {
      unlinkSync(temp)
    } catch {}
    throw e
  }
}
