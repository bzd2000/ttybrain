import { describe, expect, test } from "bun:test"
import { parseActionFilter } from "./action-filter"

describe("parseActionFilter", () => {
  test("owner, project and free words; status defaults to open", () => {
    expect(parseActionFilter("owner:anna project:CRM budget")).toEqual({ owner: "anna", project: "CRM", links: [], text: ["budget"], status: "open" })
  })
  test("status tokens, owner:me (read as @me), extra whitespace; unknown status values are free words", () => {
    expect(parseActionFilter("  status:done  owner:me ")).toEqual({ owner: "@me", status: "done", links: [], text: [] })
    expect(parseActionFilter("status:all")).toEqual({ status: "all", links: [], text: [] })
    expect(parseActionFilter("status:bogus")).toEqual({ status: "open", links: [], text: ["status:bogus"] })
    expect(parseActionFilter("")).toEqual({ status: "open", links: [], text: [] })
  })
  // The design's `@anna #CRM mine`: linked records by their refs (a meeting too), and `mine` (or `@me`) for owner:@me.
  test("@handle, #CODE and M-n are links; mine is owner:@me", () => {
    expect(parseActionFilter("@anna #CRM mine budget M-4")).toEqual({ owner: "@me", status: "open", links: ["@anna", "#CRM", "M-4"], text: ["budget"] })
    expect(parseActionFilter("@me budget")).toEqual({ owner: "@me", status: "open", links: [], text: ["budget"] })
    expect(parseActionFilter("owner:@me")).toEqual({ owner: "@me", status: "open", links: [], text: [] })
    expect(parseActionFilter("owner:@ME")).toEqual({ owner: "@me", status: "open", links: [], text: [] })
    expect(parseActionFilter("# @ m-x")).toEqual({ status: "open", links: [], text: ["#", "@", "m-x"] })
  })
})
