// The frame around every screen: the header (screen chip, breadcrumbs, badges, date) and the status bar
// (the keys valid right now, or a message for 5 s).
import { For, Show } from "solid-js"
import { useQuery } from "./data"
import type { Hint } from "./keys"
import type { Message } from "./messages"
import type { Registered } from "./registry"
import { PluginScope, useApp } from "./scope"
import { theme } from "./theme"
import type { StatusBadgeDef } from "./types"

// One plugin badge: its text() through useQuery (live), nothing while it is null or loading.
function Badge(props: { def: StatusBadgeDef }) {
  const q = useQuery(() => props.def.text())
  return <Show when={q.data()}>{(t: () => string) => <text fg={theme.text}>{t()}</text>}</Show>
}

// `badges` are rendered in the given order (the registry sorts them by `order`), each in its plugin's scope.
export function Header(props: { chip: string; crumbs: string[]; badges: Array<Registered<StatusBadgeDef>>; date: string }) {
  const app = useApp()
  return (
    <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} backgroundColor={theme.panel}>
      <box flexDirection="row" flexShrink={1} overflow="hidden">
        <text fg={theme.muted}>{"pm · "}</text>
        <text fg={theme.accent}>{props.chip}</text>
        <For each={props.crumbs}>{(c) => <text fg={theme.text}>{` › ${c}`}</text>}</For>
      </box>
      <box flexDirection="row" flexShrink={0} gap={2}>
        <For each={props.badges}>
          {(b) => (
            <PluginScope kernel={app.kernel} plugin={b.plugin} label={b.id}>
              <Badge def={b} />
            </PluginScope>
          )}
        </For>
        <text fg={theme.muted}>{props.date}</text>
      </box>
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
