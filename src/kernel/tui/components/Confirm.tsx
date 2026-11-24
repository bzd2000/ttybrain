// The in-TUI confirmation (spec §9, `Del`): `<text>  y yes · n no`. `y` answers yes, `n` or Esc no; it is
// modal and claims every key, so nothing else (not even `q`) acts while it is open.
import { onMount } from "solid-js"
import { printable, useKeys, useScreenKeys } from "../keys"
import { theme } from "../theme"

export function Confirm(props: { text: string; answer(yes: boolean): void }) {
  const keys = useKeys()
  onMount(() =>
    keys.hints([
      { key: "y", label: "yes" },
      { key: "n", label: "no" },
    ]),
  )
  useScreenKeys((key) => {
    key.preventDefault()
    const ch = printable(key)
    if (ch === "y") props.answer(true)
    else if (ch === "n" || key.name === "escape") props.answer(false)
  })
  return (
    <box border borderStyle="rounded" borderColor={theme.accent} backgroundColor={theme.panel} paddingLeft={1} paddingRight={1}>
      <text fg={theme.text}>{`${props.text}  y yes · n no`}</text>
    </box>
  )
}
