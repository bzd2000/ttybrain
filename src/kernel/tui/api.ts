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
export { useKeys, type Hint, type Keys } from "./keys"
export { notify } from "./messages"
export { theme, toneColor } from "./theme"
