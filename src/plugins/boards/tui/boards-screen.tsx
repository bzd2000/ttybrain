// Screen 7, Boards (no mock draws it; laid out as the Projects screen): one panel "Boards · n", the active boards by
// code (after `a`, the archived ones under them, and a Status column).
// - Columns: Code (cyan, as wide as the longest code, so codes stay whole), Name, Next meeting (its day date and
//   name: `Fri 27 Nov Board`; a muted `—` without one) and Talk (the open talk items; a muted `0`). Next meeting and
//   Talk come from the meetings plugin's read `boardActivity`; without meetings they read `—` and `0`.
// - Keys: Enter opens the board (its view's first tab, Summary), n new board, e edit, Del archive (after a
//   confirmation), r restore an archived row, a archived, / filter (code or name; Enter applies it, Esc clears it).
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import {
  act,
  dayDate,
  fitWidth,
  notify,
  Panel,
  printable,
  Table,
  theme,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  type Cell,
  type Hint,
  type TableColumn,
  type TableRow,
} from "@ttybrain/api/tui"
import type { BoardRecord } from "../logic/schema"
import { archiveQuestion } from "./board-summary"

export const EMPTY = "No boards yet. Press n to add one."
export const NO_MATCH = "No boards match the filter."
const FILTER_HINTS: Hint[] = [
  { key: "Enter", label: "apply" },
  { key: "Esc", label: "clear" },
]
const CODE_MIN = 5 // the Code column's title and a gap
const CODE_MAX = 16 // codes are 2–16 characters and never cut

type Activity = { next: { title: string; date: string } | null; talk: number }
type Board = BoardRecord & Activity

// Every whitespace-separated term must be found in the code or the name (case-insensitive).
export const matches = (b: BoardRecord, filter: string) =>
  filter
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== "")
    .every((t) => b.code.toLowerCase().includes(t) || b.name.toLowerCase().includes(t))

const MUTED_DASH: Cell = { text: "—", tone: "muted" }

function row(b: Board, withStatus: boolean): TableRow {
  const muted = (text: string): Cell => ({ text, tone: "muted" })
  const next = b.next === null ? null : `${dayDate(b.next.date)} ${b.next.title}`
  const talk = b.talk === 0 ? muted("0") : String(b.talk)
  // An archived board is drawn muted all through.
  return {
    ref: b.ref,
    cells: b.archived
      ? { code: muted(b.code), name: muted(b.name), next: next === null ? MUTED_DASH : muted(next), talk: muted(String(b.talk)), status: muted("archived") }
      : { code: { text: b.code, tone: "cyan" }, name: b.name, next: next ?? MUTED_DASH, talk, ...(withStatus ? { status: "active" } : {}) },
  }
}

