// Two record types (and tag types) on one prefix (`#`: projects and boards), when both opt in with `sharedPrefix`.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../tests/helpers"
import { definePlugin, Type, type PluginDef } from "./api"
import { runWithContext } from "./context"
import { NotFoundError, ValidationError } from "./errors"
import { RecordTypeRegistry, type RecordTypeDef } from "./records"
import { TagRegistry } from "./tags"

// A type on `#` whose records are `codes` (code -> id); `asked` counts its resolve calls.
function hashType(name: string, codes: Record<string, number>, opts: { sharedPrefix?: boolean; plugin?: string } = {}) {
  const asked: string[] = []
  const def: RecordTypeDef = {
    name,
    plugin: opts.plugin ?? name,
    prefix: "#",
    ...(opts.sharedPrefix !== undefined ? { sharedPrefix: opts.sharedPrefix } : {}),
    resolve: async (input) => {
      asked.push(input)
      return codes[input.replace(/^#/, "").toUpperCase()] ?? null
    },
    label: async (id) => `${name} ${id}`,
    search: async (text, limit) =>
      Object.keys(codes)
        .filter((c) => c.includes(text.toUpperCase()))
        .sort()
        .slice(0, limit)
        .map((c) => ({ ref: `#${c}`, label: `${name} ${codes[c]}` })),
    ref: async (id) => `#${Object.keys(codes).find((c) => codes[c] === id)}`,
  }
  return { def, asked }
}

function shared() {
  const r = new RecordTypeRegistry()
  const alpha = hashType("alpha", { CRM: 1, ERP: 2 }, { sharedPrefix: true })
  const beta = hashType("beta", { MB: 7, BOARD: 8 }, { sharedPrefix: true })
  r.register(alpha.def)
  r.register(beta.def)
  return { r, alpha, beta }
}

describe("RecordTypeRegistry: a shared prefix", () => {
  test("two types on # resolve their own codes; typesOfRef names both, typeOfRef the first registered", async () => {
    const { r } = shared()
    expect(await r.resolveAny("#CRM")).toEqual({ type: "alpha", id: 1 })
    expect(await r.resolveAny("#mb")).toEqual({ type: "beta", id: 7 })
    expect(r.typesOfRef("#MB").map((d) => d.name)).toEqual(["alpha", "beta"])
    expect(r.typeOfRef("#MB")?.name).toBe("alpha")
    expect(await r.label("#MB")).toBe("beta 7")
    expect(r.typesOfRef("X-1")).toEqual([])
  })

  test("an unknown code resolves to null; its label is a NotFoundError naming both types", async () => {
    const { r } = shared()
    expect(await r.resolveAny("#ZZ")).toBeNull()
    await expect(r.label("#ZZ")).rejects.toBeInstanceOf(NotFoundError)
    await expect(r.label("#ZZ")).rejects.toThrow('no alpha or beta "#ZZ"')
  })

  test("a code two types both know is a data error naming both", async () => {
    const r = new RecordTypeRegistry()
    r.register(hashType("alpha", { MB: 1 }, { sharedPrefix: true }).def)
    r.register(hashType("beta", { MB: 7 }, { sharedPrefix: true }).def)
    await expect(r.resolveAny("#MB")).rejects.toBeInstanceOf(ValidationError)
    await expect(r.resolveAny("#MB")).rejects.toThrow('"#MB" is both a alpha and a beta')
  })

  test('resolve("#X", { type }) asks only that type', async () => {
    const { r, alpha, beta } = shared()
    expect(await r.resolveAny("#MB", { type: "alpha" })).toBeNull()
    expect(await r.resolveAny("#MB", { type: "beta" })).toEqual({ type: "beta", id: 7 })
    expect(beta.asked).toEqual(["#MB"])
    expect(alpha.asked).toEqual(["#MB"])
    // A type whose prefix the ref does not start with, or no type of that name: nothing.
    r.register({ ...hashType("gamma", {}).def, prefix: "G-" })
    expect(await r.resolveAny("#MB", { type: "gamma" })).toBeNull()
    expect(await r.resolveAny("#MB", { type: "nope" })).toBeNull()
    expect(alpha.asked).toEqual(["#MB"])
  })

  test("a second type on a prefix is refused unless both declare sharedPrefix", () => {
    const plain = new RecordTypeRegistry()
    plain.register(hashType("alpha", {}).def)
    expect(() => plain.register(hashType("beta", {}, { sharedPrefix: true }).def)).toThrow('record type prefix "#" is already registered by "alpha"')
    const opted = new RecordTypeRegistry()
    opted.register(hashType("alpha", {}, { sharedPrefix: true }).def)
    expect(() => opted.register(hashType("beta", {}).def)).toThrow('record type prefix "#" is already registered by "alpha"')
    expect(() => opted.register(hashType("beta", {}, { sharedPrefix: false }).def)).toThrow(ValidationError)
    opted.register(hashType("beta", {}, { sharedPrefix: true }).def)
    expect(opted.typesOfRef("#A").map((d) => d.name)).toEqual(["alpha", "beta"])
  })

  test("removing one plugin keeps the other type on the prefix", async () => {
    const { r } = shared()
    r.remove("alpha")
    expect(r.typesOfRef("#MB").map((d) => d.name)).toEqual(["beta"])
    expect(await r.resolveAny("#CRM")).toBeNull()
    await expect(r.label("#CRM")).rejects.toThrow('no record "#CRM"')
  })
})

describe("TagRegistry: a shared prefix", () => {
  function tags() {
    const { r } = shared()
    const t = new TagRegistry(r)
    t.register({ prefix: "#", recordType: "alpha", sharedPrefix: true, resolve: async (tok) => ({ CRM: 1, ERP: 2 })[tok.toUpperCase()] ?? null }, "alpha")
    t.register({ prefix: "#", recordType: "beta", sharedPrefix: true, resolve: async (tok) => ({ MB: 7, BOARD: 8 })[tok.toUpperCase()] ?? null }, "beta")
    return t
  }

  test("#tags resolve to whichever type knows the code; an unknown one stays unresolved", async () => {
    expect(await tags().resolve("see #crm and #MB, not #ZZ")).toEqual({
      links: [
        { recordType: "alpha", recordId: 1, raw: "#crm" },
        { recordType: "beta", recordId: 7, raw: "#MB" },
      ],
      unresolved: ["#ZZ"],
    })
  })

  test("types() lists both; suggest merges both types' candidates, ordered by ref", async () => {
    const t = tags()
    expect(t.types()).toEqual([
      { prefix: "#", recordType: "alpha" },
      { prefix: "#", recordType: "beta" },
    ])
    expect((await t.suggest("#", 10)).map((s) => s.ref)).toEqual(["#BOARD", "#CRM", "#ERP", "#MB"])
    expect((await t.suggest("#", 3)).map((s) => s.ref)).toEqual(["#BOARD", "#CRM", "#ERP"])
    expect((await t.suggest("#r", 10)).map((s) => s.ref)).toEqual(["#BOARD", "#CRM", "#ERP"])
  })

  test("a code two tag types both know is a data error", async () => {
    const t = new TagRegistry()
    t.register({ prefix: "#", recordType: "alpha", sharedPrefix: true, resolve: async () => 1 })
    t.register({ prefix: "#", recordType: "beta", sharedPrefix: true, resolve: async () => 2 })
    await expect(t.resolve("#MB")).rejects.toThrow('"#MB" is both a alpha and a beta')
  })

  test("a second tag type on a prefix is refused unless both declare sharedPrefix", () => {
    const t = new TagRegistry()
    t.register({ prefix: "#", recordType: "alpha", resolve: async () => null })
    expect(() => t.register({ prefix: "#", recordType: "beta", sharedPrefix: true, resolve: async () => null })).toThrow(
      'tag prefix "#" is already registered for "alpha"',
    )
    const o = new TagRegistry()
    o.register({ prefix: "#", recordType: "alpha", sharedPrefix: true, resolve: async () => null })
    expect(() => o.register({ prefix: "#", recordType: "beta", resolve: async () => null })).toThrow('tag prefix "#" is already registered for "alpha"')
  })

  test("remove(plugin) keeps the other tag type on the prefix", async () => {
    const t = tags()
    t.remove("alpha")
    expect(t.types()).toEqual([{ prefix: "#", recordType: "beta" }])
    expect(await t.resolve("#CRM #MB")).toEqual({ links: [{ recordType: "beta", recordId: 7, raw: "#MB" }], unresolved: ["#CRM"] })
  })
})

// Through the kernel: two fixture plugins, each with a type on `#`, a tag type and a write op that returns (or deletes) a record.
function hashPlugin(id: string, codes: Record<string, number>): PluginDef {
  return definePlugin({
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 1,
    activate(ctx) {
      const { def } = hashType(id, codes, { sharedPrefix: true })
      const { plugin: _plugin, ...own } = def
      ctx.recordType(own)
      ctx.tagType({ prefix: "#", recordType: id, sharedPrefix: true, resolve: async (tok) => codes[tok.toUpperCase()] ?? null })
      ctx.expose({
        write: {
          touch: {
            input: Type.Object({ code: Type.String() }),
            output: Type.Object({ ref: Type.String() }),
            describe: (i) => `~ #${i.code}`,
            run: async (i) => ({ ref: `#${i.code}` }),
          },
          drop: {
            input: Type.Object({ code: Type.String() }),
            output: Type.Object({ ref: Type.String(), deleted: Type.Literal(true), id: Type.Number() }),
            describe: (i) => `- #${i.code}`,
            run: async (i) => ({ ref: `#${i.code}`, deleted: true as const, id: codes[i.code]! }),
          },
        },
      })
    },
  })
}

describe("kernel: two plugins sharing #", () => {
  let kernel: TestKernel | undefined
  afterEach(async () => {
    await kernel?.cleanup()
    kernel = undefined
  })

  test("ctx.records and ctx.tags see both; writes of either type record provenance, and a delete is the writing plugin's own type's", async () => {
    kernel = await makeTestKernel({ plugins: [hashPlugin("alpha", { CRM: 1 }), hashPlugin("beta", { MB: 7 })] })
    expect(kernel.plugins.map((p) => `${p.id}:${p.status}`)).toEqual(["alpha:ok", "beta:ok"])
    const rt = kernel.runtime("alpha")!
    await runWithContext(kernel.context(), async () => {
      expect(await rt.records.resolve("#MB")).toEqual({ type: "beta", id: 7 })
      expect(await rt.records.resolve("#MB", { type: "alpha" })).toBeNull()
      expect(await rt.records.resolve("#ZZ")).toBeNull()
      await expect(rt.records.label("#ZZ")).rejects.toThrow('no alpha or beta "#ZZ"')
      expect(rt.records.typesOfRef("#MB")).toEqual(["alpha", "beta"])
      expect(rt.records.typesOfRef("@anna")).toEqual([])
      expect((await rt.tags.suggest("#", 10)).map((s) => s.ref)).toEqual(["#CRM", "#MB"])
      expect((await rt.tags.resolve("#MB #CRM")).links.map((l) => l.recordType)).toEqual(["beta", "alpha"])
    })
    const beta = kernel.runtime("beta")!
    await runWithContext(kernel.context({ type: "inbox", ref: "I-3" }), () => beta.self().write.touch!({ code: "MB" }))
    expect(await beta.provenance.originOf("beta", 7)).toEqual({ type: "inbox", ref: "I-3" })
    await runWithContext(kernel.context({ type: "inbox", ref: "I-4" }), () => rt.self().write.touch!({ code: "CRM" }))
    // A delete is its own plugin's type's: beta's drop of #MB forgets beta's record only.
    await runWithContext(kernel.context(), () => beta.self().write.drop!({ code: "MB" }))
    expect(await beta.provenance.originOf("beta", 7)).toBeUndefined()
    expect(await beta.provenance.originOf("alpha", 1)).toEqual({ type: "inbox", ref: "I-4" })
  })
})
