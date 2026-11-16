import { describe, expect, test } from "bun:test"
import { IsolationError } from "./errors"
import { assertPluginId, RESERVED_PLUGIN_IDS } from "./plugin-id"

describe("assertPluginId", () => {
  test("accepts [a-z][a-z0-9-]*", () => {
    for (const id of ["people", "projects", "my-plugin2"]) expect(() => assertPluginId(id)).not.toThrow()
  })

  test("rejects other shapes", () => {
    for (const id of ["my_plugin", "Contracts", "1st", "", "-x"]) {
      expect(() => assertPluginId(id)).toThrow(IsolationError)
      expect(() => assertPluginId(id)).toThrow(`plugin id "${id}" must match [a-z][a-z0-9-]*`)
    }
  })

  test("rejects the reserved kernel and sqlite namespaces", () => {
    expect([...RESERVED_PLUGIN_IDS]).toEqual(["kernel", "sqlite"])
    for (const id of RESERVED_PLUGIN_IDS) expect(() => assertPluginId(id)).toThrow(`plugin id "${id}" is reserved`)
  })
})
