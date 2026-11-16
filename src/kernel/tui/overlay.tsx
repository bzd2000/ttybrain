// The overlay stack: one list of overlays above the screen, the top one takes the keys (keys.ts layers). The app's
// own overlays (switcher, help, global actions) and useOverlay() (open, openForm, confirm) all push here.
import { createContext, createSignal, useContext, type JSX } from "solid-js"
import type { Kernel } from "../host"
import type { PluginRuntime } from "../plugin"
import { Confirm } from "./components/Confirm"
import { Editor, type EditorOptions } from "./components/Editor"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { RuntimeProvider, useOptionalRuntime } from "./data"
import { notify } from "./messages"
import type { TuiRegistry } from "./registry"
import { PluginScope, useApp } from "./scope"
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
  // Opens `c` above everything, in the scope of the plugin whose component called useOverlay() (its runtime for
  // useRuntime(), an error boundary that Esc closes); the returned function closes it.
  open(c: () => JSX.Element): () => void
  // Opens `recordType`'s registered form `formId` (undefined: its first) with `props`, in its plugin's scope.
  // Resolves with the ref the form passed to `close(savedRef)`: undefined on cancel, or when there is no form.
  openForm(recordType: string, formId?: string, props?: Omit<RecordFormProps, "close">): Promise<string | undefined>
  // Asks `<text>  y yes · n no`; resolves true on `y` only (false on `n` or Esc).
  confirm(text: string): Promise<boolean>
  // A full-screen text editor. Ctrl+S (or Esc s) calls `save` and closes on ok, or shows the error and stays open;
  // Esc d discards. Edits stay in the editor until saved.
  openEditor(opts: EditorOptions): void
}

// The app's overlay service; useOverlay() binds `open` to the caller's plugin runtime.
export type OverlayService = Omit<Overlay, "open"> & { open(c: () => JSX.Element, runtime: PluginRuntime | undefined): () => void }

export function createOverlay(stack: OverlayStack, kernel: Kernel, registry: TuiRegistry): OverlayService {
  return {
    open: (c, runtime) =>
      stack.push((close) => (
        <ErrorBoundary label={runtime?.id ?? "overlay"} close={close}>
          <RuntimeProvider runtime={runtime}>{c()}</RuntimeProvider>
        </ErrorBoundary>
      )),
    openForm(recordType, formId, props = {}) {
      const forms = registry.forms(recordType)
      const def = formId === undefined ? forms[0] : forms.find((f) => f.id === formId)
      if (!def) {
        notify(formId === undefined ? `no form for ${recordType}` : `no form "${formId}" for ${recordType}`, "error")
        return Promise.resolve(undefined)
      }
      const Component = def.component
      return new Promise<string | undefined>((resolve) => {
        stack.push((close) => {
          const done = (savedRef?: string) => {
            close()
            resolve(savedRef)
          }
          return (
            <PluginScope kernel={kernel} plugin={def.plugin} label={def.label} close={() => done()}>
              <Component {...props} close={done} />
            </PluginScope>
          )
        })
      })
    },
    openEditor(opts) {
      stack.push((close) => (
        <ErrorBoundary label="editor" close={close}>
          <Editor {...opts} close={close} />
        </ErrorBoundary>
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

export const OverlayContext = createContext<OverlayService>()

export function useOverlay(): Overlay {
  const service = useContext(OverlayContext)
  if (!service) throw new Error("useOverlay() must be called inside <TuiApp>")
  const runtime = useOptionalRuntime()
  return { ...service, open: (c) => service.open(c, runtime) }
}

// The record forms registered for `recordType` (any plugin's), in registration order: what a component can offer
// to open with openForm (the inbox's "process by hand" menu) without knowing the plugin that owns the type.
export function useRecordForms(recordType: string): Array<{ id: string; label: string; plugin: string }> {
  return useApp()
    .registry.forms(recordType)
    .map((f) => ({ id: f.id, label: f.label, plugin: f.plugin }))
}
