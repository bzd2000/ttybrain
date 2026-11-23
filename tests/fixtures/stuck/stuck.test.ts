// For tests/watchdog.test.ts only: a test whose event loop never comes back (a microtask-only loop), which bun's
// own timeout cannot stop. Skipped unless TTYBRAIN_STUCK_FIXTURE is set.
import { test } from "bun:test"

test.skipIf(!process.env.TTYBRAIN_STUCK_FIXTURE)(
  "a microtask-only loop",
  async () => {
    for (;;) await Promise.resolve()
  },
  500,
)
