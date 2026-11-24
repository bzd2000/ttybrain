// The TUI extension points: what a plugin's tui part registers through its TuiContext. These names are the
// contract every screen, tab, panel and overlay builds on (and, in phase 5, external plugins).
import type { Component } from "solid-js"
import type { Origin } from "../context"
import type { PluginRuntime } from "../plugin"
import type { Overlay } from "./overlay"

export type Tone = "red" | "amber" | "green" | "muted" | "accent" | "cyan" | "magenta" | undefined
// `parts`: the text in differently coloured pieces (their texts joined are `text`); a part without a tone takes the
// cell's. A Table cuts the parts together to the column's width. `strike`: the text struck through (an item ticked off).
export type CellPart = { text: string; tone?: Tone }
export type Cell = { text: string; tone?: Tone; parts?: CellPart[]; strike?: boolean }
export type Route =
  | { kind: "screen"; screen: string; params?: Record<string, string> }
  | { kind: "record"; screen: string; ref: string; tab?: string }
// `count`: the number the switcher shows next to the title, in `countTone` (muted by default). `records`: the record
// types that belong to this screen: a record of one opens with this screen's chip in the header, wherever it was
// opened from (one screen per type).
export type ScreenDef = {
  id: string
  title: string
  slot?: number
  component: Component<{}>
  count?: () => Promise<number>
  countTone?: Tone
  records?: string[]
}
// Components that take a record's display ref get it as `recordRef`, never `ref`: Solid's JSX treats a `ref`
// attribute as an element ref and would not pass the string.
export type RecordTabDef = {
  id: string
  title: string
  order: number
  count?: (recordRef: string) => Promise<number | null>
  // Whether the tab shows for this record (always without it). A check that throws keeps the tab.
  when?: (recordRef: string) => Promise<boolean>
  // While it is the only tab shown, the record view draws no tab row and no blank line above it (the meeting in
  // progress: one view, no tabs).
  bare?: boolean
  component: Component<{ recordRef: string }>
}
// `group`: a row with one goes under that muted sub-heading (after a blank line); consecutive rows with the same
// group share it. Rows without a group come first, under the panel title.
export type OverviewRow = { ref: string; cells: Cell[]; group?: string }
// A column width: a number of cells, `{ min, max }` (at least `min`, growing to the longest text shown up to `max`, so
// codes and ids stay whole while the grow column gives way; `drop`: on a narrow terminal it gives way, higher numbers
// first, as a Table column's `drop`), "grow" (the width left over) or `{ grow: true, min }` (the width left over,
// keeping `min` cells before the `drop` columns give way; "grow" keeps 16).
export type OverviewColumn = number | "grow" | { min: number; max: number; drop?: number } | { grow: true; min: number }
// What a key on a panel row may use: the overlays (a form to open, a question to ask before act()).
export type OverviewKeyContext = { overlay: Overlay }
// A key on a panel's selected row: `run` gets that row's ref. Its hint (`key label`) shows while the panel has focus.
export type OverviewKeyDef = { key: string; label: string; run(ref: string, ui: OverviewKeyContext): void | Promise<void> }
// The block a panel shows under its rows for the selected row (null: none for that row): a muted title, then rows.
export type OverviewDetail = { title: string; rows: OverviewRow[] }
// `count: false` leaves the row count out of the panel title (default: `Title · n`, n counting the rows without a
// group: `Title · 2` above a `Later` sub-heading). `columns`: each cell column's width (OverviewColumn); without it
// the columns fit their text and the widest one grows. `header`: the column titles, a muted first row. `footer`: a
// muted last line inside the panel; `note`: muted text on its bottom border, right-aligned (as a Panel footer), while
// it has rows.
// `keys`: keys on the selected row. `detail`: a block under the rows for the selected row, a blank line, its title
// and at most `rows` rows (more end in `+N more`), with its own columns and keys; its lines are kept free whether
// or not the selected row has one, so the panel does not change height as the selection moves. ↓ on the panel's
// last row moves the selection into the block (its keys and Enter act on its rows), ↑ on its first row back; on a
// row of the panel, the detail's keys act on the block's first row (shown selected). `lead` (the first panel by
// priority only): it takes the left column of a block at the top, `lead` : 1 of the width, with the next panels
// stacked on its right while they fit its height; the others follow in the grid below.
export type OverviewPanelDef = {
  id: string
  title: string
  priority: number
  empty: string
  footer?: string
  note?: string
  count?: boolean
  columns?: OverviewColumn[]
  header?: string[]
  lead?: number
  keys?: OverviewKeyDef[]
  detail?: { rows: number; columns?: OverviewColumn[]; keys?: OverviewKeyDef[]; load(ref: string): Promise<OverviewDetail | null> }
  load(): Promise<OverviewRow[]>
}
// A key on every view of a record of a type, whatever tab is active (a plugin's `t` on a person): `run` gets the
// record's ref and the overlays. The active tab's own keys come first, so a tab's letter wins; its hint shows after
// the tab's (an exact bar leaves it out, as it does a block's).
export type RecordKeyDef = { key: string; label: string; run(recordRef: string, ui: OverviewKeyContext): void | Promise<void> }
export type ListColumnDef = { id: string; title: string; width: number; value(ref: string): Promise<string | null> }
// `draftFor`: what a new record's form is for (its draft key names it: a talk item for @anna keeps its own draft).
export type RecordFormProps = { recordRef?: string; prefill?: Record<string, string>; origin?: Origin; draftFor?: string; close(savedRef?: string): void }
export type RecordFormDef = { id: string; label: string; component: Component<RecordFormProps> }
export type GlobalActionDef = { id: string; key: string; label: string; overlay: Component<{ close(): void }> }
// `tone`: the badge's colour (text colour by default).
export type StatusBadgeDef = { id: string; order: number; tone?: Tone; text(): Promise<string | null> }
// How an open record shows in the header's breadcrumb `› <ref> <label> <detail>`: `tone` colours the ref (text
// colour by default) and `detail` adds a muted tail: `Thu 4 Dec · 8 attendees` shows as `· Thu 4 Dec · 8 attendees`
// (null or a throw adds none). `ref: false` leaves the ref out (`› Anna Peeters · Architect · team`). `under`: for a
// record opened from another record's view (`parentRef`), the text it shows after that record's crumb instead of its
// own (`3 People ▾ › Anna Peeters › 1:1 Mon 23 Nov`, the chip then the parent's screen's); null (or a throw) keeps
// the usual crumb.
export type RecordCrumbDef = {
  tone?: Tone
  ref?: boolean
  detail?(recordRef: string): Promise<string | null>
  under?(recordRef: string, parentRef: string): Promise<string | null>
}
// Quick capture's routes: text the capture overlay would save to the inbox may go elsewhere instead (a talk-list).
// `preview(text)` says whether the route takes it: null (not its text: the next route is asked, and with none the
// text goes to the inbox), else the lines the overlay shows under its input (coloured pieces), with `declined: true`
// when the text looks like the route's but still goes to the inbox (the lines say why). `submit(text)` saves it
// (its own act) and resolves to the status-bar message, or throws (the message shows as an error, the overlay stays).
export type CapturePreview = { lines: CellPart[][]; declined?: boolean }
export type CaptureRouteDef = { id: string; preview(text: string): Promise<CapturePreview | null>; submit(text: string): Promise<string> }
export type FieldEditorProps = { value: string | null; onChange(v: string | null): void; focused: boolean }

export interface TuiContext extends PluginRuntime {
  screen(def: ScreenDef): void
  recordTab(recordType: string, def: RecordTabDef): void
  overviewPanel(def: OverviewPanelDef): void
  listColumn(list: string, def: ListColumnDef): void
  recordForm(recordType: string, def: RecordFormDef): void
  fieldEditor(recordType: string, field: string, editor: Component<FieldEditorProps>): void
  globalAction(def: GlobalActionDef): void
  statusBadge(def: StatusBadgeDef): void
  // One per record type.
  recordCrumb(recordType: string, def: RecordCrumbDef): void
  // Asked in registration order; the first whose preview is not null has the text.
  captureRoute(def: CaptureRouteDef): void
  // A key on the record views of `recordType` (one per type and key).
  recordKey(recordType: string, def: RecordKeyDef): void
}

export type TuiDef = { plugin: string; activate(ui: TuiContext): void }

export function defineTui(def: TuiDef): TuiDef {
  return def
}
