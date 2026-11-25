// Form drop-downs (an enum field, a text field with `choices`, a record field's candidates) and the date field's
// arrows, against a fixture plugin `pick` (record type `pickthing`, no data of its own) with the built-ins.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { builtinPlugins } from "../../../tests/builtins"
import { bgAt, fgAt } from "../../../tests/design"
import { definePlugin, type PluginDef } from "../api"
import { runWithContext } from "../context"
import { Form, type FieldSpec } from "./components/Form"
import { useOverlay, type Overlay } from "./overlay"
import { theme } from "./theme"
import { defineTui, type RecordFormProps, type TuiDef } from "./types"

const pickPlugin: PluginDef = definePlugin({
  id: "pick",
  name: "Pick",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.recordType({ name: "pickthing", prefix: "PK-", resolve: async () => null, label: async () => "", search: async () => [] })
  },
})

let submitted: Array<Record<string, string | null>> = []
const form = (title: string, fields: FieldSpec[]) => (props: RecordFormProps) => (
  <Form
    title={title}
    fields={fields}
    submit={async (v) => {
      submitted.push(v)
      return { ok: true }
    }}
    close={props.close}
  />
)

const PICK_FIELDS: FieldSpec[] = [
  { name: "kind", label: "Kind", kind: "enum", values: ["one_on_one", "project", "board"], labels: { one_on_one: "1:1" }, required: true },
  { name: "health", label: "Health", kind: "enum", values: ["green", "amber", "red"] },
  { name: "owner", label: "Owner", kind: "record", recordType: "person" },
  {
    name: "every",
    label: "Every",
    kind: "text",
    choices: (v) => [{ value: "alpha" }, { value: `beta ${v.kind ?? ""}`.trim(), label: "Beta!" }],
    custom: "custom…",
  },
  { name: "title", label: "Title", kind: "text" },
]
// Many fields, the enum last: at 80×24 its list has no room below.
const LOW_FIELDS: FieldSpec[] = [
  ...Array.from({ length: 12 }, (_, i): FieldSpec => ({ name: `f${i}`, label: `Field ${i}`, kind: "text" })),
  { name: "size", label: "Size", kind: "enum", values: ["xs", "s", "m", "l", "xl", "xxl"], required: true },
]
const DATE_FIELDS: FieldSpec[] = [{ name: "due", label: "Due", kind: "date" }]

let overlay: Overlay | undefined
function Home() {
  overlay = useOverlay()
  return <text>pick screen</text>
}
const pickPart: TuiDef = defineTui({
  plugin: "pick",
  activate: (ui) => {
    ui.screen({ id: "pick", title: "Pick", component: Home })
    ui.recordForm("pickthing", { id: "pick", label: "Pick", component: form("Pick", PICK_FIELDS) })
    ui.recordForm("pickthing", { id: "low", label: "Low", component: form("Low", LOW_FIELDS) })
    ui.recordForm("pickthing", { id: "date", label: "Date", component: form("Date", DATE_FIELDS) })
  },
})

let kernel: TestKernel
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  overlay = undefined
  submitted = []
  await kernel.cleanup()
})

async function open(formId: string, size: { width?: number; height?: number } = {}): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: [...builtinPlugins, pickPlugin] })
  await runWithContext(kernel.context(), async () => {
    await kernel.runtime("people")!.self().write.addPerson!({ name: "Anna Peeters", handle: "anna" })
    await kernel.runtime("people")!.self().write.addPerson!({ name: "Bob Stone", handle: "bob" })
  })
  tui = await renderTui(kernel, { external: [pickPart], ...size })
  await tui.settle()
  tui.input.pressKey("8") // external screens start at 8 (7 is Boards)
  await until(tui, (f) => f.includes("pick screen"))
  void overlay!.openForm("pickthing", formId)
  await until(tui, (f) => f.includes("ctrl+s save · esc cancel"))
  return tui
}

async function until(t: RenderedTui, ok: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 50 && !ok(frame); i++) {
    await new Promise((r) => setTimeout(r, 20))
    frame = await t.frame()
  }
  return frame
}

