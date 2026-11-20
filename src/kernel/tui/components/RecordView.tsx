// An open record: the tabs its type has (tabsFor, with their counts) and the active tab's component with
// `{ recordRef }`, in that tab's plugin scope; the header shows its breadcrumb (frame.tsx). ←→ switch tabs.
// A tab with `when` shows only once its check resolved true (or threw: a broken check never hides data); a
// `tab` that is not shown falls back to the first tab. As the screen designs draw it, a blank line sits between the
// header and the tabs.
import { createMemo, createSignal, Show } from "solid-js"
import { useQuery, useRecord } from "../data"
import { useKeys } from "../keys"
import type { Registered } from "../registry"
import { PluginScope, useApp } from "../scope"
import type { RecordTabDef } from "../types"
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

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1} paddingLeft={1} paddingRight={1}>
      <Tabs
        tabs={shownTabs().map((t) => ({ id: t.id, title: t.title, count: loaded.data()?.counts.get(t.id) ?? null }))}
        active={active()?.id ?? ""}
        onChange={setChosen}
        focused={keys.active()}
      />
      <Show when={active()} keyed>
        {(t: Registered<RecordTabDef>) => (
          <box flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0}>
            <PluginScope kernel={app.kernel} plugin={t.plugin} label={t.title}>
              <t.component recordRef={props.recordRef} />
            </PluginScope>
          </box>
        )}
      </Show>
    </box>
  )
}
