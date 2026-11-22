// Rhythms (design §5.2): the four phrases, the dates they give and how they read back.
import { describe, expect, test } from "bun:test"
import { parseRhythm, rhythmDates, rhythmLabel, rhythmText } from "./rhythm"

const failure = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e as { name: string; message: string; hint?: string; field?: string }
  }
  throw new Error("expected a failure")
}

// The mock's today is Fri 20 Nov 2026; occurrences are made for 56 days from today (to 14 Jan 2027).
const FROM = "2026-11-20"
const TO = "2027-01-14"

describe("parseRhythm", () => {
  test("the four forms, case-insensitive, full or 3-letter day, the leading every optional", () => {
    expect(parseRhythm("weekly on Mon")).toEqual({ every: "weeks", weeks: 1, day: 1 })
    expect(parseRhythm("every 2 weeks on wednesday")).toEqual({ every: "weeks", weeks: 2, day: 3 })
    expect(parseRhythm("2 weeks on wed")).toEqual({ every: "weeks", weeks: 2, day: 3 })
    expect(parseRhythm("  Every 3 WEEKS on  Fri ")).toEqual({ every: "weeks", weeks: 3, day: 5 })
    expect(parseRhythm("every 1 week on sunday")).toEqual({ every: "weeks", weeks: 1, day: 0 })
    expect(parseRhythm("monthly on the 4th tue")).toEqual({ every: "month", nth: 4, day: 2 })
    expect(parseRhythm("monthly on the 1st thursday")).toEqual({ every: "month", nth: 1, day: 4 })
    expect(parseRhythm("Monthly on the last Fri")).toEqual({ every: "month", nth: -1, day: 5 })
    expect(parseRhythm("monthly on day 15")).toEqual({ every: "month-day", date: 15 })
    expect(parseRhythm("monthly on day 31")).toEqual({ every: "month-day", date: 31 })
  })

  test("anything else is a validation error on `every` whose hint names the four forms", () => {
    for (const bad of ["", "daily", "every 0 weeks on mon", "weekly on someday", "monthly on the 5th mon", "monthly on day 32", "monthly on day 0", "weekly"]) {
      const e = failure(() => parseRhythm(bad))
      expect(e.name).toBe("ValidationError")
      expect(e.message).toBe(`invalid rhythm "${bad}"`)
      expect(e.field).toBe("every")
      expect(e.hint).toBe("use weekly on <day>, every <n> weeks on <day>, monthly on the <1st|2nd|3rd|4th|last> <day> or monthly on day <n>")
    }
  })

  test("rhythmText gives the canonical phrase stored on a series", () => {
    expect(rhythmText(parseRhythm("2 weeks on Wednesday"))).toBe("every 2 weeks on wed")
    expect(rhythmText(parseRhythm("every 1 week on mon"))).toBe("weekly on mon")
    expect(rhythmText(parseRhythm("monthly on the LAST friday"))).toBe("monthly on the last fri")
    expect(rhythmText(parseRhythm("monthly on day 15"))).toBe("monthly on day 15")
  })
})

describe("rhythmDates", () => {
  test("the mock's series from Fri 20 Nov", () => {
    expect(rhythmDates(parseRhythm("every 2 weeks on wednesday"), "2026-11-25", FROM, TO)).toEqual(["2026-11-25", "2026-12-09", "2026-12-23", "2027-01-06"])
    expect(rhythmDates(parseRhythm("monthly on the 4th tue"), FROM, FROM, TO)).toEqual(["2026-11-24", "2026-12-22"])
    expect(rhythmDates(parseRhythm("monthly on the last fri"), FROM, FROM, TO)).toEqual(["2026-11-27", "2026-12-25"])
    expect(rhythmDates(parseRhythm("weekly on mon"), FROM, FROM, "2026-12-07")).toEqual(["2026-11-23", "2026-11-30", "2026-12-07"])
  })

  test("monthly on day 31 falls on the last day of shorter months", () => {
    expect(rhythmDates(parseRhythm("monthly on day 31"), "2026-10-01", "2026-10-01", "2027-03-31")).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ])
    expect(rhythmDates(parseRhythm("monthly on day 30"), "2028-02-01", "2028-02-01", "2028-03-31")).toEqual(["2028-02-29", "2028-03-30"])
  })

  test("every n weeks counts from the first date, whatever the window", () => {
    // First date Mon 9 Nov: Mon 23 Nov and 7 Dec, not 16 or 30 Nov.
    expect(rhythmDates(parseRhythm("every 2 weeks on mon"), "2026-11-09", FROM, "2026-12-31")).toEqual(["2026-11-23", "2026-12-07", "2026-12-21"])
    // A first date that is not the rhythm's day starts at the next such day.
    expect(rhythmDates(parseRhythm("every 2 weeks on wed"), "2026-11-20", FROM, "2026-12-31")).toEqual(["2026-11-25", "2026-12-09", "2026-12-23"])
    // Nothing before the first date, even inside the window.
    expect(rhythmDates(parseRhythm("weekly on mon"), "2026-12-01", FROM, "2026-12-15")).toEqual(["2026-12-07", "2026-12-14"])
    expect(rhythmDates(parseRhythm("monthly on the 4th tue"), "2026-12-01", FROM, TO)).toEqual(["2026-12-22"])
  })

  test("an end date in the middle of the window stops the dates (the end date itself included)", () => {
    expect(rhythmDates(parseRhythm("weekly on mon"), FROM, FROM, TO, "2026-12-07")).toEqual(["2026-11-23", "2026-11-30", "2026-12-07"])
    expect(rhythmDates(parseRhythm("monthly on day 15"), FROM, FROM, TO, "2026-12-14")).toEqual([])
    expect(rhythmDates(parseRhythm("monthly on day 15"), FROM, FROM, "2027-02-28", "2027-01-15")).toEqual(["2026-12-15", "2027-01-15"])
    expect(rhythmDates(parseRhythm("every 2 weeks on wed"), "2026-11-25", FROM, TO, "2026-12-20")).toEqual(["2026-11-25", "2026-12-09"])
  })
})

describe("rhythmLabel", () => {
  test("short (screen 5's Series column) and long (a person's Meetings panel)", () => {
    const cases: Array<[string, string, string]> = [
      ["every 2 weeks on mon", "every 2 wk Mon", "every 2 weeks, Monday"],
      ["weekly on mon", "weekly Mon", "weekly, Monday"],
      ["monthly on the 4th tue", "monthly, 4th Tue", "monthly, 4th Tue"],
      ["monthly on the 1st thu", "monthly, 1st Thu", "monthly, 1st Thu"],
      ["monthly on the last fri", "monthly, last Fri", "monthly, last Fri"],
      ["monthly on day 15", "monthly, day 15", "monthly, day 15"],
    ]
    for (const [text, short, long] of cases) {
      expect(rhythmLabel(parseRhythm(text), "short")).toBe(short)
      expect(rhythmLabel(parseRhythm(text), "long")).toBe(long)
    }
  })
})
