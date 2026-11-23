// What the plugins' tui parts registered, by plugin, so a part that fails can be removed wholesale. The
// registration rules (slots, keys, duplicates) are checked here; bootTui (boot.ts) feeds it and seals it.
import type { Component } from "solid-js"
import { IsolationError, ValidationError } from "../errors"
import type {
  CaptureRouteDef,
  FieldEditorProps,
  RecordKeyDef,
  GlobalActionDef,
  ListColumnDef,
  OverviewPanelDef,
  RecordCrumbDef,
  RecordFormDef,
  RecordTabDef,
  ScreenDef,
  StatusBadgeDef,
} from "./types"

// Keys the kernel's global key map owns (spec §9), plus `c` for the assistant (phase 7). Screen-local keys
// are not reserved: the focused screen's handler runs before global actions.
export const RESERVED_KEYS: ReadonlySet<string> = new Set(["j", "k", "n", "e", "x", "g", "q", "?", "/", "1", "2", "3", "4", "5", "6", "7", "8", "9", "c"])
// Slot 1 is the kernel's Attention screen; built-in screens may take 2–6; the rest are numbered from 7 in order.
export const OVERVIEW_SLOT = 1
const BUILTIN_SLOTS = { min: 2, max: 6 }
const FIRST_FREE_SLOT = 7

type Owned<T> = { plugin: string } & T

// What the getters return: the def plus the plugin that registered it, so the app can render each component in
// its plugin's scope (PluginScope: error boundary + runtime).
export type Registered<T> = T & { plugin: string }

