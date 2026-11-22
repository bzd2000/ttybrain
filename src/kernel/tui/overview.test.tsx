// The Attention panels' row options (OverviewPanelDef): a header row of column titles, a note on the bottom border,
// keys on the selected row, a detail block for the selected row (with its own rows and keys, reached with ↓ past the
// last row), and columns that give way on a narrow terminal (`drop`). A fixture plugin `thing` (record type `thing`,
// prefix `T-`; `GD-` gadgets).
import { afterEach, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { fgAt, isSelected } from "../../../tests/design"
import { definePlugin, type PluginDef } from "../api"
import { theme } from "./theme"
import { defineTui, type OverviewPanelDef, type TuiDef } from "./types"

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

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
      resolve: async (ref) => {
        const m = /^(?:GD-)?(\d+)$/i.exec(ref)
        return m ? Number(m[1]) : null
      },
      label: async (id) => `Gadget ${id}`,
      search: async () => [],
    })
  },
})

async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 100 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}
const lines = (frame: string) => frame.split("\n").map((l) => l.trimEnd())
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))
const bar = (frame: string) => lines(frame.trimEnd()).at(-1)!

type Ran = Array<[key: string, ref: string]>

// Things T-1 … T-3 with a header, a note and a `t` key; T-1 and T-2 have gadgets in their detail block (T-2 three,
// one more than fits), T-3 none. A second panel `Other` for Tab.
function part(ran: Ran, extra: Partial<OverviewPanelDef> = {}): TuiDef {
  const gadgets: Record<string, number[]> = { "T-1": [1, 2], "T-2": [3, 4, 5], "T-3": [] }
  return defineTui({
    plugin: "thing",
    activate: (ui) => {
      ui.overviewPanel({
        id: "things",
        title: "Things",
        priority: 10,
        empty: "No things.",
        header: ["Ref", "Name", "Size"],
        note: "r round",
        columns: [5, "grow", { min: 6, max: 6, drop: 1 }],
        keys: [{ key: "t", label: "touch", run: (ref) => void ran.push(["t", ref]) }],
        detail: {
          rows: 2,
          columns: [5, "grow"],
          keys: [{ key: "x", label: "done", run: (ref) => void ran.push(["x", ref]) }],
          load: async (ref) => {
            const ids = gadgets[ref] ?? []
            return ids.length === 0 ? null : { title: `Before ${ref} · gadgets`, rows: ids.map((n) => ({ ref: `GD-${n}`, cells: [{ text: `GD-${n}`, tone: "muted" as const }, { text: `gadget ${n}` }] })) }
          },
        },
        load: async () => [1, 2, 3].map((n) => ({ ref: `T-${n}`, cells: [{ text: `T-${n}`, tone: "muted" as const }, { text: `thing ${n}` }, { text: `size ${n}` }] })),
        ...extra,
      })
      ui.overviewPanel({ id: "other", title: "Other", priority: 20, empty: "Nothing else.", load: async () => [] })
    },
  })
}

test("a panel's header row, its note on the bottom border, and the selected row's detail block", async () => {
  kernel = await makeTestKernel({ plugins: [thingPlugin] })
  tui = await renderTui(kernel, { parts: [part([])], width: 100, height: 30 })
  const frame = await until(tui, (f) => f.includes("Before T-1 · gadgets") && f.includes("gadget 2"))
  const top = indexOf(frame, "Things · 3")
  // Inside the left panel (the text between `│ ` and ` │`).
  const inside = (i: number) => (lines(frame)[i]!.split("│")[1] ?? "").slice(1).trimEnd()
  expect([1, 2, 3, 4, 5, 6, 7, 8].map((d) => inside(top + d))).toEqual([
    "Ref   " + "Name".padEnd(33) + "Size",
    "T-1   " + "thing 1".padEnd(33) + "size 1",
    "T-2   " + "thing 2".padEnd(33) + "size 2",
    "T-3   " + "thing 3".padEnd(33) + "size 3",
    "",
    "Before T-1 · gadgets",
    "GD-1  gadget 1",
    "GD-2  gadget 2",
  ])
  // The note sits on the bottom border, right-aligned; the panel reserved the detail's lines.
  expect(lines(frame)[top + 9]).toMatch(/^ ╰─+ r round ─╯/)
  const spans = await tui.spans()
  expect(fgAt(spans, "Ref", top + 1)).toBe(theme.muted)
  expect(fgAt(spans, "Before T-1", top + 6)).toBe(theme.muted)
  expect(fgAt(spans, "r round", top + 9)).toBe(theme.muted)
  expect(fgAt(spans, "GD-1", top + 7)).toBe(theme.muted)
  expect(isSelected(spans, "thing 1")).toBe(true)
  // The panel's keys and its detail's in the bar, after Tab and Enter; the frame's hints but `q quit`.
  expect(bar(frame)).toBe(" tab panel   enter open   x done   t touch   g screens   ? help")

  // Another row: its detail; none for T-3 (the lines stay reserved), more than fit end in `+N more`.
  tui.input.pressArrow("down")
  let f = await until(tui, (x) => x.includes("Before T-2"))
  expect(lineWith(f, "GD-3")).toContain("gadget 3")
  expect(f).toContain("+2 more")
  expect(f).not.toContain("gadget 4")
  tui.input.pressArrow("down")
  f = await until(tui, (x) => !x.includes("Before T-2"))
  expect(f).not.toContain("Before")
  expect(lines(f)[top + 9]).toMatch(/^ ╰─+ r round ─╯/)
})

