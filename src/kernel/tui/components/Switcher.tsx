// The screen switcher (`g`): a dropdown under the header chip listing every screen as `<slot>  <title>`, with its
// count right-aligned when the screen defines one (in the screen's countTone, muted by default). ↑↓/jk move, Enter
// goes there, the number keys jump, Esc closes. It is modal: it claims every key while open.
import { createSignal, For, onMount, Show } from "solid-js"
import { printable, useKeys, useScreenKeys } from "../keys"
import { theme, toneColor } from "../theme"
import type { Tone } from "../types"

export type SwitcherEntry = { id: string; slot: number; title: string; count?: () => Promise<number>; countTone?: Tone }

// The designs' dropdown: 26 cells wide, a rounded focused border, no title.
const WIDTH = 26

export function Switcher(props: {
  screens: SwitcherEntry[]
  current: string
  select(id: string): void
  close(): void
  load(count: () => Promise<number>): Promise<number>
}) {
  const keys = useKeys()
  const [index, setIndex] = createSignal(Math.max(0, props.screens.findIndex((s) => s.id === props.current)))
  const [counts, setCounts] = createSignal<Record<string, number>>({})
  for (const s of props.screens) {
    if (!s.count) continue
    props.load(s.count).then(
      (n) => setCounts((c) => ({ ...c, [s.id]: n })),
      () => {},
    )
  }
  const slots = props.screens.map((s) => s.slot)
  const range = slots.length > 1 ? `${Math.min(...slots)}-${Math.max(...slots)}` : String(slots[0] ?? 1)
  onMount(() =>
    keys.hints([
      { key: "↑↓", label: "move" },
      { key: range, label: "jump" },
      { key: "Enter", label: "go" },
      { key: "Esc", label: "close" },
    ]),
  )
  const move = (d: number) => setIndex((i) => Math.min(props.screens.length - 1, Math.max(0, i + d)))
  const go = (id: string) => {
    props.close()
    props.select(id)
  }

  useScreenKeys((key) => {
    key.preventDefault()
    const ch = printable(key)
    if (key.name === "escape") props.close()
    else if (key.name === "up" || ch === "k") move(-1)
    else if (key.name === "down" || ch === "j") move(1)
    else if (key.name === "return") {
      const s = props.screens[index()]
      if (s) go(s.id)
    } else if (ch !== undefined && ch >= "1" && ch <= "9") {
      const s = props.screens.find((x) => x.slot === Number(ch))
      if (s) go(s.id)
    }
  })

  return (
    <box border borderStyle="rounded" borderColor={theme.borderFocused} backgroundColor={theme.bg} flexDirection="column" width={WIDTH} paddingLeft={1} paddingRight={1}>
      <For each={props.screens}>
        {(s, i) => {
          const selected = () => i() === index()
          return (
            <box flexDirection="row" justifyContent="space-between" backgroundColor={selected() ? theme.selectedBg : theme.bg}>
              <box flexDirection="row" flexShrink={1} overflow="hidden">
                <text fg={selected() ? theme.accent : theme.muted} flexShrink={0}>{`${s.slot}  `}</text>
                <text fg={selected() ? theme.accent : theme.text}>{s.title}</text>
              </box>
              <Show when={counts()[s.id] !== undefined}>
                <text fg={toneColor(s.countTone ?? "muted")} flexShrink={0}>
                  {String(counts()[s.id])}
                </text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
