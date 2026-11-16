import type { Section } from "../sections"
import { theme } from "../theme"

export function MainPanel(props: { section: Section; focused: boolean }) {
  return (
    <box
      flexGrow={1}
      border
      borderStyle="rounded"
      borderColor={props.focused ? theme.borderFocused : theme.border}
      title={props.section.name}
    >
      <scrollbox focused={props.focused} flexGrow={1} paddingLeft={1} paddingRight={1}>
        {props.section.view()}
      </scrollbox>
    </box>
  )
}
