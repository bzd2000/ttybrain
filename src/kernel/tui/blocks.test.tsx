// The building blocks (Table, Panel, Tabs, RecordView), the Overview panel grid, nav.open routing, global actions
// and header badges, against a fixture plugin `thing` (record type `thing`, prefix `T-`).
import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { bgAt } from "../../../tests/design"
import { definePlugin, type PluginDef } from "../api"
import { onCleanup, onMount } from "solid-js"
import { Menu } from "./components/Menu"
import { Panel } from "./components/Panel"
import { displayWidth } from "./format"
import { theme } from "./theme"
import { Table, type TableRow } from "./components/Table"
import { useRecordForms } from "./overlay"
import { useKeys, useScreenKeys } from "./keys"
import { currentMessage } from "./messages"
import { defineTui, type TuiDef } from "./types"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Records T-1 … T-7, labelled `Thing <n>`; no table needed.
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
        return n >= 1 && n <= 7 ? n : null
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

function MainTab(props: { recordRef: string }) {
  return <text>{`main of ${props.recordRef}`}</text>
}
function NotesTab(props: { recordRef: string }) {
  return <text>{`notes of ${props.recordRef}`}</text>
}
function FixtureOverlay(props: { close(): void }) {
  useKeys()
  useScreenKeys((key) => {
    key.preventDefault()
    if (key.name === "escape") props.close()
  })
  return <text>fixture overlay</text>
}

const thingPart: TuiDef = defineTui({
  plugin: "thing",
  activate: (ui) => {
    ui.overviewPanel({
      id: "p1",
      title: "P1",
      priority: 20,
      empty: "Nothing in P1.",
      load: async () => [1, 2, 3, 4, 5, 6, 7].map((n) => ({ ref: `T-${n}`, cells: [{ text: `T-${n}` }, { text: `row ${n}` }] })),
    })
    ui.overviewPanel({ id: "p0", title: "P0", priority: 10, empty: "Nothing here.", load: async () => [] })
    ui.recordTab("thing", { id: "main", title: "Main", order: 1, count: async () => 3, component: MainTab })
    ui.recordTab("thing", { id: "notes", title: "Notes", order: 2, component: NotesTab })
    ui.globalAction({ id: "fixture", key: "w", label: "Fixture", overlay: FixtureOverlay })
    ui.statusBadge({ id: "things", order: 1, text: async () => "● 2 things" })
    ui.statusBadge({ id: "none", order: 2, text: async () => null })
  },
})

const screenPart = (component: () => any): TuiDef =>
  defineTui({ plugin: "thing", activate: (ui) => ui.screen({ id: "t", title: "Table", slot: 2, component }) })

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const firstLine = (frame: string) => frame.split("\n")[0]!
const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""

async function escape(t: RenderedTui) {
  t.input.pressEscape()
  await sleep(30) // a lone ESC is flushed by the input parser's timeout
}

