// SIGHUP (the web terminal closing) and SIGTERM (the container stopping): run `before` (the TUI destroys its
// renderer there, restoring the terminal), then roll back any open transaction and close the database
// (kernel.shutdown does both), then exit 0. Returns a function that removes the handlers.
import type { Kernel } from "./host"

const SIGNALS = ["SIGHUP", "SIGTERM"] as const

export type ShutdownOptions = {
  before?: () => void | Promise<void>
  exit?: (code: number) => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function installShutdownHandlers(kernel: Pick<Kernel, "shutdown">, opts: ShutdownOptions = {}): () => void {
  const exit = opts.exit ?? ((code: number) => process.exit(code))
  let stopping = false
  const onSignal = async () => {
    if (stopping) return
    stopping = true
    let code = 0
    try {
      await opts.before?.()
    } catch (e) {
      process.stderr.write(`error: shutdown failed: ${message(e)}\n`)
      code = 1
    }
    try {
      await kernel.shutdown()
    } catch (e) {
      process.stderr.write(`error: shutdown failed: ${message(e)}\n`)
      code = 1
    }
    exit(code)
  }
  for (const s of SIGNALS) process.on(s, onSignal)
  return () => {
    for (const s of SIGNALS) process.off(s, onSignal)
  }
}
