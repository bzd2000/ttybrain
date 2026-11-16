// A bordered panel: the title (`Title · count` once the count is known) sits in the top border, which takes the
// accent colour while the panel has focus; an optional footer line closes it. With `grow` it takes the height
// left over and no more, so a Table inside it scrolls instead of pushing the panel past the screen.
import { Show, type JSX } from "solid-js"
import { theme } from "../theme"

export function Panel(props: { title: string; count?: number; focused?: boolean; footer?: string; grow?: boolean; children?: JSX.Element }) {
  const title = () => (props.count === undefined ? props.title : `${props.title} · ${props.count}`)
  return (
    <box
      border
      borderColor={props.focused ? theme.accent : theme.border}
      title={title()}
      flexDirection="column"
      flexGrow={props.grow ? 1 : 0}
      flexShrink={props.grow ? 1 : 0}
      minHeight={props.grow ? 0 : undefined}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.bg}
    >
      {props.children}
      <Show when={props.footer}>{(f: () => string) => <text fg={theme.muted}>{f()}</text>}</Show>
    </box>
  )
}
