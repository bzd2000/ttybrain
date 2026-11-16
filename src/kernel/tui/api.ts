// What plugins' tui parts import from the kernel (the future `@pm/api/tui`): defineTui, the extension-point
// types, the hooks, the building blocks, the format helpers and the theme.
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
// Overlays above the screen: open(c), openForm(recordType, formId?, props?) and confirm(text).
export { useOverlay, type Overlay } from "./overlay"
// The record forms registered for a record type: Array<{ id, label, plugin }> (for a menu of forms to open).
export { useRecordForms } from "./overlay"
export type { EditorOptions } from "./components/Editor"
// $VISUAL/$EDITOR handoff (local mode); returns the new text, or null when unchanged, failed or in a container.
export { editExternal, useEditExternal } from "./external"
// Take keys with useScreenKeys, not OpenTUI's raw useKeyboard: it ignores keys while an overlay sits above the
// component, so overlays get keys first, and while a text field has focus it withholds printable keys and Enter
// (a component that owns the text field passes { whileTyping: true }). Claim a key with key.preventDefault() so
// the global keys skip it. printable(key) is the character a plain key press types (undefined with Ctrl/Alt/Meta).
export { printable, useKeys, useScreenKeys, type Hint, type Keys, type ScreenKeysOptions } from "./keys"
// Loads and writes: useQuery reloads live and keeps the last data; act runs a write with busy retry and messages.
// useToday() is the clock's today as an accessor that follows a day change (read it in memos and JSX).
export { act, useQuery, useRecord, useRuntime, useToday, type ActResult, type Query, type RecordInfo } from "./data"
// Building blocks.
export { Field, type FieldKind, type FieldSpec } from "./components/Field"
export { Form, type FormValues, type SubmitResult } from "./components/Form"
export { KeyHints } from "./components/KeyHints"
export { Menu, type MenuItem } from "./components/Menu"
export { Panel } from "./components/Panel"
// The extra fields of a record (the `field` extension point) as `Label  value` rows.
export { RecordFields } from "./components/RecordFields"
export { RecordView } from "./components/RecordView"
export { Table, type TableColumn, type TableGroup, type TableProps, type TableRow } from "./components/Table"
export { Tabs, type TabItem } from "./components/Tabs"
export { addDays, daysBetween } from "../dates"
export { displayWidth, dueLabel, longDate, shortDate, truncate } from "./format"
export { ErrorBoundary } from "./components/ErrorBoundary"
export { notify } from "./messages"
export { theme, toneColor } from "./theme"
