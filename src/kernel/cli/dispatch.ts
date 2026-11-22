// `ttybrain <thing> <verb> [args] [--flags]`: resolves the command (kernel commands first, then plugins'), parses
// its arguments, enforces --yes on destructive commands, runs it inside the operation context (with the
// --from-inbox origin) and prints the result or the error. Returns the exit code: 0, 1, 2 or 3.
import { runWithContext, type Origin } from "../context"
import { NotFoundError, suggest, ValidationError } from "../errors"
import type { Kernel } from "../host"
import { bindArgs, commandName, leading, parseCommand, wantsJson, without } from "./args"
import type { CommandDef } from "./commands"
import { helpAll, helpCommand, helpThing, kernelCommands } from "./kernel-commands"
import { printError, printResult, type CliIo, type CommandResult } from "./output"

export type { CliIo } from "./output"

const quoted = (xs: string[]) => xs.map((x) => `"${x}"`).join(", ")

class Commands {
  readonly all: CommandDef[]
  constructor(kernel: Kernel) {
    this.all = [...kernelCommands(kernel, (topic) => this.help(topic)), ...kernel.commands.list().map((c) => c.def)]
  }

  private things(): string[] {
    return [...new Set(this.all.map((d) => d.thing))]
  }

  ofThing(thing: string): CommandDef[] {
    const defs = this.all.filter((d) => d.thing === thing)
    if (!defs.length) {
      const s = suggest(thing, this.things())
      throw new ValidationError(`unknown command "${thing}"`, { hint: s.length ? `did you mean ${quoted(s)}?` : 'run "ttybrain help" to list the commands' })
    }
    return defs
  }

  verbless(thing: string): CommandDef | undefined {
    return this.ofThing(thing).find((d) => d.verb === "")
  }

  find(thing: string, verb: string): CommandDef {
    const defs = this.ofThing(thing)
    const def = defs.find((d) => d.verb === verb)
    if (def) return def
    const s = suggest(
      verb,
      defs.map((d) => d.verb),
    ).map((v) => `${thing} ${v}`)
    throw new ValidationError(`unknown command "${thing} ${verb}"`, {
      hint: s.length ? `did you mean ${quoted(s)}?` : `run "ttybrain ${thing} --help" to list its commands`,
    })
  }

  needsVerb(thing: string): ValidationError {
    return new ValidationError(`"${thing}" needs a verb`, { hint: `one of: ${this.ofThing(thing).map((d) => d.verb).join(", ")}` })
  }

  help(topic: string[]): CommandResult {
    const [thing, verb] = topic
    if (thing === undefined) return helpAll(this.all)
    const bare = this.verbless(thing)
    if (bare) return helpCommand(bare)
    if (verb === undefined) return helpThing(thing, this.ofThing(thing))
    return helpCommand(this.find(thing, verb))
  }
}

function originOf(fromInbox: string | undefined): Origin | undefined {
  if (fromInbox === undefined) return undefined
  const m = /^I-(\d+)$/i.exec(fromInbox.trim())
  if (!m) throw new ValidationError(`invalid --from-inbox "${fromInbox}"`, { field: "from-inbox", hint: "use an inbox item id, e.g. I-12" })
  return { type: "inbox", ref: `I-${Number(m[1])}` }
}

// The kernel's origin check, its not-found error naming the flag: `--from-inbox: no record "I-99"`.
async function checkFromInbox(kernel: Kernel, origin: Origin): Promise<void> {
  try {
    await kernel.checkOrigin(origin)
  } catch (e) {
    if (e instanceof NotFoundError) throw new NotFoundError(`--from-inbox: ${e.message}`, { hint: e.hint })
    throw e
  }
}

async function dispatch(argv: string[], kernel: Kernel, io: CliIo): Promise<{ result: CommandResult; json: boolean }> {
  const commands = new Commands(kernel)
  const { words, global } = leading(argv)
  const [first, second] = words
  if (!first) {
    // `ttybrain` alone, or `ttybrain --json`: the help. Anything else (`ttybrain --yes`) still goes through the help command.
    const def = commands.verbless("help")!
    const parsed = parseCommand(argv, def, kernel.context().today)
    return { result: helpAll(commands.all), json: parsed.global.json }
  }
  const bare = commands.verbless(first.value)
  if (!bare && !second) {
    if (global.help) return { result: helpThing(first.value, commands.ofThing(first.value)), json: global.json }
    throw commands.needsVerb(first.value)
  }
  const def = bare ?? commands.find(first.value, second!.value)
  const consumed = bare ? [first.index] : [first.index, second!.index]
  const parsed = parseCommand(without(argv, consumed), def, kernel.context().today)
  if (parsed.global.help) return { result: helpCommand(def), json: parsed.global.json }
  const args = bindArgs(def, parsed.positionals)
  if (def.destructive && !parsed.global.yes)
    throw new ValidationError(`"${commandName(def)}" is destructive; add --yes`, { hint: "re-run with --yes to confirm" })
  const origin = originOf(parsed.global.fromInbox)
  if (origin) await checkFromInbox(kernel, origin)
  const result = await runWithContext(kernel.context(origin), () => def.run({ args, flags: parsed.flags, readStdin: () => io.stdin() }))
  return { result, json: parsed.global.json }
}

export async function runCli(argv: string[], kernel: Kernel, io: CliIo): Promise<number> {
  const seen = kernel.upkeepFailures().length
  let code: number
  try {
    const { result, json } = await dispatch(argv, kernel, io)
    printResult(result, json, io)
    code = 0
  } catch (e) {
    code = printError(e, wantsJson(argv), io)
  }
  // An upkeep that failed during this command (it ran before the command's first write): said on stderr, so a CLI
  // user sees it; the exit code is the command's.
  for (const f of kernel.upkeepFailures().slice(seen)) io.err(`warning: ${f.text}\n${f.hint ? `hint: ${f.hint}\n` : ""}`)
  return code
}
