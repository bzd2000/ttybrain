// Every form overlay in the designs' form look (the 2026-11-20 `series` mock, docs/superpowers/specs/
// 2026-11-20-ttybrain-meeting-screens.html): a rounded panel with the title padded on its top border,
// `ctrl+s save · esc cancel` on its bottom border, a muted label column without `›` or `*`, only the focused field
// drawn as an input (the others as read: refs by name, dates as days), and the bar `tab field   ctrl+s save   esc
// cancel`. Seeded with the 2026-11-13 designs' data (today Fri 13 Nov 2026), at 118×36 and 80×24. The forms are
// opened through the overlay (useOverlay().openForm) from a probe screen, as the screens' own keys open them.
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { bgAt, fgAt, seedDesign } from "../design"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"
import { definePlugin } from "../../src/kernel/api"
import { theme } from "../../src/kernel/tui/theme"
import { useOverlay, type Overlay } from "../../src/kernel/tui/overlay"
import { defineTui, type RecordFormProps } from "../../src/kernel/tui/types"

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
let overlay: Overlay | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  overlay = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const probePlugin = definePlugin({ id: "probe", name: "Probe", version: "1.0.0", apiVersion: 1, activate() {} })
function Probe() {
  overlay = useOverlay()
  return <text>probe screen</text>
}
const probePart = defineTui({ plugin: "probe", activate: (ui) => ui.screen({ id: "probe", title: "Probe", component: Probe }) })

async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 150 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

async function start(width: number, height: number): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: [...builtinPlugins, probePlugin], seed: seedDesign })
  tui = await renderTui(kernel, { width, height, external: [probePart] })
  tui.input.pressKey("7")
  await until(tui, (f) => f.includes("probe screen"))
  return tui
}

type Opened = { frame: string; box: string[]; top: number; from: number; to: number }
// Opens a form and waits until its box is drawn whole (top border with the title, bottom border with the footer).
async function openForm(t: RenderedTui, type: string, id: string, props: Omit<RecordFormProps, "close">, title: string | RegExp, ready?: (f: string) => boolean): Promise<Opened> {
  void overlay!.openForm(type, id, props)
  const has = (f: string) => (typeof title === "string" ? f.includes(`─ ${title} ─`) : title.test(f))
  const frame = await until(t, (f) => has(f) && f.includes("ctrl+s save · esc cancel ─╯") && /tab field/.test(f) && (ready?.(f) ?? true))
  const rows = frame.split("\n")
  const top = rows.findIndex((l) => l.includes("╭") && has(l))
  expect(top).toBeGreaterThanOrEqual(0)
  const from = rows[top]!.indexOf("╭")
  const to = rows[top]!.indexOf("╮", from)
  const bottom = rows.findIndex((l, i) => i > top && l.slice(from, to + 1).startsWith("╰"))
  expect(bottom).toBeGreaterThan(top)
  return { frame, box: rows.slice(top, bottom + 1).map((l) => l.slice(from, to + 1)), top, from, to }
}
// The text between `│ ` and ` │`, without trailing spaces.
const inside = (l: string) => (l.startsWith("│") ? l.slice(2, l.lastIndexOf("│")).trimEnd() : l)
// A label marked as the old look did: `› ` before the focused one, `*` after a required one.
const MARKED = /(^|│ )› |\w\* /m
const status = (frame: string) => frame.trimEnd().split("\n").at(-1)!.trim()

// The look's chrome: the padded title, the footer on the bottom border, the label column (each label at the left
// edge, its value `width + 2` cells in), no `›` or `*`, and the bar.
function expectLook(o: Opened, title: string, rows: Array<[label: string, value: string]>, width: number, bar = "tab field   ctrl+s save   esc cancel") {
  expect(o.box[0]).toMatch(new RegExp(`^╭─ ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ─+╮$`))
  expect(o.box.at(-1)).toMatch(/^╰─+ ctrl\+s save · esc cancel ─╯$/)
  const body = o.box.slice(1, -1).map(inside)
  for (const [label, value] of rows) expect(body).toContain(`${label.padEnd(width + 2)}${value}`.trimEnd())
  expect(body.join("\n")).not.toMatch(MARKED)
  expect(status(o.frame)).toBe(bar)
}

