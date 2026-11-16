// Live refresh (spec §10): one app-wide `version` signal that screens' queries rerun on. It bumps when
// `PRAGMA data_version` changes (a commit by another connection: the CLI, Copilot, a second TUI), checked every
// `intervalMs`, and after the TUI's own writes (`record.changed`; our own commits leave our data_version alone).
// Several record.changed events in one tick (a change set) give one bump.
import { createSignal, type Accessor } from "solid-js"
import type { Kernel } from "../host"

export type LiveRefresh = { version: Accessor<number>; stop(): void }

export function createLiveRefresh(kernel: Kernel, intervalMs = 1000): LiveRefresh {
  const [version, setVersion] = createSignal(0)
  const bump = () => setVersion((v) => v + 1)
  let seen = kernel.db.dataVersion()

  const interval = setInterval(() => {
    let now: number
    try {
      now = kernel.db.dataVersion()
    } catch {
      return // closed during shutdown, or busy: try again on the next tick
    }
    if (now !== seen) {
      seen = now
      bump()
    }
  }, intervalMs)
  ;(interval as { unref?: () => void }).unref?.()

  let pending: ReturnType<typeof setTimeout> | undefined
  const off = kernel.events.on("record.changed", () => {
    if (pending !== undefined) return
    pending = setTimeout(() => {
      pending = undefined
      bump()
    }, 0)
  })

  return {
    version,
    stop() {
      clearInterval(interval)
      if (pending !== undefined) clearTimeout(pending)
      pending = undefined
      off()
    },
  }
}
