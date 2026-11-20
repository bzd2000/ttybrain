// The TUI extension points: what a plugin's tui part registers through its TuiContext. These names are the
// contract every screen, tab, panel and overlay builds on (and, in phase 5, external plugins).
import type { Component } from "solid-js"
import type { Origin } from "../context"
import type { PluginRuntime } from "../plugin"

export type Tone = "red" | "amber" | "green" | "muted" | "accent" | "cyan" | "magenta" | undefined
export type Cell = { text: string; tone?: Tone }
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
  component: Component<{ recordRef: string }>
}
export type OverviewRow = { ref: string; cells: Cell[] }
// `count: false` leaves the row count out of the panel title (default: `Title · n`).
export type OverviewPanelDef = { id: string; title: string; priority: number; empty: string; footer?: string; count?: boolean; load(): Promise<OverviewRow[]> }
export type ListColumnDef = { id: string; title: string; width: number; value(ref: string): Promise<string | null> }
export type RecordFormProps = { recordRef?: string; prefill?: Record<string, string>; origin?: Origin; close(savedRef?: string): void }
export type RecordFormDef = { id: string; label: string; component: Component<RecordFormProps> }
export type GlobalActionDef = { id: string; key: string; label: string; overlay: Component<{ close(): void }> }
// `tone`: the badge's colour (text colour by default).
export type StatusBadgeDef = { id: string; order: number; tone?: Tone; text(): Promise<string | null> }
// How an open record shows in the header's breadcrumb `› <ref> <label> <detail>`: `tone` colours the ref (text
// colour by default) and `detail` adds a muted tail: `Thu 4 Dec · 8 attendees` shows as `· Thu 4 Dec · 8 attendees`
// (null or a throw adds none).
export type RecordCrumbDef = { tone?: Tone; detail?(recordRef: string): Promise<string | null> }
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
}

export type TuiDef = { plugin: string; activate(ui: TuiContext): void }

export function defineTui(def: TuiDef): TuiDef {
  return def
}
