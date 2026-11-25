// A form field's drop-down list (<Form>): a rounded box at an absolute place in the form (`top`, `left` in the form's
// padding box), `rows` entries tall plus its border, the selected entry on the selection background. It scrolls
// when it holds more entries than rows, keeping the selected one shown. It takes no keys: <Form> moves `index`.
import { createMemo, For } from "solid-js"
import { theme } from "../theme"

// The most entries a list shows at once.
export const DROPDOWN_ROWS = 8

export function Dropdown(props: { items: string[]; index: number; top: number; left: number; width: number; rows: number }) {
  // The first entry shown: moved only as far as needed to keep the selected one in view.
  const start = createMemo((prev: number) => {
    const rows = props.rows
    const max = Math.max(0, props.items.length - rows)
    let s = Math.min(prev, max)
    if (props.index < s) s = props.index
    if (props.index >= s + rows) s = props.index - rows + 1
    return Math.max(0, Math.min(s, max))
  }, 0)
  const shown = () => props.items.slice(start(), start() + props.rows).map((label, i) => ({ label, at: start() + i }))
  const room = () => Math.max(1, props.width - 4)
  const fit = (s: string) => (s.length <= room() ? s : `${s.slice(0, room() - 1)}…`)
  return (
    <box
      position="absolute"
      top={props.top}
      left={props.left}
      width={props.width}
      height={props.rows + 2}
      zIndex={10}
      border
      borderStyle="rounded"
      borderColor={theme.accent}
      backgroundColor={theme.panel}
      flexDirection="column"
    >
      <For each={shown()}>
        {(e) => {
          const on = () => e.at === props.index
          return (
            <box flexDirection="row" paddingLeft={1} paddingRight={1} backgroundColor={on() ? theme.selectedBg : theme.panel}>
              <text fg={on() ? theme.accent : theme.text} wrapMode="none">
                {fit(e.label)}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}
