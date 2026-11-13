// Argument parsing for `pm <thing> <verb> [args] [--flags]`, on `node:util` parseArgs (both runtimes).
// Two passes: `leading` finds the command words knowing only the global flags; `parseCommand` then parses the
// rest against that command's own args and flags, strictly (an unknown flag is a ValidationError).
import { parseArgs } from "node:util"
import { parseDate } from "../dates"
import { PmError, ValidationError } from "../errors"
import type { CommandDef, FlagDef } from "./commands"

export const GLOBAL_FLAGS: Record<string, FlagDef> = {
  json: { type: "boolean", description: "print machine-readable JSON (errors too, on stdout)" },
  db: { type: "string", placeholder: "path", description: "use this database file instead of $PM_HOME/pm.db" },
  "from-inbox": { type: "string", placeholder: "I-n", description: "record that this change comes from inbox item I-n" },
  yes: { type: "boolean", description: "confirm a destructive command" },
  help: { type: "boolean", short: "h", description: "show help for this command" },
}

export type GlobalFlags = { json: boolean; db?: string; fromInbox?: string; yes: boolean; help: boolean }

type Options = NonNullable<Parameters<typeof parseArgs>[0]>["options"]

function optionsOf(flags: Record<string, FlagDef>): Options {
  const out: NonNullable<Options> = {}
  for (const [name, f] of Object.entries(flags)) out[name] = { type: f.type === "boolean" ? "boolean" : "string", ...(f.short ? { short: f.short } : {}) }
  return out
}

function tokens(argv: string[], flags: Record<string, FlagDef>) {
  return parseArgs({ args: argv, options: optionsOf(flags), strict: false, allowPositionals: true, tokens: true }).tokens
}

// `--json` anywhere before `--`: decides how a failure is printed, even one in parsing itself.
export function wantsJson(argv: string[]): boolean {
  const end = argv.indexOf("--")
  return (end < 0 ? argv : argv.slice(0, end)).includes("--json")
}

// The first two positional words (the command words, before any args) and the global flags, parsed leniently.
export function leading(argv: string[]): { words: Array<{ value: string; index: number }>; global: GlobalFlags } {
  const words: Array<{ value: string; index: number }> = []
  const values: Record<string, string | boolean | undefined> = {}
  let ended = false
  for (const t of tokens(argv, GLOBAL_FLAGS)) {
    if (t.kind === "option-terminator") ended = true
    else if (t.kind === "positional" && !ended && words.length < 2) words.push({ value: t.value, index: t.index })
    else if (t.kind === "option" && Object.hasOwn(GLOBAL_FLAGS, t.name)) values[t.name] = t.value ?? true
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined)
  return {
    words,
    global: { json: values.json === true, db: str(values.db), fromInbox: str(values["from-inbox"]), yes: values.yes === true, help: values.help === true },
  }
}

export function without(argv: string[], indices: number[]): string[] {
  return argv.filter((_, i) => !indices.includes(i))
}

const placeholder = (f: FlagDef) =>
  f.placeholder !== undefined
    ? `<${f.placeholder}>`
    : f.values ? `<${f.values.join("|")}>` : f.type === "date" ? "<date>" : f.type === "number" ? "<number>" : f.type === "list" ? "<a,b>" : "<value>"

export function flagSignature(name: string, f: FlagDef): string {
  const long = f.type === "boolean" ? `--${name}` : `--${name} ${placeholder(f)}`
  return f.short ? `-${f.short}, ${long}` : long
}

export function commandName(def: CommandDef): string {
  return def.verb ? `${def.thing} ${def.verb}` : def.thing
}

// `widget add <title>`: the command words plus its positional arguments.
export function signature(def: CommandDef): string {
  const args = (def.args ?? []).map((a) => {
    const n = a.rest ? `${a.name}...` : a.name
    return a.required ? `<${n}>` : `[${n}]`
  })
  return [commandName(def), ...args].join(" ")
}

