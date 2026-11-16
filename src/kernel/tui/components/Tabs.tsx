// A row of tabs (`Title count`), the active one highlighted; ←→ switch while focused.
import { For, Show } from "solid-js"
import { useKeys, useScreenKeys } from "../keys"
import { theme } from "../theme"

export type TabItem = { id: string; title: string; count?: number | null }

export function Tabs(props: { tabs: TabItem[]; active: string; onChange(id: string): void; focused?: boolean }) {
  const keys = useKeys()
  useScreenKeys((key) => {
    if (props.focused === false || keys.typing() || (key.name !== "left" && key.name !== "right")) return
    const i = props.tabs.findIndex((t) => t.id === props.active)
    const next = props.tabs[Math.min(props.tabs.length - 1, Math.max(0, i + (key.name === "left" ? -1 : 1)))]
    key.preventDefault()
    if (next && next.id !== props.active) props.onChange(next.id)
  })
  return (
    <box flexDirection="row" height={1} flexShrink={0} gap={1}>
      <For each={props.tabs}>
        {(t) => {
          const on = () => t.id === props.active
          return (
            <box flexDirection="row" backgroundColor={on() ? theme.selectedBg : theme.bg} paddingLeft={1} paddingRight={1}>
              <text fg={on() ? (keys.active() && props.focused !== false ? theme.accent : theme.text) : theme.muted}>{t.title}</text>
              <Show when={t.count !== undefined && t.count !== null}>
                <text fg={theme.muted}>{` ${t.count}`}</text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