const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const rowOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))
const statusLine = (frame: string) => frame.trimEnd().split("\n").at(-1)!
// The list's rows: those between its `╭` and `╰` (the form's own border is further left), their text only.
const listRows = (frame: string): string[] => {
  const ls = lines(frame)
  const formLeft = ls.find((l) => l.includes("╭─ "))!.indexOf("╭")
  const top = ls.findIndex((l) => l.indexOf("╭", formLeft + 1) > formLeft)
  if (top < 0) return []
  const x = ls[top]!.indexOf("╭", formLeft + 1)
  const out: string[] = []
  for (let i = top + 1; i < ls.length && ls[i]![x] === "│"; i++) out.push(ls[i]!.slice(x + 1, ls[i]!.indexOf("│", x + 1)).trim())
  return out
}

describe("form drop-downs", () => {
  test("enum: Enter opens the values (labels) under the field, the current one selected; ↓ moves, Enter picks", async () => {
    const t = await open("pick")
    let frame = await t.frame()
    expect(listRows(frame)).toEqual([])
    t.input.pressEnter()
    frame = await until(t, (f) => listRows(f).length > 0)
    expect(listRows(frame)).toEqual(["1:1", "project", "board"])
    expect(rowOf(frame, " project ")).toBe(rowOf(frame, "Kind") + 3) // under the field, after the list's border
    const spans = await t.spans()
    expect(bgAt(spans, "1:1 ", rowOf(frame, "Kind") + 2)).toBe(theme.selectedBg)
    t.input.pressArrow("down")
    t.input.pressArrow("down")
    t.input.pressEnter()
    frame = await until(t, (f) => listRows(f).length === 0)
    expect(lineWith(frame, "Kind")).toMatch(/Kind +board \(1:1 · project\)/)
    t.input.pressKey("s", { ctrl: true })
    await t.settle()
    expect(submitted[0]?.kind).toBe("board")
  })

  test("enum: Esc closes the list without change and keeps the form open; ←→ still cycle", async () => {
    const t = await open("pick")
    t.input.pressEnter()
    await until(t, (f) => listRows(f).length > 0)
    t.input.pressArrow("down")
    t.input.pressEscape()
    let frame = await until(t, (f) => listRows(f).length === 0)
    await new Promise((r) => setTimeout(r, 100)) // past the Esc window: the form stays
    frame = await t.frame()
    expect(frame).toContain("╭─ Pick ")
    expect(lineWith(frame, "Kind")).toMatch(/Kind +1:1 \(project · board\)/)
    t.input.pressArrow("right")
    frame = await until(t, (f) => /Kind +project/.test(f))
    expect(lineWith(frame, "Kind")).toMatch(/Kind +project \(1:1 · board\)/)
    // The list's Esc arms nothing: a key right after it is the field's (here ↓ in the list again, then Esc, then a
    // second Esc cancels the form as usual).
    t.input.pressEnter()
    await until(t, (f) => listRows(f).length > 0)
    t.input.pressArrow("down")
    t.input.pressEscape()
    t.input.pressArrow("left")
    frame = await until(t, (f) => /Kind +1:1/.test(f))
    expect(lineWith(frame, "Kind")).toMatch(/Kind +1:1 \(project · board\)/) // the ← cycled back: not taken by an Esc chord
    expect(frame).toContain("╭─ Pick ")
    t.input.pressEscape()
    frame = await until(t, (f) => !f.includes("╭─ Pick "))
    expect(frame).not.toContain("╭─ Pick ")
    expect(submitted).toEqual([])
  })

  test("enum: a letter jumps to the first value starting with it; one that is not required has an empty choice", async () => {
    const t = await open("pick")
    t.input.pressEnter()
    await until(t, (f) => listRows(f).length > 0)
    await t.input.typeText("b")
    t.input.pressEnter()
    let frame = await until(t, (f) => listRows(f).length === 0)
    expect(lineWith(frame, "Kind")).toMatch(/Kind +board/)
    t.input.pressTab()
    t.input.pressEnter()
    frame = await until(t, (f) => listRows(f).length > 0)
    expect(listRows(frame)).toEqual(["—", "green", "amber", "red"])
    await t.input.typeText("r")
    t.input.pressEnter()
    await until(t, (f) => listRows(f).length === 0)
    t.input.pressKey("s", { ctrl: true })
    await t.settle()
    expect(submitted[0]).toMatchObject({ kind: "board", health: "red" })
  })

  test("Ctrl+S with the list open closes it without picking and saves the current value", async () => {
    const t = await open("pick")
    t.input.pressEnter()
    await until(t, (f) => listRows(f).length > 0)
    t.input.pressArrow("down")
    t.input.pressKey("s", { ctrl: true })
    await t.settle()
    expect(submitted).toEqual([{ kind: "one_on_one", health: null, owner: null, every: null, title: null }])
  })

  test("record: Enter lists the candidates, typing narrows them, Enter picks", async () => {
    const t = await open("pick")
    t.input.pressTab()
    t.input.pressTab()
    t.input.pressEnter()
    let frame = await until(t, (f) => listRows(f).length > 1)
    expect(listRows(frame)).toEqual(["@anna Anna Peeters", "@bob Bob Stone"])
    await t.input.typeText("bo")
    frame = await until(t, (f) => listRows(f).length === 1)
    expect(listRows(frame)).toEqual(["@bob Bob Stone"])
    t.input.pressEnter()
    frame = await until(t, (f) => listRows(f).length === 0)
    expect(lineWith(frame, "Owner")).toContain("@bob")
    t.input.pressKey("s", { ctrl: true })
    await t.settle()
    expect(submitted[0]?.owner).toBe("@bob")
  })

  test("choices: Enter lists the field's choices from the form's values; custom… closes the list to type", async () => {
    const t = await open("pick")
    for (let i = 0; i < 3; i++) t.input.pressTab()
    t.input.pressEnter()
    let frame = await until(t, (f) => listRows(f).length > 0)
    expect(listRows(frame)).toEqual(["alpha", "Beta!", "custom…"])
    t.input.pressArrow("down")
    t.input.pressEnter()
    frame = await until(t, (f) => listRows(f).length === 0)
    expect(lineWith(frame, "Every")).toContain("beta one_on_one")
    // custom…: the list closes and the value stays, to be typed on.
    t.input.pressEnter()
    await until(t, (f) => listRows(f).length > 0)
    await t.input.typeText("c")
    t.input.pressEnter()
    frame = await until(t, (f) => listRows(f).length === 0)
    await t.input.typeText(" x")
    frame = await t.frame()
    expect(lineWith(frame, "Every")).toContain("beta one_on_one x")
    t.input.pressKey("s", { ctrl: true })
    await t.settle()
    expect(submitted[0]?.every).toBe("beta one_on_one x")
  })

  test("80×24, the field near the bottom: the list opens upward, whole, and the form keeps its width", async () => {
    const t = await open("low", { width: 80, height: 24 })
    for (let i = 0; i < 12; i++) t.input.pressTab()
    let frame = await t.frame()
    const border = lineWith(frame, "╭─ Low ")
    const sizeRow = rowOf(frame, "│ Size")
    t.input.pressEnter()
    frame = await until(t, (f) => listRows(f).length > 0)
    expect(listRows(frame)).toEqual(["xs", "s", "m", "l", "xl", "xxl"])
    expect(lines(frame.trimEnd()).length).toBeLessThanOrEqual(24)
    expect(rowOf(frame, " xxl ")).toBeLessThan(sizeRow) // above the field
    expect(lineWith(frame, "╭─ Low ")).toBe(border)
    t.input.pressArrow("up") // from xs: stays
    t.input.pressEnter()
    frame = await until(t, (f) => listRows(f).length === 0)
    expect(lineWith(frame, "╭─ Low ")).toBe(border)
    expect(lineWith(frame, "│ Size")).toContain("xs")
  })

  test("the bar shows the list's keys while it is open", async () => {
    const t = await open("pick")
    t.input.pressEnter()
    const frame = await until(t, (f) => listRows(f).length > 0)
    expect(statusLine(frame).trim()).toBe("↑↓ move   enter pick   esc close   ctrl+s save")
  })
})

