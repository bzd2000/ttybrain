// The kernel's own commands: help, guide, plugin list|add|remove|enable|disable|build and report. They are CommandDefs like the plugins'
// ones, so they get the same argument parsing, --json and --help. `help` and `guide` have no verb (verb "").
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { loadConfig, updateConfigFile } from "../config"
import { NotFoundError, suggest } from "../errors"
import type { Kernel } from "../host"
import { buildPlugin } from "../plugins/build"
import { addPlugin, removePlugin, TRUST_WARNING } from "../plugins/install"
import { createdText, scaffoldPlugin } from "../plugins/scaffold"
import { renderReport, type ReportDef } from "../reports"
import { commandName, flagSignature, GLOBAL_FLAGS, signature, usage } from "./args"
import type { CommandDef, FlagDef } from "./commands"
import { formatTable, type CommandResult } from "./output"

export const PM_VERSION = "0.1.0"

// Help for a topic (`[]`, `[thing]` or `[thing, verb]`); supplied by the dispatcher, which resolves commands.
export type HelpFn = (topic: string[]) => CommandResult

export function kernelCommands(kernel: Kernel, help: HelpFn): CommandDef[] {
  return [
    {
      thing: "help",
      verb: "",
      summary: "list the commands and their flags; pm help <thing> [verb] for one",
      args: [{ name: "topic", rest: true }],
      run: async ({ args }) => help((args.topic as string[] | undefined) ?? []),
    },
    {
      thing: "guide",
      verb: "",
      summary: "print the Markdown guide for agents",
      flags: { write: { type: "string", placeholder: "path", description: "write the guide to this file instead" } },
      run: async ({ flags }) => {
        const markdown = kernel.guide.render(PM_VERSION)
        if (typeof flags.write !== "string") return { json: { markdown }, text: markdown }
        const path = resolve(flags.write)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, markdown)
        return { json: { path }, text: `wrote ${path}` }
      },
    },
    {
      thing: "plugin",
      verb: "list",
      summary: "list the plugins with their version, source, status and error",
      run: async () => {
        const rows = kernel.plugins.map((p) => ({ id: p.id, version: p.version, source: p.source, status: p.status, error: p.error ?? null }))
        return { json: rows, text: formatTable(["id", "version", "source", "status", "error"], rows) }
      },
    },
    {
      thing: "plugin",
      verb: "add",
      summary: "install a plugin from npm, a folder or a .tgz into the plugins folder (from the next run)",
      args: [{ name: "spec", required: true }],
      run: async ({ args }) => {
        // The installer choice (PM_PLUGIN_INSTALLER) comes from the process environment, which pm's entry point boots with.
        const { name, id, version, warned } = await addPlugin(kernel.paths, String(args.spec), process.env)
        return {
          json: { name, id, version, source: "npm", warned },
          text: `${warned ? `${TRUST_WARNING}\n` : ""}added ${id} ${version} (npm)`,
        }
      },
    },
    {
      thing: "plugin",
      verb: "remove",
      summary: "uninstall an npm plugin or delete a folder plugin; its data stays unless --purge-data",
      args: [{ name: "id", required: true }],
      flags: { "purge-data": { type: "boolean", description: "also drop the plugin's tables and its kernel rows (migrations, provenance)" } },
      destructive: true,
      run: async ({ args, flags }) => {
        const id = String(args.id)
        const purged = flags["purge-data"] === true
        await removePlugin(kernel, id, { purgeData: purged, env: process.env })
        return { json: { id, removed: true, purged }, text: purged ? `removed ${id} and its data` : `removed ${id}` }
      },
    },
    {
      thing: "plugin",
      verb: "enable",
      summary: "enable a disabled plugin (from the next run)",
      args: [{ name: "id", required: true }],
      run: async ({ args }) => {
        const id = String(args.id)
        updateConfigFile(kernel.paths, (cfg) => {
          const plugins = pluginsSection(cfg)
          const disabled = disabledList(plugins)
          // An id that is no longer installed can still be taken off the list.
          if (!disabled.includes(id)) knownPlugin(kernel, id)
          plugins.disabled = disabled.filter((d) => d !== id)
        })
        // The file no longer lists it, so if the merged config still does, PM_CONFIG_JSON (read from the process
        // environment, which pm's entry point boots with) disables it.
        if (loadConfig(kernel.paths, process.env).plugins.disabled.includes(id)) {
          return { json: { id, disabled: false, stillDisabledBy: "PM_CONFIG_JSON" }, text: `enabled ${id}; note: PM_CONFIG_JSON still disables it` }
        }
        return { json: { id, disabled: false }, text: `enabled ${id}` }
      },
    },
    {
      thing: "plugin",
      verb: "disable",
      summary: "disable a plugin (from the next run); the plugins that require it are skipped too; its data stays",
      args: [{ name: "id", required: true }],
      run: async ({ args }) => {
        const id = knownPlugin(kernel, String(args.id))
        updateConfigFile(kernel.paths, (cfg) => {
          const plugins = pluginsSection(cfg)
          const disabled = disabledList(plugins)
          plugins.disabled = disabled.includes(id) ? disabled : [...disabled, id]
        })
        const skipped = dependantsOf(kernel, id)
        const also = skipped.map(([d, on]) => `${d} (requires ${on.join(", ")})`).join(", ")
        return {
          json: { id, disabled: true, alsoSkipped: skipped.map(([d]) => d) },
          text: `disabled ${id}${also ? `; also skipped: ${also}` : ""}`,
        }
      },
    },
    {
      thing: "plugin",
      verb: "build",
      summary: "compile a plugin's src/ to dist/ with shims for pm's shared modules (default dir: .)",
      args: [{ name: "dir" }],
      run: async ({ args }) => {
        const dir = resolve(typeof args.dir === "string" ? args.dir : ".")
        const { files, shims } = await buildPlugin(dir)
        const { name, version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string }
        return {
          json: { name: name ?? null, version: version ?? null, files, shims },
          text: `built ${name ?? basename(dir)}${version !== undefined ? ` ${version}` : ""}: ${files} files, shims for ${shims.length > 0 ? shims.join(", ") : "none"}`,
        }
      },
    },
    {
      thing: "plugin",
      verb: "new",
      summary: "scaffold a new plugin folder <id> in the current directory (a migration, a command, a screen, a project tab, a test)",
      args: [{ name: "id", required: true }],
      run: async ({ args }) => {
        const id = String(args.id)
        const dir = scaffoldPlugin(process.cwd(), id)
        return { json: { id, dir }, text: createdText(dir, id) }
      },
    },
    ...kernel.reports.list().map((r) => reportCommand(kernel, r)),
  ]
}

