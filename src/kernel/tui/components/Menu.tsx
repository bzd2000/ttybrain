// A small overlay list of actions: ↑↓/jk move, Enter runs the selected item, an item's own key runs it, Esc
// closes. It closes before running the item. It is modal: it claims every key while open.
import { createSignal, For, onMount } from "solid-js"
import { printable, useKeys, useScreenKeys } from "../keys"
import { theme } from "../theme"

export type MenuItem = { key?: string; label: string; run(): void }

export function Menu(props: { items: MenuItem[]; close(): void; title?: string }) {
  const keys = useKeys()
  const [index, setIndex] = createSignal(0)
  onMount(() =>
    keys.hints([
      { key: "↑↓", label: "move" },
      { key: "Enter", label: "run" },
      { key: "Esc", label: "close" },
    ]),
  )
  const run = (item: MenuItem | undefined) => {
    if (!item) return
    props.close()
    item.run()
  }
  const move = (d: number) => setIndex((i) => Math.min(props.items.length - 1, Math.max(0, i + d)))
  useScreenKeys((key) => {
    key.preventDefault()
    const ch = printable(key)
    if (key.name === "escape") props.close()
    else if (key.name === "return") run(props.items[index()])
    else if (key.name === "up" || ch === "k") move(-1)
    else if (key.name === "down" || ch === "j") move(1)
    else if (ch !== undefined) run(props.items.find((i) => i.key === ch))
  })
  return (
    <box border borderStyle="rounded" borderColor={theme.accent} titleColor={theme.accent} backgroundColor={theme.panel} flexDirection="column" minWidth={24} paddingLeft={1} paddingRight={1} title={props.title === undefined ? undefined : ` ${props.title} `}>
      <For each={props.items}>
        {(item, i) => (
          <box flexDirection="row" gap={1} backgroundColor={i() === index() ? theme.selectedBg : theme.panel}>
            <text fg={theme.accent} width={1}>
              {item.key ?? " "}
            </text>
            <text fg={i() === index() ? theme.accent : theme.text}>{item.label}</text>
          </box>
        )}
      </For>
    </box>
  )
}
