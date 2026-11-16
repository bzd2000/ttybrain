// The Overview screen (slot 1). A stub until the panels arrive (Task 6).
import { theme } from "../theme"

export function OverviewScreen() {
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={theme.accent}>Overview</text>
      <text fg={theme.muted}>No panels</text>
    </box>
  )
}