describe("date field arrows", () => {
  test("empty: → (or ←, Shift+→) puts today; a date: ←→ a day, Shift+←→ a week", async () => {
    const t = await open("date")
    let frame = await t.frame()
    expect(statusLine(frame)).toContain("←→ day   shift+←→ week")
    t.input.pressArrow("right")
    frame = await until(t, (f) => f.includes("→ 2026-11-13"))
    expect(lineWith(frame, "Due")).toContain("2026-11-13")
    t.input.pressArrow("right")
    await until(t, (f) => f.includes("→ 2026-11-14"))
    t.input.pressArrow("left")
    t.input.pressArrow("left")
    await until(t, (f) => f.includes("→ 2026-11-12"))
    t.input.pressArrow("right", { shift: true })
    await until(t, (f) => f.includes("→ 2026-11-19"))
    t.input.pressArrow("left", { shift: true })
    t.input.pressArrow("left", { shift: true })
    frame = await until(t, (f) => f.includes("→ 2026-11-05"))
    expect(lineWith(frame, "Due")).toContain("→ 2026-11-05")
    t.input.pressKey("s", { ctrl: true })
    await t.settle()
    expect(submitted).toEqual([{ due: "2026-11-05" }])
  })

  test("empty: ← and Shift+→ put today too", async () => {
    const t = await open("date")
    t.input.pressArrow("left")
    await until(t, (f) => f.includes("→ 2026-11-13"))
    for (let i = 0; i < 10; i++) t.input.pressBackspace()
    await until(t, (f) => !f.includes("→ 2026-11-13"))
    t.input.pressArrow("right", { shift: true })
    const frame = await until(t, (f) => f.includes("→ 2026-11-13"))
    expect(lineWith(frame, "Due")).toContain("→ 2026-11-13")
  })

  test("text that is not a date: the arrows move the cursor, so it can be edited", async () => {
    const t = await open("date")
    await t.input.typeText("abc")
    t.input.pressArrow("left")
    await t.input.typeText("X")
    let frame = await until(t, (f) => f.includes("abXc"))
    expect(lineWith(frame, "Due")).toContain("abXc")
    expect(lineWith(frame, "Due")).toContain("invalid date")
    // A date typed by hand shifts like any other.
    t.input.pressArrow("right")
    for (let i = 0; i < 4; i++) t.input.pressBackspace()
    await t.input.typeText("+1d")
    await until(t, (f) => f.includes("→ 2026-11-14"))
    t.input.pressArrow("right")
    frame = await until(t, (f) => f.includes("→ 2026-11-15"))
    expect(lineWith(frame, "Due")).toContain("2026-11-15")
  })

  test("while editing, a muted weekday in front of the date follows it; none for empty or invalid text; same width", async () => {
    const t = await open("date")
    let frame = await t.frame()
    const border = lineWith(frame, "╭─ Date ")
    expect(lineWith(frame, "│ Due")).toMatch(/│ Due +│/) // empty: no weekday
    t.input.pressArrow("right")
    frame = await until(t, (f) => f.includes("→ 2026-11-13"))
    expect(lineWith(frame, "│ Due")).toMatch(/│ Due +Fri  2026-11-13 +→ 2026-11-13/)
    expect(fgAt(await t.spans(), "Fri  2026")).toBe(theme.muted)
    t.input.pressArrow("right")
    frame = await until(t, (f) => f.includes("→ 2026-11-14"))
    expect(lineWith(frame, "│ Due")).toMatch(/│ Due +Sat  2026-11-14/)
    const at = lineWith(frame, "│ Due").indexOf("2026-11-14")
    expect(lineWith(frame, "╭─ Date ")).toBe(border)
    for (let i = 0; i < 10; i++) t.input.pressBackspace()
    await t.input.typeText("zz")
    frame = await until(t, (f) => f.includes("invalid date"))
    // The weekday's column stays, blank: the input does not move.
    expect(lineWith(frame, "│ Due").indexOf("zz")).toBe(at)
    expect(lineWith(frame, "│ Due")).toMatch(/│ Due +zz/)
    expect(lineWith(frame, "╭─ Date ")).toBe(border)
  })
})
