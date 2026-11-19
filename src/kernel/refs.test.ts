import { describe, expect, test } from "bun:test"
import { formatRef, isValidCode, makeHandle, normalizeCode, normalizeHandle, parseRef } from "./refs"

describe("handles", () => {
  test("generation", () => {
    expect(makeHandle("Ségolène Royal", () => false)).toBe("segolene")
    expect(makeHandle("Anna Peeters", (h) => h === "anna")).toBe("anna2")
    expect(makeHandle("Anna X", (h) => ["anna", "anna2"].includes(h))).toBe("anna3")
    expect(makeHandle("Jean-Luc Picard", () => false)).toBe("jean-luc")
    expect(makeHandle("李雷", () => false)).toBe("person")
  })
  test("normalize", () => expect(normalizeHandle("@Anna")).toBe("anna"))
})
describe("refs", () => {
  test("format/parse", () => {
    expect(formatRef("A-", 12)).toBe("A-12")
    expect(parseRef("A-12", "A-")).toBe(12)
    expect(parseRef("a-12", "A-")).toBe(12)
    expect(parseRef("12", "A-")).toBe(12)
    expect(parseRef("R-12", "A-")).toBeNull()
    expect(parseRef("A-", "A-")).toBeNull()
    expect(parseRef("A-1x", "A-")).toBeNull()
  })
})
describe("codes", () => {
  test("valid/normalize", () => {
    expect(isValidCode("AB")).toBe(true)
    expect(isValidCode("A")).toBe(false)
    expect(isValidCode("ABCDEFGHI")).toBe(true)
    expect(isValidCode("ABCDEFGHIJKLMN16")).toBe(true)
    expect(isValidCode("ABCDEFGHIJKLMNO17")).toBe(false)
    expect(isValidCode("AB-C")).toBe(false)
    expect(isValidCode("ab")).toBe(false)
    expect(normalizeCode("#abc")).toBe("ABC")
  })
})
