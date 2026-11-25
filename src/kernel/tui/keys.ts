// Keys: the global key dispatch, the text-focus guard and the key hints shown in the status bar.
//
// Dispatch order for one key press:
//   1. an open overlay (its own `useScreenKeys` handler; the screen below is gated off by `useScreenKeys`);
//   2. a focused text field: while the top layer holds `textFocus(true)`, single-letter global keys are off, and
//      `useScreenKeys` handlers get no printable keys or Enter unless they pass `{ whileTyping: true }`;
//   3. the focused screen's own `useScreenKeys` handlers (screen-local keys are not reserved);
//   4. global actions (plugins' `globalAction` keys);
//   5. global keys (`q`, `?`, `g`, `1`–`9`, `Esc`).
// OpenTUI calls every `useKeyboard` handler before the focused renderable (an <input>), so the kernel's
// dispatcher registers at the renderable level and therefore runs after all of them. A local handler claims a
// key with `key.preventDefault()`; the dispatcher then leaves it alone (and so does a focused input).
import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createContext, createSignal, onCleanup, onMount, useContext, type Accessor } from "solid-js"

// `alt`: a second key for the same thing, shown as `<key> or <alt> <label>` (`g or 1-7 screens`).
export type Hint = { key: string; label: string; alt?: string }
// `exact`: these hints are the whole of the layer's own part of the status bar: hints registered without it on the
// same layer (a Table's `↑↓ select`, say) are left out while it is registered. `frame` (with `exact`, on the screen
// layer): which of the frame's hints (the keys of frameHints: "g", "?", "q") follow the global actions' hints; all
// of them when left out. `globals: false` (with `exact`, on the screen layer): the global actions' hints (`i capture`)
// are left out too, for a design that draws none (their keys still work). `after` (with `exact`): hints a screen keeps
// beyond its design, shown last, after the frame's.
export type HintOptions = { exact?: boolean; frame?: string[]; globals?: boolean; after?: Hint[] }

// The spec §9 key table, as Help shows it (Help adds the registered global actions after these). `c`
// (assistant) stays unclaimed until phase 7.
export const GLOBAL_KEYS: Hint[] = [
  { key: "↑↓ / j k", label: "move" },
  { key: "Enter", label: "open" },
  { key: "Esc", label: "back" },
  { key: "Tab", label: "next panel" },
  { key: "←→", label: "tabs" },
  { key: "1–9", label: "screens" },
  { key: "g", label: "switcher" },
  { key: "n", label: "new" },
  { key: "e", label: "edit" },
  { key: "x", label: "done or close" },
  { key: "Del", label: "delete" },
  { key: "/", label: "filter" },
  { key: "?", label: "help" },
  { key: "q", label: "quit" },
]

// The hints the frame adds on a screen (not in an overlay, not while typing), after the global actions' hints;
// `lastSlot` is the highest screen number key (`g or 1-7 screens`).
export function frameHints(lastSlot: number): Hint[] {
  return [
    { key: "g", ...(lastSlot > 1 ? { alt: `1-${lastSlot}` } : {}), label: "screens" },
    { key: "?", label: "help" },
    { key: "q", label: "quit" },
  ]
}

// A hint's key as the status bar shows it: named keys in lowercase (`Enter` → `enter`, `Ctrl+S` → `ctrl+s`, `Esc`,
// `Tab`, `Del`, `PgUp` → `pgup`); single letters stay as typed (`J/K` and `D` are Shift+j/k/d).
export function keyText(key: string): string {
  return key.replace(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g, (w) => w.toLowerCase()).replace(/\+([A-Z])\b/g, (_, c: string) => `+${c.toLowerCase()}`)
}

// The layer a component renders in: "screen", or the id of the overlay it belongs to.
export const SCREEN_LAYER = "screen"
export const LayerContext = createContext<string>(SCREEN_LAYER)

type TextClaim = { token: object; layer: string }
type HintEntry = { id: number; token: object; layer: string; list: Hint[] } & HintOptions

// Per app: who holds text focus and which hints are registered, by layer. Only the top layer counts.
export class KeysStore {
  private readonly claims = createSignal<TextClaim[]>([])
  private readonly entries = createSignal<HintEntry[]>([])
  private nextId = 0

  constructor(readonly top: Accessor<string>) {}

  textFocused(): boolean {
    const top = this.top()
    return this.claims[0]().some((c) => c.layer === top)
  }

  // The hints registered on the top layer, in registration order (a screen's before its blocks'); a key
  // registered twice shows once, with its first label. While an `exact` registration is on the layer, only the
  // exact ones count.
  hints(): Hint[] {
    const top = this.top()
    const on = this.entries[0]().filter((e) => e.layer === top)
    const exact = on.some((e) => e.exact === true)
    const out: Hint[] = []
    for (const e of on) {
      if (exact && e.exact !== true) continue
      for (const h of e.list) if (!out.some((o) => o.key === h.key)) out.push(h)
    }
    return out
  }

  // The frame hint keys an exact registration on the top layer asked for (HintOptions.frame), or undefined: all.
  frameKeys(): string[] | undefined {
    const top = this.top()
    return this.entries[0]().find((e) => e.layer === top && e.exact === true && e.frame !== undefined)?.frame
  }

  // Whether the global actions' hints show: false when an exact registration on the top layer says `globals: false`.
  globalHints(): boolean {
    const top = this.top()
    return !this.entries[0]().some((e) => e.layer === top && e.exact === true && e.globals === false)
  }

