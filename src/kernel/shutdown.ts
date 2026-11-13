// SIGHUP (the web terminal closing) and SIGTERM (the container stopping): roll back any open transaction and
// close the database (kernel.shutdown does both), then exit 0. Returns a function that removes the handlers.
import type { Kernel } from "./host"

const SIGNALS = ["SIGHUP", "SIGTERM"] as const

export function installShutdownHandlers(kernel: Pick<Kernel, "shutdown">, exit: (code: number) => void = (code) => process.exit(code)): () => void {
  let stopping = false
  const onSignal = () => {
    if (stopping) return
    stopping = true
    kernel.shutdown().then(
      () => exit(0),
      (e: unknown) => {
        process.stderr.write(`error: shutdown failed: ${e instanceof Error ? e.message : String(e)}\n`)
        exit(1)
      },
    )
  }
  for (const s of SIGNALS) process.on(s, onSignal)
  return () => {
    for (const s of SIGNALS) process.off(s, onSignal)
  }
}
