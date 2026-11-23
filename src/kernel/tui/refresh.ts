// Live refresh (spec §10): one app-wide `version` signal that screens' queries rerun on. It bumps when
// `PRAGMA data_version` changes (a commit by another connection: the CLI, Copilot, a second TUI), checked every
// `intervalMs`, and after the TUI's own writes (`record.changed`; our own commits leave our data_version alone).
// Several record.changed events in one tick (a change set) give one bump. Each check also compares the clock's
// today: a new day (a TUI left open overnight) updates `today` and bumps, so dates and groups follow. The plugins'
// upkeeps (ctx.upkeep) run when the refresh starts (the TUI's start) and on each new day, and bump when they changed rows.
import { createSignal, type Accessor } from "solid-js"
import type { Kernel } from "../host"

// `pending()`: a bump after an own write is scheduled but has not happened yet, or an upkeep is running (tests wait
// for both with idle()).
export type LiveRefresh = { version: Accessor<number>; today: Accessor<string>; pending(): boolean; stop(): void }

export function createLiveRefresh(kernel: Kernel, intervalMs = 1000): LiveRefresh {
  const [version, setVersion] = createSignal(0)
  const bump = () => setVersion((v) => v + 1)
  let seen = kernel.db.dataVersion()
  const [today, setToday] = createSignal(kernel.clock.today())
  // Our own commits leave data_version alone, so an upkeep that changed rows bumps by itself.
  let upkeeping = 0
  const upkeep = () => {
    upkeeping++
    void kernel
      .upkeep()
      .then((changed) => {
        if (changed) bump()
      })
      .catch(() => {}) // never rejects: its errors are kept with the plugins (Help's plugin problems)
      .finally(() => {
        upkeeping--
      })
  }
  upkeep()

  const interval = setInterval(() => {
    const day = kernel.clock.today()
    if (day !== today()) {
      setToday(day)
      bump()
      upkeep()
    }
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
    today,
    pending: () => pending !== undefined || upkeeping > 0,
    stop() {
      clearInterval(interval)
      if (pending !== undefined) clearTimeout(pending)
      pending = undefined
      off()
    },
  }
}
