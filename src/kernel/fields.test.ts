// The `field` extension point on the logic side: ctx.field registers, kernel.fields.for reads, boot checks the
// named operations, and registrations are sealed after boot. Proven with the `budget` fixture plugin.
import { afterEach, describe, expect, test } from "bun:test"
import { budget } from "../../tests/fixtures/tui-fixture"
import { makeTestKernel, type TestKernel } from "../../tests/helpers"
import { builtinPlugins } from "../plugins/index"
import { definePlugin, type PluginContext } from "./api"
import { IsolationError } from "./errors"

let kernel: TestKernel | undefined
afterEach(async () => {
  await kernel?.cleanup()
  kernel = undefined
})

describe("field registry", () => {
  test("a registered field is listed for its record type", async () => {
    kernel = await makeTestKernel({ plugins: [...builtinPlugins, budget()] })
    expect(kernel.plugins.find((p) => p.id === "budget")?.status).toBe("ok")
    expect(kernel.fields.for("project")).toEqual([
      { plugin: "budget", def: { name: "budget", label: "Budget", type: "number", get: "getBudget", set: "setBudget" } },
    ])
    expect(kernel.fields.for("action")).toEqual([])
  })

  test("field with missing op fails the plugin", async () => {
    kernel = await makeTestKernel({ plugins: [...builtinPlugins, budget({ get: "readBudget" })] })
    const status = kernel.plugins.find((p) => p.id === "budget")
    expect(status?.status).toBe("failed")
    expect(status?.error).toBe('field "budget": no read operation "readBudget"')
    expect(kernel.fields.for("project")).toEqual([])
    expect(kernel.ops.api("budget")).toBeUndefined()
  })

  test("a field whose set is no write operation fails the plugin", async () => {
    kernel = await makeTestKernel({ plugins: [...builtinPlugins, budget({ set: "getBudget" })] })
    const status = kernel.plugins.find((p) => p.id === "budget")
    expect(status?.status).toBe("failed")
    expect(status?.error).toBe('field "budget": no write operation "getBudget"')
    expect(kernel.fields.for("project")).toEqual([])
  })

  test("a field registered twice fails the second plugin", async () => {
    const twice = definePlugin({
      id: "twice",
      name: "Twice",
      version: "1.0.0",
      apiVersion: 1,
      activate(ctx) {
        ctx.field("project", { name: "x", label: "X", type: "text", get: "g", set: "s" })
        ctx.field("project", { name: "x", label: "X", type: "text", get: "g", set: "s" })
      },
    })
    kernel = await makeTestKernel({ plugins: [twice] })
    expect(kernel.plugins[0]?.error).toBe('field "x" of "project" is already registered')
  })

  test("field registration after boot throws", async () => {
    let kept: PluginContext | undefined
    const late = definePlugin({ id: "late", name: "Late", version: "1.0.0", apiVersion: 1, activate: (ctx) => void (kept = ctx) })
    kernel = await makeTestKernel({ plugins: [late] })
    expect(() => kept!.field("project", { name: "x", label: "X", type: "text", get: "g", set: "s" })).toThrow(
      new IsolationError("plugins can only register during activate"),
    )
    expect(kernel.fields.for("project")).toEqual([])
  })
})