test("Edit project in the form look: label column, values as read, one input", async () => {
  const t = await start(118, 36)
  const o = await openForm(t, "project", "project", { recordRef: "#CRM" }, "Edit CRM")
  expectLook(
    o,
    "Edit CRM",
    [
      ["Name", "CRM replatforming"],
      ["Status", "active"],
    ],
    15,
  )
  // Only the focused field (the first) is an input: its value has the input background, the next one does not.
  const spans = await t.spans()
  expect(bgAt(spans, "CRM replatforming", o.top + 1)).toBe(theme.selectedBg)
  expect(fgAt(spans, "Name", o.top + 1)).toBe(theme.muted)
})

test("Edit person, action, milestone and links in the form look", async () => {
  const t = await start(118, 36)
  let o = await openForm(t, "person", "person", { recordRef: "@anna" }, "Edit @anna")
  expectLook(o, "Edit @anna", [["Name", "Anna Peeters"], ["Job title", "Architect"]], 16)
  t.input.pressEscape()
  await until(t, (f) => !f.includes("Edit @anna"))

  o = await openForm(t, "action", "action", { recordRef: "A-1" }, /─ Edit A-1 ─/)
  const action = o.box.slice(1, -1).map(inside)
  expect(action.some((l) => /^Title {2,}\S/.test(l))).toBe(true)
  expectLook(o, "Edit A-1", [], 0)
  t.input.pressEscape()
  await until(t, (f) => !f.includes("Edit A-1"))

  o = await openForm(t, "milestone", "milestone", { recordRef: "MS-1" }, /─ Edit MS-1/)
  // A date reads as its day while not focused.
  expect(o.box.slice(1, -1).map(inside).some((l) => /^Due {2,}\w{3} \d{1,2} \w{3}/.test(l))).toBe(true)
  expect(o.box.at(-1)).toMatch(/ctrl\+s save · esc cancel ─╯$/)
  t.input.pressEscape()
  await until(t, (f) => !f.includes("Edit MS-1"))

  o = await openForm(t, "action", "links", { recordRef: "A-1" }, /─ Links of A-1|─ Links/)
  expect(o.box.at(-1)).toMatch(/ctrl\+s save · esc cancel ─╯$/)
  expect(o.box.slice(1, -1).join("\n")).not.toMatch(MARKED)
  expect(status(o.frame)).toBe("tab field   ctrl+s save   esc cancel")
})

