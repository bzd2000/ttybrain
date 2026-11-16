import { expect, test } from "bun:test"
import { satisfies } from "./semver"

test("satisfies", () => {
  expect(satisfies("1.4.0", "^1")).toBe(true)
  expect(satisfies("2.0.0", "^1")).toBe(false)
  expect(satisfies("1.1.0", "^1.2")).toBe(false)
  expect(satisfies("1.2.0", "^1.2")).toBe(true)
  expect(satisfies("1.9.9", "^1.2.3")).toBe(true)
  expect(satisfies("1.2.2", "^1.2.3")).toBe(false)
  expect(satisfies("0.3.0", "*")).toBe(true)
  expect(satisfies("1.2.3", "1.2.3")).toBe(true)
  expect(satisfies("1.2.4", "1.2.3")).toBe(false)
})
