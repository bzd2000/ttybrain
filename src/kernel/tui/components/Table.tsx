// A list of rows with a selection: ↑↓/jk move it, Enter opens the selected row (onOpen(ref)). The selection
// follows the ref across reloads; when that ref is gone it stays at the same index, clamped. Columns are
// truncated by display width with `…`: fixed ones to their width, "grow" ones to the width left over (measured).
// The rows scroll so the selected one stays in view. The selected row shows as a `selectedBg` background, in the
// focused table only (no marker column). `groups` renders `Title · n` headers above each group's rows (a group
// without a title has no header: a screen's main group under its panel title; `count: false` leaves out the
// ` · n`; `tone` colours the header, muted by default; `space` puts a blank line above it). A row's `detail` is a second line under it, aligned with
// its second column and not selectable (a processed inbox item's outcome). A focused table with rows and `onOpen`
// adds the `↑↓ select` and `Enter open` hints. With `listId`, the columns other plugins registered for that list (registry `columns(listId)`) are
// appended and filled through their `value(ref)`. While a text field holds text focus, the Table takes no keys,
// nor keys a handler before it (its screen's) already claimed with preventDefault().
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { useQuery } from "../data"
import { displayWidth, truncate } from "../format"
import { printable, useKeys, useScreenKeys } from "../keys"
import { useApp } from "../scope"
import { theme, toneColor } from "../theme"
import type { Cell, Tone } from "../types"

export type TableRow = { ref: string; cells: Record<string, string | Cell>; detail?: Cell }
// `drop`: a fixed column that gives way when the table is too narrow: higher numbers go first, equal numbers go
// together, unset never goes. `minWidth` (on the grow column): the width it keeps before columns are dropped
// (default 16 once any column is droppable).
export type TableColumn = { id: string; title: string; width: number | "grow"; tone?: (row: TableRow) => Tone; drop?: number; minWidth?: number }
// `space`: a blank line above the group's header (none when the header is the table's first line).
export type TableGroup = { title?: string; count?: boolean; tone?: Tone; space?: boolean; rows: TableRow[] }

export type TableProps = {
  columns: TableColumn[]
  rows?: TableRow[]
  // Rendered instead of `rows` when given.
  groups?: TableGroup[]
  selectedRef?: string
  // The selected row's ref; undefined while the table has no rows.
  onSelect?(ref: string | undefined): void
  onOpen?(ref: string): void
  focused?: boolean
  // Shown when there are no rows.
  empty?: string
  listId?: string
  // The column titles row (default true).
  header?: boolean
}

// The gap between columns.
const GAP = 1
// A grow column's width before the table has been measured.
const UNMEASURED_GROW = 20

type Line = { kind: "group"; title: string; tone: Tone } | { kind: "row"; row: TableRow } | { kind: "detail"; cell: Cell } | { kind: "space" }

const rowLines = (row: TableRow): Line[] => (row.detail ? [{ kind: "row", row }, { kind: "detail", cell: row.detail }] : [{ kind: "row", row }])

function cellOf(row: TableRow, col: TableColumn): Cell {
  const v = row.cells[col.id]
  const cell: Cell = v === undefined ? { text: "" } : typeof v === "string" ? { text: v } : v
  const tone = col.tone?.(row)
  return tone === undefined ? cell : { ...cell, tone }
}