test("New note, talk item and a meeting about a board in the form look", async () => {
  const t = await start(118, 36)
  let o = await openForm(t, "note", "note", { prefill: { person: "@anna" } }, "New note · @anna")
  expect(o.box.at(-1)).toMatch(/ctrl\+s save · esc cancel ─╯$/)
  expect(o.box.slice(1, -1).join("\n")).not.toMatch(MARKED)
  t.input.pressEscape()
  await until(t, (f) => !f.includes("New note"))

  o = await openForm(t, "talk_item", "talk", { prefill: { about: "@anna" } }, "New talk item", (f) => f.includes("Anna Peeters · person"))
  expectLook(o, "New talk item", [["About", "Anna Peeters · person"]], 14)
  t.input.pressEscape()
  await until(t, (f) => !f.includes("New talk item"))

  // No form edits a board itself (`ttybrain meeting board add` makes one): a board's form is its meeting's.
  // About is focused first (an input, as typed); once Tab leaves it, it reads as the board's name and type.
  o = await openForm(t, "meeting", "meeting", { prefill: { about: "#SC" } }, "New meeting")
  expect(o.box[1]).toMatch(/^│ About {2,}#SC +│$/)
  t.input.pressTab()
  const frame = await until(t, (f) => /About {2,}Steering committee · board/.test(f))
  expect(frame).toMatch(/│ About {2,}Steering committee · board +│/)
  expect(o.box.at(-1)).toMatch(/ctrl\+s save · esc cancel ─╯$/)
})

// Every registered form, new and (where one is seeded) edit, opens whole at 80×24: the box inside the terminal,
// the title on its top border, the footer on its bottom border, every label whole.
const EVERY: Array<[type: string, id: string, props: Omit<RecordFormProps, "close">, title: RegExp]> = [
  ["project", "project", {}, /─ New project ─/],
  ["project", "project", { recordRef: "#CRM" }, /─ Edit CRM ─/],
  ["project", "health", { recordRef: "#CRM" }, /─ Health update · CRM ─/],
  ["project", "involvement", { recordRef: "#CRM" }, /─ Add involvement · CRM ─/],
  ["milestone", "milestone", { recordRef: "MS-1" }, /─ Edit MS-1/],
  ["milestone", "milestone", { prefill: { project: "CRM" } }, /─ New milestone/],
  ["deliverable", "deliverable", { prefill: { project: "CRM" } }, /─ New deliverable/],
  ["risk", "risk", { prefill: { project: "CRM" } }, /─ New risk/],
  ["decision", "decision", { prefill: { project: "CRM" } }, /─ New decision/],
  ["person", "person", {}, /─ New person ─/],
  ["person", "person", { recordRef: "@anna" }, /─ Edit @anna ─/],
  ["note", "note", { prefill: { person: "@anna" } }, /─ New note · @anna ─/],
  ["goal", "goal", { prefill: { person: "@anna" } }, /─ New goal · @anna ─/],
  ["action", "action", {}, /─ New action ─/],
  ["action", "action", { recordRef: "A-1" }, /─ Edit A-1 ─/],
  ["action", "due", { recordRef: "A-1" }, /─ Due date of A-1 ─/],
  ["action", "links", { recordRef: "A-1" }, /─ .*A-1.* ─/],
  ["meeting", "meeting", {}, /─ New meeting ─/],
  ["meeting", "meeting", { recordRef: "M-2" }, /─ Edit M-2 ─/],
  ["meeting", "agenda-item", { recordRef: "M-2" }, /─ New agenda item · M-2 ─/],
  ["meeting", "attendees", { recordRef: "M-2" }, /─ Attendees · M-2 ─/],
  ["meeting", "move", { recordRef: "M-2" }, /─ Move Steering committee Q4 · .+ ─/],
  ["series", "series", {}, /─ New recurring meeting ─/],
  ["talk_item", "talk", { prefill: { about: "@anna" } }, /─ New talk item ─/],
  ["inbox_item", "item", {}, /─ Capture to inbox ─/],
]

test("every form opens whole in the form look at 80×24", async () => {
  const t = await start(80, 24)
  for (const [type, id, props, title] of EVERY) {
    const o = await openForm(t, type, id, props, title)
    const where = `${type}/${id} ${JSON.stringify(props)}`
    expect(o.from, where).toBeGreaterThanOrEqual(0)
    expect(o.to, where).toBeLessThan(80)
    expect(o.box.at(-1), where).toMatch(/─ ctrl\+s save · esc cancel ─╯$/)
    const body = o.box.slice(1, -1)
    // Every row inside the box is closed by its border (nothing spills over it), and no label is marked.
    for (const l of body) expect(l, where).toMatch(/^│.*│$/)
    expect(body.join("\n"), where).not.toMatch(MARKED)
    t.input.pressEscape()
    await until(t, (f) => !title.test(f))
  }
}, 60_000)

test("an inline error under a field stays in the value column at 80×24", async () => {
  const t = await start(80, 24)
  const o = await openForm(t, "project", "project", {}, "New project")
  void o
  t.input.pressKey("s", { ctrl: true })
  const frame = await until(t, (f) => f.includes("✗"))
  const rows = frame.split("\n")
  const err = rows.find((l) => l.includes("✗"))!
  const label = rows.find((l) => /│ Code /.test(l)) ?? rows.find((l) => /│ Name /.test(l))!
  // The error starts where the values do.
  const valueAt = label.search(/│ \S+ +\S/) // the label's start
  expect(err.indexOf("✗")).toBeGreaterThan(valueAt + 4)
  expect(err.trimEnd().endsWith("│")).toBe(true)
})
