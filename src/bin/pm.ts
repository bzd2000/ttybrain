// The `pm` entry point. With no arguments it prints the help (the TUI comes in phase 2); otherwise it boots the
// kernel with the built-in plugins, runs the CLI, shuts the kernel down and exits with the command's code.
// `--db` is read before boot. Stdin is read only when a command asks for it.
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { leading } from "../kernel/cli/args"
import { runCli } from "../kernel/cli/dispatch"
import { printError, type CliIo } from "../kernel/cli/output"
import { bootKernel } from "../kernel/host"
import { installShutdownHandlers } from "../kernel/shutdown"
import { builtinPlugins } from "../plugins"

export const PHASE2_NOTE = 'The terminal UI arrives in phase 2; run "bun start" for the preview.'

export async function main(argv: string[], env: Record<string, string | undefined>, io: CliIo): Promise<number> {
  const { global } = leading(argv)
  let kernel
  try {
    kernel = await bootKernel({ env, flags: global.db !== undefined ? { db: global.db } : {}, plugins: builtinPlugins })
  } catch (e) {
    return printError(e, global.json, io)
  }
  const uninstall = installShutdownHandlers(kernel)
  try {
    const code = await runCli(argv, kernel, io)
    if (argv.length === 0) io.out(`\n${PHASE2_NOTE}\n`)
    return code
  } finally {
    uninstall()
    await kernel.shutdown()
  }
}

async function readStdin(): Promise<string> {
  let s = ""
  process.stdin.setEncoding("utf8")
  for await (const chunk of process.stdin) s += chunk
  return s
}

// Runtime-neutral "am I the entry module" (no import.meta.main): compare real paths, so a symlinked bin works.
function isEntry(): boolean {
  const script = process.argv[1]
  if (!script) return false
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntry()) {
  const pending: Array<Promise<void>> = []
  const write = (stream: NodeJS.WriteStream) => (s: string) => {
    pending.push(new Promise((r) => stream.write(s, () => r())))
  }
  const code = await main(process.argv.slice(2), process.env, { out: write(process.stdout), err: write(process.stderr), stdin: readStdin })
  await Promise.all(pending) // flush piped output before exiting
  process.exit(code)
}