test("keys act on the selected row; a detail key does nothing there", async () => {
  const ran: Ran = []
  kernel = await makeTestKernel({ plugins: [thingPlugin] })
  tui = await renderTui(kernel, { parts: [part(ran)], width: 100, height: 30 })
  await until(tui, (f) => f.includes("gadget 2"))
  tui.input.pressArrow("down") // T-2
  await until(tui, (f) => f.includes("Before T-2"))
  tui.input.pressKey("t")
  tui.input.pressKey("x")
  await tui.settle()
  expect(ran).toEqual([["t", "T-2"]])
  // ↓ on the last row, which has no detail, stays there.
  tui.input.pressArrow("down")
  tui.input.pressArrow("down")
  await until(tui, (f) => !f.includes("Before"))
  expect(isSelected(await tui.spans(), "thing 3")).toBe(true)
})

test("↓ past the last row selects in its detail block: the detail's keys and Enter act on that row, ↑ goes back", async () => {
  const ran: Ran = []
  kernel = await makeTestKernel({ plugins: [thingPlugin] })
  const one = part(ran, { load: async () => [{ ref: "T-1", cells: [{ text: "T-1" }, { text: "thing 1" }, { text: "size 1" }] }] })
  tui = await renderTui(kernel, { parts: [one], width: 100, height: 30 })
  await until(tui, (f) => f.includes("gadget 2"))
  tui.input.pressArrow("down")
  await tui.settle()
  let spans = await tui.spans()
  expect(isSelected(spans, "gadget 1")).toBe(true)
  expect(isSelected(spans, "thing 1")).toBe(false)
  tui.input.pressArrow("down")
  await tui.settle()
  expect(isSelected(await tui.spans(), "gadget 2")).toBe(true)
  tui.input.pressKey("x")
  tui.input.pressKey("t") // the panel's keys still act on its selected row
  await tui.settle()
  expect(ran).toEqual([
    ["x", "GD-2"],
    ["t", "T-1"],
  ])
  tui.input.pressArrow("up")
  tui.input.pressArrow("up")
  await tui.settle()
  spans = await tui.spans()
  expect(isSelected(spans, "thing 1")).toBe(true)
  expect(isSelected(spans, "gadget 1")).toBe(false)
  tui.input.pressArrow("down")
  await tui.settle()
  tui.input.pressEnter()
  await tui.settle()
  // Gadgets have no record view: opening one names it in the status bar.
  expect(await until(tui, (f) => f.includes("GD-1: Gadget 1"))).toContain("GD-1: Gadget 1")
})

test("a column with drop gives way on a narrow terminal; the name stays", async () => {
  kernel = await makeTestKernel({ plugins: [thingPlugin] })
  tui = await renderTui(kernel, { parts: [part([], { columns: [5, { min: 20, max: 20 }, { min: 6, max: 6, drop: 1 }] })], width: 70, height: 24 })
  const frame = await until(tui, (f) => f.includes("thing 1") && f.includes("gadget 1"))
  expect(frame).not.toContain("size 1")
  expect(lineWith(frame, "thing 1")).toContain("T-1   thing 1")
  expect(frame).not.toContain("Size")
})
