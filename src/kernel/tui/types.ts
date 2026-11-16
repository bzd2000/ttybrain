// The TUI extension points: what a plugin's tui part registers through its TuiContext. These names are the
// contract every screen, tab, panel and overlay builds on (and, in phase 5, external plugins).
import type { Component } from "solid-js"
import type { Origin } from "../context"
import type { PluginRuntime } from "../plugin"

export type Tone = "red" | "amber" | "green" | "muted" | "accent" | undefined
export type Cell = { text: string; tone?: Tone }
export type Route =
  | { kind: "screen"; screen: string; params?: Record<string, string> }
  | { kind: "record"; screen: string; ref: string; tab?: string }
export type ScreenDef = { id: string; title: string; slot?: number; component: Component<{}>; count?: () => Promise<number> }
export type RecordTabDef = { id: string; title: string; order: number; count?: (ref: string) => Promise<number | null>; component: Component<{ ref: string }> }
export type OverviewRow = { ref: string; cells: Cell[] }
export type OverviewPanelDef = { id: string; title: string; priority: number; empty: string; footer?: string; load(): Promise<OverviewRow[]> }
export type ListColumnDef = { id: string; title: string; width: number; value(ref: string): Promise<string | null> }
export type RecordFormProps = { ref?: string; prefill?: Record<string, string>; origin?: Origin; close(savedRef?: string): void }
export type RecordFormDef = { id: string; label: string; component: Component<RecordFormProps> }
export type GlobalActionDef = { id: string; key: string; label: string; overlay: Component<{ close(): void }> }
export type StatusBadgeDef = { id: string; order: number; text(): Promise<string | null> }
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
}

export type TuiDef = { plugin: string; activate(ui: TuiContext): void }

export function defineTui(def: TuiDef): TuiDef {
  return def
}
