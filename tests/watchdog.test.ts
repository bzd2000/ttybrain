// The test watchdog (tests/watchdog.ts): a test whose event loop never comes back fails the run within the
// watchdog's limit, with a report, instead of hanging it (bun's per-test timeout cannot fire on a stuck loop).
import { expect, test } from "bun:test"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

test("a stuck test thread is reported and the run killed", async () => {
  const started = Date.now()
  const proc = Bun.spawn([process.execPath, "test", "./tests/fixtures/stuck/stuck.test.ts"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, TTYBRAIN_STUCK_FIXTURE: "1", TTYBRAIN_TEST_WATCHDOG_MS: "2000" },
  })
  // Without the watchdog the child never exits: give up on it well before this test's own timeout.
  const guard = setTimeout(() => proc.kill("SIGKILL"), 15_000)
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  clearTimeout(guard)
  expect(err).toContain("test watchdog: the test thread's event loop has been stuck for")
  expect(err).toContain("threads (tid name state wchan):")
  expect(code).not.toBe(0)
  expect(Date.now() - started).toBeLessThan(15_000)
}, 30_000)
