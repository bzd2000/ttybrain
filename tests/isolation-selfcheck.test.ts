import { expect, test } from "bun:test"
import { runIsolationSelfCheck } from "../src/kernel/isolation-selfcheck"

test("the isolation self-check passes", async () => {
  const r = await runIsolationSelfCheck()
  expect(r.results.filter((x) => !x.ok)).toEqual([])
  expect(r.results.length).toBeGreaterThanOrEqual(15)
  expect(r.ok).toBe(true)
})
