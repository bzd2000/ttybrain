import type { JSX } from "solid-js"
import { theme } from "./theme"

// Each entry is one item in the sidebar and one view in the main panel.
// To add a screen, add an entry here.
export type Section = {
  id: string
  name: string
  description: string
  view: () => JSX.Element
}

export const sections: Section[] = [
  {
    id: "home",
    name: "Home",
    description: "Welcome screen",
    view: () => (
      <box flexDirection="column" gap={1}>
        <text fg={theme.accent}>
          <b>Welcome</b>
        </text>
        <text fg={theme.text}>This is a starter OpenTUI + Solid app.</text>
        <text fg={theme.muted}>Pick a section on the left. Press tab to move focus to this panel.</text>
      </box>
    ),
  },
  {
    id: "items",
    name: "Items",
    description: "A scrollable list",
    view: () => (
      <box flexDirection="column">
        {Array.from({ length: 50 }, (_, i) => (
          <text fg={theme.text}>Item {i + 1}</text>
        ))}
      </box>
    ),
  },
  {
    id: "settings",
    name: "Settings",
    description: "Placeholder",
    view: () => <text fg={theme.muted}>Nothing here yet.</text>,
  },
]
