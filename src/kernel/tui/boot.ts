// Activates the plugins' tui parts. Each part gets a TuiContext: its plugin's runtime (same data, operations,
// records and tags as the logic part) plus registration methods tagged with the plugin id. A part whose plugin
// is not loaded is skipped; a part whose activate throws, or returns a promise (activate must be synchronous),
// loses everything it registered, while its logic stays loaded. The registry is sealed once every part has run.
import type { Kernel } from "../host"
import { TuiRegistry } from "./registry"
import type { TuiContext, TuiDef } from "./types"

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  (typeof v === "object" || typeof v === "function") && v !== null && typeof (v as { then?: unknown }).then === "function"

// `parts` are booted with `opts.builtin` (built-in parts may claim screen slots 2–6; others are numbered from 7),
// then `opts.external` with builtin false, all into one registry.
export function bootTui(kernel: Kernel, parts: TuiDef[], opts: { builtin?: boolean; external?: TuiDef[] } = {}): TuiRegistry {
  const registry = new TuiRegistry()
  const activated = new Set<string>()
  const boot = (part: TuiDef, builtin: boolean) => {
    const id = part.plugin
    const runtime = kernel.runtime(id)
    if (!runtime) {
      registry.recordError(id, `tui part for "${id}": plugin is not loaded`)
      return
    }
    // One part per plugin, so removing a failed part's registrations by plugin id never touches another part.
    if (activated.has(id)) {
      registry.recordError(id, `tui part for "${id}": a part for this plugin is already loaded`)
      return
    }
    activated.add(id)
    let failed = false
    const live = () => {
      if (failed) throw new Error(`tui part for "${id}" failed and can no longer register anything`)
    }
    const ui: TuiContext = {
      ...runtime,
      screen: (def) => (live(), registry.addScreen(id, def, builtin)),
      recordTab: (recordType, def) => (live(), registry.addRecordTab(id, recordType, def)),
      overviewPanel: (def) => (live(), registry.addPanel(id, def)),
      listColumn: (list, def) => (live(), registry.addColumn(id, list, def)),
      recordForm: (recordType, def) => (live(), registry.addForm(id, recordType, def)),
      fieldEditor: (recordType, field, editor) => (live(), registry.addEditor(id, recordType, field, editor)),
      globalAction: (def) => (live(), registry.addGlobalAction(id, def)),
      statusBadge: (def) => (live(), registry.addBadge(id, def)),
      recordCrumb: (recordType, def) => (live(), registry.addRecordCrumb(id, recordType, def)),
      captureRoute: (def) => (live(), registry.addCaptureRoute(id, def)),
    }
    const fail = (error: string) => {
      failed = true
      registry.remove(id)
      registry.recordError(id, `${id}: ${error}`)
    }
    try {
      const result: unknown = part.activate(ui)
      if (isThenable(result)) {
        result.then(undefined, () => {}) // a rejection is swallowed: the part has failed already
        fail("tui activate must be synchronous")
      }
    } catch (e) {
      fail(message(e))
    }
  }
  for (const part of parts) boot(part, opts.builtin ?? false)
  for (const part of opts.external ?? []) boot(part, false)
  registry.seal()
  return registry
}
