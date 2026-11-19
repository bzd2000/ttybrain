import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
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

// Keys that would reach an object's prototype; JSON can spell them, the config never needs them.
const UNSAFE = new Set(["__proto__", "constructor", "prototype"])

// `over` on top of `base`; objects merge key by key (a fresh copy, unsafe keys dropped), anything else replaces.
function merge(base: Obj, over: Obj): Obj {
  const out: Obj = {}
  for (const [k, v] of [...Object.entries(base), ...Object.entries(over)]) {
    if (UNSAFE.has(k)) continue
    out[k] = isObj(v) ? merge(isObj(out[k]) ? (out[k] as Obj) : {}, v) : v
  }
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
  if (env.TTYBRAIN_CONFIG_JSON) cfg = merge(cfg, parse(env.TTYBRAIN_CONFIG_JSON, "TTYBRAIN_CONFIG_JSON"))
  return cfg as Config
}

// Edits the config file in place: reads it (missing: `{}`; invalid: the same ValidationError as loadConfig),
// lets `change` mutate the object, and writes it back (atomically) as 2-space JSON with a trailing newline.
// Keys `change` leaves alone keep their order and values; defaults and TTYBRAIN_CONFIG_JSON are not written.
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
  // truncated config (which would break every boot). A symlinked config is written through: the temp file goes
  // next to the real file and replaces it, so the link stays; the file keeps its mode.
  const target = text === undefined ? paths.config : realpathSync(paths.config)
  const mode = text === undefined ? undefined : statSync(target).mode & 0o7777
  const temp = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(cfg, null, 2) + "\n", mode === undefined ? {} : { mode })
    if (mode !== undefined) chmodSync(temp, mode) // the umask applies to writeFileSync's mode
    renameSync(temp, target)
  } catch (e) {
    try {
      unlinkSync(temp)
    } catch {}
    throw e
  }
}
