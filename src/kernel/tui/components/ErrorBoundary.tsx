// Contains a throwing screen, tab or panel (spec §10): it shows `⚠ <label>: <message>` in place, in red, and
// the rest of the app keeps running.
import { ErrorBoundary as SolidErrorBoundary, type JSX } from "solid-js"
import { theme } from "../theme"

export function ErrorBoundary(props: { label: string; children: JSX.Element }) {
  return (
    <SolidErrorBoundary fallback={(e: unknown) => <text fg={theme.red}>{`⚠ ${props.label}: ${e instanceof Error ? e.message : String(e)}`}</text>}>
      {props.children}
    </SolidErrorBoundary>
  )
}
