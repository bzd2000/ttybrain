// What plugins' tui parts import from the kernel (the future `@pm/api/tui`): defineTui, the extension-point
// types, the hooks and the theme. Building blocks join it as they arrive.
export { defineTui } from "./types"
export type {
  Cell,
  FieldEditorProps,
  GlobalActionDef,
  ListColumnDef,
  OverviewPanelDef,
  OverviewRow,
  RecordFormDef,
  RecordFormProps,
  RecordTabDef,
  Route,
  ScreenDef,
  StatusBadgeDef,
  Tone,
  TuiContext,
  TuiDef,
} from "./types"
export { useNav, type Nav } from "./nav"
// Take keys with useScreenKeys, not OpenTUI's raw useKeyboard: it ignores keys while an overlay sits above the
// component, so overlays get keys first. Claim a key with key.preventDefault() so the global keys skip it.
export { useKeys, useScreenKeys, type Hint, type Keys } from "./keys"
// Loads and writes: useQuery reloads live and keeps the last data; act runs a write with busy retry and messages.
export { act, useQuery, useRuntime, type ActResult, type Query } from "./data"
export { ErrorBoundary } from "./components/ErrorBoundary"
export { notify } from "./messages"
export { theme, toneColor } from "./theme"
