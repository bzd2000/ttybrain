// The shared components' chrome as the screen designs draw it (docs/superpowers/specs/2026-11-13-pm-screens.html):
// rounded panels with padded titles (muted, accent when focused) and the footer on the bottom border; tables that
// show the selection as a row background only, with toned group rows; tabs whose active label is accent whole;
// the cyan and magenta tones next to the old ones.
import { afterEach, expect, test } from "bun:test"
import { bgAt, fgAt } from "../../../../tests/design"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { definePlugin } from "../../api"
import { theme } from "../theme"
import { defineTui, type TuiDef } from "../types"
import { Panel } from "./Panel"
import { Table, type TableRow } from "./Table"
import { Tabs } from "./Tabs"

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const cols = [
  { id: "id", title: "ID", width: 4 },
  { id: "title", title: "Action", width: "grow" as const },
  { id: "code", title: "Proj.", width: 5 },
  { id: "who", title: "For", width: 15 },
  { id: "due", title: "Due", width: 5 },
]
const overdue: TableRow[] = [
  {
    ref: "A-1",
    cells: { id: { text: "A-1", tone: "muted" }, title: "Send revised budget", code: { text: "CRM", tone: "cyan" }, who: { text: "Peter Janssens", tone: "magenta" }, due: { text: "-3d", tone: "red" } },
  },
  { ref: "A-2", cells: { id: { text: "A-2", tone: "muted" }, title: "Book vendor demo", code: { text: "ERP", tone: "cyan" }, who: "", due: { text: "-2d", tone: "red" } } },
]
const week: TableRow[] = [
  { ref: "A-3", cells: { id: { text: "A-3", tone: "muted" }, title: "Confirm licences", code: { text: "IAM", tone: "cyan" }, who: "", due: { text: "soon", tone: "amber" } } },
  { ref: "A-4", cells: { id: { text: "A-4", tone: "muted" }, title: "Close the loop", code: "", who: "", due: { text: "done", tone: "green" } } },
]
const dueRows: TableRow[] = [1, 2, 3, 4, 5].map((n) => ({ ref: `D-${n}`, cells: { title: `Due thing ${n}` } }))

function ChromeScreen() {
  return (
    <box flexDirection="column" flexGrow={1}>
      <Tabs tabs={[{ id: "o", title: "Overview" }, { id: "m", title: "Milestones", count: 5 }, { id: "d", title: "Deliverables", count: 6 }]} active="m" onChange={() => {}} />
      <box flexDirection="row" flexGrow={1} gap={1}>
        <box flexDirection="column" flexGrow={1} flexBasis={0}>
          <Panel title="Overdue actions" count={3} focused footer="status:open" grow>
            <Table
              columns={cols}
              header={false}
              groups={[
                { title: "Overdue", tone: "red", count: false, rows: overdue },
                { title: "This week", tone: "accent", rows: week },
              ]}
              onOpen={() => {}}
            />
          </Panel>
        </box>
        <box flexDirection="column" flexGrow={1} flexBasis={0}>
          <Panel title="Due this week" count={5} grow>
            <Table columns={[{ id: "title", title: "", width: "grow" }]} header={false} rows={dueRows} focused={false} />
          </Panel>
        </box>
      </box>
    </box>
  )
}

const chromePart: TuiDef = defineTui({
  plugin: "thing",
  activate: (ui) => {
    ui.screen({ id: "chrome", title: "Chrome", slot: 2, component: ChromeScreen })
    ui.overviewPanel({ id: "plain", title: "Projects needing attention", priority: 10, count: false, empty: "None.", load: async () => [{ ref: "X-1", cells: [{ text: "ERP" }] }] })
    ui.overviewPanel({ id: "counted", title: "Late milestones", priority: 20, empty: "None.", load: async () => [{ ref: "X-2", cells: [{ text: "DWH" }] }, { ref: "X-3", cells: [{ text: "CRM" }] }] })
  },
})

const thing = definePlugin({ id: "thing", name: "Thing", version: "1.0.0", apiVersion: 1, activate() {} })

async function open(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: [thing] })
  tui = await renderTui(kernel, { parts: [chromePart], width: 120, height: 20 })
  tui.input.pressKey("2")
  await tui.frame()
  return tui
}

const lines = (frame: string) => frame.split("\n")

test("unfocused panel title is muted with a space each side; focused is accent", async () => {
  const t = await open()
  const frame = await t.frame()
  expect(frame).toContain("╭─ Due this week · 5 ─")
  expect(frame).toContain("╭─ Overdue actions · 3 ─")
  const spans = await t.spans()
  expect(fgAt(spans, "Due this week · 5")).toBe(theme.muted)
  expect(fgAt(spans, "Overdue actions · 3")).toBe(theme.accent)
  // The border itself keeps its colours: accent around the focused panel, the border colour around the other.
  expect(fgAt(spans, "╭─ Overdue")).toBe(theme.borderFocused)
  expect(fgAt(spans, "╭─ Due")).toBe(theme.border)
})

