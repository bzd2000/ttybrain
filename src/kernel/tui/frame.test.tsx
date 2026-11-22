// The frame's extension points, against a fixture plugin `thing` (record types `thing`, T-1 … T-3, and `gadget`,
// GD-1): a screen claiming a record type (the chip names it), a record type's crumb (ref tone, muted detail), a
// screen's own crumb (useScreenCrumb), a badge's tone, and a screen setting its status bar exactly (HintOptions).
import { afterEach, expect, test } from "bun:test"
import { onMount } from "solid-js"
import { fgAt, line } from "../../../tests/design"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { builtinPlugins } from "../../../tests/builtins"
import { definePlugin, type PluginDef } from "../api"
import { runWithContext } from "../context"
import { keyText, useKeys, useScreenKeys } from "./keys"
import { useScreenCrumb } from "./nav"
import { theme } from "./theme"
import { defineTui, type TuiDef } from "./types"

const thingPlugin: PluginDef = definePlugin({
  id: "thing",
  name: "Thing",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.recordType({
      name: "thing",
      prefix: "T-",
      resolve: async (ref) => {
        const m = /^(?:T-)?(\d+)$/i.exec(ref)
        const n = m ? Number(m[1]) : 0
        return n >= 1 && n <= 3 ? n : null
      },
      label: async (id) => `Thing ${id}`,
      search: async () => [],
    })
    ctx.recordType({
      name: "gadget",
      prefix: "GD-",
      resolve: async (ref) => (/^(?:GD-)?1$/i.test(ref) ? 1 : null),
      label: async () => "Gadget one",
      search: async () => [],
    })
  },
})

// The screen: its crumb `All`, an exact bar (`tab panel`, then only `? help` of the frame's hints, then its `after` hints) and a child that
// registers its own hint, which the exact bar leaves out.
function Child() {
  const keys = useKeys()
  onMount(() => keys.hints([{ key: "↑↓", label: "select" }]))
  return <text>child</text>
}
function ThingsScreen() {
  const keys = useKeys()
  useScreenCrumb(() => "All")
  onMount(() => keys.hints([{ key: "Tab", label: "panel" }], { exact: true, frame: ["?"], after: [{ key: "x", label: "extra" }] }))
  return (
    <box flexDirection="column">
      <text>things screen</text>
      <Child />
    </box>
  )
}
// A screen without an exact bar: every hint, then the global actions', then all of the frame's.
function PlainScreen() {
  const keys = useKeys()
  onMount(() => keys.hints([{ key: "Enter", label: "open" }]))
  return <text>plain screen</text>
}
// A screen whose design draws no global or frame hints: `globals: false` and `frame: []` leave them out (the keys
// still work).
function BareScreen() {
  const keys = useKeys()
  onMount(() => keys.hints([{ key: "n", label: "new" }], { exact: true, frame: [], globals: false }))
  return <text>bare screen</text>
}
function Tab(props: { recordRef: string }) {
  return <text>{`tab of ${props.recordRef}`}</text>
}
function ActionOverlay(props: { close(): void }) {
  useScreenKeys((key) => {
    key.preventDefault()
    if (key.name === "escape") props.close()
  })
  return <text>act overlay</text>
}

// The crumb detail's loads, and a gate a test can hold them on (open by default).
let detailCalls = 0
let detailGate: Promise<void> = Promise.resolve()

