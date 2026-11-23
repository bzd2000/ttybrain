// The extension points the meetings rework added to the frame and quick capture, against a fixture plugin `thing`
// (record types `thing`, T-1 … T-2, a screen of its own, and `gadget`, GD-1 … GD-2): a crumb without its ref
// (`ref: false`), a crumb shown under the record it was opened from (`under`, with that record's screen's chip),
// a `bare` tab shown alone (no tab row), a record key (`recordKey`: on every tab, after the tab's own keys), and
// capture routes (registration order, the first that takes the text; a declined preview only when none does).
import { afterEach, expect, test } from "bun:test"
import { line } from "../../../tests/design"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { definePlugin, type PluginDef } from "../api"
import { matchCapture } from "./captureRoutes"
import { TuiRegistry } from "./registry"
import { defineTui, type TuiDef } from "./types"
import { printable, useScreenKeys } from "./keys"

const thingPlugin: PluginDef = definePlugin({
  id: "thing",
  name: "Thing",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    const type = (name: string, prefix: string, label: string) =>
      ctx.recordType({
        name,
        prefix,
        resolve: async (ref) => {
          const m = new RegExp(`^(?:${prefix})?(\\d+)$`, "i").exec(ref)
          const n = m ? Number(m[1]) : 0
          return n >= 1 && n <= 2 ? n : null
        },
        label: async (id) => `${label} ${id}`,
        search: async () => [],
      })
    type("thing", "T-", "Thing")
    type("gadget", "GD-", "Gadget")
  },
})

const Tab = (props: { recordRef: string }) => <text>{`tab of ${props.recordRef}`}</text>
// The "More" tab claims `w` itself.
function More(props: { recordRef: string }) {
  useScreenKeys((key) => {
    if (printable(key) !== "w") return
    key.preventDefault()
    pressed.push(`tab w on ${props.recordRef}`)
  })
  return <text>{`more of ${props.recordRef}`}</text>
}
const pressed: string[] = []
const Bare = (props: { recordRef: string }) => <text>{`bare view of ${props.recordRef}`}</text>

const thingPart: TuiDef = defineTui({
  plugin: "thing",
  activate(ui) {
    ui.screen({ id: "things", title: "Things", slot: 2, component: () => <text>things</text>, records: ["thing"] })
    ui.screen({ id: "gadgets", title: "Gadgets", slot: 3, component: () => <text>gadgets</text>, records: ["gadget"] })
    ui.recordTab("thing", { id: "main", title: "Main", order: 1, component: Tab })
    ui.recordTab("thing", { id: "more", title: "More", order: 2, component: More })
    ui.recordKey("thing", { key: "w", label: "wave", run: async (ref) => void pressed.push(`record w on ${ref}`) })
    // GD-1 shows only the bare view; GD-2 the bare view and a tab.
    ui.recordTab("gadget", { id: "bare", title: "Bare", order: 1, bare: true, component: Bare })
    ui.recordTab("gadget", { id: "other", title: "Other", order: 2, when: async (ref) => ref === "GD-2", component: Tab })
    ui.recordCrumb("thing", { ref: false, detail: async () => "a detail" })
    ui.recordCrumb("gadget", { under: async (ref, parent) => (parent === "T-1" ? `${ref} under ${parent}` : null), detail: async () => "its detail" })
  },
})

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

async function open(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: [thingPlugin] })
  tui = await renderTui(kernel, { parts: [thingPart], width: 100, height: 20 })
  await tui.frame()
  return tui
}

async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

test("a crumb with ref: false shows the label alone, then its detail", async () => {
  const t = await open()
  await t.nav.open("T-1")
  const frame = await until(t, (f) => line(f, 0).includes("Thing 1 · a detail"))
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}2 Things ▾ {2}› Thing 1 · a detail\s+\w{3} \d+ \w{3} \d{4}$/)
})

test("under: opened from the record it names, the crumb follows that record's (plain) with the parent's chip", async () => {
  const t = await open()
  await t.nav.open("T-1")
  await until(t, (f) => line(f, 0).includes("Thing 1"))
  await t.nav.open("GD-1")
  let frame = await until(t, (f) => line(f, 0).includes("GD-1 under T-1"))
  // The parent without its detail; the chip is the parent's screen's, not the gadget's own.
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}2 Things ▾ {2}› Thing 1 › GD-1 under T-1\s/)
  // Back on the thing, then a gadget opened from elsewhere: the usual crumb and the gadget's own screen.
  t.nav.back()
  await until(t, (f) => !f.includes("under"))
  t.nav.go("things")
  await t.nav.open("T-2")
  await until(t, (f) => line(f, 0).includes("Thing 2"))
  await t.nav.open("GD-1")
  frame = await until(t, (f) => line(f, 0).includes("GD-1 Gadget 1"))
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}3 Gadgets ▾ {2}› GD-1 Gadget 1 · its detail\s/)
})

