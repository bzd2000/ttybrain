import { describe, expect, test } from "bun:test"
import { parseActionFilter } from "./action-filter"

describe("parseActionFilter", () => {
  test("owner, project and free words; status defaults to open", () => {
    expect(parseActionFilter("owner:anna project:CRM budget")).toEqual({ owner: "anna", project: "CRM", text: ["budget"], status: "open" })
  })
  test("status tokens, owner:me, extra whitespace; unknown status values are free words", () => {
    expect(parseActionFilter("  status:done  owner:me ")).toEqual({ owner: "me", status: "done", text: [] })
    expect(parseActionFilter("status:all")).toEqual({ status: "all", text: [] })
    expect(parseActionFilter("status:bogus")).toEqual({ status: "open", text: ["status:bogus"] })
    expect(parseActionFilter("")).toEqual({ status: "open", text: [] })
  })
})
