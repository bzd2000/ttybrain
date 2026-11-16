// The frame around every screen: the header (screen chip, breadcrumbs, badges, date) and the status bar
// (the keys valid right now, or a message for 5 s).
import { For, Show } from "solid-js"
import type { Hint } from "./keys"
import type { Message } from "./messages"
import { theme } from "./theme"

export function Header(props: { chip: string; crumbs: string[]; badges: string[]; date: string }) {
  const right = () => [...props.badges, props.date].join("  ")
  return (
    <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} backgroundColor={theme.panel}>
      <box flexDirection="row" flexShrink={1} overflow="hidden">
        <text fg={theme.muted}>{"pm · "}</text>
        <text fg={theme.accent}>{props.chip}</text>
        <For each={props.crumbs}>{(c) => <text fg={theme.text}>{` › ${c}`}</text>}</For>
      </box>
      <text fg={theme.muted} flexShrink={0}>
        {right()}
      </text>
    </box>
  )
}

export function StatusBar(props: { hints: Hint[]; message: Message | null }) {
  return (
    <box height={1} flexShrink={0} flexDirection="row" gap={2} paddingLeft={1} backgroundColor={theme.panel}>
      <Show
        when={props.message}
        fallback={
          <For each={props.hints}>
            {(hint) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.accent}>{hint.key}</text>
                <text fg={theme.muted}>{hint.label}</text>
              </box>
            )}
          </For>
        }
      >
        {(m: () => Message) => <text fg={m().kind === "error" ? theme.red : theme.text}>{m().text}</text>}
      </Show>
    </box>
  )
}
