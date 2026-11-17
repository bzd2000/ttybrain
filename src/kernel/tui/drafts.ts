// Drafts: the unsaved values of a form, the quick-capture overlay or the editor, kept on disk so a cancel, a quit
// or a crash loses nothing (spec §9). One JSON file per key under PM_HOME/drafts (`{ key, savedAt, values }`,
// the file name is the key URI-encoded), written atomically (a temp file renamed over it). Not in the database:
// typing takes no write lock, bumps no data_version and leaves no history.
// - A writer (one per open form/editor) writes DRAFT_MS after the last change, at once on flush (Esc, quit), and
//   deletes the draft when the values are back to the initial ones; discard() deletes it (a save).
// - The TUI prunes drafts older than DRAFT_DAYS when it starts.
// - I/O errors never break editing or saving: they are swallowed, the first one is reported through `onError`.
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createContext, onCleanup } from "solid-js"
import type { Clock } from "../clock"
import { daysBetween } from "../dates"
import { useOptionalRuntime } from "./data"
import { shortDate } from "./format"
import { useApp } from "./scope"

export const DRAFT_MS = 1000
export const DRAFT_DAYS = 30
export const DRAFT_KEPT = "draft kept"

export type Draft<V = unknown> = { key: string; savedAt: string; values: V }

export type DraftWriter<V> = {
  // Writes `values` DRAFT_MS after the last call (a later call restarts the wait).
  schedule(values: V): void
  // Writes a scheduled value now.
  flush(): void
  // Deletes the draft and drops a scheduled value (after a save, or `x` on the prompt).
  discard(): void
  // Flushes, then: is a draft that differs from the initial values on disk?
  kept(): boolean
  // Flushes and stops: flushAll() no longer sees it.
  close(): void
}

export type DraftStore = {
  read<V = unknown>(key: string): Draft<V> | undefined
  write(key: string, values: unknown): void
  remove(key: string): void
  // Deletes the drafts saved more than DRAFT_DAYS days ago; returns how many.
  prune(): number
  // `onDisk`: the draft the caller found for `key` (what is on disk now).
  writer<V>(key: string, initial: () => V, onDisk?: Draft<V>): DraftWriter<V>
  flushAll(): void
}

export const draftFile = (dir: string, key: string) => join(dir, `${encodeURIComponent(key)}.json`)

// The same values: compared as JSON with the keys sorted (a form's values are a flat record).
export function sameValues(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x !== null && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)))
      : x,
  )
}

const SAVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const missing = (e: unknown) => (e as { code?: string }).code === "ENOENT"

