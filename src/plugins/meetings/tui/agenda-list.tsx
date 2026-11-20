// The left-hand Agenda panel of the Prep and Notes tabs, as the meeting prep design draws it: one row per item,
// `n.` (muted, in text colour when selected), the text and its project code (cyan), with ↑↓ moving the selection
// (onSelect gets the item's position). The panel itself is drawn unfocused (the right-hand panel has focus), the
// selection still shows. Under the items, a muted `Attendees` heading and the attendees' short names, stakeholders
// first (`Peter J.`, magenta), then the team (`Anna`), wrapped to two lines, the ones that do not fit counted as a
// muted `+n`. 34 columns wide, 24 on a terminal under 100 columns.
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For } from "solid-js"
import { displayWidth, Panel, Table, theme, toneColor, truncate, useKeys, useQuery, useRuntime, type TableColumn, type TableRow, type Tone } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import type { MeetingRecord } from "../logic/schema"

const WIDE = 34
const NARROW = 24
const NARROW_BELOW = 100 // terminal columns
const ATTENDEE_LINES = 2
const NUMBER = 3 // the `n.` column

type Runtime = ReturnType<typeof useRuntime>
type PersonRow = { handle: unknown; name: unknown; is_stakeholder?: unknown; is_team?: unknown }
const peopleOf = (rt: Runtime, m: MeetingRecord): Promise<PersonRow[]> => {
  const handles = m.attendees.map((h) => h.slice(1))
  return makeStore(rt).unlessUnavailable([] as PersonRow[], () =>
    rt.data.selectFrom("people.person").select(["handle", "name", "is_stakeholder", "is_team"]).where("handle", "in", handles).execute(),
  )
}

// The attendees' names (people.person), in the meeting's order; a handle stands in for a name it cannot find.
export async function attendeeNames(rt: Runtime, m: MeetingRecord): Promise<string[]> {
  if (m.attendees.length === 0) return []
  const nameOf = new Map((await peopleOf(rt, m)).map((r) => [String(r.handle), String(r.name)]))
  return m.attendees.map((h) => nameOf.get(h.slice(1)) ?? h)
}

export type Attendee = { name: string; tone?: Tone }
// A stakeholder as `First L.`, anyone else by first name.
export function shortName(name: string, stakeholder: boolean): string {
  const words = name.trim().split(/\s+/)
  if (!stakeholder || words.length < 2) return words[0] || name
  return `${words[0]} ${[...words.at(-1)!][0]}.`
}

// The attendees as the Agenda panel shows them: stakeholders first (magenta), then the others, each in the
// meeting's order; a handle stands in for a person it cannot find.
export async function attendeeList(rt: Runtime, m: MeetingRecord): Promise<Attendee[]> {
  if (m.attendees.length === 0) return []
  const byHandle = new Map((await peopleOf(rt, m)).map((r) => [String(r.handle), r]))
  const all = m.attendees.map((h) => {
    const r = byHandle.get(h.slice(1))
    if (r === undefined) return { name: h, stakeholder: false }
    const stakeholder = Number(r.is_stakeholder) === 1
    return { name: shortName(String(r.name), stakeholder), stakeholder }
  })
  return [...all.filter((a) => a.stakeholder), ...all.filter((a) => !a.stakeholder)].map((a) => (a.stakeholder ? { name: a.name, tone: "magenta" } : { name: a.name }))
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

// attendeeLines in pieces, for colour: each name in its tone, the separators in text colour, `+n` muted.
export function attendeePieces(people: Attendee[], width: number, max = ATTENDEE_LINES): Attendee[][] {
  let k = 0
  return attendeeLines(
    people.map((p) => p.name),
    width,
    max,
  ).map((l) => {
    const out: Attendee[] = []
    let rest = l
    while (rest !== "") {
      const p = people[k]
      const sep = /^[, ]+/.exec(rest)
      if (sep) {
        out.push({ name: sep[0] })
        rest = rest.slice(sep[0].length)
      } else if (p !== undefined && rest.startsWith(p.name)) {
        out.push(p)
        rest = rest.slice(p.name.length)
        k++
      } else {
        // The `+n`, or a name cut to the width.
        const more = /^\+\d+$/.test(rest)
        out.push(more ? { name: rest, tone: "muted" } : { name: rest, ...(p?.tone ? { tone: p.tone } : {}) })
        if (!more) k++
        rest = ""
      }
    }
    return out
  })
}

export function AgendaList(props: { recordRef: string; onSelect(position: number | undefined): void; selectedRef?: string; width?: number }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const keys = useKeys()
  const dims = useTerminalDimensions()
  const width = () => props.width ?? (dims().width < NARROW_BELOW ? NARROW : WIDE)

  const q = useQuery(
    async () => {
      const m = await store.meeting(props.recordRef)
      return { meeting: m, attendees: await attendeeList(rt, m) }
    },
    { key: () => props.recordRef },
  )
  const agenda = () => q.data()?.meeting.agenda ?? []
  const [selected, setSelected] = createSignal<string | undefined>()
  // The project column is as wide as the longest code (none without projects): codes are never cut.
  const columns = createMemo((): TableColumn[] => {
    const code = Math.max(0, ...agenda().map((a) => (a.project === null ? 0 : displayWidth(a.project) - 1)))
    return [{ id: "pos", title: "#", width: NUMBER }, { id: "item", title: "Item", width: "grow" }, ...(code > 0 ? [{ id: "project", title: "Project", width: code }] : [])]
  })
  const rows = createMemo((): TableRow[] =>
    agenda().map((a) => ({
      ref: String(a.position),
      cells: {
        pos: { text: `${a.position}.`, ...(String(a.position) === selected() ? {} : { tone: "muted" as const }) },
        item: a.text,
        project: { text: a.project === null ? "" : a.project.slice(1), tone: "cyan" },
      },
    })),
  )
  // The panel's border and padding take four columns.
  const lines = () => attendeePieces(q.data()?.attendees ?? [], width() - 4)

  return (
    <box flexDirection="column" width={width()} flexShrink={0} minHeight={0}>
      <Panel title="Agenda" focused={false} grow>
        {/* As tall as the items, shrinking (and scrolling) when the panel is shorter. */}
        <box flexDirection="column" height={Math.max(1, rows().length)} flexShrink={1} minHeight={0}>
          <Table
            columns={columns()}
            rows={rows()}
            header={false}
            selectedRef={props.selectedRef}
            onSelect={(ref) => {
              setSelected(ref)
              props.onSelect(ref === undefined ? undefined : Number(ref))
            }}
            focused={keys.active()}
            empty="No agenda yet."
          />
        </box>
        <box flexDirection="column" flexShrink={0} marginTop={1}>
          <text fg={theme.muted}>Attendees</text>
          <For each={lines()} fallback={<text fg={theme.muted}>none</text>}>
            {(l) => (
              <box flexDirection="row" height={1}>
                <For each={l}>
                  {(p) => (
                    <text wrapMode="none" flexShrink={0} fg={toneColor(p.tone)}>
                      {p.name}
                    </text>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>
      </Panel>
    </box>
  )
}
