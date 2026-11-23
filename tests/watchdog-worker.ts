// The test watchdog's worker (tests/watchdog.ts starts it). The test thread posts a heartbeat every 250 ms from a
// timer; when none came for `limit` ms its event loop is stuck (a synchronous or microtask-only loop, or a native
// call that never returns), which bun's per-test timeout cannot catch since that timeout is a timer on the same
// loop. The worker then writes what it can see (how long, whether the process burned CPU meanwhile, each thread's
// state and kernel wait channel) to stderr and kills the process, so the run fails at once instead of hanging.
import { readdirSync, readFileSync, writeSync } from "node:fs"

declare const self: { onmessage: ((e: MessageEvent<{ limit: number }>) => void) | null }

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8").trim()
  } catch {
    return "?"
  }
}
// utime + stime of the process, in clock ticks (Linux only; 0 elsewhere).
const cpuTicks = () => {
  const fields = read("/proc/self/stat").split(") ")[1]?.split(" ") ?? []
  return Number(fields[11] ?? 0) + Number(fields[12] ?? 0) || 0
}
const threads = () => {
  try {
    return readdirSync("/proc/self/task").map((tid) => {
      const stat = read(`/proc/self/task/${tid}/stat`)
      const name = /\((.*)\)/.exec(stat)?.[1] ?? "?"
      const state = stat.split(") ")[1]?.split(" ")[0] ?? "?"
      return `  ${tid} ${name} ${state} ${read(`/proc/self/task/${tid}/wchan`)}`
    })
  } catch {
    return ["  (no /proc)"]
  }
}

let limit = 0
let last = Date.now()
let ticks = cpuTicks()
self.onmessage = (e) => {
  if (typeof e.data?.limit === "number") limit = e.data.limit
  last = Date.now()
  ticks = cpuTicks()
}

setInterval(() => {
  const quiet = Date.now() - last
  if (limit <= 0 || quiet < limit) return
  const used = cpuTicks() - ticks
  const report = [
    "",
    `test watchdog: the test thread's event loop has been stuck for ${quiet} ms; killing the run.`,
    `cpu meanwhile: ${used} ticks (about ${Math.round((used / 100 / (quiet / 1000)) * 100)}% of a core: high means a JS or native busy loop, near 0 a wait that never ends)`,
    "threads (tid name state wchan):",
    ...threads(),
    "The last test reported above is the one before the stuck one.",
    "",
  ].join("\n")
  writeSync(2, report)
  process.kill(process.pid, "SIGKILL")
}, 500)
