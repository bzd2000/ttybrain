import { For } from "solid-js"
import { theme } from "../theme"

export type KeyHint = { key: string; label: string }

export function StatusBar(props: { hints: KeyHint[] }) {
  return (
    <box height={1} flexDirection="row" gap={2} paddingLeft={1} backgroundColor={theme.panel}>
      <For each={props.hints}>
        {(hint) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.accent}>{hint.key}</text>
            <text fg={theme.muted}>{hint.label}</text>
          </box>
        )}
      </For>
    </box>
  )
}
