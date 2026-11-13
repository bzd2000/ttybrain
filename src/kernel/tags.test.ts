import { describe, expect, test } from "bun:test"
import { ValidationError } from "./errors"
import { parseTags, TagRegistry } from "./tags"

const tokens = (text: string) => parseTags(text).map((t) => t.token)

function registry() {
  const tags = new TagRegistry()
  const seen: string[] = []
  // The projects resolver normalises the token itself (Task 14); here only CRM exists, as id 7.
  tags.register({ prefix: "#", recordType: "project", resolve: async (t) => (seen.push(t), t.toUpperCase() === "CRM" ? 7 : null) })
  tags.register({ prefix: "@", recordType: "person", resolve: async (t) => (t === "peter" ? 3 : null) })
  return { tags, seen }
}

describe("tag parsing", () => {
  test("tags next to brackets and punctuation", () => {
    expect(parseTags("Peter worried (#CRM), see @peter.")).toEqual([
      { prefix: "#", token: "CRM", raw: "#CRM" },
      { prefix: "@", token: "peter", raw: "@peter" },
    ])
    expect(tokens("Peter worried (#CRM), see @peter.")).toEqual(["CRM", "peter"])
  })

  test("e-mail addresses and C# are not tags", () => {
    expect(parseTags("mail anna@example.com about C# code")).toEqual([])
  })

  test("start of text, after [ and trailing .,;:!?)]", () => {
    expect(tokens("#CRM: [@anna] #ERP; @bob! #X1? (@jo) #a-b.")).toEqual(["CRM", "anna", "ERP", "bob", "X1", "jo", "a-b"])
  })

  test("a tag needs a letter or digit right after the prefix", () => {
    expect(parseTags("# heading, @ home, #-x, $")).toEqual([])
    expect(parseTags("$contract-42")).toEqual([{ prefix: "$", token: "contract-42", raw: "$contract-42" }])
  })

  test("#crm resolves the same as #CRM; the resolver gets the token as typed", async () => {
    const { tags, seen } = registry()
    const lower = await tags.resolve("#crm")
    const upper = await tags.resolve("#CRM")
    expect(lower).toEqual({ links: [{ recordType: "project", recordId: 7, raw: "#crm" }], unresolved: [] })
    expect(upper).toEqual({ links: [{ recordType: "project", recordId: 7, raw: "#CRM" }], unresolved: [] })
    expect(seen).toEqual(["crm", "CRM"])
  })

  test("#CMR with no match is unresolved", async () => {
    const { tags } = registry()
    expect(await tags.resolve("#CMR")).toEqual({ links: [], unresolved: ["#CMR"] })
  })

  test("unknown prefixes and unknown tokens both go to unresolved; repeats count once", async () => {
    const { tags } = registry()
    expect(await tags.resolve("@peter on #CRM, $contract and @nobody; again @peter #crm $contract")).toEqual({
      links: [
        { recordType: "person", recordId: 3, raw: "@peter" },
        { recordType: "project", recordId: 7, raw: "#CRM" },
      ],
      unresolved: ["$contract", "@nobody"],
    })
  })
})

describe("TagRegistry", () => {
  test("a duplicate prefix throws", () => {
    const { tags } = registry()
    expect(() => tags.register({ prefix: "#", recordType: "other", resolve: async () => null })).toThrow(ValidationError)
  })

  test("a prefix parseTags can never produce is refused", () => {
    const { tags } = registry()
    expect(() => tags.register({ prefix: "%", recordType: "other", resolve: async () => null })).toThrow(
      'tag prefix "%" must be one of #, @, $',
    )
  })

  test("remove(plugin) drops that plugin's tag types", async () => {
    const tags = new TagRegistry()
    tags.register({ prefix: "$", recordType: "contract", resolve: async () => 1 }, "contracts")
    expect((await tags.resolve("$c1")).links).toHaveLength(1)
    tags.remove("contracts")
    expect(await tags.resolve("$c1")).toEqual({ links: [], unresolved: ["$c1"] })
    tags.register({ prefix: "$", recordType: "contract", resolve: async () => 1 }, "contracts2")
  })
})
