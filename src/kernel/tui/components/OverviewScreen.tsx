// The Attention screen (slot 1, route id "overview"): the plugins' panels in priority order, in paired grid rows (two columns of equal width, or with a lead its split)
// when they fit, else in two columns balanced by height (overviewLayout.ts), Tab moving through them in priority
// order. The screen loads every panel through useQuery, so it knows each one's row count and can size them to fit
// the screen: each panel shows its count in the title (unless its `count` is false; rows with a `group` are not
// counted), as many rows as fit (at most MAX_ROWS) plus `+N more`, or its `empty` text, or `⚠ <error>` when its
// first load failed (spec §9). Rows with a `group` show under a muted sub-heading after a blank line. A panel's
// `footer` is a muted line after its rows, inside the panel (as the screen designs draw it), not
// on the border like a Panel footer (its `note` is that). A panel's `columns` set its column widths, `header` adds
// a muted row of column titles. ↑↓ move within the focused panel and Enter opens the selected row's ref; a panel's
// `keys` act on its selected row, and its `detail` shows a block for the selected row under the rows (↓ on the last
// row moves into it, ↑ on its first row back; its own `keys` and Enter act on its rows). The status bar shows
// `tab panel`, `enter open`, then the focused panel's detail keys and its own (while it has rows), the global
// actions' and `g or 1-6 screens`, `? help` (the Attention design draws no `q quit`). On a row of the panel, the
// detail block's first row is the one its keys act on (shown selected). A first panel with `lead` takes the left
// column of the top block (overviewLayout.ts). The screen has one key handler: it routes keys to the focused panel,
// whose tables take theirs through it (Table `keySource`).
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useQuery, type Query } from "../data"
import type { KeyEvent } from "@opentui/core"
import { printable, useKeys, useScreenKeys } from "../keys"
import { notify } from "../messages"
import { useNav } from "../nav"
import { useOverlay } from "../overlay"
import type { Registered } from "../registry"
import { PluginScope, useApp } from "../scope"
import { theme } from "../theme"
import type { OverviewColumn, OverviewKeyDef, OverviewPanelDef, OverviewRow } from "../types"
import { layoutOverview, MAX_ROWS, overviewColumns, type PanelPlace } from "./overviewLayout"
import { Panel } from "./Panel"
import { createKeySource, fitWidth, Table, type KeySource, type TableColumn, type TableGroup, type TableRow } from "./Table"

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
  const sources = panels.map(() => createKeySource())
  const [focus, setFocus] = createSignal(0)
  useScreenKeys((key) => {
    if (panels.length === 0) return
    if (key.name === "tab" && !key.shift) {
      key.preventDefault()
      setFocus((i) => (i + 1) % panels.length)
      return
    }
    sources[focus()]!.dispatch(key)
  })
  const places = createMemo(() =>
    layoutOverview(
      panels.map((p, i) => {
        const rows = queries[i]!.data()
        return {
          rows: rows?.length,
          empty: p.empty,
          footer: p.footer,
          headings: rows === undefined ? 0 : headingLines(rows.slice(0, MAX_ROWS)),
          extra: extraLines(p),
          ...(i === 0 && p.lead !== undefined ? { lead: p.lead } : {}),
        }
      }),
      dims().height - FRAME_LINES,
      dims().width,
    ),
  )
  const indexes = (pick: (p: PanelPlace) => boolean) => panels.map((_, i) => i).filter((i) => pick(places()[i]!))
  const lead = createMemo(() => indexes((p) => p.part === "lead"), undefined, { equals: (a, b) => a.join() === b.join() })
  const side = createMemo(() => indexes((p) => p.part === "side"), undefined, { equals: (a, b) => a.join() === b.join() })
  const rest = () => panels.map((_, i) => i).filter((i) => places()[i]!.part === undefined)
  const isGrid = createMemo(() => rest().every((i) => places()[i]!.row !== undefined))
  // The panel indexes per grid row (left, then right), or per column when they are balanced (lead block apart).
  const groups = createMemo(
    () => {
      const of = (key: (p: PanelPlace) => number | undefined, n: number) =>
        Array.from({ length: n }, (_, k) => rest().filter((i) => key(places()[i]!) === k))
      const rows = Math.max(0, ...rest().map((i) => (places()[i]!.row ?? -1) + 1))
      return isGrid() ? of((p) => p.row, rows) : of((p) => p.column, 2)
    },
    undefined,
    { equals: sameIndexes },
  )
  const Item = (props: { i: number }) => (
    <PluginScope kernel={app.kernel} plugin={panels[props.i]!.plugin} label={panels[props.i]!.title}>
      <OverviewPanel
        def={panels[props.i]!}
        query={queries[props.i]!}
        place={places()[props.i]!}
        focused={keys.active() && focus() === props.i}
        keySource={sources[props.i]!}
      />
    </PluginScope>
  )
  // The two columns (overviewColumns): with a lead the lead block's split on every row, so one column edge runs down
  // the screen; else equal halves, the gap taking the cell an uneven split leaves. The same widths whatever a row
  // holds, so the outer edges line up with the header's.
  const cols = createMemo(() => overviewColumns(dims().width, panels[0]?.lead))
  const Half = (props: { indexes: number[]; side: 0 | 1 }) => (
    <box flexDirection="column" width={props.side === 0 ? cols().left : cols().right} flexShrink={0} minHeight={0} overflow="hidden">
      <For each={props.indexes}>{(i) => <Item i={i} />}</For>
    </box>
  )
  // The bar: Tab and Enter, then the focused panel's detail keys and its own (while it has rows).
  createEffect(() => {
    if (panels.length === 0) return
    const p = panels[focus()]!
    const own = (queries[focus()]!.data()?.length ?? 0) > 0 ? [...(p.detail?.keys ?? []), ...(p.keys ?? [])] : []
    const hints = [{ key: "Tab", label: "panel" }, { key: "Enter", label: "open" }, ...own.map((k) => ({ key: k.key, label: k.label }))]
    onCleanup(keys.hints(hints, { exact: true, frame: ["g", "?"] }))
  })
  return (
    <Show when={panels.length > 0} fallback={<text fg={theme.muted}>No panels yet: plugins add them here.</text>}>
      <box flexDirection="column" paddingLeft={1} paddingRight={1} flexGrow={1} minHeight={0} overflow="hidden">
        <Show when={lead().length > 0}>
          <box flexDirection="row" gap={cols().gap} flexShrink={0}>
            <Half indexes={lead()} side={0} />
            <Half indexes={side()} side={1} />
          </box>
        </Show>
        <Show
          when={isGrid()}
          fallback={
            <box flexDirection="row" gap={cols().gap} flexGrow={1} minHeight={0} overflow="hidden">
              <For each={groups()}>{(list, k) => <Half indexes={list} side={k() === 0 ? 0 : 1} />}</For>
            </box>
          }
        >
          <For each={groups()}>
            {(pair) => (
              <box flexDirection="row" gap={cols().gap} flexShrink={0}>
                <Half indexes={pair.slice(0, 1)} side={0} />
                <Half indexes={pair.slice(1)} side={1} />
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

// The lines a panel with rows adds to them: its header row and its detail block (a blank line, its title, its rows).
const extraLines = (p: OverviewPanelDef) => (p.header ? 1 : 0) + (p.detail ? p.detail.rows + 2 : 0)

const toRow = (r: OverviewRow): TableRow => ({ ref: r.ref, cells: Object.fromEntries(r.cells.map((c, i) => [`c${i}`, c])) })

// Table columns for `rows` from a panel's `columns` (a `{ min, max }` fits the rows shown and its title); without
// them the column with the widest text (the last of equals) takes the leftover width and the others fit their rows.
function tableColumns(spec: OverviewColumn[] | undefined, rows: OverviewRow[], shown: TableRow[], titles: string[] = []): TableColumn[] {
  const title = (i: number) => titles[i] ?? ""
  if (spec)
    return spec.map((w, i) =>
      typeof w !== "object"
        ? { id: `c${i}`, title: title(i), width: w }
        : "grow" in w
          ? { id: `c${i}`, title: title(i), width: "grow" as const, minWidth: w.min }
          : { id: `c${i}`, title: title(i), width: Math.max(w.min, fitWidth(shown, `c${i}`, title(i), w.max)), ...(w.drop === undefined ? {} : { drop: w.drop }) },
    )
  const n = Math.max(0, ...rows.map((r) => r.cells.length))
  const natural = Array.from({ length: n }, (_, i) => fitWidth(shown, `c${i}`, title(i), Infinity))
  const grow = natural.reduce((best, w, i) => (w >= (natural[best] ?? 0) ? i : best), 0)
  return Array.from({ length: n }, (_, i) =>
    i === grow ? { id: `c${i}`, title: title(i), width: "grow" as const } : { id: `c${i}`, title: title(i), width: Math.min(natural[i]!, MAX_COLUMN) },
  )
}

// Runs a panel key; a failure shows in the status bar.
function runKey(k: OverviewKeyDef, ref: string, overlay: ReturnType<typeof useOverlay>): void {
  void Promise.resolve()
    .then(() => k.run(ref, { overlay }))
    .catch((e: unknown) => notify(errorText(e), "error"))
}

function OverviewPanel(props: { def: PanelEntry; query: Query<OverviewRow[]>; place: PanelPlace; focused: boolean; keySource: KeySource }) {
  const nav = useNav()
  const keys = useKeys()
  const overlay = useOverlay()
  const all = () => props.query.data() ?? []
  const shownRows = () => all().slice(0, props.place.rows)
  const shown = (): TableRow[] => shownRows().map(toRow)
  // The rows shown, in runs of the same group (the first without a title).
  const groups = (): TableGroup[] => {
    const out: TableGroup[] = []
    for (const r of shownRows()) {
      const last = out[out.length - 1]
      if (last && last.title === r.group) last.rows.push(toRow(r))
      else out.push({ title: r.group, count: false, space: true, rows: [toRow(r)] })
    }
    return out
  }
  const columns = (): TableColumn[] => tableColumns(props.def.columns, all(), shown(), props.def.header)
  const more = () => all().length - props.place.rows

  // --- the selected row, and the detail block for it ---
  const [selected, setSelected] = createSignal<string | undefined>()
  const [inDetail, setInDetail] = createSignal(false)
  const [detailSelected, setDetailSelected] = createSignal<string | undefined>()
  const spec = props.def.detail
  const detail = useQuery(
    async () => {
      const ref = selected()
      return { ref, detail: ref === undefined || !spec ? null : await spec.load(ref) }
    },
    { key: () => selected() },
  )
  // The detail of the selected row only (not the last one's, while the new one loads).
  const current = () => {
    const d = detail.data()
    return d && d.ref === selected() ? d.detail : null
  }
  const detailAll = () => current()?.rows ?? []
  const detailCap = () => (spec ? (detailAll().length > spec.rows ? spec.rows - 1 : spec.rows) : 0)
  const detailShownRows = () => detailAll().slice(0, detailCap())
  const detailShown = (): TableRow[] => detailShownRows().map(toRow)
  const detailMore = () => detailAll().length - detailShownRows().length
  createEffect(() => {
    if (inDetail() && detailShownRows().length === 0) setInDetail(false)
  })
  // With a detail block the rows take their own lines only, so the block follows them.
  const tableHeight = () => (props.def.header ? 1 : 0) + shownRows().length + headingLines(shownRows())

  // Runs first (registered before the tables): moves in and out of the detail block, and the keys of the panel and
  // its detail. On a row of the panel the detail's keys act on its first row (shown selected).
  const onKey = (key: KeyEvent) => {
    if (!props.focused || keys.typing() || key.defaultPrevented) return
    const ch = printable(key)
    const down = key.name === "down" || ch === "j"
    const up = key.name === "up" || ch === "k"
    const rows = shownRows()
    const target = () => (inDetail() ? detailSelected() : detailShownRows()[0]?.ref)
    if (down && !inDetail() && rows.length > 0 && selected() === rows[rows.length - 1]!.ref && detailShownRows().length > 0) setInDetail(true)
    else if (up && inDetail() && detailSelected() === detailShownRows()[0]?.ref) setInDetail(false)
    else {
      if (ch === undefined) return
      const own = props.def.keys?.find((k) => k.key === ch)
      const forDetail = spec?.keys?.find((k) => k.key === ch)
      const [k, ref] = inDetail() ? (forDetail ? [forDetail, target()] : [own, selected()]) : own ? [own, selected()] : [forDetail, target()]
      if (!k || ref === undefined) return
      runKey(k, ref, overlay)
    }
    key.preventDefault()
  }
  onCleanup(props.keySource.add(onKey))

  const rowsTable = () => (
    <Table
      columns={columns()}
      groups={groups()}
      header={props.def.header !== undefined}
      empty={props.def.empty}
      focused={props.focused && !inDetail()}
      keySource={props.keySource}
      onSelect={setSelected}
      onOpen={(ref) => void nav.open(ref)}
    />
  )
  return (
    <box height={props.place.height} flexShrink={0} flexDirection="column" overflow="hidden">
      <Panel
        title={props.def.title}
        count={props.def.count === false ? undefined : props.query.data()?.filter((r) => r.group === undefined).length}
        focused={props.focused}
        footer={(props.query.data()?.length ?? 0) > 0 ? props.def.note : undefined}
        grow
      >
        <Show when={props.query.error() !== undefined && props.query.data() === undefined}>
          <text fg={theme.red} flexShrink={0}>{`⚠ ${errorText(props.query.error())}`}</text>
        </Show>
        <Show when={props.query.data() !== undefined}>
          <Show when={spec && shownRows().length > 0} fallback={rowsTable()}>
            <box height={tableHeight()} flexShrink={0} flexDirection="column">
              {rowsTable()}
            </box>
          </Show>
          <Show when={more() > 0}>
            <text fg={theme.muted} flexShrink={0}>{`+${more()} more`}</text>
          </Show>
          <Show when={spec ? current() : null}>
            {(d: () => NonNullable<ReturnType<typeof current>>) => (
              <box flexDirection="column" flexShrink={0} paddingTop={1}>
                <text fg={theme.muted} flexShrink={0}>
                  {d().title}
                </text>
                <box height={detailShownRows().length} flexShrink={0} flexDirection="column">
                  <Table
                    columns={tableColumns(spec!.columns, detailAll(), detailShown())}
                    rows={detailShown()}
                    header={false}
                    focused={props.focused && inDetail()}
                    selectionShown={props.focused}
                    selectedRef={inDetail() ? undefined : detailShownRows()[0]?.ref}
                    keySource={props.keySource}
                    onSelect={setDetailSelected}
                    onOpen={(ref) => void nav.open(ref)}
                  />
                </box>
                <Show when={detailMore() > 0}>
                  <text fg={theme.muted} flexShrink={0}>{`+${detailMore()} more`}</text>
                </Show>
              </box>
            )}
          </Show>
        </Show>
        <Show when={props.def.footer}>{(f: () => string) => <text fg={theme.muted} flexShrink={0}>{f()}</text>}</Show>
      </Panel>
    </box>
  )
}