// ---- plugin enable|disable helpers ----

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

// The config file's `plugins` object, created when missing (its other keys, such as `allow`, stay).
function pluginsSection(cfg: Obj): Obj {
  if (!isObj(cfg.plugins)) cfg.plugins = {}
  return cfg.plugins as Obj
}

const disabledList = (plugins: Obj): string[] => (Array.isArray(plugins.disabled) ? plugins.disabled.filter((d): d is string => typeof d === "string") : [])

function knownPlugin(kernel: Kernel, id: string): string {
  if (kernel.plugins.some((p) => p.id === id)) return id
  throw new NotFoundError(`no plugin "${id}"`, { suggestions: suggest(id, kernel.plugins.map((p) => p.id)), hint: 'run "pm plugin list"' })
}

// The loaded plugins that require `id`, directly or through another one, sorted by id, each with the plugins
// of that set (or `id`) it requires: they are skipped too once `id` is disabled.
function dependantsOf(kernel: Kernel, id: string): Array<[string, string[]]> {
  const off = new Set([id])
  const loaded = kernel.plugins.filter((p) => p.status === "ok" && p.id !== id).map((p) => p.id)
  for (let grew = true; grew; ) {
    grew = false
    for (const p of loaded) {
      if (!off.has(p) && kernel.requiresOf(p).some((r) => off.has(r))) {
        off.add(p)
        grew = true
      }
    }
  }
  return [...off]
    .filter((p) => p !== id)
    .sort()
    .map((p) => [p, kernel.requiresOf(p).filter((r) => off.has(r)).sort()])
}

type JsonSchema = { type?: string; description?: string }

