// What the plugins' tui parts registered, by plugin, so a part that fails can be removed wholesale. The
// registration rules (slots, keys, duplicates) are checked here; bootTui (boot.ts) feeds it and seals it.
import type { Component } from "solid-js"
import { IsolationError, ValidationError } from "../errors"
import type {
  FieldEditorProps,
  GlobalActionDef,
  ListColumnDef,
  OverviewPanelDef,
  RecordFormDef,
  RecordTabDef,
  ScreenDef,
  StatusBadgeDef,
} from "./types"

// Keys the kernel's global key map owns (spec §9), plus `c` for the assistant (phase 7). Screen-local keys
// are not reserved: the focused screen's handler runs before global actions.
export const RESERVED_KEYS: ReadonlySet<string> = new Set(["j", "k", "n", "e", "x", "g", "q", "?", "/", "1", "2", "3", "4", "5", "6", "7", "8", "9", "c"])
// Slot 1 is the kernel's Overview; built-in screens may take 2–6; the rest are numbered from 7 in order.
export const OVERVIEW_SLOT = 1
const BUILTIN_SLOTS = { min: 2, max: 6 }
const FIRST_FREE_SLOT = 7

type Owned<T> = { plugin: string } & T

export class TuiRegistry {
  private sealed = false
  private readonly screenList: Array<Owned<{ def: ScreenDef; slot?: number }>> = []
  private readonly tabList: Array<Owned<{ recordType: string; def: RecordTabDef }>> = []
  private readonly panelList: Array<Owned<{ def: OverviewPanelDef }>> = []
  private readonly columnList: Array<Owned<{ list: string; def: ListColumnDef }>> = []
  private readonly formList: Array<Owned<{ recordType: string; def: RecordFormDef }>> = []
  private readonly editorList: Array<Owned<{ recordType: string; field: string; editor: Component<FieldEditorProps> }>> = []
  private readonly actionList: Array<Owned<{ def: GlobalActionDef }>> = []
  private readonly badgeList: Array<Owned<{ def: StatusBadgeDef }>> = []
  private readonly errorList: Array<{ plugin: string; error: string }> = []

  // --- getters ---

  // Built-in screens by their slot, then the others numbered 7, 8, … in registration order.
  screens(): Array<ScreenDef & { slot: number }> {
    const fixed = this.screenList.filter((s) => s.slot !== undefined).sort((a, b) => a.slot! - b.slot!)
    const numbered = this.screenList.filter((s) => s.slot === undefined)
    return [...fixed.map((s) => ({ ...s.def, slot: s.slot! })), ...numbered.map((s, i) => ({ ...s.def, slot: FIRST_FREE_SLOT + i }))]
  }

  screenBySlot(n: number): (ScreenDef & { slot: number }) | undefined {
    return this.screens().find((s) => s.slot === n)
  }

  tabsFor(recordType: string): RecordTabDef[] {
    return this.tabList.filter((t) => t.recordType === recordType).map((t) => t.def).sort((a, b) => a.order - b.order)
  }

  // By priority; ties keep registration order (Array.prototype.sort is stable).
  panels(): OverviewPanelDef[] {
    return this.panelList.map((p) => p.def).sort((a, b) => a.priority - b.priority)
  }

  columns(list: string): ListColumnDef[] {
    return this.columnList.filter((c) => c.list === list).map((c) => c.def)
  }

  forms(recordType: string): RecordFormDef[] {
    return this.formList.filter((f) => f.recordType === recordType).map((f) => f.def)
  }

  editor(recordType: string, field: string): Component<FieldEditorProps> | undefined {
    return this.editorList.find((e) => e.recordType === recordType && e.field === field)?.editor
  }

  globalActions(): GlobalActionDef[] {
    return this.actionList.map((a) => a.def)
  }

  badges(): StatusBadgeDef[] {
    return this.badgeList.map((b) => b.def).sort((a, b) => a.order - b.order)
  }

  errors(): Array<{ plugin: string; error: string }> {
    return [...this.errorList]
  }

  // --- registration (bootTui's TuiContext calls these with the part's plugin id) ---

