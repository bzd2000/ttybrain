// The Meetings screen (slot 5): one table of meetings in two groups.
// - `Upcoming · n`: planned meetings by date, then id; one dated before today shows its date in red.
// - `Past · n`: held and cancelled meetings, newest first; cancelled rows are muted.
// - Columns: ref, date (`Thu 4 Dec`), title, kind, status, attendee count, project codes of the agenda, then the
//   columns other plugins registered for the list "meetings".
// - Keys: Enter opens the meeting, n new, e edit, x close a planned meeting as held, Del cancel a planned meeting
//   (both after a confirmation). The selection is kept in the route's `selected` param.
import { createMemo, createSignal, Show, untrack } from "solid-js"
import {
  act,
  joinFit,
  joinFitWidth,
  KeyHints,
  longDate,
  Panel,
  printable,
  Table,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  useToday,
  type Hint,
  type TableColumn,
  type TableGroup,
  type TableRow,
  type Tone,
} from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import type { MeetingRecord } from "../logic/schema"

export const EMPTY = "No meetings yet. Press n to add one."
export const closeQuestion = (ref: string) => `Close ${ref} as held?`
export const cancelQuestion = (ref: string) => `Cancel ${ref}? It stays in the list as cancelled.`
const HINTS: Hint[] = [
  { key: "Enter", label: "open" },
  { key: "n", label: "new" },
  { key: "e", label: "edit" },
  { key: "x", label: "close" },
  { key: "Del", label: "cancel" },
]
// The Projects column fits each row's first code, plus ` …` when more follow (12 to 18), and a cell keeps whole
// codes (joinFit): a code is never cut, and more codes than fit always end in `…`.
const columns = (projectsWidth: number): TableColumn[] => [
  { id: "ref", title: "Ref", width: 5 },
  { id: "date", title: "Date", width: 10 },
  { id: "title", title: "Title", width: "grow" },
  { id: "kind", title: "Kind", width: 8 },
  { id: "status", title: "Status", width: 9 },
  { id: "att", title: "Att.", width: 4 },
  { id: "projects", title: "Projects", width: projectsWidth },
]

// `Thu 4 Dec`: the long date without its year.
const dayDate = (iso: string) => longDate(iso).replace(/ \d+$/, "")
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
// The status line after closing: `closed M-4: 3 actions, 1 decision`.
export const closedMessage = (ref: string, out: unknown) => {
  const { actions, decisions } = (out as { logged: { actions: number; decisions: number } }).logged
  return `closed ${ref}: ${plural(actions, "action")}, ${plural(decisions, "decision")}`
}
// The project codes of the agenda, in agenda order, without `#`.
const codes = (m: MeetingRecord) => [...new Set(m.agenda.flatMap((a) => (a.project === null ? [] : [a.project.slice(1)])))]

function row(m: MeetingRecord, today: string, projectsWidth: number): TableRow {
  const muted: Tone = m.status === "cancelled" ? "muted" : undefined
  const cell = (text: string, tone: Tone = muted) => ({ text, tone })
  return {
    ref: m.ref,
    cells: {
      ref: cell(m.ref, "muted"),
      date: cell(dayDate(m.date), m.status === "planned" && m.date < today ? "red" : muted),
      title: cell(m.title),
      kind: cell(m.kind),
      status: cell(m.status),
      att: cell(String(m.attendees.length)),
      projects: cell(joinFit(codes(m), projectsWidth), muted ?? "cyan"),
    },
  }
}

export function meetingGroups(list: MeetingRecord[]): Array<{ title: string; rows: MeetingRecord[] }> {
  const upcoming = list.filter((m) => m.status === "planned").sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const past = list.filter((m) => m.status !== "planned").sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  return [
    { title: "Upcoming", rows: upcoming },
    { title: "Past", rows: past },
  ].filter((g) => g.rows.length > 0)
}

export function MeetingsScreen() {
  const rt = useRuntime()
  const store = makeStore(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()

  const q = useQuery(async (): Promise<MeetingRecord[]> => {
    const ids = await rt.data.selectFrom("meeting").select("id").execute()
    return Promise.all(ids.map((r) => store.meeting(`M-${Number(r.id)}`)))
  })
  // The selection is kept in the route's params while a record is open (Esc pops to this screen again).
  const params = untrack(() => {
    const r = nav.route()
    return (r.kind === "screen" ? r.params : undefined) ?? {}
  })
  const remember = (ref: string) => {
    const here = nav.route()
    if (here.kind === "screen" && here.params?.selected !== ref) nav.replaceParams({ ...here.params, selected: ref })
  }
  // `current`: the row the table has selected (undefined while it shows none); `want`: a row to select once it is
  // loaded (a new meeting, or the `selected` param), dropped as soon as the table has selected it.
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>(params.selected)

  const groups = createMemo(() => meetingGroups(q.data() ?? []))
  const projectsWidth = createMemo(() => joinFitWidth(groups().flatMap((g) => g.rows.map(codes)), 12, 18))
  const tableGroups = createMemo((): TableGroup[] => groups().map((g) => ({ title: g.title, rows: g.rows.map((m) => row(m, today(), projectsWidth())) })))
  const shown = () => groups().flatMap((g) => g.rows)
  // The selected meeting, only while shown.
  const selected = (): MeetingRecord | undefined => {
    const ref = current()
    return ref === undefined ? undefined : shown().find((m) => m.ref === ref)
  }
  const loaded = (ref: string | undefined) => ref !== undefined && shown().some((m) => m.ref === ref)
  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
    if (ref !== undefined) remember(ref)
  }

  const meetingForm = async (recordRef?: string) => {
    const saved = await overlay.openForm("meeting", "meeting", recordRef === undefined ? {} : { recordRef })
    if (saved !== undefined) setWant(saved)
  }
  const close = async (m: MeetingRecord) => {
    if (!(await overlay.confirm(closeQuestion(m.ref)))) return
    await act(() => rt.self().write.closeMeeting!({ ref: m.ref }), { ok: (out) => closedMessage(m.ref, out) })
  }
  const cancel = async (m: MeetingRecord) => {
    if (!(await overlay.confirm(cancelQuestion(m.ref)))) return
    await act(() => rt.self().write.cancelMeeting!({ ref: m.ref }), { ok: () => `cancelled ${m.ref}` })
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    const m = selected()
    const planned = m !== undefined && m.status === "planned"
    if (key.name === "delete") {
      if (planned) void cancel(m)
    } else if (ch === "x") {
      if (planned) void close(m)
    } else if (ch === "n") void meetingForm()
    else if (ch === "e") {
      if (m !== undefined) void meetingForm(m.ref)
    } else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
      <KeyHints hints={HINTS} />
      <Panel title="Meetings" count={q.data() === undefined ? undefined : shown().length} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Table
            columns={columns(projectsWidth())}
            groups={tableGroups()}
            selectedRef={loaded(want()) ? want() : undefined}
            onSelect={select}
            onOpen={(ref) => void nav.open(ref)}
            focused={keys.active()}
            empty={EMPTY}
            listId="meetings"
          />
        </Show>
      </Panel>
    </box>
  )
}
