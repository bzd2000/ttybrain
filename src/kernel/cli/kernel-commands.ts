// The kernel's own commands: help, guide, plugin list and report. They are CommandDefs like the plugins'
// ones, so they get the same argument parsing, --json and --help. `help` and `guide` have no verb (verb "").
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { Kernel } from "../host"
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
    ...kernel.reports.list().map((r) => reportCommand(kernel, r)),
  ]
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
