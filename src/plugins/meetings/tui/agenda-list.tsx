// The left-hand agenda list of the Prep and Notes tabs: one row per item, `n. text` and then its project code
// (muted), with ↑↓ moving the selection (onSelect gets the item's position). Below it the attendees' names, wrapped
// to two lines, the ones that do not fit counted as `+n`. 32 columns wide, 24 on a terminal under 100 columns.
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For } from "solid-js"
import { displayWidth, Panel, Table, theme, truncate, useKeys, useQuery, useRuntime, type TableColumn, type TableRow } from "../../../kernel/tui/api"
import { makeStore } from "../logic/records"
import type { MeetingRecord } from "../logic/schema"

const WIDE = 32
const NARROW = 24
const NARROW_BELOW = 100 // terminal columns
const ATTENDEE_LINES = 2

// The attendees' names (people.person), in the meeting's order; a handle stands in for a name it cannot find.
export async function attendeeNames(rt: ReturnType<typeof useRuntime>, m: MeetingRecord): Promise<string[]> {
  if (m.attendees.length === 0) return []
  const handles = m.attendees.map((h) => h.slice(1))
  const rows = await makeStore(rt).unlessUnavailable([] as Array<{ handle: unknown; name: unknown }>, () =>
    rt.data.selectFrom("people.person").select(["handle", "name"]).where("handle", "in", handles).execute(),
  )
  const nameOf = new Map(rows.map((r) => [String(r.handle), String(r.name)]))
  return m.attendees.map((h) => nameOf.get(h.slice(1)) ?? h)
}

// Names packed into lines of `width` columns (`Marie Dubois, Peter Janssens`), at most `max` lines: when they do
// not all fit, as many as fit with `+n` for the rest.
export function attendeeLines(names: string[], width: number, max = ATTENDEE_LINES): string[] {
  const pack = (list: string[], last: string | undefined): string[] => {
    const pieces = list.map((n, i) => (i < list.length - 1 ? `${n},` : n))
    if (last !== undefined) pieces.push(last)
    const out: string[] = []
    for (const p of pieces) {
      const cur = out.at(-1)
      if (cur !== undefined && displayWidth(`${cur} ${p}`) <= width) out[out.length - 1] = `${cur} ${p}`
      else out.push(p)
    }
    return out.map((l) => truncate(l, width))
  }
  const all = pack(names, undefined)
  if (all.length <= max) return all
  for (let k = names.length - 1; k > 0; k--) {
    const shown = pack(names.slice(0, k), `+${names.length - k}`)
    if (shown.length <= max) return shown
  }
  return [`+${names.length}`]
}

export function AgendaList(props: { recordRef: string; onSelect(position: number | undefined): void; width?: number }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const keys = useKeys()
  const dims = useTerminalDimensions()
  const width = () => props.width ?? (dims().width < NARROW_BELOW ? NARROW : WIDE)

  const q = useQuery(
    async () => {
      const m = await store.meeting(props.recordRef)
      return { meeting: m, names: await attendeeNames(rt, m) }
    },
    { key: () => props.recordRef },
  )
  const agenda = () => q.data()?.meeting.agenda ?? []
  // The project column is as wide as the longest code (none without projects).
  const columns = createMemo((): TableColumn[] => {
    const code = Math.max(0, ...agenda().map((a) => (a.project === null ? 0 : displayWidth(a.project) - 1)))
    return [{ id: "item", title: "Item", width: "grow" }, ...(code > 0 ? [{ id: "project", title: "Project", width: code }] : [])]
  })
  const rows = createMemo((): TableRow[] =>
    agenda().map((a) => ({
      ref: String(a.position),
      cells: { item: `${a.position}. ${a.text}`, project: { text: a.project === null ? "" : a.project.slice(1), tone: "muted" } },
    })),
  )
  // The panel's border and padding take four columns.
  const lines = () => attendeeLines(q.data()?.names ?? [], width() - 4)

  return (
    <box flexDirection="column" width={width()} flexShrink={0} minHeight={0}>
      <Panel title="Agenda" count={q.data() === undefined ? undefined : agenda().length} focused={keys.active()} grow>
        <Table
          columns={columns()}
          rows={rows()}
          header={false}
          onSelect={(ref) => props.onSelect(ref === undefined ? undefined : Number(ref))}
          focused={keys.active()}
          empty="No agenda yet."
        />
      </Panel>
      <box flexDirection="column" flexShrink={0} paddingLeft={2} paddingRight={2}>
        <text fg={theme.accent}>Attendees</text>
        <For each={lines()} fallback={<text fg={theme.muted}>none</text>}>
          {(l) => (
            <text wrapMode="none" fg={theme.text}>
              {l}
            </text>
          )}
        </For>
      </box>
    </box>
  )
}