// `pm widget add <title> [--due <date>]`
export function usage(def: CommandDef): string {
  const flags = Object.entries(def.flags ?? {}).map(([name, f]) => {
    const s = f.type === "boolean" ? `--${name}` : `--${name} ${placeholder(f)}`
    return f.required ? s : `[${s}]`
  })
  return ["pm", signature(def), ...flags].join(" ")
}

export const joinOr = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`)

function convert(name: string, f: FlagDef, raw: string, today: string): unknown {
  if (f.values && !f.values.includes(raw)) throw new ValidationError(`invalid --${name} "${raw}"`, { field: name, hint: `use ${joinOr(f.values)}` })
  switch (f.type) {
    case "number": {
      const n = Number(raw)
      if (raw.trim() === "" || !Number.isFinite(n)) throw new ValidationError(`--${name} must be a number, not "${raw}"`, { field: name })
      return n
    }
    case "list":
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
    case "date":
      try {
        return parseDate(raw, today)
      } catch (e) {
        if (e instanceof PmError) throw new ValidationError(e.message, { field: name, hint: e.hint })
        throw e
      }
    default:
      return raw
  }
}

export type ParsedCommand = {
  global: GlobalFlags
  positionals: string[]
  flags: Record<string, unknown>
}

// Parses everything after the command words against `def`'s flags plus the global ones. Dates are parsed
// against `today`. Arguments are bound separately (`bindArgs`), so `--help` works without them.
export function parseCommand(argv: string[], def: CommandDef, today: string): ParsedCommand {
  const own = def.flags ?? {}
  const all = { ...GLOBAL_FLAGS, ...own }
  const positionals: string[] = []
  const raw: Record<string, string | true> = {}
  for (const t of tokens(argv, all)) {
    if (t.kind === "positional") positionals.push(t.value)
    if (t.kind !== "option") continue
    const f = all[t.name]
    if (!f) throw new ValidationError(`unknown flag ${t.rawName}`, { field: t.name.replace(/^-+/, ""), hint: `run "pm ${commandName(def)} --help" for its flags` })
    if (f.type === "boolean") {
      if (t.value !== undefined) throw new ValidationError(`${t.rawName} takes no value`, { field: t.name })
      raw[t.name] = true
    } else {
      // `--due --json`: parseArgs would take "--json" as the value; that is a missing value, not a date.
      if (t.value === undefined || (!t.inlineValue && t.value.startsWith("--"))) throw new ValidationError(`${t.rawName} needs a value`, { field: t.name })
      raw[t.name] = t.value
    }
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined)
  const global: GlobalFlags = { json: raw.json === true, db: str(raw.db), fromInbox: str(raw["from-inbox"]), yes: raw.yes === true, help: raw.help === true }
  const flags: Record<string, unknown> = {}
  if (!global.help) {
    for (const [name, f] of Object.entries(own)) {
      const v = raw[name]
      if (v === undefined) {
        if (f.required) throw new ValidationError(`missing flag --${name}`, { field: name, hint: `usage: ${usage(def)}` })
        continue
      }
      flags[name] = v === true ? true : convert(name, f, v, today)
    }
  }
  return { global, positionals, flags }
}

// Positionals → the command's named args. A `rest` arg takes the remaining words as string[] (possibly empty).
export function bindArgs(def: CommandDef, positionals: string[]): Record<string, string | string[] | undefined> {
  const args: Record<string, string | string[] | undefined> = {}
  const queue = [...positionals]
  for (const a of def.args ?? []) {
    const value = a.rest ? queue.splice(0) : queue.shift()
    const missing = a.rest ? (value as string[]).length === 0 : value === undefined
    if (missing && a.required) throw new ValidationError(`missing argument <${a.name}>`, { field: a.name, hint: `usage: ${usage(def)}` })
    args[a.name] = value
  }
  if (queue.length) throw new ValidationError(`unexpected argument "${queue[0]}"`, { hint: `usage: ${usage(def)}` })
  return args
}
