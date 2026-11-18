// A kernel on a temporary PM_HOME with a fixed clock (default 2026-11-13, a Friday) and PM_TEST=1. `clock`
// replaces it (a test that moves the date).
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fixedClock, type Clock } from "../src/kernel/clock"
import { bootKernel, type BootOptions, type Kernel } from "../src/kernel/host"

export type TestKernel = Kernel & { home: string; cleanup(): Promise<void> }

export async function makeTestKernel(
  opts: { plugins?: BootOptions["plugins"]; discover?: BootOptions["discover"]; today?: string; clock?: Clock; env?: Record<string, string> } = {},
): Promise<TestKernel> {
  const home = mkdtempSync(join(tmpdir(), "pm-test-"))
  const env = { PM_HOME: home, PM_TEST: "1", ...opts.env }
  let kernel: Kernel
  try {
    kernel = await bootKernel({
      env,
      plugins: opts.plugins ?? [],
      ...(opts.discover !== undefined && { discover: opts.discover }),
      clock: opts.clock ?? fixedClock(opts.today ?? "2026-11-13"),
    })
  } catch (e) {
    rmSync(home, { recursive: true, force: true })
    throw e
  }
  return Object.assign(kernel, {
    home,
    async cleanup() {
      await kernel.shutdown()
      rmSync(home, { recursive: true, force: true })
    },
  })
}
