// The Overview screen (slot 1): the plugins' panels in a two-column grid, in priority order (left column: even
// indexes, right column: odd). Each panel loads through useQuery in its plugin's scope, shows its row count in
// the title, at most MAX_ROWS rows plus `+N more`, or its `empty` text. Tab moves focus to the next panel,
// ↑↓ move within it and Enter opens the selected row's ref.
import { createSignal, For, Show } from "solid-js"
import { useQuery } from "../data"
import { useKeys, useScreenKeys } from "../keys"
import { useNav } from "../nav"
import type { Registered } from "../registry"
import { PluginScope, useApp } from "../scope"
import { theme } from "../theme"
import type { OverviewPanelDef, OverviewRow } from "../types"
import { KeyHints } from "./KeyHints"
import { Panel } from "./Panel"
import { fitWidth, Table, type TableColumn, type TableRow } from "./Table"

export const MAX_ROWS = 5
const MAX_COLUMN = 16

type PanelEntry = Registered<OverviewPanelDef>

export function OverviewScreen() {
  const app = useApp()
  const keys = useKeys()
  const panels = app.registry.panels()
  const [focus, setFocus] = createSignal(0)
  useScreenKeys((key) => {
    if (key.name !== "tab" || key.shift || panels.length === 0) return
    key.preventDefault()
    setFocus((i) => (i + 1) % panels.length)
  })
  const column = (parity: number) => panels.map((p, i) => ({ p, i })).filter(({ i }) => i % 2 === parity)
  const Column = (props: { parity: number }) => (
    <box flexDirection="column" flexGrow={1} flexBasis={0} gap={0}>
      <For each={column(props.parity)}>
        {({ p, i }) => (
          <PluginScope kernel={app.kernel} plugin={p.plugin} label={p.title}>
            <OverviewPanel def={p} focused={keys.active() && focus() === i} />
          </PluginScope>
        )}
      </For>
    </box>
  )
  return (
    <Show when={panels.length > 0} fallback={<text fg={theme.muted}>No panels</text>}>
      <KeyHints
        hints={[
          { key: "Tab", label: "next panel" },
          { key: "↑↓", label: "move" },
          { key: "Enter", label: "open" },
        ]}
      />
      <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
        <Column parity={0} />
        <Column parity={1} />
      </box>
    </Show>
  )
}

function OverviewPanel(props: { def: PanelEntry; focused: boolean }) {
  const nav = useNav()
  const q = useQuery(() => props.def.load())
  const all = () => q.data() ?? []
  const shown = (): TableRow[] =>
    all()
      .slice(0, MAX_ROWS)
      .map((r: OverviewRow) => ({ ref: r.ref, cells: Object.fromEntries(r.cells.map((c, i) => [`c${i}`, c])) }))
  // The column with the widest text (the last of equals) takes the leftover width; the others fit their rows.
  const columns = (): TableColumn[] => {
    const n = Math.max(0, ...all().map((r) => r.cells.length))
    const natural = Array.from({ length: n }, (_, i) => fitWidth(shown(), `c${i}`, "", Infinity))
    const grow = natural.reduce((best, w, i) => (w >= (natural[best] ?? 0) ? i : best), 0)
    return Array.from({ length: n }, (_, i) =>
      i === grow ? { id: `c${i}`, title: "", width: "grow" as const } : { id: `c${i}`, title: "", width: Math.min(natural[i]!, MAX_COLUMN) },
    )
  }
  const more = () => all().length - MAX_ROWS
  return (
    <Panel title={props.def.title} count={q.data()?.length} focused={props.focused} footer={props.def.footer}>
      <Show when={q.data() !== undefined}>
        <Table columns={columns()} rows={shown()} header={false} empty={props.def.empty} focused={props.focused} onOpen={(ref) => void nav.open(ref)} />
        <Show when={more() > 0}>
          <text fg={theme.muted}>{`+${more()} more`}</text>
        </Show>
      </Show>
    </Panel>
  )
}
