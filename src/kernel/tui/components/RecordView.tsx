// An open record: the tabs its type has (tabsFor, with their counts) and the active tab's component with
// `{ recordRef }`, in that tab's plugin scope; the header shows its breadcrumb (frame.tsx). ←→ switch tabs.
// A tab with `when` shows only once its check resolved true (or threw: a broken check never hides data); a
// `tab` that is not shown falls back to the first tab. As the screen designs draw it, a blank line sits between the
// header and the tabs; a `bare` tab shown alone has neither (the meeting in progress). The record type's keys
// (`recordKey`) work on every tab, after the active tab's own (a key the tab claimed is its own).
import { createMemo, createSignal, Show } from "solid-js"
import { runWithContext } from "../../context"
import { useQuery, useRecord } from "../data"
import { notify } from "../messages"
import { printable, useKeys, useScreenKeys } from "../keys"
import { useOverlay } from "../overlay"
import type { Registered } from "../registry"
import { PluginScope, useApp } from "../scope"
import type { RecordKeyDef, RecordTabDef } from "../types"
import { Tabs } from "./Tabs"

export function RecordView(props: { recordRef: string; tab?: string }) {
  const app = useApp()
  const keys = useKeys()
  // Registered before the active tab's blocks, so these come first in the status bar.
  keys.hints([
    { key: "←→", label: "tabs" },
    { key: "Esc", label: "back" },
  ])
  const rec = useRecord(() => props.recordRef)
  // Memos: every reload gives a new record info and tabsFor builds new objects, but the active tab's component
  // must not remount on a reload.
  const recordType = createMemo(() => rec.type())
  const tabs = createMemo((): Array<Registered<RecordTabDef>> => {
    const type = recordType()
    return type === undefined ? [] : app.registry.tabsFor(type)
  })
  // The counts and the `when` checks, in one load.
  const loaded = useQuery(
    async () => {
      const list = tabs()
      const shows = (t: RecordTabDef) => (t.when ? Promise.resolve().then(() => t.when!(props.recordRef)).catch(() => true) : Promise.resolve(true))
      const [values, checks] = await Promise.all([
        // A count that throws shows none; it never fails the checks.
        Promise.all(list.map((t) => (t.count ? Promise.resolve().then(() => t.count!(props.recordRef)).catch(() => null) : Promise.resolve(null)))),
        Promise.all(list.map(shows)),
      ])
      return {
        counts: new Map(list.map((t, i) => [t.id, values[i] ?? null])),
        // The tabs with `when` that show (a load from before the record's type was known has none).
        shown: new Set(list.filter((t, i) => t.when !== undefined && checks[i] !== false).map((t) => t.id)),
      }
    },
    { key: () => `${props.recordRef}\n${recordType() ?? ""}` },
  )
  // Until the first load, the tabs without `when`.
  const shownTabs = () => tabs().filter((t) => t.when === undefined || loaded.data()?.shown.has(t.id) === true)
  const [chosen, setChosen] = createSignal(props.tab)
  const active = () => shownTabs().find((t) => t.id === chosen()) ?? shownTabs()[0]
  const bare = () => shownTabs().length === 1 && shownTabs()[0]!.bare === true

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={bare() ? 0 : 1} paddingLeft={1} paddingRight={1}>
      <Show when={!bare()}>
        <Tabs
          tabs={shownTabs().map((t) => ({ id: t.id, title: t.title, count: loaded.data()?.counts.get(t.id) ?? null }))}
          active={active()?.id ?? ""}
          onChange={setChosen}
          focused={keys.active()}
        />
      </Show>
      <Show when={active()} keyed>
        {(t: Registered<RecordTabDef>) => (
          <box flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0}>
            <PluginScope kernel={app.kernel} plugin={t.plugin} label={t.title}>
              <t.component recordRef={props.recordRef} />
            </PluginScope>
            <Show when={recordType()} keyed>
              {(type: string) => <RecordKeys recordRef={props.recordRef} keys={app.registry.recordKeys(type)} />}
            </Show>
          </box>
        )}
      </Show>
    </box>
  )
}

// The record type's keys, registered after the active tab's handlers (rendered after it, and again with it), so a key
// the tab claimed is left alone; their hints follow the tab's. `run` runs in its plugin's scope.
function RecordKeys(props: { recordRef: string; keys: Array<Registered<RecordKeyDef>> }) {
  const app = useApp()
  const keys = useKeys()
  const overlay = useOverlay()
  if (props.keys.length > 0) keys.hints(props.keys.map((k) => ({ key: k.key, label: k.label })))
  useScreenKeys((key) => {
    if (keys.typing() || key.defaultPrevented) return
    const ch = printable(key)
    const def = props.keys.find((k) => k.key === ch)
    if (!def) return
    key.preventDefault()
    // In an operation context (its reads see the kernel's clock); not tracked: it may wait for a form.
    void runWithContext(app.kernel.context(), async () => def.run(props.recordRef, { overlay })).catch((e: unknown) => notify(e instanceof Error ? e.message : String(e), "error"))
  })
  return null
}
