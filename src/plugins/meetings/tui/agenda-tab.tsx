// The meeting record view's Agenda tab: `Thu 4 Dec 2026 · steering · planned · 8 attendees`, the agenda as a
// table (#, item, project, the ask's first line) and the attendees. Keys: n add an item, e edit it, J/K move it
// down/up (the selection follows it), Del remove it (after a confirmation), p attendees, x close the meeting.
// A cancelled meeting is read-only: its write keys say so and open nothing.
import { createMemo, createSignal, Show } from "solid-js"
import {
  act,
  longDate,
  notify,
  Panel,
  printable,
  Table,
  theme,
  useKeys,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  type Hint,
  type TableColumn,
  type TableRow,
} from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import type { AgendaItem, MeetingRecord } from "../logic/schema"
import { attendeeNames } from "./agenda-list"
import { closedMessage, closeQuestion } from "./meetings-screen"

export const EMPTY = "No agenda yet. Press n to add an item."
const HINTS: Hint[] = [
  { key: "n", label: "add" },
  { key: "e", label: "edit" },
  { key: "J/K", label: "move" },
  { key: "Del", label: "remove" },
  { key: "p", label: "attendees" },
  { key: "x", label: "close" },
]
const COLUMNS: TableColumn[] = [
  { id: "pos", title: "#", width: 3 },
  { id: "text", title: "Item", width: "grow" },
  { id: "project", title: "Project", width: 8 },
  { id: "ask", title: "Ask", width: "grow" },
]

const firstLine = (s: string | null) => (s ?? "").split("\n")[0] ?? ""
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
// `Thu 4 Dec 2026 · steering · planned · 8 attendees`.
const meetingHeader = (m: MeetingRecord) => [longDate(m.date), m.kind, m.status, plural(m.attendees.length, "attendee")].join(" · ")

// The writes the meeting tabs share: a guard for a cancelled meeting, closing, and logging an action or decision
// against the meeting (and the item's project, when it has one).
export function useMeetingWrites() {
  const rt = useRuntime()
  const overlay = useOverlay()
  const links = (m: MeetingRecord, project: string | null) => ({ prefill: { ...(project === null ? {} : { project }), meeting: m.ref } })
  return {
    // Runs `run` unless the meeting is cancelled; says so then.
    live(m: MeetingRecord | undefined, run: () => void) {
      if (m === undefined) return
      if (m.status === "cancelled") notify(`${m.ref} is cancelled`, "error")
      else run()
    },
    // A planned meeting after a confirmation; a held one fails in the operation (`M-4 is already held`).
    async close(m: MeetingRecord) {
      if (m.status === "planned" && !(await overlay.confirm(closeQuestion(m.ref)))) return
      await act(() => rt.self().write.closeMeeting!({ ref: m.ref }), { ok: (out) => closedMessage(m.ref, out) })
    },
    logAction: (m: MeetingRecord, project: string | null) => void overlay.openForm("action", "action", links(m, project)),
    logDecision: (m: MeetingRecord, project: string | null) => void overlay.openForm("decision", "decision", links(m, project)),
    editItem: (m: MeetingRecord, item: AgendaItem) => void overlay.openForm("meeting", "agenda-item", { recordRef: m.ref, prefill: { item: String(item.position) } }),
  }
}

export function AgendaTab(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const overlay = useOverlay()
  const keys = useKeys()
  const writes = useMeetingWrites()
  keys.hints(HINTS)

  const q = useQuery(
    async () => {
      const m = await store.meeting(props.recordRef)
      return { meeting: m, names: await attendeeNames(rt, m) }
    },
    { key: () => props.recordRef },
  )
  const meeting = () => q.data()?.meeting
  const rows = createMemo((): TableRow[] =>
    (meeting()?.agenda ?? []).map((a) => ({
      ref: String(a.position),
      cells: { pos: String(a.position), text: a.text, project: a.project === null ? "" : a.project.slice(1), ask: firstLine(a.ask) },
    })),
  )
  // `current`: the position the table has selected; `want`: a position to select once it is shown (a new or
  // moved item), dropped as soon as the table has selected it.
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>()
  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
  }
  // The selected item, only while it is shown.
  const selected = () => meeting()?.agenda.find((a) => String(a.position) === current())

  const add = async (m: MeetingRecord) => {
    const saved = await overlay.openForm("meeting", "agenda-item", { recordRef: m.ref })
    if (saved !== undefined) setWant(String(m.agenda.length + 1))
  }
  const move = async (m: MeetingRecord, item: AgendaItem, to: number) => {
    if (to < 1 || to > m.agenda.length) return
    const r = await act(() => rt.self().write.moveAgendaItem!({ meeting: m.ref, item: item.position, to }))
    if (r.ok) setWant(String(to))
  }
  const remove = async (m: MeetingRecord, item: AgendaItem) => {
    if (!(await overlay.confirm(`Remove item ${item.position} "${item.text}"?`))) return
    await act(() => rt.self().write.removeAgendaItem!({ meeting: m.ref, item: item.position }))
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const m = meeting()
    if (m === undefined) return
    const ch = printable(key)
    const item = selected()
    if (ch === "n") writes.live(m, () => void add(m))
    else if (ch === "e") writes.live(m, () => item && writes.editItem(m, item))
    else if (ch === "J") writes.live(m, () => item && void move(m, item, item.position + 1))
    else if (ch === "K") writes.live(m, () => item && void move(m, item, item.position - 1))
    else if (key.name === "delete") writes.live(m, () => item && void remove(m, item))
    else if (ch === "p") writes.live(m, () => void overlay.openForm("meeting", "attendees", { recordRef: m.ref }))
    else if (ch === "x") writes.live(m, () => void writes.close(m))
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1}>
      <Show when={meeting()}>
        {(m: () => MeetingRecord) => (
          <text fg={theme.text} flexShrink={0} marginBottom={1}>
            {meetingHeader(m())}
          </text>
        )}
      </Show>
      <Panel title="Agenda" count={meeting()?.agenda.length} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Table
            columns={COLUMNS}
            rows={rows()}
            selectedRef={rows().some((r) => r.ref === want()) ? want() : undefined}
            onSelect={select}
            focused={keys.active()}
            empty={EMPTY}
          />
        </Show>
      </Panel>
      <Show when={q.data()}>
        {(d: () => { names: string[] }) => (
          <box flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
            <text fg={theme.accent}>Attendees</text>
            <text fg={d().names.length === 0 ? theme.muted : theme.text}>{d().names.length === 0 ? "No attendees." : d().names.join(", ")}</text>
          </box>
        )}
      </Show>
    </box>
  )
}
