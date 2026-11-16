// A list of rows with a selection: ↑↓/jk move it, Enter opens the selected row (onOpen(ref)). The selection
// follows the ref across reloads; when that ref is gone it stays at the same index, clamped. Fixed-width columns
// are truncated by display width with `…`; a "grow" column takes the rest. `groups` renders `Title · n` headers
// above each group's rows. With `listId`, the columns other plugins registered for that list (registry
// `columns(listId)`) are appended and filled through their `value(ref)`.
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
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

const MARKER_WIDTH = 2

function cellOf(row: TableRow, col: TableColumn): Cell {
  const v = row.cells[col.id]
  const cell: Cell = v === undefined ? { text: "" } : typeof v === "string" ? { text: v } : v
  const tone = col.tone?.(row)
  return tone === undefined ? cell : { ...cell, tone }
}

function ColumnText(props: { col: TableColumn; text: string; fg: string }) {
  const w = props.col.width
  return (
    <Show
      when={w !== "grow"}
      fallback={
        <text fg={props.fg} flexGrow={1} flexShrink={1} wrapMode="none" truncate>
          {props.text}
        </text>
      }
    >
      <text fg={props.fg} width={w as number} flexShrink={0} wrapMode="none">
        {truncate(props.text, w as number)}
      </text>
    </Show>
  )
}

export function Table(props: TableProps) {
  const app = useApp()
  const keys = useKeys()
  const groups = (): TableGroup[] | undefined => props.groups
  const flat = createMemo(() => groups()?.flatMap((g) => g.rows) ?? props.rows ?? [])
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

  useScreenKeys((key) => {
    if (props.focused === false) return
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

  const Row = (rp: { row: TableRow }) => {
    const on = () => rp.row.ref === selected()
    return (
      <box flexDirection="row" height={1} flexShrink={0} gap={1} backgroundColor={on() && focused() ? theme.selectedBg : theme.bg}>
        <text fg={theme.accent} width={MARKER_WIDTH - 1} flexShrink={0}>
          {on() && focused() ? "›" : " "}
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
    <box flexDirection="column" flexShrink={0}>
      <Show when={props.header !== false && flat().length > 0}>
        <box flexDirection="row" height={1} flexShrink={0} gap={1}>
          <text width={MARKER_WIDTH - 1} flexShrink={0}>
            {" "}
          </text>
          <For each={columns()}>{(col) => <ColumnText col={col} text={col.title} fg={theme.muted} />}</For>
        </box>
      </Show>
      <Show when={flat().length > 0} fallback={<Show when={props.empty}>{(e: () => string) => <text fg={theme.muted}>{e()}</text>}</Show>}>
        <Show when={groups()} fallback={<For each={props.rows ?? []}>{(row) => <Row row={row} />}</For>}>
          {(gs: () => TableGroup[]) => (
            <For each={gs()}>
              {(g) => (
                <>
                  <text fg={theme.muted}>{`${g.title} · ${g.rows.length}`}</text>
                  <For each={g.rows}>{(row) => <Row row={row} />}</For>
                </>
              )}
            </For>
          )}
        </Show>
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
