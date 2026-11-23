// Screen 5, Meetings (the 2026-11-20 `meetings` design): an overview across people and projects.
// - "Upcoming" (left, focused first): Date · Meeting · About · Talk · Act. (upcoming.ts), the planned meetings by
//   week: "This week · 20–22 Nov" (when it has any), "Next week · 23–27 Nov", "Week after · 30 Nov–4 Dec" (its rows'
//   title and Talk muted). A one-off meeting's title ends with a muted `one-off`. After them, muted: "Held, closes
//   itself <day> · n" (planned meetings of the last 3 days that close themselves: date amber, Talk `notes` when they
//   have notes), "Not closed · n" (past planned meetings that never close themselves, or that missed closing
//   themselves because no write-capable start ran the upkeep; date red) and "No subject · n"
//   (meetings from before subjects, M7; a muted line under the table says how to give one a subject). Groups that
//   would be empty are left out.
// - "Series · n" (right): Series · About · Rhythm (short), the series that have not ended: 1:1s, then project, then
//   board series, each by next date; as tall as its rows (at most half the column).
// - "Boards · n" (right, under Series; design §5.7): the boards that are not archived, by code: the code (cyan, its
//   column as wide as the longest code, so codes stay whole) and the name.
// - Keys: Tab cycles Upcoming → Series → Boards; Enter opens the meeting (a series: what it is about; a board: its
//   view); n a one-off meeting, N a new
//   series, s skips the selected meeting's date (after a confirmation), m moves it (a date form). The bar is the
//   design's: `tab panel   enter open   n one-off   N series   s skip date   m move date   i capture`.
import { createMemo, createSignal, Show, untrack } from "solid-js"
import {
  act,
  addDays,
  dayDate,
  KeyHints,
  Panel,
  printable,
  shortDate,
  Table,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  theme,
  type Cell,
  type TableColumn,
  type TableGroup,
  type TableRow,
} from "@ttybrain/api/tui"
import { CLOSE_AFTER_DAYS } from "../logic/close"
import { makeStore } from "../logic/records"
import { parseRhythm, rhythmLabel } from "../logic/rhythm"
import type { SubjectType } from "../logic/schema"
import { actCell } from "./panels"
import { dayOnly, makeUpcoming, MUTED_DASH, type Upcoming } from "./upcoming"

export const EMPTY = "No meetings coming up. Press n or N to add one."
export const SERIES_EMPTY = "No series yet. Press N to add one."
export const BOARDS_EMPTY = "No boards yet."
export const skipQuestion = (m: { title: string; date: string }) => `Skip ${m.title} on ${dayDate(m.date)}?`
export const closeQuestion = (ref: string) => `Close ${ref} as held?`
// The status line after closing: closeMeeting's message (`1:1 Anna closed · 2 discussed, 3 kept for next time · …`).
export const closedMessage = (out: unknown) => (out as { message: string }).message
export const subjectHint = (ref: string) => `give it one: ttybrain meeting subject ${ref} <ref>`
const HINTS = [
  { key: "Tab", label: "panel" },
  { key: "Enter", label: "open" },
  { key: "n", label: "one-off" },
  { key: "N", label: "series" },
  { key: "s", label: "skip date" },
  { key: "m", label: "move date" },
]
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const KIND_ORDER = { one_on_one: 0, project: 1, board: 2 } as const

// About fits its codes and names (7 to 16), so they stay whole.
const upcomingColumns = (aboutWidth: number): TableColumn[] => [
  { id: "date", title: "Date", width: 10 },
  { id: "meeting", title: "Meeting", width: "grow" },
  { id: "about", title: "About", width: aboutWidth },
  { id: "talk", title: "Talk", width: 7, drop: 1 },
  { id: "act", title: "Act.", width: 6, drop: 1 },
]
const seriesColumns = (aboutWidth: number, rhythmWidth: number): TableColumn[] => [
  { id: "title", title: "Series", width: "grow", minWidth: 10 },
  { id: "about", title: "About", width: aboutWidth },
  { id: "rhythm", title: "Rhythm", width: rhythmWidth, drop: 1 },
]

// The Monday of a date's week.
const mondayOf = (iso: string) => addDays(iso, -((DAYS.indexOf(dayDate(iso).slice(0, 3)) + 6) % 7))
// `23–27 Nov`, `30 Nov–4 Dec`, `20 Nov`.
export function rangeLabel(from: string, to: string): string {
  if (from === to) return shortDate(from)
  const [a, b] = [shortDate(from), shortDate(to)]
  return from.slice(0, 7) === to.slice(0, 7) ? `${a.split(" ")[0]}–${b}` : `${a}–${b}`
}

type Row = Upcoming & { status?: string }
type Series = { ref: string; title: string; kind: keyof typeof KIND_ORDER; about: Cell; subject: { type: SubjectType; id: number }; rhythm: string; next: string | null }
type Board = { ref: string; code: string; name: string }
type Loaded = { groups: Array<{ group: TableGroup; meetings: Row[] }>; series: Series[]; boards: Board[]; noSubject: string | undefined }
const boardColumns = (codeWidth: number): TableColumn[] => [
  { id: "code", title: "", width: codeWidth },
  { id: "name", title: "", width: "grow", minWidth: 10 },
]