test("a bare tab shown alone has no tab row; with another tab shown the row is back", async () => {
  const t = await open()
  await t.nav.open("GD-1")
  let frame = await until(t, (f) => f.includes("bare view of GD-1"))
  expect(line(frame, 1)).toContain("bare view of GD-1")
  expect(frame).not.toContain("Bare")
  t.nav.back()
  await t.nav.open("GD-2")
  frame = await until(t, (f) => f.includes("Other") && f.includes("bare view of GD-2"))
  expect(line(frame, 1).trim()).toBe("")
  expect(line(frame, 2)).toMatch(/Bare +Other/)
})

test("a record key works on every tab of its type, after the tab's own keys; its hint follows the tab's", async () => {
  pressed.length = 0
  const t = await open()
  await t.nav.open("T-1")
  let frame = await until(t, (f) => f.includes("tab of T-1"))
  expect(line(frame, 19)).toContain("w wave")
  t.input.pressKey("w")
  await t.settle()
  expect(pressed).toEqual(["record w on T-1"])
  // On the tab that takes `w` itself, the tab's wins.
  t.input.pressArrow("right")
  frame = await until(t, (f) => f.includes("more of T-1"))
  t.input.pressKey("w")
  await t.settle()
  expect(pressed).toEqual(["record w on T-1", "tab w on T-1"])
  // Another record type has none.
  await t.nav.open("GD-1")
  frame = await until(t, (f) => f.includes("bare view of GD-1"))
  expect(line(frame, 19)).not.toContain("w wave")
  const registry = new TuiRegistry()
  registry.addRecordKey("a", "thing", { key: "w", label: "x", run: () => {} })
  expect(() => registry.addRecordKey("b", "thing", { key: "w", label: "y", run: () => {} })).toThrow('key "w" on "thing" is already registered')
})

test("capture routes: registered in order, a duplicate id refused; the first preview that is not null wins", async () => {
  const registry = new TuiRegistry()
  const route = (id: string, takes: (text: string) => boolean) => ({
    id,
    preview: async (text: string) => (takes(text) ? { lines: [[{ text: `${id} takes it` }]] } : null),
    submit: async () => `saved by ${id}`,
  })
  registry.addCaptureRoute("a", route("first", (t) => t.startsWith("talk ")))
  registry.addCaptureRoute("b", {
    id: "broken",
    preview: async () => {
      throw new Error("broken")
    },
    submit: async () => "",
  })
  registry.addCaptureRoute("b", route("second", (t) => t.includes("talk")))
  expect(() => registry.addCaptureRoute("c", route("first", () => true))).toThrow('capture route "first" is already registered')
  const routes = registry.captureRoutes()
  expect(routes.map((r) => `${r.plugin}:${r.id}`)).toEqual(["a:first", "b:broken", "b:second"])
  expect((await matchCapture(routes, "talk @anna x"))?.route.id).toBe("first")
  // A throwing preview counts as null: the next route is asked.
  expect((await matchCapture(routes, "small talk"))?.route.id).toBe("second")
  expect((await matchCapture(routes, "small talk"))?.preview.lines).toEqual([[{ text: "second takes it" }]])
  expect(await matchCapture(routes, "lunch")).toBeNull()
  // A declined preview does not stop the routes after it; it shows only when none takes the text.
  const declining = new TuiRegistry()
  declining.addCaptureRoute("a", { id: "no", preview: async () => ({ declined: true, lines: [[{ text: "not mine" }]] }), submit: async () => "" })
  declining.addCaptureRoute("b", route("yes", (t) => t.startsWith("talk ")))
  expect((await matchCapture(declining.captureRoutes(), "talk x"))?.route.id).toBe("yes")
  expect(await matchCapture(declining.captureRoutes(), "lunch")).toEqual(expect.objectContaining({ preview: { declined: true, lines: [[{ text: "not mine" }]] } }))
  // Removing a failed part removes its routes.
  registry.remove("b")
  expect(registry.captureRoutes().map((r) => r.id)).toEqual(["first"])
})
