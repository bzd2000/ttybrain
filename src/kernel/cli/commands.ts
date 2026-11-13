// CLI commands registered by plugins (`ctx.command`), keyed by `<thing> <verb>`. The dispatcher (cli/dispatch.ts)
// parses argv against a command's args and flags and calls its `run`.
import { ValidationError } from "../errors"

// `list` is comma-separated → string[]; `date` accepts the date input forms and is parsed to ISO.
export type FlagDef = { type: "string" | "boolean" | "number" | "date" | "list"; description: string; required?: boolean; short?: string }

export type CommandDef = {
  thing: string
  verb: string
  summary: string
  args?: Array<{ name: string; required?: boolean; rest?: boolean }>
  flags?: Record<string, FlagDef>
  destructive?: boolean
  run(input: {
    args: Record<string, string | string[] | undefined>
    flags: Record<string, unknown>
    readStdin(): Promise<string>
  }): Promise<{ json: unknown; text: string }>
}

export type RegisteredCommand = { plugin: string; def: CommandDef }

export class CommandRegistry {
  private readonly entries = new Map<string, RegisteredCommand>() // keyed "<thing> <verb>", in registration order

  register(plugin: string, def: CommandDef): void {
    const key = `${def.thing} ${def.verb}`
    const taken = this.entries.get(key)
    if (taken) throw new ValidationError(`command "${key}" is already registered by plugin "${taken.plugin}"`)
    this.entries.set(key, { plugin, def })
  }

  find(thing: string, verb: string): RegisteredCommand | undefined {
    return this.entries.get(`${thing} ${verb}`)
  }

  // Every thing that has at least one command, sorted.
  things(): string[] {
    return [...new Set([...this.entries.values()].map((e) => e.def.thing))].sort()
  }

  list(): RegisteredCommand[] {
    return [...this.entries.values()]
  }

  remove(pluginId: string): void {
    for (const [key, e] of this.entries) if (e.plugin === pluginId) this.entries.delete(key)
  }
}
