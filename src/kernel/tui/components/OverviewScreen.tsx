// The Attention screen (slot 1, route id "overview"): the plugins' panels in priority order, in paired grid rows
// when they fit, else in two columns balanced by height (overviewLayout.ts), Tab moving through them in priority
// order. The screen loads every panel through useQuery, so it knows each one's row count and can size them to fit
// the screen: each panel shows its count in the title (unless its `count` is false; rows with a `group` are not
// counted), as many rows as fit (at most MAX_ROWS) plus `+N more`, or its `empty` text, or `⚠ <error>` when its
// first load failed (spec §9). Rows with a `group` show under a muted sub-heading after a blank line. A panel's
// `footer` is a muted line after its rows, inside the panel (as the designs draw "Stakeholders to contact"), not
// on the border like a Panel footer. A panel's `columns` fix its column widths.
// ↑↓ move within the focused panel and Enter opens the selected row's ref.
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
import { layoutOverview, MAX_ROWS, type PanelPlace } from "./overviewLayout"
import { Panel } from "./Panel"
import { fitWidth, Table, type TableColumn, type TableGroup, type TableRow } from "./Table"

export { MAX_ROWS } from "./overviewLayout"
const MAX_COLUMN = 16
// The frame's header and status bar.
const FRAME_LINES = 2

type PanelEntry = Registered<OverviewPanelDef>
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
// Index lists compared by value, so a reload that keeps the layout remounts nothing.
const sameIndexes = (a: number[][], b: number[][]) => a.length === b.length && a.every((x, k) => x.length === b[k]!.length && x.every((y, j) => y === b[k]![j]))

// Lines a panel's sub-headings take: each group's heading, and a blank line above it unless it is the first line.
export function headingLines(rows: OverviewRow[]): number {
  let lines = 0
  rows.forEach((r, i) => {
    if (r.group === undefined || (i > 0 && rows[i - 1]!.group === r.group)) return
    lines += i > 0 ? 2 : 1
  })
  return lines
}

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
      panels.map((p, i) => {
        const rows = queries[i]!.data()
        return { rows: rows?.length, empty: p.empty, footer: p.footer, headings: rows === undefined ? 0 : headingLines(rows.slice(0, MAX_ROWS)) }
      }),
      dims().height - FRAME_LINES,
      dims().width,
    ),
  )
  const isGrid = createMemo(() => places().every((p) => p.row !== undefined))
  // The panel indexes per grid row (left, then right), or per column when they are balanced.
  const groups = createMemo(
    () => {
      const of = (key: (p: PanelPlace) => number | undefined, n: number) =>
        Array.from({ length: n }, (_, k) => panels.map((_, i) => i).filter((i) => key(places()[i]!) === k))
      return isGrid() ? of((p) => p.row, Math.ceil(panels.length / 2)) : of((p) => p.column, 2)
    },
    undefined,
    { equals: sameIndexes },
  )
  const Item = (props: { i: number }) => (
    <PluginScope kernel={app.kernel} plugin={panels[props.i]!.plugin} label={panels[props.i]!.title}>
      <OverviewPanel def={panels[props.i]!} query={queries[props.i]!} place={places()[props.i]!} focused={keys.active() && focus() === props.i} />
    </PluginScope>
  )
  // A grid row's cell, or a column: half the width.
  const Half = (props: { indexes: number[] }) => (
    <box flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
      <For each={props.indexes}>{(i) => <Item i={i} />}</For>
    </box>
  )
  return (
    <Show when={panels.length > 0} fallback={<text fg={theme.muted}>No panels yet: plugins add them here.</text>}>
      <KeyHints
        exact
        hints={[
          { key: "Tab", label: "panel" },
          { key: "Enter", label: "open" },
        ]}
      />
      <Show
        when={isGrid()}
        fallback={
          <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} flexGrow={1} minHeight={0} overflow="hidden">
            <For each={groups()}>{(indexes) => <Half indexes={indexes} />}</For>
          </box>
        }
      >
        <box flexDirection="column" paddingLeft={1} paddingRight={1} flexGrow={1} minHeight={0} overflow="hidden">
          <For each={groups()}>
            {(pair) => (
              <box flexDirection="row" gap={1} flexShrink={0}>
                <Half indexes={pair.slice(0, 1)} />
                <Half indexes={pair.slice(1)} />
              </box>
            )}
          </For>
        </box>
      </Show>
    </Show>
  )
}

function OverviewPanel(props: { def: PanelEntry; query: Query<OverviewRow[]>; place: PanelPlace; focused: boolean }) {
  const nav = useNav()
  const all = () => props.query.data() ?? []
  const toRow = (r: OverviewRow): TableRow => ({ ref: r.ref, cells: Object.fromEntries(r.cells.map((c, i) => [`c${i}`, c])) })
  const shown = (): TableRow[] => all().slice(0, props.place.rows).map(toRow)
  // The rows shown, in runs of the same group (the first without a title).
  const groups = (): TableGroup[] => {
    const out: TableGroup[] = []
    for (const r of all().slice(0, props.place.rows)) {
      const last = out[out.length - 1]
      if (last && last.title === r.group) last.rows.push(toRow(r))
      else out.push({ title: r.group, count: false, space: true, rows: [toRow(r)] })
    }
    return out
  }
  // Fixed by the panel's `columns`; otherwise the column with the widest text (the last of equals) takes the
  // leftover width and the others fit their rows.
  const columns = (): TableColumn[] => {
    const fixed = props.def.columns
    if (fixed) return fixed.map((width, i) => ({ id: `c${i}`, title: "", width }))
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
      <Panel title={props.def.title} count={props.def.count === false ? undefined : props.query.data()?.filter((r) => r.group === undefined).length} focused={props.focused} grow>
        <Show when={props.query.error() !== undefined && props.query.data() === undefined}>
          <text fg={theme.red} flexShrink={0}>{`⚠ ${errorText(props.query.error())}`}</text>
        </Show>
        <Show when={props.query.data() !== undefined}>
          <Table columns={columns()} groups={groups()} header={false} empty={props.def.empty} focused={props.focused} onOpen={(ref) => void nav.open(ref)} />
          <Show when={more() > 0}>
            <text fg={theme.muted} flexShrink={0}>{`+${more()} more`}</text>
          </Show>
        </Show>
        <Show when={props.def.footer}>{(f: () => string) => <text fg={theme.muted} flexShrink={0}>{f()}</text>}</Show>
      </Panel>
    </box>
  )
}
