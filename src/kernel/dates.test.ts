import { describe, expect, test } from "bun:test"
import { addDays, dayDate, dueLabel, isValidDate, parseDate, shortDate, weekEnd } from "./dates"
import { ValidationError } from "./errors"

const T = "2026-11-13"
describe("parseDate", () => {
  const cases: [string, string][] = [
    ["2026-12-04", "2026-12-04"],
    ["today", "2026-11-13"],
    ["tomorrow", "2026-11-14"],
    ["+3d", "2026-11-16"],
    ["+2w", "2026-11-27"],
    ["+0d", "2026-11-13"],
    ["fri", "2026-11-20"],
    ["FRI", "2026-11-20"],
    ["mon", "2026-11-16"],
  ]
  for (const [i, o] of cases) test(`${i} -> ${o}`, () => expect(parseDate(i, T)).toBe(o))
  for (const bad of ["2026-02-30", "31/12/2026", "next week"]) {
    test(`rejects ${bad}`, () => {
      try {
        parseDate(bad, T)
        throw new Error("should throw")
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError)
        expect((e as ValidationError).hint).toBe("use YYYY-MM-DD, today, tomorrow, +3d, +2w or mon…sun")
      }
    })
  }
})
test("weekEnd", () => {
  expect(weekEnd("2026-11-13")).toBe("2026-11-15")
  expect(weekEnd("2026-11-15")).toBe("2026-11-15")
})
test("addDays / isValidDate", () => {
  expect(addDays("2026-12-30", 3)).toBe("2027-01-02")
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
  expect(isValidDate("2026-02-30")).toBe(false)
  expect(isValidDate("2028-02-29")).toBe(true)
  expect(isValidDate("nope")).toBe(false)
})

// The display formats are on the plugin API too, so report sections (logic) can write `14 Oct` and `-3d`.
test("display formats: shortDate, dayDate, dueLabel", () => {
  expect(shortDate("2026-10-14")).toBe("14 Oct")
  expect(dayDate("2026-12-04")).toBe("Fri 4 Dec")
  expect(dueLabel("2026-11-09", "2026-11-12")).toBe("-3d")
  expect(dueLabel("2026-11-13", "2026-11-12")).toBe("Fri")
  expect(dueLabel("2026-12-02", "2026-11-12")).toBe("2 Dec")
})
