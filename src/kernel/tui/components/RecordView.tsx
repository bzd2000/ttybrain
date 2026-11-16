// An open record: the breadcrumb `› <ref> <label>` (`#CRM` shows as `CRM`), the tabs its type has (tabsFor, with
// their counts) and the active tab's component with `{ ref }`, in that tab's plugin scope. ←→ switch tabs.
// Solid's JSX treats a `ref` attribute as an element ref, so a component taking a `ref` string prop (a record
// tab, RecordView itself) is created with createComponent(C, { ref }) or a spread ({...{ ref }}), not ref={…}.
import { createComponent, createSignal, Show } from "solid-js"
import { useQuery, useRecord } from "../data"
import { useKeys } from "../keys"
import type { Registered } from "../registry"
import { PluginScope, useApp } from "../scope"
import { theme } from "../theme"
import type { RecordTabDef } from "../types"
import { Tabs } from "./Tabs"

export function RecordView(props: { ref: string; tab?: string }) {
  const app = useApp()
  const keys = useKeys()
  const rec = useRecord(() => props.ref)
  const tabs = (): Array<Registered<RecordTabDef>> => {
    const type = rec.type()
    return type === undefined ? [] : app.registry.tabsFor(type)
  }
  const counts = useQuery(
    async () => {
      const list = tabs()
      const values = await Promise.all(list.map((t) => (t.count ? t.count(props.ref) : Promise.resolve(null))))
      return new Map(list.map((t, i) => [t.id, values[i] ?? null]))
    },
    { key: () => `${props.ref}\n${rec.type() ?? ""}` },
  )
  const [chosen, setChosen] = createSignal(props.tab)
  const active = () => tabs().find((t) => t.id === chosen()) ?? tabs()[0]
  const shownRef = () => (props.ref.startsWith("#") ? props.ref.slice(1) : props.ref)

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show when={rec.label() !== undefined} fallback={<text fg={theme.muted}>{`› ${shownRef()}`}</text>}>
        <text fg={theme.text}>{`› ${shownRef()} ${rec.label()}`}</text>
      </Show>
      <Tabs
        tabs={tabs().map((t) => ({ id: t.id, title: t.title, count: counts.data()?.get(t.id) ?? null }))}
        active={active()?.id ?? ""}
        onChange={setChosen}
        focused={keys.active()}
      />
      <Show when={active()} keyed>
        {(t: Registered<RecordTabDef>) => (
          <box flexDirection="column" flexGrow={1}>
            <PluginScope kernel={app.kernel} plugin={t.plugin} label={t.title}>
              {createComponent(t.component, {
                get ref() {
                  return props.ref
                },
              })}
            </PluginScope>
          </box>
        )}
      </Show>
    </box>
  )
}