test("panel footer sits on the bottom border, right-aligned, muted", async () => {
  const t = await open()
  const frame = await t.frame()
  const withFooter = lines(frame).filter((l) => l.includes("status:open"))
  expect(withFooter).toHaveLength(1)
  // The left panel's bottom border: `╰──…── status:open ─╯`, then the right panel's plain bottom border.
  expect(withFooter[0]).toMatch(/^╰─+ status:open ─╯ ╰─+╯\s*$/)
  // No footer line inside the panel: the line above the bottom border is the last row or blank panel space.
  const at = lines(frame).indexOf(withFooter[0]!)
  expect(lines(frame)[at - 1]).toMatch(/^│\s+│ │\s+│\s*$/)
  const spans = await t.spans()
  expect(fgAt(spans, "status:open")).toBe(theme.muted)
})

test("borders are rounded", async () => {
  const t = await open()
  const frame = await t.frame()
  for (const corner of ["╭", "╮", "╰", "╯"]) expect(frame).toContain(corner)
  for (const square of ["┌", "┐", "└", "┘"]) expect(frame).not.toContain(square)
})

test("selected row has a background and no › marker", async () => {
  const t = await open()
  const frame = await t.frame()
  // The rows start right after the border and padding: no marker column.
  const row = lines(frame).find((l) => l.includes("Send revised budget"))!
  expect(row).toMatch(/^│ A-1  Send revised budget/)
  expect(row).not.toContain("›")
  expect(lines(frame).find((l) => l.includes("Due thing 1"))).toMatch(/│ Due thing 1/)
  const spans = await t.spans()
  expect(bgAt(spans, "A-1  Send revised budget")).toBe(theme.selectedBg)
  expect(bgAt(spans, "Book vendor demo")).toBe(theme.bg)
  // The unfocused list shows no selection.
  expect(bgAt(spans, "Due thing 1")).toBe(theme.bg)
  // The selection follows ↓, still as a background only.
  t.input.pressArrow("down")
  const moved = await t.spans()
  expect(bgAt(moved, "Book vendor demo")).toBe(theme.selectedBg)
  expect(bgAt(moved, "Send revised budget")).toBe(theme.bg)
})

test("group rows take their tone and optional count", async () => {
  const t = await open()
  const frame = await t.frame()
  const overdueLine = lines(frame).find((l) => l.includes("Overdue") && !l.includes("Overdue actions"))!
  expect(overdueLine).toMatch(/^│ Overdue\s+│/)
  expect(frame).toContain("│ This week · 2 ")
  const spans = await t.spans()
  // "Overdue" then blank row space (not the panel title "Overdue actions").
  expect(fgAt(spans, "Overdue     ")).toBe(theme.red)
  expect(fgAt(spans, "This week · 2")).toBe(theme.accent)
})

test("active tab label is accent including its count", async () => {
  const t = await open()
  const frame = await t.frame()
  expect(frame).toContain(" Milestones 5 ")
  const spans = await t.spans()
  expect(fgAt(spans, "Milestones 5")).toBe(theme.accent)
  expect(fgAt(spans, "5 ")).toBe(theme.accent)
  expect(bgAt(spans, "Milestones 5")).toBe(theme.selectedBg)
  // An inactive tab stays muted, its count too.
  expect(fgAt(spans, "Deliverables 6")).toBe(theme.muted)
  expect(fgAt(spans, "6")).toBe(theme.muted)
})

test("cyan and magenta tones", async () => {
  const t = await open()
  const spans = await t.spans()
  expect(fgAt(spans, "CRM")).toBe(theme.cyan)
  expect(fgAt(spans, "Peter Janssens")).toBe(theme.magenta)
  expect(theme.cyan).toBe("#7dcfff")
  expect(theme.magenta).toBe("#bb9af7")
})

test("old tone values still work", async () => {
  const t = await open()
  const spans = await t.spans()
  expect(fgAt(spans, "-3d")).toBe(theme.red)
  expect(fgAt(spans, "soon")).toBe(theme.amber)
  expect(fgAt(spans, "done")).toBe(theme.green)
  expect(fgAt(spans, "A-1 ")).toBe(theme.muted)
  expect(fgAt(spans, "Book vendor demo")).toBe(theme.text)
})

test("a focused table with rows adds the ↑↓ select hint before Enter open", async () => {
  const t = await open()
  const bar = lines(await t.frame()).find((l) => l.includes("q quit"))!
  expect(bar).toContain("↑↓ select")
  expect(bar.indexOf("↑↓ select")).toBeLessThan(bar.indexOf("Enter open"))
})

test("an overview panel may leave the count out of its title", async () => {
  const t = await open()
  t.input.pressKey("1")
  const frame = await t.frame()
  expect(frame).toContain("╭─ Projects needing attention ─")
  expect(frame).not.toContain("Projects needing attention ·")
  expect(frame).toContain("╭─ Late milestones · 2 ─")
})
