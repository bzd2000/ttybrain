// A board meeting's Agenda tab (the 2026-11-20 `board` design): on the left (1.3 : 1) "Agenda · n", the agenda as a
// table (# muted `1.`, Item, Project cyan, the ask's first line, `—` muted for none); on the right "Board talk-list
// · n", the board project's open talk items (`·`), then `A adds one to the agenda`. Keys (the design's bar): n add an
// item, J/K move it down/up (the selection follows it), A take the talk-list's selected item (the first one until
// Tab moves to that panel) onto the agenda (ruling M8: added as an item and ticked discussed in this meeting, in one
// act), e edit the item (its ask); kept beyond the bar: Tab the other panel, Del remove an item (after a
// confirmation), p attendees, x close the meeting. A cancelled meeting is read-only: its write keys say so.
import { createMemo, createSignal, Show } from "solid-js"
import {
  act,
  fitWidth,
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
import type { AgendaItem, MeetingRecord, TalkRecord } from "../logic/schema"
import { closedMessage, closeQuestion } from "./meetings-screen"

export const EMPTY = "No agenda yet. Press n to add an item."
const HINTS: Hint[] = [
  { key: "←→", label: "tabs" },
  { key: "n", label: "agenda item" },
  { key: "J/K", label: "reorder" },
  { key: "A", label: "talk-list → agenda" },
  { key: "e", label: "edit ask" },
  { key: "Esc", label: "back" },
]
// The project column fits the longest code shown (7 to 16): codes are never cut.
const columns = (codes: string[]): TableColumn[] => [
  { id: "pos", title: "", width: 3 },
  { id: "text", title: "Item", width: "grow" },
  { id: "project", title: "Project", width: fitWidth(codes, 7, 16) },
  { id: "ask", title: "Ask", width: "grow", drop: 1 },
]
const talkColumns: TableColumn[] = [
  { id: "dot", title: "", width: 3 },
  { id: "text", title: "", width: "grow" },
]
export const TALK_LIST_EMPTY = "Nothing on the board's talk-list."

const firstLine = (s: string | null) => (s ?? "").split("\n")[0] ?? ""

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
      await act(() => rt.self().write.closeMeeting!({ ref: m.ref }), { ok: closedMessage })
    },
    logAction: (m: MeetingRecord, project: string | null) => void overlay.openForm("action", "action", links(m, project)),
    logDecision: (m: MeetingRecord, project: string | null) => void overlay.openForm("decision", "decision", links(m, project)),
    editItem: (m: MeetingRecord, item: AgendaItem) => void overlay.openForm("meeting", "agenda-item", { recordRef: m.ref, prefill: { item: String(item.position) } }),
    // Moves the item to position `to` (J/K); true when it moved, so the caller's selection can follow it.
    async moveItem(m: MeetingRecord, item: AgendaItem, to: number): Promise<boolean> {
      if (to < 1 || to > m.agenda.length) return false
      return (await act(() => rt.self().write.moveAgendaItem!({ meeting: m.ref, item: item.position, to }))).ok
    },
  }
}

