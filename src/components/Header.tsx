import { theme } from "../theme"

export function Header(props: { title: string; subtitle: string }) {
  return (
    <box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} backgroundColor={theme.panel}>
      <text fg={theme.accent}>
        <b>{props.title}</b>
      </text>
      <text fg={theme.muted}>{props.subtitle}</text>
    </box>
  )
}
