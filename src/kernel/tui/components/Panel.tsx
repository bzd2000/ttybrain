// A bordered panel with rounded corners. The title (`Title · count` once the count is known) sits in the top
// border with a space on each side: muted, and accent with the border while the panel has focus; a title too wide
// for the border is cut with `…` before its count. An optional footer sits on the bottom border, right-aligned and
// always muted (`╰──── status:open ─╯`); it costs no row, and is cut with `…` to the border's width. With `grow` it
// takes the height left over and no more, so a Table inside it scrolls instead of pushing the panel past the
// screen.
import { createSignal, Show, type JSX } from "solid-js"
import { displayWidth, truncate } from "../format"
import { theme } from "../theme"

// Border cells kept beside the title and the footer: the corner and one `─` on each side.
const EDGE = 2

export function Panel(props: { title: string; count?: number; focused?: boolean; footer?: string; grow?: boolean; children?: JSX.Element }) {
  const [width, setWidth] = createSignal(0)
  // ` Title · n ` cut to the top border's room (OpenTUI leaves out a title that does not fit), keeping the count.
  const title = () => {
    const count = props.count === undefined ? "" : ` · ${props.count}`
    const room = width() - 2 * EDGE - 2 - displayWidth(count)
    const text = width() === 0 || displayWidth(props.title) <= room ? props.title : truncate(props.title, Math.max(1, room))
    return ` ${text}${count} `
  }
  // ` footer ` cut to what the bottom border has between its edges (whole until the panel is measured, so the
  // first frame has it); left out when not even one cell fits.
  const footer = () => {
    if (!props.footer) return undefined
    if (width() === 0) return ` ${props.footer} `
    const room = width() - 2 * EDGE - 2
    return room < 1 ? undefined : ` ${truncate(props.footer, room)} `
  }
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.focused ? theme.borderFocused : theme.border}
      title={title()}
      titleColor={props.focused ? theme.accent : theme.muted}
      flexDirection="column"
      flexGrow={props.grow ? 1 : 0}
      flexShrink={props.grow ? 1 : 0}
      minHeight={props.grow ? 0 : undefined}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.bg}
      onSizeChange={function () {
        setWidth(this.width)
      }}
    >
      {props.children}
      <Show when={footer()}>
        {(f: () => string) => (
          // Absolutely placed on the bottom border row (offsets count from the inner edge of the border), ending
          // one `─` before the corner.
          <text position="absolute" bottom={-1} right={EDGE - 1} fg={theme.muted} bg={theme.bg} wrapMode="none">
            {f()}
          </text>
        )}
      </Show>
    </box>
  )
}
