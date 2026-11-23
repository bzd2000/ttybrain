// Test preload (bunfig.toml): a watchdog for a stuck test thread. bun's per-test timeout is a timer on the test
// thread, so a test whose event loop never comes back (a synchronous or microtask-only loop, a native call that
// never returns) hangs the run silently until the CI job times out. A worker (tests/watchdog-worker.ts) gets a
// heartbeat from a timer here and, when the heartbeat stops for TTYBRAIN_TEST_WATCHDOG_MS (default 60000; 0 turns
// it off), reports what it sees and kills the run.
const limit = Number(process.env.TTYBRAIN_TEST_WATCHDOG_MS ?? 60_000)

if (limit > 0) {
  const worker = new Worker(new URL("./watchdog-worker.ts", import.meta.url).href)
  worker.unref()
  const beat = () => worker.postMessage({ limit })
  beat()
  setInterval(beat, 250).unref()
}