// `pm report <cliName>`: the report's required params are positional arguments (in declaration order), the
// optional ones flags. `--format md|text|json` picks the text rendering; `--json` prints the result itself.
function reportCommand(kernel: Kernel, report: ReportDef): CommandDef {
  const schema = report.params as { properties?: Record<string, JsonSchema>; required?: string[] }
  const props = Object.entries(schema.properties ?? {})
  const required = new Set(schema.required ?? [])
  const numeric = (s: JsonSchema) => s.type === "number" || s.type === "integer"
  const flags: Record<string, FlagDef> = {}
  for (const [name, s] of props) {
    if (required.has(name)) continue
    flags[name] = { type: numeric(s) ? "number" : s.type === "boolean" ? "boolean" : "string", description: s.description ?? "" }
  }
  flags.format = { type: "string", values: ["md", "text", "json"], description: "output format (default md)" }
  return {
    thing: "report",
    verb: report.cliName,
    summary: report.describe,
    args: props.filter(([n]) => required.has(n)).map(([name]) => ({ name, required: true })),
    flags,
    run: async ({ args, flags: given }) => {
      const params: Record<string, unknown> = {}
      for (const [name, s] of props) {
        const v = required.has(name) ? args[name] : given[name]
        if (v === undefined) continue
        params[name] = required.has(name) && numeric(s) && v !== "" ? Number(v) : v
      }
      const result = await kernel.reports.run(report.id, params)
      const format = (given.format as "md" | "text" | "json" | undefined) ?? "md"
      return { json: result, text: renderReport(result, format) }
    },
  }
}

// ---- help rendering (pure: over the list of commands) ----

const helpCommandJson = (def: CommandDef) => ({
  command: commandName(def),
  usage: usage(def),
  summary: def.summary,
  destructive: def.destructive === true,
  args: (def.args ?? []).map((a) => ({ name: a.name, required: a.required === true, rest: a.rest === true })),
  flags: Object.entries(def.flags ?? {}).map(([name, f]) => ({
    name,
    type: f.type,
    description: f.description,
    required: f.required === true,
    ...(f.short ? { short: f.short } : {}),
    ...(f.values ? { values: f.values } : {}),
    ...(f.placeholder !== undefined ? { placeholder: f.placeholder } : {}),
  })),
})

const globalFlagsJson = () => Object.entries(GLOBAL_FLAGS).map(([name, f]) => ({ name, type: f.type, description: f.description }))

function flagLines(flags: Record<string, FlagDef>, indent: string): string[] {
  const entries = Object.entries(flags).map(([name, f]) => [flagSignature(name, f), f.description + (f.required ? " (required)" : "")] as const)
  const width = Math.max(0, ...entries.map(([s]) => s.length))
  return entries.map(([s, d]) => `${indent}${s.padEnd(width)}  ${d}`.trimEnd())
}

function commandLines(defs: CommandDef[]): string[] {
  const width = Math.max(0, ...defs.map((d) => signature(d).length))
  const lines: string[] = []
  for (const d of defs) {
    lines.push(`  ${signature(d).padEnd(width)}  ${d.summary}${d.destructive ? " (destructive; needs --yes)" : ""}`.trimEnd())
    lines.push(...flagLines(d.flags ?? {}, "      "))
  }
  return lines
}

const globalSection = () => ["Global flags:", ...flagLines(GLOBAL_FLAGS, "  ")]

export function helpAll(defs: CommandDef[]): CommandResult {
  const text = [
    "usage: pm <thing> <verb> [args] [--flags]",
    "",
    "Commands:",
    ...commandLines(defs),
    "",
    ...globalSection(),
    "",
    'Run "pm <thing> --help" or "pm <thing> <verb> --help" for one thing or command.',
  ].join("\n")
  return { json: { commands: defs.map(helpCommandJson), globalFlags: globalFlagsJson() }, text: text + "\n" }
}

export function helpThing(thing: string, defs: CommandDef[]): CommandResult {
  const text = [`Commands for "${thing}":`, ...commandLines(defs), "", ...globalSection()].join("\n")
  return { json: { commands: defs.map(helpCommandJson), globalFlags: globalFlagsJson() }, text: text + "\n" }
}

export function helpCommand(def: CommandDef): CommandResult {
  const own = def.flags ?? {}
  const text = [
    `usage: ${usage(def)}`,
    "",
    def.summary,
    ...(def.destructive ? ["", "This command is destructive: it needs --yes."] : []),
    ...(Object.keys(own).length ? ["", "Flags:", ...flagLines(own, "  ")] : []),
    "",
    ...globalSection(),
  ].join("\n")
  return { json: { commands: [helpCommandJson(def)], globalFlags: globalFlagsJson() }, text: text + "\n" }
}