export function BoardsScreen() {
  const rt = useRuntime()
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()

  // Every board (archived too), with its next meeting and open talk items from meetings, when it is loaded.
  const q = useQuery(async (): Promise<Board[]> => {
    const rows = await rt.data.selectFrom("board").select(["id", "code", "name", "note", "archived_at"]).orderBy("code").execute()
    const activity = rt.read("meetings")?.boardActivity
    const out: Board[] = []
    for (const r of rows) {
      const a = activity === undefined ? { next: null, talk: 0 } : ((await activity({ board: Number(r.id) })) as Activity)
      out.push({
        ref: `#${String(r.code)}`,
        id: Number(r.id),
        code: String(r.code),
        name: String(r.name),
        note: r.note === null ? null : String(r.note),
        archived: r.archived_at !== null,
        next: a.next,
        talk: a.talk,
      })
    }
    return out
  })
  const [archived, setArchived] = createSignal(false)
  const [filter, setFilter] = createSignal("")
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  // `current`: the row the table has selected; `want`: a row to select once it is loaded (a new board, or the
  // route's `selected` param when Esc comes back from a board's view).
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>(
    untrack(() => {
      const r = nav.route()
      return r.kind === "screen" ? r.params?.selected : undefined
    }),
  )

  const shown = createMemo(() => (q.data() ?? []).filter((b) => (archived() || !b.archived) && matches(b, filter())))
  // The active ones by code, then the archived ones by code.
  const rows = createMemo(() => [...shown().filter((b) => !b.archived), ...shown().filter((b) => b.archived)].map((b) => row(b, archived())))
  const activeCount = () => shown().filter((b) => !b.archived).length
  const footer = () => {
    const parts = [...(archived() ? ["archived shown"] : []), ...(filter() === "" ? [] : [`filter: ${filter()}`])]
    return parts.length === 0 ? undefined : parts.join(" · ")
  }
  const selected = (): Board | undefined => shown().find((b) => b.ref === current())
  const loaded = (ref: string | undefined) => ref !== undefined && shown().some((b) => b.ref === ref)
  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
    const here = nav.route()
    if (ref !== undefined && here.kind === "screen" && here.params?.selected !== ref) nav.replaceParams({ ...here.params, selected: ref })
  }

  const columns = (): TableColumn[] => [
    { id: "code", title: "Code", width: fitWidth(shown().map((b) => b.code), CODE_MIN, CODE_MAX) },
    { id: "name", title: "Name", width: "grow", minWidth: 20 },
    // Narrow terminals drop Status, then Talk, then Next meeting.
    { id: "next", title: "Next meeting", width: 22, drop: 1 },
    { id: "talk", title: "Talk", width: 6, drop: 2 },
    ...(archived() ? [{ id: "status", title: "Status", width: 8, drop: 3 }] : []),
  ]

  const openForm = async (recordRef?: string) => {
    const saved = await overlay.openForm("board", "board", recordRef === undefined ? {} : { recordRef })
    if (saved !== undefined) setWant(saved)
  }
  // Ask first, then write (never await a question inside act).
  const archive = async (ref: string) => {
    if (!(await overlay.confirm(archiveQuestion(ref)))) return
    await act(() => rt.self().write.archiveBoard!({ board: ref }), { ok: () => `archived ${ref}` })
  }
  const restore = (ref: string) => void act(() => rt.self().write.restoreBoard!({ board: ref }), { ok: () => `restored ${ref}` })

  // --- the bar and the filter line ---
  createEffect(() => {
    const on = editing() && keys.active()
    keys.textFocus(on)
    const hints: Hint[] = [
      { key: "Enter", label: "open" },
      { key: "n", label: "new" },
      { key: "e", label: "edit" },
      selected()?.archived === true ? { key: "r", label: "restore" } : { key: "Del", label: "archive" },
      { key: "/", label: "filter" },
      { key: "a", label: "archived" },
      { key: "↑↓", label: "select" },
    ]
    // The frame's `g or 1-7 screens` and `? help`; `q quit` does not fit at 118 columns.
    onCleanup(keys.hints(on ? FILTER_HINTS : hints, on ? undefined : { exact: true, frame: ["g", "?"] }))
  })
  const endFilter = (value: string) => {
    setFilter(value.trim())
    setEditing(false)
  }

  useScreenKeys(
    (key) => {
      if (editing()) {
        if (key.name === "return") endFilter(draft())
        else if (key.name === "escape") endFilter("")
        else return
        return key.preventDefault()
      }
      if (key.name === "escape") {
        if (filter() === "") return // nothing to clear: Esc goes back
        setFilter("")
        return key.preventDefault()
      }
      if (keys.typing()) return
      const ch = printable(key)
      const b = selected()
      if (key.name === "delete") {
        if (b !== undefined && !b.archived) void archive(b.ref)
      } else if (ch === "n") void openForm()
      else if (ch === "e") {
        if (b !== undefined && b.archived) notify(`${b.ref} is archived — press r to restore`, "error")
        else if (b !== undefined) void openForm(b.ref)
      } else if (ch === "r") {
        if (b !== undefined && b.archived) restore(b.ref)
      } else if (ch === "a") setArchived((a) => !a)
      else if (ch === "/") {
        setDraft(filter())
        setEditing(true)
      } else return
      key.preventDefault()
    },
    { whileTyping: true },
  )

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
      <Panel title="Boards" count={q.data() === undefined ? undefined : activeCount()} focused={keys.active()} footer={footer()} grow>
        <Show when={editing()}>
          <box flexDirection="row" height={1} flexShrink={0} gap={1}>
            <text fg={theme.accent}>/</text>
            <input
              flexGrow={1}
              value={draft()}
              focused={keys.active()}
              backgroundColor={theme.selectedBg}
              focusedBackgroundColor={theme.selectedBg}
              textColor={theme.text}
              focusedTextColor={theme.text}
              onInput={(v: string) => setDraft(v)}
            />
          </box>
        </Show>
        <Show when={q.data() !== undefined}>
          <Table
            columns={columns()}
            rows={rows()}
            selectedRef={loaded(want()) ? want() : undefined}
            onSelect={select}
            onOpen={(ref) => void nav.open(ref)}
            focused={keys.active()}
            empty={(q.data() ?? []).length === 0 ? EMPTY : NO_MATCH}
          />
        </Show>
      </Panel>
    </box>
  )
}
