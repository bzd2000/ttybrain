// The overlay stack: one list of overlays above the screen, the top one takes the keys (keys.ts layers). The app's
// own overlays (switcher, help, global actions) and useOverlay() (open, openForm, confirm) all push here.
import { createContext, createSignal, useContext, type JSX } from "solid-js"
import type { Kernel } from "../host"
import { Confirm } from "./components/Confirm"
import { notify } from "./messages"
import type { TuiRegistry } from "./registry"
import { PluginScope } from "./scope"
import type { RecordFormProps } from "./types"

export type OverlayEntry = { id: string; kind: string | undefined; render: () => JSX.Element }

export type OverlayStack = {
  list(): OverlayEntry[]
  // The id of the top overlay, undefined when none is open.
  top(): string | undefined
  // Pushes an overlay and returns its close function. With `kind`, an overlay of that kind already open is kept
  // and the call does nothing (its close is a no-op).
  push(render: (close: () => void) => JSX.Element, kind?: string): () => void
}

export function createOverlayStack(): OverlayStack {
  const [list, setList] = createSignal<OverlayEntry[]>([])
  let count = 0
  return {
    list,
    top: () => list().at(-1)?.id,
    push(render, kind) {
      if (kind !== undefined && list().some((o) => o.kind === kind)) return () => {}
      const id = `overlay-${++count}`
      const close = () => setList((l) => l.filter((o) => o.id !== id))
      setList((l) => [...l, { id, kind, render: () => render(close) }])
      return close
    },
  }
}

export type Overlay = {
  // Opens `c` above everything; the returned function closes it.
  open(c: () => JSX.Element): () => void
  // Opens `recordType`'s registered form `formId` (undefined: its first) with `props`, in its plugin's scope.
  openForm(recordType: string, formId?: string, props?: Omit<RecordFormProps, "close">): void
  // Asks `<text>  y yes · n no`; resolves true on `y` only (false on `n` or Esc).
  confirm(text: string): Promise<boolean>
}

export function createOverlay(stack: OverlayStack, kernel: Kernel, registry: TuiRegistry): Overlay {
  return {
    open: (c) => stack.push(() => c()),
    openForm(recordType, formId, props = {}) {
      const forms = registry.forms(recordType)
      const def = formId === undefined ? forms[0] : forms.find((f) => f.id === formId)
      if (!def) return notify(formId === undefined ? `no form for ${recordType}` : `no form "${formId}" for ${recordType}`, "error")
      const Component = def.component
      stack.push((close) => (
        <PluginScope kernel={kernel} plugin={def.plugin} label={def.label} close={close}>
          <Component {...props} close={() => close()} />
        </PluginScope>
      ))
    },
    confirm(text) {
      return new Promise<boolean>((resolve) => {
        stack.push((close) => (
          <Confirm
            text={text}
            answer={(yes) => {
              close()
              resolve(yes)
            }}
          />
        ))
      })
    },
  }
}

export const OverlayContext = createContext<Overlay>()

export function useOverlay(): Overlay {
  const o = useContext(OverlayContext)
  if (!o) throw new Error("useOverlay() must be called inside <TuiApp>")
  return o
}
