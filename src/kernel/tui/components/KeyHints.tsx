// Shows `hints` in the status bar while mounted and focused (focused defaults to true).
import { createEffect, onCleanup } from "solid-js"
import { useKeys, type Hint } from "../keys"

export function KeyHints(props: { hints: Hint[]; focused?: boolean }) {
  const keys = useKeys()
  createEffect(() => {
    if (props.focused === false) return
    onCleanup(keys.hints(props.hints))
  })
  return null
}