function registered<T>(o: Owned<{ def: T }>): Registered<T> {
  return { ...o.def, plugin: o.plugin }
}

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
  private readonly crumbList: Array<Owned<{ recordType: string; def: RecordCrumbDef }>> = []
  private readonly routeList: Array<Owned<{ def: CaptureRouteDef }>> = []
  private readonly recordKeyList: Array<Owned<{ recordType: string; def: RecordKeyDef }>> = []
  private readonly errorList: Array<{ plugin: string; error: string }> = []

  // --- getters ---

  // Built-in screens by their slot, then the others numbered 7, 8, … in registration order.
  screens(): Array<Registered<ScreenDef> & { slot: number }> {
    const fixed = this.screenList.filter((s) => s.slot !== undefined).sort((a, b) => a.slot! - b.slot!)
    const numbered = this.screenList.filter((s) => s.slot === undefined)
    return [
      ...fixed.map((s) => ({ ...registered(s), slot: s.slot! })),
      ...numbered.map((s, i) => ({ ...registered(s), slot: FIRST_FREE_SLOT + i })),
    ]
  }

  screenBySlot(n: number): (Registered<ScreenDef> & { slot: number }) | undefined {
    return this.screens().find((s) => s.slot === n)
  }

  // The screen that records of `recordType` belong to (its `records`), if any.
  screenForRecord(recordType: string): (Registered<ScreenDef> & { slot: number }) | undefined {
    return this.screens().find((s) => s.records?.includes(recordType) === true)
  }

  crumbFor(recordType: string): Registered<RecordCrumbDef> | undefined {
    const c = this.crumbList.find((x) => x.recordType === recordType)
    return c && registered(c)
  }

  tabsFor(recordType: string): Array<Registered<RecordTabDef>> {
    return this.tabList.filter((t) => t.recordType === recordType).map(registered).sort((a, b) => a.order - b.order)
  }

  // By priority; ties keep registration order (Array.prototype.sort is stable).
  panels(): Array<Registered<OverviewPanelDef>> {
    return this.panelList.map(registered).sort((a, b) => a.priority - b.priority)
  }

  columns(list: string): Array<Registered<ListColumnDef>> {
    return this.columnList.filter((c) => c.list === list).map(registered)
  }

  forms(recordType: string): Array<Registered<RecordFormDef>> {
    return this.formList.filter((f) => f.recordType === recordType).map(registered)
  }

  editor(recordType: string, field: string): Component<FieldEditorProps> | undefined {
    return this.editorOf(recordType, field)?.editor
  }

  // The editor with the plugin that registered it (a form renders it in that plugin's scope).
  editorOf(recordType: string, field: string): { plugin: string; editor: Component<FieldEditorProps> } | undefined {
    const e = this.editorList.find((x) => x.recordType === recordType && x.field === field)
    return e && { plugin: e.plugin, editor: e.editor }
  }

  globalActions(): Array<Registered<GlobalActionDef>> {
    return this.actionList.map(registered)
  }

  badges(): Array<Registered<StatusBadgeDef>> {
    return this.badgeList.map(registered).sort((a, b) => a.order - b.order)
  }

  // The keys on the record views of `recordType`, in registration order.
  recordKeys(recordType: string): Array<Registered<RecordKeyDef>> {
    return this.recordKeyList.filter((k) => k.recordType === recordType).map(registered)
  }

  // In registration order (load order).
  captureRoutes(): Array<Registered<CaptureRouteDef>> {
    return this.routeList.map(registered)
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
      if (slot === OVERVIEW_SLOT) throw new ValidationError(`slot ${OVERVIEW_SLOT} is reserved for the Attention screen`)
      if (!Number.isInteger(slot) || slot < BUILTIN_SLOTS.min || slot > BUILTIN_SLOTS.max) {
        throw new ValidationError(`slot ${slot} must be between ${BUILTIN_SLOTS.min} and ${BUILTIN_SLOTS.max}`)
      }
      const taken = this.screenList.find((s) => s.slot === slot)
      if (taken) throw new ValidationError(`slot ${slot} is already taken by screen "${taken.def.id}"`)
    }
    for (const type of def.records ?? []) {
      const owner = this.screenList.find((s) => s.def.records?.includes(type))
      if (owner) throw new ValidationError(`record type "${type}" already belongs to screen "${owner.def.id}"`)
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
    if (this.actionList.some((a) => a.def.id === def.id)) throw new ValidationError(`global action "${def.id}" is already registered`)
    // Spec §3.4: a key conflict skips just this action, with a message; the rest of the part still loads.
    if (RESERVED_KEYS.has(def.key) || this.actionList.some((a) => a.def.key === def.key)) {
      this.recordError(plugin, `${plugin}: key "${def.key}" is already taken`)
      return
    }
    this.actionList.push({ plugin, def })
  }

  addBadge(plugin: string, def: StatusBadgeDef): void {
    this.open()
    if (this.badgeList.some((b) => b.def.id === def.id)) throw new ValidationError(`status badge "${def.id}" is already registered`)
    this.badgeList.push({ plugin, def })
  }

  addRecordCrumb(plugin: string, recordType: string, def: RecordCrumbDef): void {
    this.open()
    if (this.crumbList.some((c) => c.recordType === recordType)) throw new ValidationError(`a crumb for "${recordType}" is already registered`)
    this.crumbList.push({ plugin, recordType, def })
  }

  addCaptureRoute(plugin: string, def: CaptureRouteDef): void {
    this.open()
    if (this.routeList.some((r) => r.def.id === def.id)) throw new ValidationError(`capture route "${def.id}" is already registered`)
    this.routeList.push({ plugin, def })
  }

  addRecordKey(plugin: string, recordType: string, def: RecordKeyDef): void {
    this.open()
    if ([...def.key].length !== 1) throw new ValidationError(`key "${def.key}" must be a single character`)
    if (this.recordKeyList.some((k) => k.recordType === recordType && k.def.key === def.key)) throw new ValidationError(`key "${def.key}" on "${recordType}" is already registered`)
    this.recordKeyList.push({ plugin, recordType, def })
  }

  // --- lifecycle (bootTui) ---

  // Removes everything `plugin` registered.
  remove(plugin: string): void {
    for (const list of [this.screenList, this.tabList, this.panelList, this.columnList, this.formList, this.editorList, this.actionList, this.badgeList, this.crumbList, this.routeList, this.recordKeyList] as Array<Array<{ plugin: string }>>) {
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
