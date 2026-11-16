// How TUI components load and write. Every load and action runs inside an operation context
// (`runWithContext(kernel.context(origin?))`), so plugin code sees the injected clock and the origin.
// - useRuntime(): the runtime of the plugin whose component is rendering (set by <PluginScope> in app.tsx).
// - useQuery(load): loads, reloads on every live-refresh bump and when `key()` changes, keeps the last data
//   while a reload is in flight or after it failed.
// - act(fn): runs a write inside ONE outermost write transaction (the operations it calls become savepoints, so a
//   save of several operations is all-or-nothing and a busy retry reruns the whole attempt), retries on BusyError, and turns the result into a status-bar message.
//   An act called while a <Form> submits (withFormExtras) also saves that form's changed extra fields, inside the
//   same write, after `fn`, for the ref `fn` returned: the first such act claims them.
import { AsyncLocalStorage } from "node:async_hooks"
import { createComponent, createContext, createEffect, createSignal, on, onCleanup, useContext, type Accessor, type JSX } from "solid-js"
import { runWithContext, type Origin } from "../context"
import { BusyError } from "../errors"
import type { Kernel } from "../host"
import type { PluginRuntime } from "../plugin"
import { notify } from "./messages"

export const BUSY_MESSAGE = "database busy, retrying"
export const BUSY_RETRY_MS = 1000
export const BUSY_ATTEMPTS = 5

export type DataSession = {
  kernel: Kernel
  // The live-refresh version (refresh.ts): queries rerun when it changes.
  version: Accessor<number>
  // The clock's today, updated by live refresh when the day changes.
  today: Accessor<string>
  // Registers a promise with the app so tests can wait until nothing is in flight.
  track<T>(p: Promise<T>): Promise<T>
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

// --- the app's data session ---

export const DataContext = createContext<DataSession>()

function useSession(): DataSession {
  const s = useContext(DataContext)
  if (!s) throw new Error("useQuery() must be called inside <TuiApp>")
  return s
}

// act() runs from key handlers, outside any Solid owner, so the mounted app binds its session here.
let bound: DataSession | undefined

export function bindDataSession(session: DataSession): () => void {
  bound = session
  return () => {
    if (bound === session) bound = undefined
  }
}

// --- the plugin runtime ---

const RuntimeContext = createContext<PluginRuntime>()

export function RuntimeProvider(props: { runtime: PluginRuntime | undefined; children: JSX.Element }): JSX.Element {
  return createComponent(RuntimeContext.Provider, {
    get value() {
      return props.runtime
    },
    get children() {
      return props.children
    },
  })
}

// The runtime of the plugin whose component is rendering, or undefined in the kernel's own components.
export function useOptionalRuntime(): PluginRuntime | undefined {
  return useContext(RuntimeContext)
}

export function useRuntime(): PluginRuntime {
  const rt = useContext(RuntimeContext)
  if (!rt) throw new Error("useRuntime() must be called inside a plugin's registered component")
  return rt
}

// --- today ---

// The clock's today as an accessor: it changes when the day does (live refresh checks it every tick), so a
// component that reads it in a memo or JSX follows a TUI left open overnight. Loads read rt.clock.today().
export function useToday(): Accessor<string> {
  return useSession().today
}

// --- useQuery ---

export type Query<T> = { data(): T | undefined; error(): unknown; loading(): boolean; reload(): void }

export function useQuery<T>(load: () => Promise<T>, opts: { key?: () => unknown } = {}): Query<T> {
  const session = useSession()
  const [data, setData] = createSignal<T | undefined>(undefined)
  const [error, setError] = createSignal<unknown>(undefined)
  const [loading, setLoading] = createSignal(false)
  const [manual, setManual] = createSignal(0)
  let seq = 0
  let alive = true
  onCleanup(() => (alive = false))

  const run = () => {
    const mine = ++seq
    setLoading(true)
    const current = () => alive && mine === seq
    session
      .track(runWithContext(session.kernel.context(), load))
      .then(
        (value) => {
          if (!current()) return
          setData(() => value)
          setError(undefined)
          setLoading(false)
        },
        (e: unknown) => {
          if (!current()) return
          setError(() => e)
          setLoading(false)
          notify(message(e), "error")
        },
      )
  }

  createEffect(on([session.version, manual, () => opts.key?.()], run))
  return { data, error, loading, reload: () => setManual((n) => n + 1) }
}

// --- a form's extra fields, saved by the act its submit runs ---

// The changed extra fields of the form whose submit is running; `claimed` once an act took them.
export type PendingExtras = { changed: boolean; claimed: boolean; save(ref: string): Promise<void> }
export const NO_REF_FOR_EXTRAS = "extra fields not saved: the save returned no record ref"

// Scoped to the submit's async chain: an act anywhere else (another form, a key handler) never sees them, and a
// cancelled form leaves nothing behind.
const formExtras = new AsyncLocalStorage<PendingExtras>()

export function withFormExtras<T>(extras: PendingExtras, fn: () => Promise<T>): Promise<T> {
  return formExtras.run(extras, fn)
}

function claimExtras(): PendingExtras | undefined {
  const extras = formExtras.getStore()
  if (!extras || extras.claimed || !extras.changed) return undefined
  extras.claimed = true
  return extras
}

// --- act ---

export type ActResult<T> = { ok: true; value: T } | { ok: false; error: unknown }

export function act<T>(fn: () => Promise<T>, opts: { origin?: Origin; ok?: (r: T) => string } = {}): Promise<ActResult<T>> {
  const session = bound
  if (!session) throw new Error("act() needs a mounted <TuiApp>")
  const extras = claimExtras()
  const run = extras
    ? async () => {
        const value = await fn()
        const ref = (value as { ref?: unknown } | null | undefined)?.ref
        if (typeof ref !== "string") throw new Error(NO_REF_FOR_EXTRAS)
        await extras.save(ref)
        return value
      }
    : fn
  const attempt = async (): Promise<ActResult<T>> => {
    for (let n = 1; ; n++) {
      try {
        const value = await runWithContext(session.kernel.context(opts.origin), () => session.kernel.db.write(run))
        if (opts.ok) notify(opts.ok(value), "info")
        return { ok: true, value }
      } catch (e) {
        if (e instanceof BusyError && n < BUSY_ATTEMPTS) {
          notify(BUSY_MESSAGE, "info")
          await new Promise((r) => setTimeout(r, BUSY_RETRY_MS))
          continue
        }
        notify(message(e), "error")
        return { ok: false, error: e }
      }
    }
  }
  return session.track(attempt())
}

// --- useRecord ---

export type RecordInfo = { type(): string | undefined; id(): number | undefined; label(): string | undefined }

// Resolves `ref()` through the kernel's record types (type, id, label) with useQuery, so it refreshes live. All
// three are undefined while loading and for a ref that does not resolve.
export function useRecord(ref: () => string): RecordInfo {
  const { kernel } = useSession()
  const q = useQuery(
    async () => {
      const found = await kernel.records.resolveAny(ref())
      if (!found) return null
      return { ...found, label: await kernel.records.label(ref()) }
    },
    { key: ref },
  )
  return { type: () => q.data()?.type, id: () => q.data()?.id, label: () => q.data()?.label }
}
