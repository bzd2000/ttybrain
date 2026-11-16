import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { builtinPlugins } from "../../plugins"
import { runWithContext } from "../context"
import { IsolationError } from "../errors"
import { bootTui } from "./boot"
import { defineTui, type TuiContext, type TuiDef } from "./types"

let k: TestKernel

beforeEach(async () => {
  k = await makeTestKernel({ plugins: builtinPlugins })
})
afterEach(async () => {
  await k.cleanup()
})

const Nothing = () => null
const part = (plugin: string, activate: (ui: TuiContext) => void): TuiDef => defineTui({ plugin, activate })
const screen = (id: string, slot?: number) => ({ id, title: id, ...(slot !== undefined ? { slot } : {}), component: Nothing })
const action = (id: string, key: string) => ({ id, key, label: id, overlay: Nothing })

describe("plugin runtime", () => {
  test("runtime returns the plugin's own scoped data", async () => {
    const rt = k.runtime("people")!
    expect(await rt.data.selectFrom("person").selectAll().execute()).toEqual([])
    let err: unknown
    try {
      await rt.data.selectFrom("project").selectAll().execute()
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(IsolationError)
  })

  test("runtime is undefined for a plugin that is not loaded", () => {
    expect(k.runtime("meetings")).toBeUndefined()
    expect(Object.keys(k.runtime("projects")!).sort()).toEqual(["clock", "config", "data", "id", "provenance", "records", "self", "tags", "use"])
  })

  test('tags.suggest("#cr", 5) finds the project; an unknown prefix gives []', async () => {
    await runWithContext(k.context(), () => k.ops.api("projects")!.write.addProject!({ code: "CRM", name: "CRM replatforming" }))
    const rt = k.runtime("inbox")!
    expect(await rt.tags.suggest("#cr", 5)).toEqual([{ ref: "#CRM", label: "CRM replatforming" }])
    expect(await rt.tags.suggest("$cr", 5)).toEqual([])
    expect(k.tags.types()).toEqual([
      { prefix: "@", recordType: "person" },
      { prefix: "#", recordType: "project" },
    ])
  })
})

describe("bootTui", () => {
  test("a part whose plugin is not loaded is skipped", () => {
    const reg = bootTui(k, [part("meetings", (ui) => ui.screen(screen("meetings", 4)))], { builtin: true })
    expect(reg.screens()).toEqual([])
    expect(reg.errors()).toEqual([{ plugin: "meetings", error: 'tui part for "meetings": plugin is not loaded' }])
  })

  test("a part whose activate throws loses everything it registered; its logic stays loaded", () => {
    const reg = bootTui(
      k,
      [
        part("projects", (ui) => {
          ui.screen(screen("projects", 2))
          ui.overviewPanel({ id: "p", title: "P", priority: 1, empty: "none", load: async () => [] })
          ui.globalAction(action("a", "a"))
          throw new Error("boom")
        }),
        part("people", (ui) => ui.screen(screen("people", 3))),
      ],
      { builtin: true },
    )
    expect(reg.screens().map((s) => s.id)).toEqual(["people"])
    expect(reg.panels()).toEqual([])
    expect(reg.globalActions()).toEqual([])
    expect(reg.errors()).toEqual([{ plugin: "projects", error: "projects: boom" }])
    expect(k.runtime("projects")).toBeDefined()
  })

  test("built-in slots 2-6; two screens on one slot fail the later part", () => {
    const reg = bootTui(
      k,
      [part("projects", (ui) => ui.screen(screen("projects", 2))), part("people", (ui) => ui.screen(screen("people", 2))), part("inbox", (ui) => ui.screen(screen("inbox", 6)))],
      { builtin: true },
    )
    expect(reg.screens().map((s) => [s.id, s.slot])).toEqual([
      ["projects", 2],
      ["inbox", 6],
    ])
    expect(reg.screenBySlot(6)?.id).toBe("inbox")
    expect(reg.errors()).toEqual([{ plugin: "people", error: 'people: slot 2 is already taken by screen "projects"' }])
  })

  test("external parts ignore slot and get 7, 8, … in order", () => {
    const reg = bootTui(k, [part("projects", (ui) => ui.screen(screen("projects", 2))), part("people", (ui) => ui.screen(screen("people", 2)))], { builtin: false })
    expect(reg.screens().map((s) => [s.id, s.slot])).toEqual([
      ["projects", 7],
      ["people", 8],
    ])
    expect(reg.screenBySlot(8)?.id).toBe("people")
    expect(reg.errors()).toEqual([])
  })

  test("slot 1 is reserved for the Overview screen", () => {
    const reg = bootTui(k, [part("projects", (ui) => ui.screen(screen("projects", 1)))], { builtin: true })
    expect(reg.screens()).toEqual([])
    expect(reg.errors()).toEqual([{ plugin: "projects", error: "projects: slot 1 is reserved for the Overview screen" }])
  })

  test("globalAction keys: single character, not a global key, not taken by an earlier action", () => {
    const reg = bootTui(
      k,
      [
        part("inbox", (ui) => ui.globalAction(action("capture", "i"))),
        part("projects", (ui) => ui.globalAction(action("again", "i"))),
        part("people", (ui) => ui.globalAction(action("wide", "ab"))),
      ],
      { builtin: true },
    )
    expect(reg.globalActions().map((a) => a.key)).toEqual(["i"])
    expect(reg.errors()).toEqual([
      { plugin: "projects", error: 'projects: key "i" is already taken' },
      { plugin: "people", error: 'people: key "ab" must be a single character' },
    ])
    for (const key of ["j", "k", "n", "e", "x", "g", "q", "?", "/", "1", "5", "9", "c"]) {
      const r = bootTui(k, [part("inbox", (ui) => ui.globalAction(action("x", key)))], { builtin: true })
      expect(r.errors()).toEqual([{ plugin: "inbox", error: `inbox: key "${key}" is already taken` }])
    }
    for (const key of ["h", "a", "d", "z", "u", "p", "E"]) {
      const r = bootTui(k, [part("inbox", (ui) => ui.globalAction(action("x", key)))], { builtin: true })
      expect(r.errors()).toEqual([])
    }
  })

  test("registering after bootTui returns throws", () => {
    let kept!: TuiContext
    const reg = bootTui(k, [part("projects", (ui) => void (kept = ui))], { builtin: true })
    expect(reg.errors()).toEqual([])
    expect(() => kept.screen(screen("late", 3))).toThrow(new IsolationError("plugins can only register during activate"))
    expect(() => kept.statusBadge({ id: "b", order: 1, text: async () => null })).toThrow("plugins can only register during activate")
    expect(reg.screens()).toEqual([])
    expect(reg.badges()).toEqual([])
    // The context still carries the plugin's runtime.
    expect(kept.id).toBe("projects")
    expect(kept.data).toBe(k.runtime("projects")!.data)
  })

  test("recordTab for an unregistered record type is accepted and never shown", () => {
    const tab = { id: "t", title: "T", order: 1, component: Nothing }
    const reg = bootTui(k, [part("projects", (ui) => ui.recordTab("meeting", tab))], { builtin: true })
    expect(reg.errors()).toEqual([])
    expect(reg.tabsFor("project")).toEqual([])
  })

  test("getters sort and filter what the parts registered", () => {
    const editor = () => null
    const reg = bootTui(
      k,
      [
        part("projects", (ui) => {
          ui.recordTab("project", { id: "b", title: "B", order: 2, component: Nothing })
          ui.recordTab("project", { id: "a", title: "A", order: 1, component: Nothing })
          ui.overviewPanel({ id: "late", title: "L", priority: 2, empty: "", load: async () => [] })
          ui.overviewPanel({ id: "first", title: "F", priority: 1, empty: "", load: async () => [] })
          ui.overviewPanel({ id: "tie", title: "T", priority: 2, empty: "", load: async () => [] })
          ui.listColumn("projects", { id: "c", title: "C", width: 4, value: async () => null })
          ui.recordForm("project", { id: "f", label: "Project", component: Nothing })
          ui.fieldEditor("project", "status", editor)
          ui.statusBadge({ id: "y", order: 20, text: async () => null })
          ui.statusBadge({ id: "x", order: 10, text: async () => null })
        }),
      ],
      { builtin: true },
    )
    expect(reg.tabsFor("project").map((t) => t.id)).toEqual(["a", "b"])
    expect(reg.panels().map((p) => p.id)).toEqual(["first", "late", "tie"])
    expect(reg.columns("projects").map((c) => c.id)).toEqual(["c"])
    expect(reg.columns("actions")).toEqual([])
    expect(reg.forms("project").map((f) => f.id)).toEqual(["f"])
    expect(reg.editor("project", "status")).toBe(editor)
    expect(reg.editor("project", "name")).toBeUndefined()
    expect(reg.badges().map((b) => b.id)).toEqual(["x", "y"])
  })
})
