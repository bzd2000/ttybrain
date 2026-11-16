// The Overview screen (slot 1): the plugins' panels in two columns balanced by height (overviewLayout.ts), Tab
// moving through them in priority order. The screen loads every panel through useQuery, so it knows each one's
// row count and can size them to fit the screen: each panel shows its count in the title, as many rows as fit
// (at most MAX_ROWS) plus `+N more`, or its `empty` text. ↑↓ move within the focused panel and Enter opens the
// selected row's ref.
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useQuery, type Query } from "../data"
import { useKeys, useScreenKeys } from "../keys"
import { useNav } from "../nav"
import type { Registered } from "../registry"
import { PluginScope, useApp } from "../scope"
import { theme } from "../theme"
import type { OverviewPanelDef, OverviewRow } from "../types"
import { KeyHints } from "./KeyHints"
import { layoutOverview, type PanelPlace } from "./overviewLayout"
import { Panel } from "./Panel"
import { fitWidth, Table, type TableColumn, type TableRow } from "./Table"

export { MAX_ROWS } from "./overviewLayout"
const MAX_COLUMN = 16
// The frame's header and status bar.
const FRAME_LINES = 2

type PanelEntry = Registered<OverviewPanelDef>

export function OverviewScreen() {
  const app = useApp()
  const keys = useKeys()
  const dims = useTerminalDimensions()
  const panels = app.registry.panels()
  const queries = panels.map((p) => useQuery(() => p.load()))
  const [focus, setFocus] = createSignal(0)
  useScreenKeys((key) => {
    if (key.name !== "tab" || key.shift || panels.length === 0) return
    key.preventDefault()
    setFocus((i) => (i + 1) % panels.length)
  })
  const places = createMemo(() =>
    layoutOverview(
      panels.map((p, i) => ({ rows: queries[i]!.data()?.length, empty: p.empty, footer: p.footer })),
      dims().height - FRAME_LINES,
      dims().width,
    ),
  )
  // The panel indexes in a column, compared by value so a reload that keeps the layout remounts nothing.
  const column = (c: 0 | 1) => createMemo(() => panels.map((_, i) => i).filter((i) => places()[i]?.column === c), undefined, {
    equals: (a, b) => a.length === b.length && a.every((x, k) => x === b[k]),
  })
  const left = column(0)
  const right = column(1)
  const Column = (props: { indexes: number[] }) => (
    <box flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
      <For each={props.indexes}>
        {(i) => (
          <PluginScope kernel={app.kernel} plugin={panels[i]!.plugin} label={panels[i]!.title}>
            <OverviewPanel def={panels[i]!} query={queries[i]!} place={places()[i]!} focused={keys.active() && focus() === i} />
          </PluginScope>
        )}
      </For>
    </box>
  )
  return (
    <Show when={panels.length > 0} fallback={<text fg={theme.muted}>No panels</text>}>
      <KeyHints
        hints={[
          { key: "Tab", label: "next panel" },
          { key: "↑↓", label: "move" },
          { key: "Enter", label: "open" },
        ]}
      />
      <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} flexGrow={1} minHeight={0} overflow="hidden">
        <Column indexes={left()} />
        <Column indexes={right()} />
      </box>
    </Show>
  )
}

function OverviewPanel(props: { def: PanelEntry; query: Query<OverviewRow[]>; place: PanelPlace; focused: boolean }) {
  const nav = useNav()
  const all = () => props.query.data() ?? []
  const shown = (): TableRow[] =>
    all()
      .slice(0, props.place.rows)
      .map((r: OverviewRow) => ({ ref: r.ref, cells: Object.fromEntries(r.cells.map((c, i) => [`c${i}`, c])) }))
  // The column with the widest text (the last of equals) takes the leftover width; the others fit their rows.
  const columns = (): TableColumn[] => {
    const n = Math.max(0, ...all().map((r) => r.cells.length))
    const natural = Array.from({ length: n }, (_, i) => fitWidth(shown(), `c${i}`, "", Infinity))
    const grow = natural.reduce((best, w, i) => (w >= (natural[best] ?? 0) ? i : best), 0)
    return Array.from({ length: n }, (_, i) =>
      i === grow ? { id: `c${i}`, title: "", width: "grow" as const } : { id: `c${i}`, title: "", width: Math.min(natural[i]!, MAX_COLUMN) },
    )
  }
  const more = () => all().length - props.place.rows
  return (
    <box height={props.place.height} flexShrink={0} flexDirection="column" overflow="hidden">
      <Panel title={props.def.title} count={props.query.data()?.length} focused={props.focused} footer={props.def.footer} grow>
        <Show when={props.query.data() !== undefined}>
          <Table columns={columns()} rows={shown()} header={false} empty={props.def.empty} focused={props.focused} onOpen={(ref) => void nav.open(ref)} />
          <Show when={more() > 0}>
            <text fg={theme.muted} flexShrink={0}>{`+${more()} more`}</text>
          </Show>
        </Show>
      </Panel>
    </box>
  )
}