  // The hints an exact registration on the top layer asked to show last (HintOptions.after).
  afterHints(): Hint[] {
    const top = this.top()
    return this.entries[0]().find((e) => e.layer === top && e.exact === true && e.after !== undefined)?.after ?? []
  }

  setTextFocus(token: object, layer: string, on: boolean): void {
    const [claims, setClaims] = this.claims
    const has = claims().some((c) => c.token === token)
    if (on && !has) setClaims([...claims(), { token, layer }])
    if (!on && has) setClaims(claims().filter((c) => c.token !== token))
  }

  addHints(token: object, layer: string, list: Hint[], opts: HintOptions = {}): () => void {
    const id = this.nextId++
    const [, setEntries] = this.entries
    setEntries((e) => [...e, { id, token, layer, list, ...opts }])
    return () => setEntries((e) => e.filter((x) => x.id !== id))
  }

  // Everything a component registered goes when it unmounts.
  drop(token: object): void {
    this.claims[1]((c) => c.filter((x) => x.token !== token))
    this.entries[1]((e) => e.filter((x) => x.token !== token))
  }
}

export const KeysContext = createContext<KeysStore>()

export type Keys = {
  // While on, the single-letter global keys are off (call it when a text field gains and loses focus).
  textFocus(on: boolean): void
  // Shows `list` in the status bar while registered; returns the function that removes it. With `{ exact: true }`
  // the list is the layer's whole own part of the bar (HintOptions), so a screen can set its bar exactly.
  hints(list: Hint[], opts?: HintOptions): () => void
  // True while no overlay sits above this component: gate `focused` props on it (useScreenKeys gates handlers).
  active(): boolean
  // True while a text field on the top layer holds text focus: blocks (Table, Tabs) leave every key to it.
  typing(): boolean
}

export function useKeys(): Keys {
  const store = useContext(KeysContext)
  if (!store) throw new Error("useKeys() must be called inside <TuiApp>")
  const layer = useContext(LayerContext)
  const token = {}
  onCleanup(() => store.drop(token))
  return {
    textFocus: (on) => store.setTextFocus(token, layer, on),
    hints: (list, opts) => store.addHints(token, layer, list, opts),
    active: () => store.top() === layer,
    typing: () => store.textFocused(),
  }
}

// The way screens, blocks and overlays take keys: OpenTUI's useKeyboard, but `handler` runs only while the
// component's layer is on top. OpenTUI calls listeners in registration order, so without this gate a screen's
// handler (registered earlier) would also see the keys meant for an overlay opened above it.
// While a text field on the top layer has focus (`typing()`), printable keys and Enter are the field's: the
// handler does not get them. A component that owns a text field (a form, an editor, a filter input) passes
// `{ whileTyping: true }` to get them anyway. Other keys (arrows, Esc, Tab, Delete) always reach the handler;
// a block that moves on arrows checks `typing()` itself.
export type ScreenKeysOptions = { whileTyping?: boolean }

export function useScreenKeys(handler: (key: KeyEvent) => void, opts: ScreenKeysOptions = {}): void {
  const keys = useKeys()
  useKeyboard((key) => {
    if (!keys.active()) return
    if (!opts.whileTyping && keys.typing() && (key.name === "return" || printable(key) !== undefined)) return
    handler(key)
  })
}

// The character a key press types, if it is a plain printable key (no Ctrl/Alt/Meta).
export function printable(key: KeyEvent): string | undefined {
  if (key.ctrl || key.meta || key.option || key.super || key.hyper) return undefined
  const s = key.sequence
  if ([...s].length === 1 && s >= " " && s !== "\x7f") return s
  if (key.source === "kitty" && [...key.name].length === 1) return key.shift ? key.name.toUpperCase() : key.name
  return undefined
}

export type GlobalKeyTargets = {
  keys: KeysStore
  // Global actions by key (step 4); returns true when one was opened.
  action(ch: string): boolean
  quit(): void
  help(): void
  switcher(): void
  slot(n: number): void
  back(): boolean
}

// Steps 2, 4 and 5 of the dispatch order (step 1 and 3 are the overlays' and screens' own handlers).
export function createGlobalKeyHandler(t: GlobalKeyTargets): (key: KeyEvent) => void {
  return (key) => {
    if (t.keys.top() !== SCREEN_LAYER) return
    if (key.name === "escape") {
      if (t.back()) key.preventDefault()
      return
    }
    const ch = printable(key)
    if (ch === undefined || t.keys.textFocused()) return
    if (t.action(ch)) return key.preventDefault()
    if (ch === "q") t.quit()
    else if (ch === "?") t.help()
    else if (ch === "g") t.switcher()
    else if (ch >= "1" && ch <= "9") t.slot(Number(ch))
    else return
    key.preventDefault()
  }
}

// Registers `handler` after every `useKeyboard` handler (see the header comment). `_internalKeyInput` is the
// renderer's key handler; its renderable-level listeners run once the global ones are done, unless one of
// those called preventDefault() or stopPropagation().
export function useGlobalKeys(handler: (key: KeyEvent) => void): void {
  const input = useRenderer()._internalKeyInput
  const listener = (key: KeyEvent) => {
    if (!key.defaultPrevented && !key.propagationStopped) handler(key)
  }
  onMount(() => input.onInternal("keypress", listener))
  onCleanup(() => input.offInternal("keypress", listener))
}
