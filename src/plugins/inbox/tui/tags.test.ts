import { describe, expect, test } from "bun:test"
import { tagParts } from "./tags"

describe("tagParts", () => {
  test("an unknown tag names its prefix's record type: of a prefix several types share, the first (as the designs draw it)", () => {
    const one = [{ prefix: "#", recordType: "project" }]
    const two = [...one, { prefix: "#", recordType: "board" }]
    const warning = (types: typeof one) => tagParts("see #ZZ", { unresolved: ["#ZZ"], types }).at(-1)
    expect(warning(one)).toEqual({ text: "⚠ unknown project", tone: "amber" })
    expect(warning(two)).toEqual({ text: "⚠ unknown project", tone: "amber" })
    expect(warning([{ prefix: "T-", recordType: "talk_item" }, ...one])).toEqual({ text: "⚠ unknown project", tone: "amber" })
    expect(warning([])).toEqual({ text: "⚠ unknown tag", tone: "amber" })
  })
})
