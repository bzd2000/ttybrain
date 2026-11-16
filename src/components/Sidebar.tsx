import type { Section } from "../sections"
import { theme } from "../theme"

export function Sidebar(props: { sections: Section[]; focused: boolean; onChange: (index: number) => void }) {
  return (
    <box
      width={24}
      border
      borderStyle="rounded"
      borderColor={props.focused ? theme.borderFocused : theme.border}
      title="Sections"
    >
      <select
        flexGrow={1}
        focused={props.focused}
        options={props.sections.map((s) => ({ name: s.name, description: s.description, value: s.id }))}
        onChange={(index) => props.onChange(index)}
        backgroundColor={theme.bg}
        focusedBackgroundColor={theme.bg}
        textColor={theme.text}
        focusedTextColor={theme.text}
        selectedBackgroundColor={theme.selectedBg}
        selectedTextColor={theme.accent}
        descriptionColor={theme.muted}
        selectedDescriptionColor={theme.muted}
      />
    </box>
  )
}