  addScreen(plugin: string, def: ScreenDef, builtin: boolean): void {
    this.open()
    if (this.screenList.some((s) => s.def.id === def.id)) throw new ValidationError(`screen "${def.id}" is already registered`)
    const slot = builtin ? def.slot : undefined
    if (slot !== undefined) {
      if (slot === OVERVIEW_SLOT) throw new ValidationError(`slot ${OVERVIEW_SLOT} is reserved for the Overview screen`)
      if (!Number.isInteger(slot) || slot < BUILTIN_SLOTS.min || slot > BUILTIN_SLOTS.max) {
        throw new ValidationError(`slot ${slot} must be between ${BUILTIN_SLOTS.min} and ${BUILTIN_SLOTS.max}`)
      }
      const taken = this.screenList.find((s) => s.slot === slot)
      if (taken) throw new ValidationError(`slot ${slot} is already taken by screen "${taken.def.id}"`)
    }
    this.screenList.push({ plugin, def, ...(slot !== undefined ? { slot } : {}) })
  }

  // The record type may belong to a plugin loaded later (or never): the tab is kept and shown only if it exists.
  addRecordTab(plugin: string, recordType: string, def: RecordTabDef): void {
    this.open()
    if (this.tabList.some((t) => t.recordType === recordType && t.def.id === def.id)) throw new ValidationError(`tab "${def.id}" of "${recordType}" is already registered`)
    this.tabList.push({ plugin, recordType, def })
  }

  addPanel(plugin: string, def: OverviewPanelDef): void {
    this.open()
    if (this.panelList.some((p) => p.def.id === def.id)) throw new ValidationError(`overview panel "${def.id}" is already registered`)
    this.panelList.push({ plugin, def })
  }

  addColumn(plugin: string, list: string, def: ListColumnDef): void {
    this.open()
    if (this.columnList.some((c) => c.list === list && c.def.id === def.id)) throw new ValidationError(`column "${def.id}" of list "${list}" is already registered`)
    this.columnList.push({ plugin, list, def })
  }

  addForm(plugin: string, recordType: string, def: RecordFormDef): void {
    this.open()
    if (this.formList.some((f) => f.recordType === recordType && f.def.id === def.id)) throw new ValidationError(`form "${def.id}" of "${recordType}" is already registered`)
    this.formList.push({ plugin, recordType, def })
  }

  addEditor(plugin: string, recordType: string, field: string, editor: Component<FieldEditorProps>): void {
    this.open()
    if (this.editorList.some((e) => e.recordType === recordType && e.field === field)) throw new ValidationError(`an editor for "${recordType}.${field}" is already registered`)
    this.editorList.push({ plugin, recordType, field, editor })
  }

  addGlobalAction(plugin: string, def: GlobalActionDef): void {
    this.open()
    if ([...def.key].length !== 1) throw new ValidationError(`key "${def.key}" must be a single character`)
    if (RESERVED_KEYS.has(def.key) || this.actionList.some((a) => a.def.key === def.key)) throw new ValidationError(`key "${def.key}" is already taken`)
    if (this.actionList.some((a) => a.def.id === def.id)) throw new ValidationError(`global action "${def.id}" is already registered`)
    this.actionList.push({ plugin, def })
  }

  addBadge(plugin: string, def: StatusBadgeDef): void {
    this.open()
    if (this.badgeList.some((b) => b.def.id === def.id)) throw new ValidationError(`status badge "${def.id}" is already registered`)
    this.badgeList.push({ plugin, def })
  }

  // --- lifecycle (bootTui) ---

  // Removes everything `plugin` registered.
  remove(plugin: string): void {
    for (const list of [this.screenList, this.tabList, this.panelList, this.columnList, this.formList, this.editorList, this.actionList, this.badgeList] as Array<Array<{ plugin: string }>>) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i]!.plugin === plugin) list.splice(i, 1)
    }
  }

  recordError(plugin: string, error: string): void {
    this.errorList.push({ plugin, error })
  }

  seal(): void {
    this.sealed = true
  }

  private open(): void {
    if (this.sealed) throw new IsolationError("plugins can only register during activate")
  }
}
