// The screen switcher (`g`): every screen as `<slot> <title>`, with its count when the screen defines one.
// ↑↓/jk move, Enter goes there, 1–9 jump, Esc closes. It is modal: it claims every key while open.
import { useKeyboard } from "@opentui/solid"
import { createSignal, For, onMount, Show } from "solid-js"
import { printable, useKeys } from "../keys"
import { theme } from "../theme"

export type SwitcherEntry = { id: string; slot: number; title: string; count?: () => Promise<number> }

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
  onMount(() =>
    keys.hints([
      { key: "↑↓", label: "move" },
      { key: "Enter", label: "go" },
      { key: "1–9", label: "jump" },
      { key: "Esc", label: "close" },
    ]),
  )
  const move = (d: number) => setIndex((i) => Math.min(props.screens.length - 1, Math.max(0, i + d)))
  const go = (id: string) => {
    props.close()
    props.select(id)
  }

  useKeyboard((key) => {
    if (!keys.active()) return
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
    <box border borderColor={theme.accent} backgroundColor={theme.panel} flexDirection="column" width={36} paddingLeft={1} paddingRight={1} title="Screens">
      <For each={props.screens}>
        {(s, i) => (
          <box flexDirection="row" justifyContent="space-between" backgroundColor={i() === index() ? theme.selectedBg : theme.panel}>
            <text fg={i() === index() ? theme.accent : theme.text}>{`${s.slot} ${s.title}`}</text>
            <Show when={counts()[s.id] !== undefined}>
              <text fg={theme.muted}>{String(counts()[s.id])}</text>
            </Show>
          </box>
        )}
      </For>
    </box>
  )
}
