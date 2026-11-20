// Shows `hints` in the status bar while mounted and focused (focused defaults to true). `exact` and `frame` are
// useKeys().hints' options (HintOptions): `exact` makes these the layer's whole own part of the bar.
import { createEffect, onCleanup } from "solid-js"
import { useKeys, type Hint } from "../keys"

export function KeyHints(props: { hints: Hint[]; focused?: boolean; exact?: boolean; frame?: string[] }) {
  const keys = useKeys()
  createEffect(() => {
    if (props.focused === false) return
    onCleanup(keys.hints(props.hints, { ...(props.exact ? { exact: true } : {}), ...(props.frame ? { frame: props.frame } : {}) }))
  })
  return null
}
