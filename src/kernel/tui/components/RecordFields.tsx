// <RecordFields recordType recordRef>: the extra fields other plugins registered for a record type (kernel.fields,
// the `field` extension point) as `Label  value` rows, each value read through the owning plugin's `get` operation
// (`—` when it has none). Renders nothing when the type has no extra fields.
import { For, Show } from "solid-js"
import { useQuery } from "../data"
import { displayWidth } from "../format"
import { useApp } from "../scope"
import { theme } from "../theme"

// The gap between the labels and the values.
const GAP = "  "

export function RecordFields(props: { recordType: string; recordRef: string }) {
  const { kernel } = useApp()
  const fields = kernel.fields.for(props.recordType)
  const width = Math.max(0, ...fields.map((f) => displayWidth(f.def.label)))
  const q = useQuery(
    async () =>
      Promise.all(
        fields.map(async ({ plugin, def }) => {
          const get = kernel.ops.api(plugin)?.read[def.get]
          if (!get) throw new Error(`field "${def.name}": no read operation "${def.get}"`)
          const value: unknown = (await get({ ref: props.recordRef }))?.value
          return value === null || value === undefined ? "—" : String(value)
        }),
      ),
    { key: () => props.recordRef },
  )
  return (
    <Show when={fields.length > 0 && q.data()}>
      {(values: () => string[]) => (
        <box flexDirection="column" flexShrink={0}>
          <For each={fields}>
            {(f, i) => (
              <box flexDirection="row" flexShrink={0}>
                <text fg={theme.muted}>{f.def.label + " ".repeat(width - displayWidth(f.def.label)) + GAP}</text>
                <text fg={theme.text}>{values()[i()] ?? "—"}</text>
              </box>
            )}
          </For>
        </box>
      )}
    </Show>
  )
}
