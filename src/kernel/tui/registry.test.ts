import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { builtinPlugins } from "../../../tests/builtins"
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
    expect(k.runtime("assistant")).toBeUndefined()
    expect(Object.keys(k.runtime("projects")!).sort()).toEqual(["clock", "config", "data", "id", "provenance", "read", "records", "reports", "self", "tags", "use"])
  })

  test('tags.suggest("#cr", 5) finds the project; an unknown prefix gives []', async () => {
    await runWithContext(k.context(), () => k.ops.api("projects")!.write.addProject!({ code: "CRM", name: "CRM replatforming" }))
    const rt = k.runtime("inbox")!
    expect(await rt.tags.suggest("#cr", 5)).toEqual([{ ref: "#CRM", label: "CRM replatforming" }])
    expect(await rt.tags.suggest("$cr", 5)).toEqual([])
    expect(k.tags.types()).toEqual([
      { prefix: "@", recordType: "person" },
      { prefix: "#", recordType: "project" },
      { prefix: "#", recordType: "board" },
    ])
  })

  test("tags.types() names each prefix's record type; a suggestion carries its record type's detail", async () => {
    await runWithContext(k.context(), async () => {
      const people = k.ops.api("people")!.write
      await people.addPerson!({ name: "Marie Dubois", handle: "marie", job_title: "Head of Sales", is_stakeholder: true })
      await people.addPerson!({ name: "Mathias Wouters", handle: "mathias", job_title: "Developer", is_team: true })
      await people.addPerson!({ name: "Max Plain", handle: "max" })
    })
    const rt = k.runtime("inbox")!
    expect(rt.tags.types()).toEqual([
      { prefix: "@", recordType: "person" },
      { prefix: "#", recordType: "project" },
      { prefix: "#", recordType: "board" },
    ])
    // People: a team member's detail is `team`, anyone else's their job title (none without one).
    expect(await rt.tags.suggest("@ma", 5)).toEqual([
      { ref: "@marie", label: "Marie Dubois", detail: "Head of Sales" },
      { ref: "@mathias", label: "Mathias Wouters", detail: "team" },
      { ref: "@max", label: "Max Plain" },
    ])
  })
})

describe("bootTui", () => {
  test("a part whose plugin is not loaded is skipped", () => {
    const reg = bootTui(k, [part("assistant", (ui) => ui.screen(screen("assistant", 4)))], { builtin: true })
    expect(reg.screens()).toEqual([])
    expect(reg.errors()).toEqual([{ plugin: "assistant", error: 'tui part for "assistant": plugin is not loaded' }])
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

  test("built-in slots 2-7; two screens on one slot fail the later part; 8 is not a built-in slot", () => {
    const reg = bootTui(
      k,
      [
        part("projects", (ui) => ui.screen(screen("projects", 2))),
        part("people", (ui) => ui.screen(screen("people", 2))),
        part("inbox", (ui) => ui.screen(screen("inbox", 6))),
        part("boards", (ui) => ui.screen(screen("boards", 7))),
        part("actions", (ui) => ui.screen(screen("actions", 8))),
      ],
      { builtin: true },
    )
    expect(reg.screens().map((s) => [s.id, s.slot])).toEqual([
      ["projects", 2],
      ["inbox", 6],
      ["boards", 7],
    ])
    expect(reg.screenBySlot(7)?.id).toBe("boards")
    expect(reg.errors()).toEqual([
      { plugin: "people", error: 'people: slot 2 is already taken by screen "projects"' },
      { plugin: "actions", error: "actions: slot 8 must be between 2 and 7" },
    ])
  })

  test("external parts ignore slot and get 8, 9, … in order", () => {
    const reg = bootTui(k, [part("projects", (ui) => ui.screen(screen("projects", 2))), part("people", (ui) => ui.screen(screen("people", 2)))], { builtin: false })
    expect(reg.screens().map((s) => [s.id, s.slot])).toEqual([
      ["projects", 8],
      ["people", 9],
    ])
    expect(reg.screenBySlot(9)?.id).toBe("people")
    expect(reg.errors()).toEqual([])
  })

  test("external parts boot after the built-in ones into the same registry, without slots", () => {
    const reg = bootTui(k, [part("projects", (ui) => ui.screen(screen("projects", 2)))], {
      builtin: true,
      external: [part("people", (ui) => ui.screen(screen("people", 3))), part("projects", () => {})],
    })
    expect(reg.screens().map((s) => [s.id, s.slot])).toEqual([
      ["projects", 2],
      ["people", 8],
    ])
    expect(reg.errors()).toEqual([{ plugin: "projects", error: 'tui part for "projects": a part for this plugin is already loaded' }])
  })

  test("slot 1 is reserved for the Attention screen", () => {
    const reg = bootTui(k, [part("projects", (ui) => ui.screen(screen("projects", 1)))], { builtin: true })
    expect(reg.screens()).toEqual([])
    expect(reg.errors()).toEqual([{ plugin: "projects", error: "projects: slot 1 is reserved for the Attention screen" }])
  })

  test("a record type belongs to one screen; one crumb per record type", () => {
    const reg = bootTui(
      k,
      [
        part("projects", (ui) => {
          ui.screen({ ...screen("projects", 2), records: ["project"] })
          ui.recordCrumb("project", { tone: "cyan" })
        }),
        part("people", (ui) => ui.screen({ ...screen("people", 3), records: ["person", "project"] })),
        part("meetings", (ui) => ui.recordCrumb("project", { tone: "red" })),
      ],
      { builtin: true },
    )
    expect(reg.screenForRecord("project")?.id).toBe("projects")
    expect(reg.screenForRecord("person")).toBeUndefined() // the people part failed whole
    expect(reg.crumbFor("project")).toEqual({ tone: "cyan", plugin: "projects" })
    expect(reg.crumbFor("person")).toBeUndefined()
    expect(reg.errors()).toEqual([
      { plugin: "people", error: 'people: record type "project" already belongs to screen "projects"' },
      { plugin: "meetings", error: 'meetings: a crumb for "project" is already registered' },
    ])
  })

  test("globalAction keys: single character, not a global key, not taken by an earlier action (a taken key skips only that action)", () => {
    const reg = bootTui(
      k,
      [
        part("inbox", (ui) => ui.globalAction(action("capture", "i"))),
        part("projects", (ui) => {
          ui.globalAction(action("again", "i"))
          ui.globalAction(action("other", "o"))
          ui.overviewPanel({ id: "kept", title: "Kept", priority: 1, empty: "-", load: async () => [] })
        }),
        part("people", (ui) => ui.globalAction(action("wide", "ab"))),
      ],
      { builtin: true },
    )
    expect(reg.globalActions().map((a) => a.key)).toEqual(["i", "o"])
    expect(reg.panels().map((p) => p.id)).toEqual(["kept"])
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