export function Table(props: TableProps) {
  const app = useApp()
  const keys = useKeys()
  const flat = createMemo(() => props.groups?.flatMap((g) => g.rows) ?? props.rows ?? [])
  const lines = createMemo((): Line[] =>
    props.groups
      ? props.groups.reduce((out: Line[], g) => {
          const rows = g.rows.flatMap(rowLines)
          if (g.title === undefined) return [...out, ...rows]
          const header: Line = { kind: "group", title: g.count === false ? g.title : `${g.title} · ${g.rows.length}`, tone: g.tone ?? "muted" }
          return [...out, ...(g.space && out.length > 0 ? [{ kind: "space" } as const] : []), header, ...rows]
        }, [])
      : flat().flatMap(rowLines),
  )
  const focused = () => props.focused !== false && keys.active()

  // --- the plugins' list columns (listId) ---
  const extra = props.listId === undefined ? [] : app.registry.columns(props.listId)
  const extraValues = extra.map((def) =>
    useQuery(
      async () => {
        const refs = flat().map((r) => r.ref)
        const values = await Promise.all(refs.map((ref) => def.value(ref)))
        return new Map(refs.map((ref, i) => [ref, values[i] ?? ""]))
      },
      { key: () => flat().map((r) => r.ref).join("\n") },
    ),
  )
  const allColumns = (): TableColumn[] => [...props.columns, ...extra.map((def) => ({ id: `${def.plugin}:${def.id}`, title: def.title, width: def.width }))]
  // The columns that fit: while the fixed columns, the gaps and the grow column's minimum exceed the measured
  // width, the droppable columns go, highest `drop` first (ties together).
  const fitColumns = (): TableColumn[] => {
    let cols = allColumns()
    const total = width()
    const grow = cols.find((c) => c.width === "grow")
    if (total === 0 || grow === undefined || !cols.some((c) => c.drop !== undefined)) return cols
    const need = (list: TableColumn[]) => list.reduce((n, c) => n + (c.width === "grow" ? (grow.minWidth ?? 16) : c.width), 0) + GAP * (list.length - 1)
    while (need(cols) > total) {
      const top = Math.max(...cols.map((c) => c.drop ?? -1))
      if (top < 0) break
      cols = cols.filter((c) => c.drop !== top)
    }
    return cols
  }
  const rowCells = (row: TableRow): TableRow => {
    if (extra.length === 0) return row
    const cells = { ...row.cells }
    extra.forEach((def, i) => (cells[`${def.plugin}:${def.id}`] = extraValues[i]!.data()?.get(row.ref) ?? ""))
    return { ref: row.ref, cells }
  }

  // --- measured size: grow columns share the width left over; the body height drives scrolling ---
  const [width, setWidth] = createSignal(0)
  // A memo with a structural check, so a width change that drops nothing does not rebuild the rows.
  const columns = createMemo(fitColumns, undefined, {
    equals: (a, b) => a.length === b.length && a.every((c, i) => c.id === b[i]!.id && c.width === b[i]!.width && c.title === b[i]!.title && c.tone === b[i]!.tone),
  })
  const [height, setHeight] = createSignal(0)
  const growWidth = createMemo(() => {
    const cols = columns()
    const grows = cols.filter((c) => c.width === "grow").length
    if (grows === 0) return 0
    if (width() === 0) return UNMEASURED_GROW
    const fixed = cols.reduce((n, c) => n + (c.width === "grow" ? 0 : c.width), 0)
    const free = width() - GAP * (cols.length - 1) - fixed
    return Math.max(1, Math.floor(free / grows))
  })
  const widthOf = (col: TableColumn) => (col.width === "grow" ? growWidth() : col.width)

  // --- selection ---
  const [chosen, setChosen] = createSignal<string | undefined>(props.selectedRef)
  createEffect(on(() => props.selectedRef, (r) => r !== undefined && setChosen(r), { defer: true }))
  let lastIndex = 0
  const selected = createMemo(() => {
    const list = flat()
    if (list.length === 0) return undefined
    const want = chosen()
    let i = want === undefined ? -1 : list.findIndex((r) => r.ref === want)
    if (i < 0) i = Math.min(lastIndex, list.length - 1)
    lastIndex = i
    return list[i]!.ref
  })
  createEffect(
    on(selected, (ref) => {
      // No rows: nothing is selected (the remembered ref comes back with its row).
      if (ref !== undefined && ref !== chosen()) setChosen(ref)
      props.onSelect?.(ref)
    }),
  )
  const move = (d: number) => {
    const list = flat()
    if (list.length === 0) return
    const i = Math.max(0, list.findIndex((r) => r.ref === selected()))
    setChosen(list[Math.min(list.length - 1, Math.max(0, i + d))]!.ref)
  }

  // --- scrolling: the first line shown keeps the selected row (its group header and detail line, when they fit) in view ---
  let lastOffset = 0
  const offset = createMemo(() => {
    const all = lines()
    const h = height()
    const sel = all.findIndex((l) => l.kind === "row" && l.row.ref === selected())
    let off = Math.min(lastOffset, Math.max(0, all.length - 1))
    if (h > 0 && sel >= 0) {
      const top = sel > 0 && all[sel - 1]!.kind === "group" ? sel - 1 : sel
      const bottom = all[sel + 1]?.kind === "detail" && h > 1 ? sel + 1 : sel
      if (top < off) off = top
      if (bottom >= off + h) off = bottom - h + 1
      off = Math.max(0, Math.min(off, all.length - h))
    }
    lastOffset = off
    return off
  })
  const visible = () => lines().slice(offset())

  // --- keys and hints ---
  useScreenKeys((key) => {
    // A key an earlier handler claimed (the screen around the table) is not the table's.
    if (props.focused === false || keys.typing() || key.defaultPrevented) return
    const ch = printable(key)
    if (key.name === "up" || ch === "k") move(-1)
    else if (key.name === "down" || ch === "j") move(1)
    else if (key.name === "return") {
      const ref = selected()
      if (ref === undefined) return
      props.onOpen?.(ref)
    } else return
    key.preventDefault()
  })
  createEffect(() => {
    if (!focused() || !props.onOpen || flat().length === 0) return
    onCleanup(
      keys.hints([
        { key: "↑↓", label: "select" },
        { key: "Enter", label: "open" },
      ]),
    )
  })

  const ColumnText = (cp: { col: TableColumn; text: string; fg: string }) => (
    <text fg={cp.fg} width={widthOf(cp.col)} flexShrink={0} wrapMode="none">
      {truncate(cp.text, widthOf(cp.col))}
    </text>
  )

  const Row = (rp: { row: TableRow }) => {
    const on = () => rp.row.ref === selected() && focused()
    return (
      <box flexDirection="row" height={1} flexShrink={0} gap={GAP} backgroundColor={on() ? theme.selectedBg : theme.bg}>
        <For each={columns()}>
          {(col) => {
            const cell = () => cellOf(rowCells(rp.row), col)
            return <ColumnText col={col} text={cell().text} fg={toneColor(cell().tone)} />
          }}
        </For>
      </box>
    )
  }

  // Indented past the first column, cut to what is left of the measured width.
  const Detail = (dp: { cell: Cell }) => {
    const indent = () => (columns().length > 1 ? widthOf(columns()[0]!) + GAP : 0)
    const room = () => (width() === 0 ? UNMEASURED_GROW : Math.max(1, width() - indent()))
    return (
      <box flexDirection="row" height={1} flexShrink={0} paddingLeft={indent()}>
        <text fg={toneColor(dp.cell.tone)} wrapMode="none">
          {truncate(dp.cell.text, room())}
        </text>
      </box>
    )
  }

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      overflow="hidden"
      onSizeChange={function () {
        setWidth(this.width)
      }}
    >
      <Show when={props.header !== false && flat().length > 0}>
        <box flexDirection="row" height={1} flexShrink={0} gap={GAP}>
          <For each={columns()}>{(col) => <ColumnText col={col} text={col.title} fg={theme.muted} />}</For>
        </box>
      </Show>
      <Show when={flat().length > 0} fallback={<Show when={props.empty}>{(e: () => string) => <text fg={theme.muted}>{e()}</text>}</Show>}>
        <box
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          overflow="hidden"
          onSizeChange={function () {
            setHeight(this.height)
          }}
        >
          <For each={visible()}>
            {(line) =>
              line.kind === "space" ? (
                <text height={1} flexShrink={0}>
                  {" "}
                </text>
              ) : line.kind === "group" ? (
                <text fg={toneColor(line.tone)} height={1} flexShrink={0}>
                  {line.title}
                </text>
              ) : line.kind === "detail" ? (
                <Detail cell={line.cell} />
              ) : (
                <Row row={line.row} />
              )
            }
          </For>
        </box>
      </Show>
    </box>
  )
}

// The width a fixed column needs to show every row's value of `id` in full (at least its title), capped at `max`.
export function fitWidth(rows: TableRow[], id: string, title: string, max: number): number {
  let w = displayWidth(title)
  for (const r of rows) {
    const v = r.cells[id]
    w = Math.max(w, displayWidth(typeof v === "string" ? v : (v?.text ?? "")))
  }
  return Math.min(w, max)
}