const thingPart: TuiDef = defineTui({
  plugin: "thing",
  activate(ui) {
    ui.screen({ id: "things", title: "Things", slot: 2, component: ThingsScreen, records: ["thing"] })
    ui.screen({ id: "plain", title: "Plain", slot: 3, component: PlainScreen })
    ui.screen({ id: "bare", title: "Bare", slot: 4, component: BareScreen })
    ui.recordTab("thing", { id: "main", title: "Main", order: 1, component: Tab })
    ui.recordTab("gadget", { id: "main", title: "Main", order: 1, component: Tab })
    ui.recordCrumb("thing", {
      tone: "magenta",
      detail: async (ref) => {
        detailCalls++
        await detailGate
        return ref === "T-2" ? null : "Thu 4 Dec · 8 attendees"
      },
    })
    ui.recordCrumb("gadget", {
      detail: async () => {
        throw new Error("no detail")
      },
    })
    ui.globalAction({ id: "act", key: "w", label: "act", overlay: ActionOverlay })
    ui.statusBadge({ id: "count", order: 1, tone: "green", text: async () => "● 2 things" })
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

// `withPeople`: also load the people plugin, for a real write.
async function open(withPeople = false): Promise<RenderedTui> {
  detailCalls = 0
  detailGate = Promise.resolve()
  kernel = await makeTestKernel({ plugins: withPeople ? [thingPlugin, ...builtinPlugins.filter((p) => p.id === "people")] : [thingPlugin] })
  tui = await renderTui(kernel, { parts: [thingPart], width: 100, height: 20 })
  await tui.frame()
  return tui
}

async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 50 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

test("keyText lowercases camel-case named keys (PgUp/PgDn) too", () => {
  expect(["PgUp/PgDn", "PgUp", "PgDn", "Shift+PgDn"].map(keyText)).toEqual(["pgup/pgdn", "pgup", "pgdn", "shift+pgdn"])
})

test("keyText lowercases named keys only", () => {
  expect(["Enter", "Esc", "Tab", "Del", "Ctrl+S", "Shift+Tab", "J/K", "D", "N", "↑↓", "1-6", "/", "a s t"].map(keyText)).toEqual([
    "enter",
    "esc",
    "tab",
    "del",
    "ctrl+s",
    "shift+tab",
    "J/K",
    "D",
    "N",
    "↑↓",
    "1-6",
    "/",
    "a s t",
  ])
})

test("a record of a claimed type shows its screen's chip, its crumb tone and muted detail", async () => {
  const t = await open()
  // Opened from Attention: the chip names Things, the screen the type belongs to.
  await t.nav.open("T-1")
  let frame = await until(t, (f) => line(f, 0).includes("Thing 1"))
  expect(line(frame, 0)).toContain("ttybrain ·  2 Things ▾  › T-1 Thing 1 · Thu 4 Dec · 8 attendees")
  expect(t.nav.route()).toEqual({ kind: "record", screen: "things", ref: "T-1" })
  expect(t.nav.crumb()).toBe("T-1")
  expect(t.nav.crumbs()).toEqual(["T-1"]) // deprecated alias
  expect(line(frame, 2)).toContain("Main") // the tabs, after a blank line
  let spans = await t.spans()
  expect(fgAt(spans, "T-1", 0)).toBe(theme.magenta)
  expect(fgAt(spans, "Thing 1", 0)).toBe(theme.text)
  expect(fgAt(spans, "· Thu 4 Dec", 0)).toBe(theme.muted)
  // A null detail adds nothing.
  await t.nav.open("T-2")
  frame = await until(t, (f) => line(f, 0).includes("Thing 2"))
  expect(line(frame, 0)).toMatch(/› T-2 Thing 2\s+● 2 things/)
  // A type no screen claims keeps the current screen's chip; no crumb tone is the text colour; a throwing detail
  // adds nothing.
  t.input.pressKey("3")
  await until(t, (f) => f.includes("plain screen"))
  await t.nav.open("GD-1")
  frame = await until(t, (f) => line(f, 0).includes("Gadget one"))
  expect(line(frame, 0)).toMatch(/ttybrain · {2}3 Plain ▾ {2}› GD-1 Gadget one\s+● 2 things/)
  spans = await t.spans()
  expect(fgAt(spans, "GD-1", 0)).toBe(theme.text)
  // The badge in its tone.
  expect(fgAt(spans, "● 2 things", 0)).toBe(theme.green)
})

test("a screen's own crumb shows while it is current and no record is open", async () => {
  const t = await open()
  t.input.pressKey("2")
  let frame = await until(t, (f) => line(f, 0).includes("› All"))
  expect(line(frame, 0)).toContain("ttybrain ·  2 Things ▾  › All")
  const spans = await t.spans()
  expect(fgAt(spans, "›", 0)).toBe(theme.muted)
  expect(fgAt(spans, "All", 0)).toBe(theme.text)
  // A record replaces it; back on the screen it is there again.
  await t.nav.open("T-3")
  frame = await until(t, (f) => line(f, 0).includes("Thing 3"))
  expect(line(frame, 0)).not.toContain("All")
  t.input.pressEscape()
  frame = await until(t, (f) => line(f, 0).includes("› All"))
  expect(line(frame, 0)).toContain("2 Things ▾  › All")
  // Another screen has none.
  t.input.pressKey("3")
  frame = await until(t, (f) => f.includes("plain screen"))
  expect(line(frame, 0)).not.toContain("›")
})

test("an exact bar: the screen's hints only, the global actions', and the frame hints it asks for", async () => {
  const t = await open()
  t.input.pressKey("2")
  let frame = await until(t, (f) => f.includes("things screen"))
  expect(line(frame, 19).trim()).toBe("tab panel   w act   ? help   x extra")
  // Without exact: every registered hint, the global actions', then all of the frame's.
  t.input.pressKey("3")
  frame = await until(t, (f) => f.includes("plain screen"))
  expect(line(frame, 19).trim()).toBe("enter open   w act   g or 1-4 screens   ? help   q quit")
  // `globals: false`: no global actions' hints either; the action's key still works.
  t.input.pressKey("4")
  frame = await until(t, (f) => f.includes("bare screen"))
  expect(line(frame, 19).trim()).toBe("n new")
  t.input.pressKey("w")
  frame = await until(t, (f) => f.includes("act overlay"))
  t.input.pressEscape()
  frame = await until(t, (f) => f.includes("bare screen") && !f.includes("act overlay"))
  t.input.pressKey("3")
  frame = await until(t, (f) => f.includes("plain screen"))
  // An overlay's bar is its own.
  t.input.pressKey("w")
  frame = await until(t, (f) => f.includes("act overlay"))
  expect(line(frame, 19).trim()).toBe("")
})

test("a write while a record is open reloads its crumb detail in place: the tail never vanishes", async () => {
  const t = await open(true)
  await t.nav.open("T-1")
  let frame = await until(t, (f) => line(f, 0).includes("· Thu 4 Dec · 8 attendees"))
  expect(line(frame, 0)).toContain("› T-1 Thing 1 · Thu 4 Dec · 8 attendees")
  const before = detailCalls
  // Hold the next detail loads, then write: the refresh reloads them, and until they resolve the last tail stays.
  let release!: () => void
  detailGate = new Promise((r) => (release = r))
  const k = kernel!
  const write = k.runtime("people")!.self().write as Record<string, (input: unknown) => Promise<unknown>>
  await runWithContext(k.context(), () => write.addPerson!({ name: "Ann Example", handle: "ann" }))
  for (let i = 0; i < 50 && detailCalls === before; i++) {
    await new Promise((r) => setTimeout(r, 10))
    await t.peek()
  }
  expect(detailCalls).toBeGreaterThan(before) // the write did reload it
  for (let i = 0; i < 5; i++) {
    expect(line(await t.peek(), 0)).toContain("› T-1 Thing 1 · Thu 4 Dec · 8 attendees")
    await new Promise((r) => setTimeout(r, 10))
  }
  release()
  frame = await t.frame()
  expect(line(frame, 0)).toContain("› T-1 Thing 1 · Thu 4 Dec · 8 attendees")
})