export function AgendaTab(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const overlay = useOverlay()
  const keys = useKeys()
  const writes = useMeetingWrites()
  keys.hints(HINTS, { exact: true, frame: [], globals: false })

  const q = useQuery(
    async () => {
      const m = await store.meeting(props.recordRef)
      const { items } = (await rt.self().read.agendaFor!({ meeting: m.ref })) as { items: TalkRecord[] }
      return { meeting: m, talk: items.filter((t) => t.status === "open") }
    },
    { key: () => props.recordRef },
  )
  const meeting = () => q.data()?.meeting
  const rows = createMemo((): TableRow[] =>
    (meeting()?.agenda ?? []).map((a) => ({
      ref: String(a.position),
      cells: {
        pos: { text: `${a.position}.`, tone: "muted" },
        text: a.text,
        project: { text: a.project === null ? "" : a.project.slice(1), tone: "cyan" },
        ask: a.ask === null || a.ask.trim() === "" ? { text: "—", tone: "muted" } : firstLine(a.ask),
      },
    })),
  )
  const talkRows = createMemo((): TableRow[] => (q.data()?.talk ?? []).map((t) => ({ ref: t.ref, cells: { dot: { text: "·", tone: "muted" }, text: t.text } })))
  // 0: the agenda, 1: the talk-list.
  const [focus, setFocus] = createSignal<0 | 1>(0)
  // `current`: the position the table has selected; `want`: a position to select once it is shown (a new or
  // moved item), dropped as soon as the table has selected it.
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>()
  const [talk, setTalk] = createSignal<string | undefined>()
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
    if (await writes.moveItem(m, item, to)) setWant(String(to))
  }
  const remove = async (m: MeetingRecord, item: AgendaItem) => {
    if (!(await overlay.confirm(`Remove item ${item.position} "${item.text}"?`))) return
    await act(() => rt.self().write.removeAgendaItem!({ meeting: m.ref, item: item.position }))
  }
  // M8: onto the agenda, and discussed in this meeting, all or nothing.
  const takeOn = async (m: MeetingRecord) => {
    const list = q.data()?.talk ?? []
    const t = list.find((x) => x.ref === talk()) ?? list[0]
    if (t === undefined) return
    const r = await act(
      async () => {
        await rt.self().write.addAgendaItem!({ meeting: m.ref, text: t.text })
        return rt.self().write.discussTalk!({ ref: t.ref, meeting: m.ref })
      },
      { ok: () => `added "${t.text}" to the agenda` },
    )
    if (r.ok) setWant(String(m.agenda.length + 1))
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const m = meeting()
    if (m === undefined) return
    const ch = printable(key)
    const item = focus() === 0 ? selected() : undefined
    if (key.name === "tab") setFocus((f) => (f === 0 ? 1 : 0))
    else if (ch === "n") writes.live(m, () => void add(m))
    else if (ch === "e") writes.live(m, () => item && writes.editItem(m, item))
    else if (ch === "J") writes.live(m, () => item && void move(m, item, item.position + 1))
    else if (ch === "K") writes.live(m, () => item && void move(m, item, item.position - 1))
    else if (ch === "A") writes.live(m, () => void takeOn(m))
    else if (key.name === "delete") writes.live(m, () => item && void remove(m, item))
    else if (ch === "p") writes.live(m, () => void overlay.openForm("meeting", "attendees", { recordRef: m.ref }))
    else if (ch === "x") writes.live(m, () => void writes.close(m))
    else return
    key.preventDefault()
  })

  // Both panels as tall as the taller one's rows (the agenda: its header and items; the talk-list: its items, a blank
  // line and the `A` line), as the design's grid draws them.
  const agendaNeed = () => 2 + 1 + (meeting()?.agenda.length ?? 0)
  const talkNeed = () => 2 + Math.max(1, q.data()?.talk.length ?? 0) + 2
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
    <box flexDirection="row" flexShrink={1} minHeight={0} gap={1} overflow="hidden">
      <box flexDirection="column" flexGrow={13} flexBasis={0} minWidth={0} minHeight={agendaNeed()}>
        <Panel title="Agenda" count={meeting()?.agenda.length} focused={keys.active() && focus() === 0} grow>
          <Show when={q.data() !== undefined}>
            <Table
              columns={columns((meeting()?.agenda ?? []).map((a) => a.project?.slice(1) ?? ""))}
              rows={rows()}
              selectedRef={rows().some((r) => r.ref === want()) ? want() : undefined}
              onSelect={select}
              focused={keys.active() && focus() === 0}
              empty={EMPTY}
            />
          </Show>
        </Panel>
      </box>
      <box flexDirection="column" flexGrow={10} flexBasis={0} minWidth={0} minHeight={talkNeed()}>
        <Panel title="Board talk-list" count={q.data()?.talk.length} focused={keys.active() && focus() === 1} grow>
          <box flexDirection="column" height={Math.max(1, talkRows().length)} flexShrink={0}>
            <Table columns={talkColumns} rows={talkRows()} header={false} onSelect={setTalk} focused={keys.active() && focus() === 1} empty={TALK_LIST_EMPTY} />
          </box>
          <text> </text>
          <box flexDirection="row" height={1}>
            <text fg={theme.accent} flexShrink={0}>
              A
            </text>
            <text fg={theme.muted} flexShrink={0}>
              {" adds one to the agenda"}
            </text>
          </box>
        </Panel>
      </box>
    </box>
    </box>
  )
}