describe("TUI blocks", () => {
  test("Table keeps selection by ref across reloads", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const row = (ref: string): TableRow => ({ ref, cells: { ref, title: `title ${ref}` } })
    const [rows, setRows] = createSignal<TableRow[]>(["A-1", "A-2", "A-3"].map(row))
    const columns = [
      { id: "ref", title: "Ref", width: 6 },
      { id: "title", title: "Title", width: "grow" as const },
    ]
    function TableScreen() {
      return <Table columns={columns} rows={rows()} selectedRef="A-2" onOpen={() => {}} focused />
    }
    tui = await renderTui(kernel, {
      parts: [defineTui({ plugin: "thing", activate: (ui) => ui.screen({ id: "t", title: "Table", slot: 2, component: TableScreen }) })],
    })
    tui.input.pressKey("2")
    // The selection is the row background (no marker).
    let spans = await tui.spans()
    expect(bgAt(spans, "A-2")).toBe(theme.selectedBg)
    expect(bgAt(spans, "A-1")).toBe(theme.bg)

    setRows(["A-0", "A-1", "A-2", "A-3"].map(row))
    spans = await tui.spans()
    expect(bgAt(spans, "A-2")).toBe(theme.selectedBg)
    expect(bgAt(spans, "A-1")).toBe(theme.bg)

    setRows(["A-0", "A-1", "A-3"].map(row))
    const frame = await tui.frame()
    expect(frame).not.toContain("A-2")
    spans = await tui.spans()
    expect(bgAt(spans, "A-3")).toBe(theme.selectedBg)

    tui.input.pressKey("k")
    spans = await tui.spans()
    expect(bgAt(spans, "A-1")).toBe(theme.selectedBg)
    expect(bgAt(spans, "A-3")).toBe(theme.bg)
  })

  test("Table truncates by display width", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    function TableScreen() {
      return (
        <Table
          columns={[{ id: "name", title: "Name", width: 10 }]}
          rows={[{ ref: "T-1", cells: { name: "名前名前名前" } }]}
          onOpen={() => {}}
          focused
        />
      )
    }
    tui = await renderTui(kernel, {
      parts: [defineTui({ plugin: "thing", activate: (ui) => ui.screen({ id: "t", title: "Table", slot: 2, component: TableScreen }) })],
    })
    tui.input.pressKey("2")
    const frame = await tui.frame()
    expect(frame).toContain("名前名前…")
    expect(frame).not.toContain("名前名前名")
  })

  test("Table truncates a grow column with … at 80x24", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const long = "名".repeat(60)
    function TableScreen() {
      return (
        <Table
          columns={[
            { id: "ref", title: "Ref", width: 5 },
            { id: "name", title: "Name", width: "grow" },
          ]}
          rows={[{ ref: "T-1", cells: { ref: "T-1", name: long } }]}
          focused
        />
      )
    }
    tui = await renderTui(kernel, { width: 80, height: 24, parts: [screenPart(TableScreen)] })
    tui.input.pressKey("2")
    const frame = await tui.frame()
    const line = lineWith(frame, "T-1").trimEnd()
    expect(line.endsWith("名…")).toBe(true)
    expect(line).not.toContain("...")
    for (const l of frame.split("\n")) expect(displayWidth(l)).toBeLessThanOrEqual(80)
  })

  test("Table scrolls to keep the selected row in view", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const rows = Array.from({ length: 40 }, (_, i) => ({ ref: `T-${i + 1}`, cells: { ref: `T-${i + 1}`, title: `title ${i + 1}` } }))
    function TableScreen() {
      return (
        <Table
          columns={[
            { id: "ref", title: "Ref", width: 5 },
            { id: "title", title: "Title", width: "grow" },
          ]}
          rows={rows}
          focused
        />
      )
    }
    tui = await renderTui(kernel, { width: 80, height: 24, parts: [screenPart(TableScreen)] })
    tui.input.pressKey("2")
    expect(bgAt(await tui.spans(), "T-1 ")).toBe(theme.selectedBg)
    for (let i = 0; i < 29; i++) tui.input.pressKey("j")
    let frame = await tui.frame()
    expect(frame).toContain("T-30 ")
    expect(bgAt(await tui.spans(), "T-30 ")).toBe(theme.selectedBg)
    expect(lineWith(frame, "Ref")).toContain("Title")
    for (let i = 0; i < 29; i++) tui.input.pressKey("k")
    frame = await tui.frame()
    expect(bgAt(await tui.spans(), "T-1 ")).toBe(theme.selectedBg)
    expect(frame).not.toContain("T-30")
  })

  test("Table leaves keys to a focused text field", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const opened: string[] = []
    function FilterScreen() {
      const keys = useKeys()
      onMount(() => keys.textFocus(true))
      onCleanup(() => keys.textFocus(false))
      return (
        <box flexDirection="column">
          <input width={20} focused={keys.active()} />
          <Table
            columns={[{ id: "ref", title: "Ref", width: 5 }]}
            rows={["A-1", "A-2", "A-3"].map((ref) => ({ ref, cells: { ref } }))}
            onOpen={(ref) => opened.push(ref)}
            focused
          />
        </box>
      )
    }
    tui = await renderTui(kernel, { parts: [screenPart(FilterScreen)] })
    tui.input.pressKey("2")
    expect(bgAt(await tui.spans(), "A-1")).toBe(theme.selectedBg)
    await tui.input.typeText("jk")
    tui.input.pressEnter()
    const frame = await tui.frame()
    expect(frame).toContain("jk")
    expect(bgAt(await tui.spans(), "A-1")).toBe(theme.selectedBg)
    expect(opened).toEqual([])
  })

  test("Table renders group headers and a plugin's list columns", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    function TableScreen() {
      return (
        <Table
          columns={[{ id: "ref", title: "Ref", width: 5 }]}
          groups={[
            { title: "Open", rows: [{ ref: "T-1", cells: { ref: "T-1" } }, { ref: "T-2", cells: { ref: "T-2" } }] },
            { title: "Done", rows: [{ ref: "T-3", cells: { ref: "T-3" } }] },
          ]}
          listId="things"
          focused
        />
      )
    }
    const part = defineTui({
      plugin: "thing",
      activate: (ui) => {
        ui.screen({ id: "t", title: "Table", slot: 2, component: TableScreen })
        ui.listColumn("things", { id: "size", title: "Size", width: 6, value: async (ref) => (ref === "T-2" ? null : `big ${ref.slice(2)}`) })
      },
    })
    tui = await renderTui(kernel, { parts: [part] })
    tui.input.pressKey("2")
    const frame = await tui.frame()
    expect(frame).toContain("Open · 2")
    expect(frame).toContain("Done · 1")
    expect(frame.indexOf("Open · 2")).toBeLessThan(frame.indexOf("T-1"))
    expect(frame.indexOf("T-2")).toBeLessThan(frame.indexOf("Done · 1"))
    expect(lineWith(frame, "Ref")).toContain("Size")
    expect(lineWith(frame, "T-1")).toMatch(/^T-1   big 1/)
    expect(lineWith(frame, "T-3")).toMatch(/^T-3   big 3/)
    expect(bgAt(await tui.spans(), "T-1")).toBe(theme.selectedBg)
  })

  test("Table group without a title has no header line", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    function TableScreen() {
      return (
        <Table
          columns={[{ id: "ref", title: "Ref", width: 5 }]}
          groups={[
            { rows: [{ ref: "T-1", cells: { ref: "T-1" } }] },
            { title: "Done", rows: [{ ref: "T-3", cells: { ref: "T-3" } }] },
          ]}
          focused
        />
      )
    }
    tui = await renderTui(kernel, { parts: [screenPart(TableScreen)] })
    tui.input.pressKey("2")
    const frame = await tui.frame()
    const at = (s: string) => frame.split("\n").findIndex((l) => l.includes(s))
    expect(at("T-1")).toBe(at("Ref") + 1)
    expect(at("Done · 1")).toBe(at("T-1") + 1)
    expect(frame).not.toContain("undefined")
  })

  test("Table group with space has a blank line above its header, except as the first line", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const [first, setFirst] = createSignal(true)
    function TableScreen() {
      return (
        <Table
          columns={[{ id: "ref", title: "Ref", width: 5 }]}
          groups={[
            { rows: first() ? [{ ref: "T-1", cells: { ref: "T-1" } }] : [] },
            { title: "Next", count: false, space: true, rows: [{ ref: "T-3", cells: { ref: "T-3" } }] },
          ]}
          header={false}
          focused
        />
      )
    }
    tui = await renderTui(kernel, { parts: [screenPart(TableScreen)] })
    tui.input.pressKey("2")
    let frame = await tui.frame()
    const at = (s: string) => frame.split("\n").findIndex((l) => l.includes(s))
    expect(at("Next")).toBe(at("T-1") + 2)
    expect(frame.split("\n")[at("T-1") + 1]!.trim()).toBe("")
    expect(at("T-3")).toBe(at("Next") + 1)
    setFirst(false)
    frame = await tui.frame()
    expect(at("Next")).toBe(1)
  })

  test("Table row detail line sits under its row and is not selectable", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    function TableScreen() {
      return (
        <Table
          columns={[
            { id: "ref", title: "Ref", width: 5 },
            { id: "title", title: "Title", width: "grow" },
          ]}
          groups={[
            { title: "Open", rows: [{ ref: "T-1", cells: { ref: "T-1", title: "one" } }] },
            {
              title: "Done lately",
              count: false,
              rows: [
                { ref: "T-2", cells: { ref: "T-2", title: "two" }, detail: { text: "✓ done by you", tone: "green" } },
                { ref: "T-3", cells: { ref: "T-3", title: "three" } },
              ],
            },
          ]}
          header={false}
          focused
        />
      )
    }
    tui = await renderTui(kernel, { parts: [screenPart(TableScreen)] })
    tui.input.pressKey("2")
    let frame = await tui.frame()
    const at = (s: string) => frame.split("\n").findIndex((l) => l.includes(s))
    expect(frame).toContain("Open · 1")
    expect(lineWith(frame, "Done lately")).not.toContain("·")
    expect(at("✓ done by you")).toBe(at("T-2") + 1)
    expect(at("T-3")).toBe(at("T-2") + 2)
    // aligned with the second column: the 5-wide ref column, gap
    expect(lineWith(frame, "✓ done by you").indexOf("✓")).toBe(lineWith(frame, "two").indexOf("two"))
    expect(lineWith(frame, "two").indexOf("two")).toBe(6)
    tui.input.pressKey("j")
    expect(bgAt(await tui.spans(), "T-2")).toBe(theme.selectedBg)
    tui.input.pressKey("j")
    const spans = await tui.spans()
    expect(bgAt(spans, "T-3")).toBe(theme.selectedBg)
    // The detail line is never selected.
    expect(bgAt(spans, "✓ done by you")).toBe(theme.bg)
  })

  test("useRecordForms lists a record type's registered forms", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    function NoForm() {
      return <text>form</text>
    }
    function FormsScreen() {
      const forms = useRecordForms("thing")
      const none = useRecordForms("gadget")
      return <text>{`${forms.map((f) => `${f.id}=${f.label}@${f.plugin}`).join(", ")} | ${none.length}`}</text>
    }
    const part = defineTui({
      plugin: "thing",
      activate: (ui) => {
        ui.screen({ id: "t", title: "Forms", slot: 2, component: FormsScreen })
        ui.recordForm("thing", { id: "thing", label: "Thing", component: NoForm })
        ui.recordForm("thing", { id: "quick", label: "Quick thing", component: NoForm })
      },
    })
    tui = await renderTui(kernel, { parts: [part] })
    tui.input.pressKey("2")
    expect(await tui.frame()).toContain("thing=Thing@thing, quick=Quick thing@thing | 0")
  })

  test("Table reports no selection when its rows are gone", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const [rows, setRows] = createSignal<TableRow[]>([{ ref: "A-1", cells: { ref: "A-1" } }])
    const seen: Array<string | undefined> = []
    function TableScreen() {
      return <Table columns={[{ id: "ref", title: "Ref", width: 5 }]} rows={rows()} onSelect={(r) => seen.push(r)} focused />
    }
    tui = await renderTui(kernel, { parts: [screenPart(TableScreen)] })
    tui.input.pressKey("2")
    await tui.frame()
    expect(seen.at(-1)).toBe("A-1")
    setRows([])
    await tui.frame()
    expect(seen.at(-1)).toBeUndefined()
    setRows([{ ref: "A-0", cells: { ref: "A-0" } }, { ref: "A-1", cells: { ref: "A-1" } }])
    await tui.frame()
    expect(seen.at(-1)).toBe("A-1") // the remembered ref comes back with its row
  })

  test("Table leaves a key its screen claimed", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const opened: string[] = []
    let claimed = 0
    function ClaimScreen() {
      useScreenKeys((key) => {
        if (key.name !== "return") return
        claimed++
        key.preventDefault()
      })
      return <Table columns={[{ id: "ref", title: "Ref", width: 5 }]} rows={[{ ref: "A-1", cells: { ref: "A-1" } }]} onOpen={(ref) => opened.push(ref)} focused />
    }
    tui = await renderTui(kernel, { parts: [screenPart(ClaimScreen)] })
    tui.input.pressKey("2")
    await tui.frame()
    tui.input.pressEnter()
    await tui.frame()
    expect(claimed).toBe(1)
    expect(opened).toEqual([])
  })

  test("Panel with grow bounds its Table, which scrolls", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const rows = Array.from({ length: 40 }, (_, i) => ({ ref: `T-${i + 1}`, cells: { ref: `T-${i + 1}` } }))
    function PanelScreen() {
      return (
        <Panel title="Things" grow focused>
          <Table columns={[{ id: "ref", title: "Ref", width: 5 }]} rows={rows} focused />
        </Panel>
      )
    }
    tui = await renderTui(kernel, { width: 80, height: 24, parts: [screenPart(PanelScreen)] })
    tui.input.pressKey("2")
    let frame = await tui.frame()
    // The panel's bottom border shows above the status bar: the panel did not grow past the screen.
    const all = frame.trimEnd().split("\n")
    expect(all.at(-2)).toMatch(/^╰─+╯\s*$/)
    for (let i = 0; i < 39; i++) tui.input.pressKey("j")
    frame = await tui.frame()
    expect(frame).toContain("T-40 ")
    expect(bgAt(await tui.spans(), "T-40 ")).toBe(theme.selectedBg)
    expect(frame).not.toContain("T-1 ")
  })

  test("Overview shows panels in priority order with counts and +more", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    tui = await renderTui(kernel, { parts: [thingPart] })
    const frame = await tui.frame()
    expect(frame).toContain("P0")
    expect(frame).toContain("Nothing here.")
    expect(frame).toContain("P1 · 7")
    expect(frame.indexOf("P0")).toBeLessThan(frame.indexOf("P1 · 7"))
    for (const n of [1, 2, 3, 4, 5]) expect(frame).toContain(`row ${n}`)
    expect(frame).not.toContain("row 6")
    expect(frame).toContain("+2 more")
    expect(frame).not.toContain("Nothing in P1.")
  })

  for (const how of ["throws", "rejects"] as const) {
    test(`a panel whose load ${how} shows its error in place, and the other panels still show`, async () => {
      const brokenPart: TuiDef = defineTui({
        plugin: "thing",
        activate: (ui) => {
          ui.overviewPanel({ id: "ok", title: "Fine", priority: 10, empty: "Nothing.", load: async () => [{ ref: "T-1", cells: [{ text: "fine row" }] }] })
          ui.overviewPanel({
            id: "bad",
            title: "Broken",
            priority: 20,
            empty: "Nothing.",
            load: how === "throws" ? () => { throw new Error("kaboom") } : async () => { throw new Error("kaboom") },
          })
        },
      })
      kernel = await makeTestKernel({ plugins: [thingPlugin] })
      tui = await renderTui(kernel, { parts: [brokenPart] })
      const frame = await tui.frame()
      expect(frame).toContain("fine row")
      expect(frame).toContain("Broken")
      expect(lineWith(frame, "kaboom")).toContain("⚠ kaboom")
      expect(frame).not.toContain("Overview: kaboom")
    })
  }

  test("Enter on a panel row opens the record view", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    tui = await renderTui(kernel, { parts: [thingPart] })
    expect(await tui.frame()).toContain("P1 · 7")
    tui.input.pressTab()
    await tui.settle()
    tui.input.pressEnter()
    let frame = await tui.frame()
    expect(tui.nav.route()).toEqual({ kind: "record", screen: "overview", ref: "T-1" })
    expect(frame).toContain("› T-1 Thing 1")
    expect(frame).toContain("Main 3")
    expect(frame).toContain("Notes")
    expect(frame).toContain("main of T-1")
    const status = frame.trimEnd().split("\n").at(-1)!
    expect(status).toContain("←→ tabs")
    expect(status).toContain("esc back")

    tui.input.pressArrow("right")
    frame = await tui.frame()
    expect(frame).toContain("notes of T-1")
    expect(frame).not.toContain("main of T-1")
    tui.input.pressArrow("left")
    expect(await tui.frame()).toContain("main of T-1")

    await escape(tui)
    frame = await tui.frame()
    expect(tui.nav.route()).toEqual({ kind: "screen", screen: "overview" })
    expect(frame).toContain("P1 · 7")
    expect(frame).not.toContain("main of T-1")
  })

  test("a tab whose when resolves false is left out, a throwing when keeps it", async () => {
    // `later` resolves T-1's check only when the test says so: until then only the tabs without `when` show.
    let release: (v: boolean) => void = () => {}
    const later = new Promise<boolean>((r) => (release = r))
    const asked: string[] = []
    const part: TuiDef = defineTui({
      plugin: "thing",
      activate: (ui) => {
        ui.recordTab("thing", { id: "main", title: "Main", order: 1, component: MainTab })
        ui.recordTab("thing", {
          id: "odd",
          title: "Odd",
          order: 2,
          when: async (ref) => (ref === "T-1" ? later : Number(ref.slice(2)) % 2 === 1),
          component: () => <text>odd tab</text>,
        })
        ui.recordTab("thing", {
          id: "broken",
          title: "Broken",
          order: 3,
          when: async (ref) => {
            asked.push(ref)
            throw new Error("no idea")
          },
          component: () => <text>broken tab</text>,
        })
        ui.recordTab("thing", { id: "notes", title: "Notes", order: 4, component: NotesTab })
      },
    })
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    tui = await renderTui(kernel, { parts: [part] })

    await tui.nav.open("T-1")
    let frame = await tui.peek() // the load waits on `later`
    expect(lineWith(frame, "Main")).toContain("Notes")
    expect(frame).not.toContain("Odd")
    expect(frame).not.toContain("Broken")
    release(true)
    await tui.settle()
    frame = await tui.frame()
    expect(lineWith(frame, "Main")).toMatch(/Main.*Odd.*Broken.*Notes/)
    await escape(tui)

    // T-2: Odd resolves false and is left out; a route naming it falls back to the first tab.
    await tui.nav.open("T-2", "odd")
    await tui.settle()
    frame = await tui.frame()
    expect(frame).toContain("› T-2 Thing 2")
    expect(lineWith(frame, "Main")).toMatch(/Main.*Broken.*Notes/)
    expect(frame).not.toContain("Odd")
    expect(frame).toContain("main of T-2")
    expect(frame).not.toContain("odd tab")
    // ← → go through the shown tabs only.
    tui.input.pressArrow("right")
    expect(await tui.frame()).toContain("broken tab")
    expect(asked).toEqual(["T-1", "T-2"])
  })

  test("a count that throws hides neither its tab nor a when tab", async () => {
    const part: TuiDef = defineTui({
      plugin: "thing",
      activate: (ui) => {
        ui.recordTab("thing", {
          id: "main",
          title: "Main",
          order: 1,
          count: async () => {
            throw new Error("no count")
          },
          component: MainTab,
        })
        ui.recordTab("thing", { id: "extra", title: "Extra", order: 2, count: async () => 4, when: async () => true, component: NotesTab })
      },
    })
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    tui = await renderTui(kernel, { parts: [part] })
    await tui.nav.open("T-1")
    const frame = await tui.frame()
    expect(lineWith(frame, "Main")).toMatch(/Main\s+Extra 4/)
    expect(frame).toContain("main of T-1")
  })

  test("a tab taller than the screen scrolls inside the tab and keeps the breadcrumb", async () => {
    const tall = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n")
    const part: TuiDef = defineTui({
      plugin: "thing",
      activate: (ui) => {
        ui.recordTab("thing", {
          id: "tall",
          title: "Tall",
          order: 1,
          component: () => (
            <box flexDirection="column" flexGrow={1}>
              <scrollbox flexGrow={1} minHeight={0}>
                <text>{tall}</text>
              </scrollbox>
            </box>
          ),
        })
      },
    })
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    tui = await renderTui(kernel, { parts: [part], width: 80, height: 24 })
    await tui.nav.open("T-1")
    await tui.settle()
    const frame = await tui.frame()
    expect(frame).toContain("line 1")
    expect(frame).toContain("› T-1 Thing 1")
  })

  test("a reload keeps the active tab's component mounted", async () => {
    let mounts = 0
    let loads = 0
    const part: TuiDef = defineTui({
      plugin: "thing",
      activate: (ui) => {
        ui.recordTab("thing", {
          id: "main",
          title: "Main",
          order: 1,
          count: async () => ++loads,
          component: () => {
            onMount(() => void mounts++)
            return <text>mounted tab</text>
          },
        })
      },
    })
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    tui = await renderTui(kernel, { parts: [part] })
    await tui.nav.open("T-1")
    expect(await tui.frame()).toContain("mounted tab")
    const before = loads
    kernel.events.emit("record.changed", { ref: "T-1" })
    await tui.settle()
    expect(lineWith(await tui.frame(), "Main")).not.toContain(`Main ${before} `)
    expect(loads).toBeGreaterThan(before)
    expect(mounts).toBe(1)
  })

  test("nav.open shows the label without tabs or forms, and an error for an unknown ref", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    tui = await renderTui(kernel, { parts: [thingPart] })
    await tui.nav.open("GD-1")
    expect(currentMessage()).toEqual({ text: "GD-1: Gadget one", kind: "info" })
    expect(tui.nav.route()).toEqual({ kind: "screen", screen: "overview" })
    await tui.nav.open("T-99")
    expect(currentMessage()).toEqual({ text: "no record T-99", kind: "error" })
    await tui.nav.open("ZZ-1")
    expect(currentMessage()).toEqual({ text: "no record ZZ-1", kind: "error" })
    expect(tui.nav.route()).toEqual({ kind: "screen", screen: "overview" })
  })

  test("global action opens its overlay", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    tui = await renderTui(kernel, { parts: [thingPart] })
    expect(await tui.frame()).not.toContain("fixture overlay")
    tui.input.pressKey("w")
    expect(await tui.frame()).toContain("fixture overlay")
    // Its own keys take over: Tab does not move the Overview's focus underneath.
    tui.input.pressTab()
    await escape(tui)
    const frame = await tui.frame()
    expect(frame).not.toContain("fixture overlay")
    tui.input.pressEnter()
    await tui.settle()
    expect(tui.nav.route()).toEqual({ kind: "screen", screen: "overview" })
  })

  test("Menu runs an item by its key or by Enter, and closes", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const ran: string[] = []
    const MenuOverlay = (props: { close(): void }) => (
      <Menu
        title="Do"
        close={props.close}
        items={[
          { key: "a", label: "Alpha", run: () => ran.push("alpha") },
          { key: "b", label: "Beta", run: () => ran.push("beta") },
        ]}
      />
    )
    const part = defineTui({ plugin: "thing", activate: (ui) => ui.globalAction({ id: "menu", key: "m", label: "Menu", overlay: MenuOverlay }) })
    tui = await renderTui(kernel, { parts: [part] })
    tui.input.pressKey("m")
    expect(await tui.frame()).toContain("Beta")
    tui.input.pressKey("b")
    expect(await tui.frame()).not.toContain("Beta")
    tui.input.pressKey("m")
    await tui.settle()
    tui.input.pressKey("j")
    tui.input.pressKey("k")
    await tui.settle()
    tui.input.pressEnter()
    expect(await tui.frame()).not.toContain("Alpha")
    expect(ran).toEqual(["beta", "alpha"])
  })

  test("badge renders in header", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    tui = await renderTui(kernel, { parts: [thingPart] })
    const line = firstLine(await tui.frame())
    expect(line).toContain("● 2 things")
    expect(line).toContain("Fri 13 Nov 2026")
    expect(line.indexOf("● 2 things")).toBeLessThan(line.indexOf("Fri 13 Nov 2026"))
  })
})