export function createDraftStore(opts: { dir: string; clock: Clock; delayMs?: number; onError?: (e: unknown) => void }): DraftStore {
  const { dir, clock } = opts
  const delayMs = opts.delayMs ?? DRAFT_MS
  let reported = false
  const fail = (e: unknown) => {
    if (reported) return
    reported = true
    opts.onError?.(e)
  }
  const parse = (file: string): Draft | undefined => {
    try {
      const d = JSON.parse(readFileSync(file, "utf8")) as Partial<Draft>
      if (typeof d?.key !== "string" || typeof d.savedAt !== "string" || !SAVED_AT.test(d.savedAt) || d.values === undefined) return undefined
      return { key: d.key, savedAt: d.savedAt, values: d.values }
    } catch {
      return undefined // missing, unreadable or not JSON: no draft
    }
  }
  const writers = new Set<DraftWriter<unknown>>()

  const store: DraftStore = {
    read<V>(key: string) {
      const d = parse(draftFile(dir, key))
      return d?.key === key ? (d as Draft<V>) : undefined
    },
    write(key, values) {
      try {
        mkdirSync(dir, { recursive: true })
        const file = draftFile(dir, key)
        const tmp = `${file}.${process.pid}.tmp`
        writeFileSync(tmp, JSON.stringify({ key, savedAt: clock.now(), values }))
        renameSync(tmp, file)
      } catch (e) {
        fail(e)
      }
    },
    remove(key) {
      try {
        unlinkSync(draftFile(dir, key))
      } catch (e) {
        if (!missing(e)) fail(e)
      }
    },
    prune() {
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch (e) {
        if (!missing(e)) fail(e)
        return 0
      }
      const today = clock.today()
      let n = 0
      for (const name of names) {
        if (!name.endsWith(".json")) continue
        const d = parse(join(dir, name))
        if (!d || daysBetween(d.savedAt.slice(0, 10), today) <= DRAFT_DAYS) continue
        try {
          unlinkSync(join(dir, name))
          n++
        } catch (e) {
          if (!missing(e)) fail(e)
        }
      }
      return n
    },
    writer<V>(key: string, initial: () => V, onDisk?: Draft<V>) {
      let disk: V | undefined = onDisk?.values
      let pending: { values: V } | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const stop = () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
      }
      const w: DraftWriter<V> = {
        schedule(values) {
          pending = { values }
          stop()
          timer = setTimeout(w.flush, delayMs)
          ;(timer as { unref?: () => void }).unref?.()
        },
        flush() {
          stop()
          if (!pending) return
          const { values } = pending
          pending = undefined
          if (sameValues(values, initial())) {
            if (disk !== undefined) store.remove(key)
            disk = undefined
          } else if (disk === undefined || !sameValues(values, disk)) {
            store.write(key, values)
            disk = values
          }
        },
        discard() {
          stop()
          pending = undefined
          store.remove(key)
          disk = undefined
        },
        kept() {
          w.flush()
          return disk !== undefined && !sameValues(disk, initial())
        },
        close() {
          w.flush()
          writers.delete(w as DraftWriter<unknown>)
        },
      }
      writers.add(w as DraftWriter<unknown>)
      return w
    },
    flushAll() {
      for (const w of writers) w.flush()
    },
  }
  return store
}

// `Unsaved draft from 10:42 · r restore · x discard`, with the date when it is not from today.
export function draftPromptText(savedAt: string, today: string): string {
  const day = savedAt.slice(0, 10)
  const time = savedAt.slice(11, 16)
  return `Unsaved draft from ${day === today ? "" : `${shortDate(day)} `}${time} · r restore · x discard`
}

// --- in components ---

// The draft key of the form openForm opened (`<plugin>:<form>:<recordRef | new>[:from:<origin ref>]`): a <Form>
// inside it keeps its draft there; a <Form> elsewhere keeps none.
export const FormDraftKey = createContext<string | undefined>()

export function formDraftKey(plugin: string, formId: string, recordRef: string | undefined, origin: { ref: string } | undefined): string {
  return `${plugin}:${formId}:${recordRef ?? "new"}${origin ? `:from:${origin.ref}` : ""}`
}

export type DraftHandle<V> = DraftWriter<V> & {
  // The draft found when the component opened (undefined: none, or no key).
  saved: Draft<V> | undefined
}

const NO_DRAFT: DraftHandle<never> = {
  saved: undefined,
  schedule() {},
  flush() {},
  discard() {},
  kept: () => false,
  close() {},
}

// The draft of `key` (the full key) for the component calling it; closed (flushed) when the component goes,
// which includes quitting (the renderer's destroy disposes the tree). Without a key: a handle that keeps nothing.
export function useDraftKey<V>(key: string | undefined, initial: () => V): DraftHandle<V> {
  if (key === undefined) return NO_DRAFT
  const { drafts } = useApp()
  const saved = drafts.read<V>(key)
  const w = drafts.writer(key, initial, saved)
  onCleanup(() => w.close())
  return { ...w, saved }
}

// A plugin's draft: `key` is prefixed with the calling plugin's id (`useDraft("capture")` → `inbox:capture`).
export function useDraft<V>(key: string, initial: () => V): DraftHandle<V> {
  return useDraftKey(pluginDraftKey(useOptionalRuntime()?.id, key), initial)
}

export const pluginDraftKey = (plugin: string | undefined, key: string) => (plugin === undefined ? key : `${plugin}:${key}`)
