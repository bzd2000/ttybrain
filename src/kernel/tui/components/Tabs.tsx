// A row of tabs (`Title count`), the active one highlighted; ←→ switch while focused. When the row is wider than
// `width` (default: the terminal's, less the record view's padding), zero counts go first (the active tab keeps
// its count); if it still does not fit, only a window of tabs around the active one shows, with `‹` / `›` where
// tabs are hidden; a single tab too wide for the row is shortened with `…`. Titles are never cut mid-word otherwise.
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { displayWidth, truncate } from "../format"
import { useKeys, useScreenKeys } from "../keys"
import { theme } from "../theme"

export type TabItem = { id: string; title: string; count?: number | null }

// What the row shows: the tabs by index with their label parts, and whether tabs are hidden on either side.
export type TabsFit = { items: Array<{ index: number; title: string; count?: number }>; before: boolean; after: boolean }

const PAD = 2 // a tab's padding (1 + 1)
const GAP = 1
const MARKER = 1 + GAP

const label = (title: string, count: number | undefined) => (count === undefined ? title : `${title} ${count}`)

export function fitTabs(tabs: TabItem[], active: number, width: number): TabsFit {
  const counted = (t: TabItem) => (t.count === undefined || t.count === null ? undefined : t.count)
  const widthOf = (items: TabsFit["items"]) => items.reduce((sum, x, k) => sum + (k > 0 ? GAP : 0) + PAD + displayWidth(label(x.title, x.count)), 0)
  const all = tabs.map((t, index) => ({ index, title: t.title, count: counted(t) }))
  if (widthOf(all) <= width) return { items: all, before: false, after: false }
  const lean = all.map((x) => (x.count === 0 && x.index !== active ? { ...x, count: undefined } : x))
  if (widthOf(lean) <= width) return { items: lean, before: false, after: false }

  // A window around the active tab, grown one tab at a time (right first), with room for the markers.
  const at = Math.min(Math.max(active, 0), lean.length - 1)
  let lo = at
  let hi = at
  const fits = (l: number, h: number) =>
    widthOf(lean.slice(l, h + 1)) + (l > 0 ? MARKER : 0) + (h < lean.length - 1 ? MARKER : 0) <= width
  for (let grew = true; grew; ) {
    grew = false
    if (hi < lean.length - 1 && fits(lo, hi + 1)) (hi++, (grew = true))
    if (lo > 0 && fits(lo - 1, hi)) (lo--, (grew = true))
  }
  const items = lean.slice(lo, hi + 1)
  if (items.length === 1 && !fits(lo, hi)) {
    const room = width - PAD - (lo > 0 ? MARKER : 0) - (hi < lean.length - 1 ? MARKER : 0)
    const only = items[0]!
    const count = only.count === undefined ? "" : ` ${only.count}`
    items[0] = { ...only, title: truncate(only.title, Math.max(1, room - displayWidth(count))) }
  }
  return { items, before: lo > 0, after: hi < lean.length - 1 }
}

export function Tabs(props: { tabs: TabItem[]; active: string; onChange(id: string): void; focused?: boolean; width?: number }) {
  const keys = useKeys()
  const dims = useTerminalDimensions()
  useScreenKeys((key) => {
    if (props.focused === false || keys.typing() || (key.name !== "left" && key.name !== "right")) return
    const i = props.tabs.findIndex((t) => t.id === props.active)
    const next = props.tabs[Math.min(props.tabs.length - 1, Math.max(0, i + (key.name === "left" ? -1 : 1)))]
    key.preventDefault()
    if (next && next.id !== props.active) props.onChange(next.id)
  })
  const fit = createMemo(() =>
    fitTabs(
      props.tabs,
      props.tabs.findIndex((t) => t.id === props.active),
      props.width ?? dims().width - 2,
    ),
  )
  return (
    <box flexDirection="row" height={1} flexShrink={0} gap={GAP}>
      <Show when={fit().before}>
        <text fg={theme.muted}>‹</text>
      </Show>
      <For each={fit().items}>
        {(x) => {
          const on = () => props.tabs[x.index]?.id === props.active
          return (
            <box flexDirection="row" flexShrink={0} backgroundColor={on() ? theme.selectedBg : theme.bg} paddingLeft={1} paddingRight={1}>
              <text fg={on() ? (keys.active() && props.focused !== false ? theme.accent : theme.text) : theme.muted}>{x.title}</text>
              <Show when={x.count !== undefined}>
                <text fg={theme.muted}>{` ${x.count}`}</text>
              </Show>
            </box>
          )
        }}
      </For>
      <Show when={fit().after}>
        <text fg={theme.muted}>›</text>
      </Show>
    </box>
  )
}
