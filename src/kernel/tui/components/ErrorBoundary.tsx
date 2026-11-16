// Contains a throwing screen, tab, panel or overlay (spec §10): it shows `⚠ <label>: <message>` in place, in red,
// and the rest of the app keeps running. With `close` (an overlay), Esc closes it: the overlay's own key handler
// never registered, and the global keys ignore keys while an overlay is on top.
import { ErrorBoundary as SolidErrorBoundary, type JSX } from "solid-js"
import { useKeys, useScreenKeys } from "../keys"
import { theme } from "../theme"

export function ErrorBoundary(props: { label: string; close?: () => void; children: JSX.Element }) {
  return (
    <SolidErrorBoundary fallback={(e: unknown) => <Failed label={props.label} error={e} close={props.close} />}>{props.children}</SolidErrorBoundary>
  )
}

function Failed(props: { label: string; error: unknown; close: (() => void) | undefined }) {
  const close = props.close
  if (close) {
    useKeys().hints([{ key: "Esc", label: "close" }])
    useScreenKeys((key) => {
      if (key.name !== "escape") return
      key.preventDefault()
      close()
    })
  }
  const message = props.error instanceof Error ? props.error.message : String(props.error)
  return <text fg={theme.red}>{`⚠ ${props.label}: ${message}`}</text>
}