export function MeetingsScreen() {
  const rt = useRuntime()
  const store = makeStore(rt)
  const upcoming = makeUpcoming(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()

  const q = useQuery(async (): Promise<Loaded> => {
    const day = rt.clock.today()
    const monday = mondayOf(day)
    const end = addDays(monday, 20) // the Sunday of the week after next
    const ahead = await upcoming.between(day, end)
    const held = (await upcoming.between(addDays(day, -CLOSE_AFTER_DAYS), addDays(day, -1))).filter((m) => m.closes_on !== null)
    const { notClosed, noSubject } = await upcoming.unclosed(day)
    const shown = new Set([...ahead, ...held, ...notClosed].map((m) => m.ref))
    const subjectless = noSubject.filter((m) => !shown.has(m.ref))

    const row = async (m: Row, how: { date?: Cell["tone"]; dim?: boolean; past?: boolean; oneOff?: boolean }): Promise<TableRow> => {
      const talk = how.past ? null : await upcoming.talk(m)
      const dim = how.dim ? ("muted" as const) : undefined
      const title: Cell =
        how.oneOff && m.series === null ? { text: `${m.title} one-off`, parts: [{ text: `${m.title} ` }, { text: "one-off", tone: "muted" }] } : { text: m.title, tone: dim }
      const talkCell: Cell = how.past ? (m.notes ? { text: "notes", tone: "muted" } : MUTED_DASH) : talk === null ? MUTED_DASH : { text: String(talk), tone: dim }
      return {
        ref: m.ref,
        cells: {
          date: { text: dayOnly(m.date), tone: how.date },
          meeting: title,
          about: await upcoming.about(m.subject),
          talk: talkCell,
          act: how.past && m.status !== "planned" ? MUTED_DASH : actCell(await upcoming.mine(m), day, false),
        },
      }
    }
    const groups: Loaded["groups"] = []
    const add = async (title: string, meetings: Row[], tone: "accent" | "muted", how: Parameters<typeof row>[1], count: boolean) => {
      if (meetings.length === 0) return
      const space = tone === "muted" && !groups.some((g) => g.group.tone === "muted")
      groups.push({ group: { title, count, tone, space, rows: await Promise.all(meetings.map((m) => row(m, how))) }, meetings })
    }
    const weeks: Array<[string, string, string]> = [
      ["This week", day, addDays(monday, 6)],
      ["Next week", addDays(monday, 7), addDays(monday, 13)],
      ["Week after", addDays(monday, 14), end],
    ]
    for (const [name, from, to] of weeks) {
      // A week reads Monday to Friday (`23–27 Nov`); this week from today to Sunday (`20–22 Nov`).
      const fri = addDays(mondayOf(from), 4)
      const label = rangeLabel(from, name === "This week" || from > fri ? to : fri)
      await add(`${name} · ${label}`, ahead.filter((m) => m.date >= from && m.date <= to), "accent", { dim: name === "Week after", oneOff: true }, false)
    }
    for (const closes of [...new Set(held.map((m) => m.closes_on!))].sort())
      await add(`Held, closes itself ${DAYS[DAYS.indexOf(dayDate(closes).slice(0, 3))]}`, held.filter((m) => m.closes_on === closes), "muted", { date: "amber", past: true }, true)
    await add("Not closed", notClosed, "muted", { date: "red", past: true }, true)
    const statuses = new Map(
      subjectless.length === 0
        ? []
        : (await rt.data.selectFrom("meeting").select(["id", "status"]).where("id", "in", subjectless.map((m) => m.id)).execute()).map((r) => [Number(r.id), String(r.status)]),
    )
    await add("No subject", subjectless.map((m) => ({ ...m, status: statuses.get(m.id) })), "muted", { past: true }, true)

    const ids = await rt.data.selectFrom("series").select(["id", "subject_type", "subject_id"]).where((eb) => eb.or([eb("end_date", "is", null), eb("end_date", ">=", day)])).execute()
    const series: Series[] = []
    for (const r of ids) {
      const s = await store.series(`S-${Number(r.id)}`)
      const subject = { type: r.subject_type as SubjectType, id: Number(r.subject_id) }
      series.push({ ref: s.ref, title: s.title, kind: s.kind, about: await upcoming.about(subject), subject, rhythm: rhythmLabel(parseRhythm(s.rhythm), "short"), next: s.next })
    }
    series.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.next ?? "9999").localeCompare(b.next ?? "9999") || Number(a.ref.slice(2)) - Number(b.ref.slice(2)))
    const boards = (await rt.data.selectFrom("board").select(["code", "name"]).where("archived_at", "is", null).orderBy("code").execute()).map((r) => ({
      ref: `#${String(r.code)}`,
      code: String(r.code),
      name: String(r.name),
    }))
    return { groups, series, boards, noSubject: subjectless[0]?.ref }
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
  const [focus, setFocus] = createSignal<0 | 1 | 2>(0)
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>(params.selected)

  const meetings = createMemo(() => (q.data()?.groups ?? []).flatMap((g) => g.meetings))
  const selected = (): Row | undefined => meetings().find((m) => m.ref === current())
  const loaded = (ref: string | undefined) => ref !== undefined && meetings().some((m) => m.ref === ref)
  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
    if (ref !== undefined) remember(ref)
  }
  const seriesRows = createMemo((): TableRow[] =>
    (q.data()?.series ?? []).map((s) => ({ ref: s.ref, cells: { title: s.title, about: s.about, rhythm: s.rhythm } })),
  )
  const fit = (texts: string[], min: number, max: number) => Math.min(max, Math.max(min, ...texts.map((t) => t.length)))
  const aboutWidth = () => fit((q.data()?.series ?? []).map((s) => s.about.text), 7, 16)
  const upcomingAbout = () => fit((q.data()?.groups ?? []).flatMap((g) => g.group.rows.map((r) => (r.cells.about as Cell).text)), 7, 16)
  const boardRows = createMemo((): TableRow[] => (q.data()?.boards ?? []).map((b) => ({ ref: b.ref, cells: { code: { text: b.code, tone: "cyan" }, name: b.name } })))
  const codeWidth = () => fit((q.data()?.boards ?? []).map((b) => b.code), 2, 16)
  const rhythmWidth = () => fit((q.data()?.series ?? []).map((s) => s.rhythm), 14, 18)

  const oneOff = async () => {
    const saved = await overlay.openForm("meeting", "meeting", {})
    if (saved !== undefined) setWant(saved)
  }
  const skip = async (m: Row) => {
    if (!(await overlay.confirm(skipQuestion(m)))) return
    await act(() => rt.self().write.skipMeeting!({ ref: m.ref }), { ok: () => `skipped ${m.ref}` })
  }
  const openSeriesSubject = async (ref: string) => {
    const s = q.data()?.series.find((x) => x.ref === ref)
    if (!s) return
    const about = await upcoming.subjectRef(s.subject)
    if (about !== null) void nav.open(about)
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    const m = focus() === 0 ? selected() : undefined
    const planned = m !== undefined && (m.status === undefined || m.status === "planned")
    if (key.name === "tab" && !key.shift) setFocus((f) => ((f + 1) % 3) as 0 | 1 | 2)
    else if (key.name === "tab" && key.shift) setFocus((f) => ((f + 2) % 3) as 0 | 1 | 2)
    else if (ch === "n") void oneOff()
    else if (ch === "N") void overlay.openForm("series", "series", {})
    else if (ch === "s") {
      if (planned) void skip(m)
    } else if (ch === "m") {
      if (planned) void overlay.openForm("meeting", "move", { recordRef: m.ref })
    } else return
    key.preventDefault()
  })
  return (
    <box flexDirection="row" flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} gap={1}>
      <KeyHints hints={HINTS} exact frame={[]} />
      <box flexDirection="column" flexGrow={13} flexBasis={0} minHeight={0}>
        <Panel title="Upcoming" focused={keys.active() && focus() === 0} grow>
          <Show when={q.data() !== undefined}>
            <Table
              columns={upcomingColumns(upcomingAbout())}
              groups={q.data()!.groups.map((g) => g.group)}
              selectedRef={loaded(want()) ? want() : undefined}
              onSelect={select}
              onOpen={(ref) => void nav.open(ref)}
              focused={keys.active() && focus() === 0}
              empty={EMPTY}
              listId="meetings"
            />
            <Show when={q.data()!.noSubject}>{(ref: () => string) => <text fg={theme.muted} flexShrink={0} wrapMode="none">{subjectHint(ref())}</text>}</Show>
          </Show>
        </Panel>
      </box>
      <box flexDirection="column" flexGrow={10} flexBasis={0} minHeight={0}>
        <Panel title="Series" count={q.data()?.series.length} focused={keys.active() && focus() === 1} shrink>
          <Show when={q.data() !== undefined}>
            <Table
              columns={seriesColumns(aboutWidth(), rhythmWidth())}
              rows={seriesRows()}
              onOpen={(ref) => void openSeriesSubject(ref)}
              focused={keys.active() && focus() === 1}
              empty={SERIES_EMPTY}
            />
          </Show>
        </Panel>
        <Panel title="Boards" count={q.data()?.boards.length} focused={keys.active() && focus() === 2} grow>
          <Show when={q.data() !== undefined}>
            <Table
              columns={boardColumns(codeWidth())}
              rows={boardRows()}
              header={false}
              onOpen={(ref) => void nav.open(ref)}
              focused={keys.active() && focus() === 2}
              empty={BOARDS_EMPTY}
            />
          </Show>
        </Panel>
      </box>
    </box>
  )
}
