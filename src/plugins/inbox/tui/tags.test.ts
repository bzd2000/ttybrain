import { describe, expect, test } from "bun:test"
import { tagParts } from "./tags"

describe("tagParts", () => {
  test("an unknown tag names its prefix's record type, or all the types that share the prefix", () => {
    const one = [{ prefix: "#", recordType: "project" }]
    const two = [...one, { prefix: "#", recordType: "board" }]
    const warning = (types: typeof one) => tagParts("see #ZZ", { unresolved: ["#ZZ"], types }).at(-1)
    expect(warning(one)).toEqual({ text: "⚠ unknown project", tone: "amber" })
    expect(warning(two)).toEqual({ text: "⚠ unknown project or board", tone: "amber" })
    expect(warning([])).toEqual({ text: "⚠ unknown tag", tone: "amber" })
  })
})
