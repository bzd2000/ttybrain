import { describe, expect, test } from "bun:test"
import { NotFoundError, ValidationError } from "./errors"
import { RecordTypeRegistry, type RecordTypeDef } from "./records"

const rows: Record<string, Record<number, string>> = {
  deliverable: { 4: "Spec v1" },
  decision: { 4: "Use SQLite" },
  project: { 12: "CRM rebuild" },
}
const codes: Record<string, number> = { CRM: 12 }

function type(name: string, prefix: string, plugin = "projects"): RecordTypeDef {
  return {
    name,
    plugin,
    prefix,
    resolve: async (input) => {
      if (prefix === "#") return codes[input.replace(/^#/, "").toUpperCase()] ?? null
      const id = Number(input.slice(prefix.length))
      return rows[name]?.[id] ? id : null
    },
    label: async (id) => rows[name]![id]!,
    search: async () => [],
  }
}

function registry(): RecordTypeRegistry {
  const r = new RecordTypeRegistry()
  r.register(type("deliverable", "D-"))
  r.register(type("decision", "DE-"))
  r.register(type("project", "#"))
  return r
}

describe("RecordTypeRegistry", () => {
  test("typeOfRef tries the longest prefix first: DE-4 is a decision, D-4 a deliverable", () => {
    const r = registry()
    expect(r.typeOfRef("DE-4")?.name).toBe("decision")
    expect(r.typeOfRef("D-4")?.name).toBe("deliverable")
    expect(r.typeOfRef("de-4")?.name).toBe("decision")
    expect(r.typeOfRef("#CRM")?.name).toBe("project")
    expect(r.typeOfRef("X-1")).toBeUndefined()
  })

  test("a duplicate name or prefix throws", () => {
    const r = registry()
    expect(() => r.register(type("decision", "Q-"))).toThrow(ValidationError)
    expect(() => r.register(type("other", "de-"))).toThrow('record type prefix "de-" is already registered by "decision"')
  })

  test("byName and byPrefix", () => {
    const r = registry()
    expect(r.byName("project")?.prefix).toBe("#")
    expect(r.byPrefix("DE-")?.name).toBe("decision")
    expect(r.byName("nope")).toBeUndefined()
  })

  test("resolveAny and label", async () => {
    const r = registry()
    expect(await r.resolveAny("DE-4")).toEqual({ type: "decision", id: 4 })
    expect(await r.resolveAny("#crm")).toEqual({ type: "project", id: 12 })
    expect(await r.resolveAny("DE-99")).toBeNull()
    expect(await r.resolveAny("X-1")).toBeNull()
    expect(await r.label("D-4")).toBe("Spec v1")
    expect(await r.label("#CRM")).toBe("CRM rebuild")
    await expect(r.label("DE-99")).rejects.toBeInstanceOf(NotFoundError)
  })

  test("refOf formats dash prefixes, and asks the type for non-numeric refs", async () => {
    const r = new RecordTypeRegistry()
    r.register(type("decision", "DE-"))
    r.register({ ...type("project", "#"), ref: async (id) => (id === 12 ? "#CRM" : `#${id}`) })
    expect(await r.refOf("decision", 4)).toBe("DE-4")
    expect(await r.refOf("project", 12)).toBe("#CRM")
    expect(await r.refOf("gone", 3)).toBe("gone:3")
  })

  test("remove drops a plugin's record types", () => {
    const r = registry()
    r.register(type("note", "N-", "people"))
    r.remove("projects")
    expect(r.typeOfRef("DE-4")).toBeUndefined()
    expect(r.byName("note")?.plugin).toBe("people")
  })
})
