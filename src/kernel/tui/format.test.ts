import { describe, expect, test } from "bun:test"
import { displayWidth, dueLabel, fitWidth, longDate, shortDate, truncate } from "./format"

describe("TUI format", () => {
  test("displayWidth counts wide characters and emoji as 2", () => {
    expect(displayWidth("名前")).toBe(4)
    expect(displayWidth("abc")).toBe(3)
    expect(displayWidth("🚀x")).toBe(3)
    expect(displayWidth("")).toBe(0)
  })

  test("truncate cuts by display width and ends with …", () => {
    expect(truncate("CRM replatforming", 8)).toBe("CRM rep…")
    expect(truncate("名前名前", 5)).toBe("名前…")
    expect(truncate("short", 8)).toBe("short")
    expect(truncate("名前名前名前", 10)).toBe("名前名前…")
    expect(displayWidth(truncate("名前名前名前", 10))).toBeLessThanOrEqual(10)
  })

  test("fitWidth: the widest text, kept between min and max", () => {
    expect(fitWidth(["CRM", "ERP2"], 8, 16)).toBe(8)
    expect(fitWidth(["CRM", "DATAPLATFORM2027"], 8, 16)).toBe(16)
    expect(fitWidth(["DATAPLATFORM2027X"], 4, 16)).toBe(16)
    expect(fitWidth(["HRPORTAL1", "名前"], 4, 16)).toBe(9)
    expect(fitWidth([], 6, 16)).toBe(6)
  })

  test("dueLabel", () => {
    const today = "2026-11-13"
    expect(dueLabel("2026-11-10", today)).toBe("-3d")
    expect(dueLabel("2026-11-13", today)).toBe("today")
    expect(dueLabel("2026-11-14", today)).toBe("Sat")
    expect(dueLabel("2026-11-15", today)).toBe("Sun")
    expect(dueLabel("2026-11-16", today)).toBe("16 Nov")
    expect(dueLabel("2026-11-26", today)).toBe("26 Nov")
    expect(dueLabel(null, today)).toBe("—")
  })

  test("shortDate and longDate", () => {
    expect(shortDate("2026-11-13")).toBe("13 Nov")
    expect(longDate("2026-11-13")).toBe("Fri 13 Nov 2026")
  })
})
