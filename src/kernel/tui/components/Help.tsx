// Help (`?`): the global keys (the kernel's, then one per registered global action), the keys of what has focus now, and the plugin problems (tui parts that failed
// or were skipped, and logic plugins that failed to load). Esc or `?` closes it; it claims every key while open.
import { For, onMount, Show } from "solid-js"
import { GLOBAL_KEYS, printable, useKeys, useScreenKeys, type Hint } from "../keys"
import { theme } from "../theme"

const KEY_WIDTH = 10

function KeyRows(props: { rows: Hint[] }) {
  return (
    <box flexDirection="column" width={28}>
      <For each={props.rows}>
        {(h) => (
          <box flexDirection="row">
            <text fg={theme.accent} width={KEY_WIDTH}>
              {h.key}
            </text>
            <text fg={theme.text}>{h.label}</text>
          </box>
        )}
      </For>
    </box>
  )
}

export function Help(props: { hints: Hint[]; actions: Hint[]; problems: string[]; close(): void }) {
  const keys = useKeys()
  const all = [...GLOBAL_KEYS, ...props.actions]
  const half = Math.ceil(all.length / 2)
  onMount(() => keys.hints([{ key: "Esc", label: "close" }]))
  useScreenKeys((key) => {
    key.preventDefault()
    if (key.name === "escape" || printable(key) === "?") props.close()
  })

  return (
    <box border borderColor={theme.accent} backgroundColor={theme.panel} flexDirection="column" width={64} paddingLeft={1} paddingRight={1} title="Help">
      <text fg={theme.muted}>Keys</text>
      <box flexDirection="row" gap={2}>
        <KeyRows rows={all.slice(0, half)} />
        <KeyRows rows={all.slice(half)} />
      </box>
      <Show when={props.hints.length > 0}>
        <text> </text>
        <text fg={theme.muted}>Here</text>
        <text fg={theme.text}>{props.hints.map((h) => `${h.key} ${h.label}`).join("   ")}</text>
      </Show>
      <text> </text>
      <text fg={theme.muted}>Plugin problems</text>
      <Show when={props.problems.length > 0} fallback={<text fg={theme.text}>none</text>}>
        <For each={props.problems}>{(p) => <text fg={theme.red}>{p}</text>}</For>
      </Show>
    </box>
  )
}
