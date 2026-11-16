// A list of rows with a selection: ↑↓/jk move it, Enter opens the selected row (onOpen(ref)). The selection
// follows the ref across reloads; when that ref is gone it stays at the same index, clamped. Columns are
// truncated by display width with `…`: fixed ones to their width, "grow" ones to the width left over (measured).
// The rows scroll so the selected one stays in view. `groups` renders `Title · n` headers above each group's
// rows. With `listId`, the columns other plugins registered for that list (registry `columns(listId)`) are
// appended and filled through their `value(ref)`. While a text field holds text focus, the Table takes no keys.
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { useQuery } from "../data"
import { displayWidth, truncate } from "../format"
import { printable, useKeys, useScreenKeys } from "../keys"
import { useApp } from "../scope"
import { theme, toneColor } from "../theme"
import type { Cell, Tone } from "../types"

export type TableRow = { ref: string; cells: Record<string, string | Cell> }
export type TableColumn = { id: string; title: string; width: number | "grow"; tone?: (row: TableRow) => Tone }
export type TableGroup = { title: string; rows: TableRow[] }

export type TableProps = {
  columns: TableColumn[]
  rows?: TableRow[]
  // Rendered instead of `rows` when given.
  groups?: TableGroup[]
  selectedRef?: string
  onSelect?(ref: string): void
  onOpen?(ref: string): void
  focused?: boolean
  // Shown when there are no rows.
  empty?: string
  listId?: string
  // The column titles row (default true).
  header?: boolean
}

// The selection marker column, and the gap between columns.
const MARKER_WIDTH = 1
const GAP = 1
// A grow column's width before the table has been measured.
const UNMEASURED_GROW = 20

type Line = { kind: "group"; title: string; n: number } | { kind: "row"; row: TableRow }

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
      ? props.groups.flatMap((g): Line[] => [{ kind: "group", title: g.title, n: g.rows.length }, ...g.rows.map((row) => ({ kind: "row" as const, row }))])
      : flat().map((row) => ({ kind: "row", row })),
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
  const columns = (): TableColumn[] => [...props.columns, ...extra.map((def) => ({ id: `${def.plugin}:${def.id}`, title: def.title, width: def.width }))]
  const rowCells = (row: TableRow): TableRow => {
    if (extra.length === 0) return row
    const cells = { ...row.cells }
    extra.forEach((def, i) => (cells[`${def.plugin}:${def.id}`] = extraValues[i]!.data()?.get(row.ref) ?? ""))
    return { ref: row.ref, cells }
  }

  // --- measured size: grow columns share the width left over; the body height drives scrolling ---
  const [width, setWidth] = createSignal(0)
  const [height, setHeight] = createSignal(0)
  const growWidth = createMemo(() => {
    const cols = columns()
    const grows = cols.filter((c) => c.width === "grow").length
    if (grows === 0) return 0
    if (width() === 0) return UNMEASURED_GROW
    const fixed = cols.reduce((n, c) => n + (c.width === "grow" ? 0 : c.width), 0)
    const free = width() - MARKER_WIDTH - GAP * cols.length - fixed
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
      if (ref === undefined) return
      if (ref !== chosen()) setChosen(ref)
      props.onSelect?.(ref)
    }),
  )
  const move = (d: number) => {
    const list = flat()
    if (list.length === 0) return
    const i = Math.max(0, list.findIndex((r) => r.ref === selected()))
    setChosen(list[Math.min(list.length - 1, Math.max(0, i + d))]!.ref)
  }

  // --- scrolling: the first line shown keeps the selected row (and its group header, when it fits) in view ---
  let lastOffset = 0
  const offset = createMemo(() => {
    const all = lines()
    const h = height()
    const sel = all.findIndex((l) => l.kind === "row" && l.row.ref === selected())
    let off = Math.min(lastOffset, Math.max(0, all.length - 1))
    if (h > 0 && sel >= 0) {
      const top = sel > 0 && all[sel - 1]!.kind === "group" ? sel - 1 : sel
      if (top < off) off = top
      if (sel >= off + h) off = sel - h + 1
      off = Math.max(0, Math.min(off, all.length - h))
    }
    lastOffset = off
    return off
  })
  const visible = () => lines().slice(offset())

  // --- keys and hints ---
  useScreenKeys((key) => {
    if (props.focused === false || keys.typing()) return
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
    if (focused() && props.onOpen && flat().length > 0) onCleanup(keys.hints([{ key: "Enter", label: "open" }]))
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
        <text fg={theme.accent} width={MARKER_WIDTH} flexShrink={0}>
          {on() ? "›" : " "}
        </text>
        <For each={columns()}>
          {(col) => {
            const cell = () => cellOf(rowCells(rp.row), col)
            return <ColumnText col={col} text={cell().text} fg={toneColor(cell().tone)} />
          }}
        </For>
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
          <text width={MARKER_WIDTH} flexShrink={0}>
            {" "}
          </text>
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
              line.kind === "group" ? (
                <text fg={theme.muted} height={1} flexShrink={0}>{`${line.title} · ${line.n}`}</text>
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
