// The `pm` entry point. It boots the kernel with the plugins the loader discovers (built-ins, plugin folders,
// npm dependencies). With no arguments and a terminal on
// stdout it opens the TUI (loaded with a dynamic import, so the CLI path never loads the UI); with no arguments
// otherwise it prints the help; else it runs the CLI. Then it shuts the kernel down and exits with the code.
// `--db` is read before boot. Stdin is read only when a command asks for it.
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { leading } from "../kernel/cli/args"
import { runCli } from "../kernel/cli/dispatch"
import { printError, type CliIo } from "../kernel/cli/output"
import { bootKernel } from "../kernel/host"
import { installShutdownHandlers } from "../kernel/shutdown"

export async function main(argv: string[], env: Record<string, string | undefined>, io: CliIo): Promise<number> {
  const { global } = leading(argv)
  let kernel
  try {
    kernel = await bootKernel({ env, flags: global.db !== undefined ? { db: global.db } : {}, discover: true })
  } catch (e) {
    return printError(e, global.json, io)
  }
  // On SIGHUP/SIGTERM the TUI's renderer is destroyed (restoring the terminal) before the database is closed.
  let stopTui: () => Promise<void> = async () => {}
  const uninstall = installShutdownHandlers(kernel, { before: () => stopTui() })
  try {
    if (argv.length === 0 && process.stdout.isTTY) {
      const { runTui } = await import("../kernel/tui/run")
      // Temporary (Task 4 moves this into runTui): each ok plugin's tui entry (default export), built-ins first.
      type Part = Parameters<typeof runTui>[1][number]
      const withTui = kernel.plugins.filter((p) => p.status === "ok" && p.tui !== undefined)
      const ordered = [...withTui.filter((p) => p.source === "built-in"), ...withTui.filter((p) => p.source !== "built-in")]
      const parts = await Promise.all(ordered.map(async (p) => ((await import(p.tui!)) as { default: Part }).default))
      await runTui(kernel, parts, {
        onRenderer: (renderer) => {
          stopTui = async () => {
            if (!renderer.isDestroyed) renderer.destroy()
            await renderer.closed
          }
        },
      })
      return 0
    }
    return await runCli(argv, kernel, io)
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
