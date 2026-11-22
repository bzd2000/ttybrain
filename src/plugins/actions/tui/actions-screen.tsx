// The Actions screen (slot 4), as the 2026-11-20 design draws it: every action in due-date groups.
// - Open actions in `Overdue · n`, `This week · n`, `Next week · n`, `Later · n` and `No date · n`, each by due date then id.
//   `status:done|cancelled|all` lists one group, `Actions`, newest first.
// - Columns (rows.ts): ID, Action, Owner (me or first name), Linked to (codes, @handles, meetings, cut whole), Due.
// - Keys: x completes, d sets the due date, l edits the links, e edits, n adds, Enter opens the form, / filters
//   (Enter applies, Esc clears).
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import {
  act,
  addDays,
  dayDate,
  dueLabel,
  Panel,
  printable,
  shortDate,
  Table,
  theme,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  useToday,
  weekEnd,
  type Hint,
  type TableGroup,
  type TableRow,
} from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import { parseActionFilter, type ActionFilter } from "./action-filter"
import { actionCells, actionColumns, loadRows, type Row } from "./rows"

export const EMPTY = "No open actions. Press n to add one."
export const NO_MATCH = "No actions match the filter."
// The design's bar (`↑↓ select  x done  d due  l links  e edit  / filter  n new`); the global `i capture` and the
// frame's `? help` come from the frame, and the kept `enter open` follows them.
const HINTS: Hint[] = [
  { key: "↑↓", label: "select" },
  { key: "x", label: "done" },
  { key: "d", label: "due" },
  { key: "l", label: "links" },
  { key: "e", label: "edit" },
  { key: "/", label: "filter" },
  { key: "n", label: "new" },
]
const KEPT_HINTS: Hint[] = [{ key: "Enter", label: "open" }]
const FILTER_HINTS: Hint[] = [
  { key: "Enter", label: "apply" },
  { key: "Esc", label: "clear" },
]

const byDue = (a: Row, b: Row) => {
  const [x, y] = [a.rec.due_date ?? "9999", b.rec.due_date ?? "9999"]
  return x < y ? -1 : x > y ? 1 : a.rec.id - b.rec.id
}

// The filter as the footer shows it: `status:open owner:anna project:CRM @anna words`.
export const describeFilter = (f: ActionFilter) =>
  [`status:${f.status}`, ...(f.owner ? [`owner:${f.owner}`] : []), ...(f.project ? [`project:${f.project}`] : []), ...f.links, ...f.text].join(" ")

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase()

// Whether an action passes the filter's owner / project / links / words (the status is applied by the caller). A
// `@handle` matches its owner too; a project matches any of the action's project links.
function passes(r: Row, f: ActionFilter): boolean {
  if (f.owner !== undefined) {
    const want = f.owner.replace(/^@/, "").toLowerCase()
    if (want === "me") {
      if (r.rec.owner_id !== null) return false
    } else if (r.rec.owner_id === null) return false
    else if (!lower(r.ownerHandle).startsWith(want) && !lower(r.ownerName).split(/\s+/).some((w) => w.startsWith(want))) return false
  }
  const linked = (ref: string) => r.rec.links.some((l) => lower(l.ref) === lower(ref))
  if (f.project !== undefined && !linked(`#${f.project.replace(/^#/, "")}`)) return false
  if (!f.links.every((ref) => linked(ref) || (ref.startsWith("@") && lower(r.rec.owner) === lower(ref)))) return false
  const title = r.rec.title.toLowerCase()
  return f.text.every((w) => title.includes(w.toLowerCase()))
}

export function ActionsScreen() {
  const rt = useRuntime()
  const store = makeStore(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()
  const thisWeekEnd = () => weekEnd(today())
  const nextWeekEnd = () => addDays(thisWeekEnd(), 7)

  // One query: every action with its owner's name, its links and the titles and dates of its meetings.
  const q = useQuery(async () => loadRows(rt, store, await store.actionQuery().execute()))

  const [filter, setFilter] = createSignal("")
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>(
    untrack(() => {
      const r = nav.route()
      return r.kind === "screen" ? r.params?.selected : undefined
    }),
  )

  const all = () => q.data()?.rows ?? []
  const parsed = createMemo(() => parseActionFilter(filter()))
  const shown = createMemo(() => {
    const f = parsed()
    return all().filter((r) => (f.status === "all" || r.rec.status === f.status) && passes(r, f))
  })

  // `week`: 0 overdue, 1 this week, 2 next week (weekdays too), 3 later, 4 no date; -1 a closed or status list.
  const row = (r: Row, week: number): TableRow => {
    const due = r.rec.due_date
    const cell =
      week === 0 ? { text: due === null ? "—" : shortDate(due), tone: "red" as const } : week === 2 && due !== null ? dayDate(due).split(" ")[0]! : dueLabel(due, today())
    return { ref: r.rec.ref, cells: actionCells(r, q.data()?.meetings ?? new Map(), today(), { due: cell }) }
  }
  const groups = createMemo((): TableGroup[] => {
    const list = shown()
    if (parsed().status !== "open") return [{ title: "Actions", rows: [...list].sort((a, b) => b.rec.id - a.rec.id).map((r) => row(r, -1)) }]
    const bucket = (r: Row) => {
      const d = r.rec.due_date
      return d === null ? 4 : d < today() ? 0 : d <= thisWeekEnd() ? 1 : d <= nextWeekEnd() ? 2 : 3
    }
    const titles = ["Overdue", "This week", "Next week", "Later", "No date"]
    const tones = ["red", "accent", "accent", "muted", "muted"] as const
    return titles
      .map((title, i): TableGroup => ({ title, count: i >= 3, tone: tones[i]!, rows: list.filter((r) => bucket(r) === i).sort(byDue).map((r) => row(r, i)) }))
      .filter((g) => g.rows.length > 0)
  })
  const openCount = () => all().filter((r) => r.rec.status === "open").length
  const loaded = (ref: string | undefined) => ref !== undefined && shown().some((r) => r.rec.ref === ref)
  // The selected record, only while it is shown (a filter or a reload may have removed it).
  const selected = () => shown().find((r) => r.rec.ref === current())?.rec
  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
    const here = nav.route()
    if (ref !== undefined && here.kind === "screen" && here.params?.selected !== ref) nav.replaceParams({ ...here.params, selected: ref })
  }

  const openForm = async (formId: string, recordRef?: string) => {
    const saved = await overlay.openForm("action", formId, recordRef === undefined ? {} : { recordRef })
    if (saved !== undefined && recordRef === undefined) setWant(saved)
  }
  const complete = (ref: string) => act(() => rt.self().write.completeAction!({ ref, date: today() }))

  // --- the filter line ---
  createEffect(() => {
    const on = editing() && keys.active()
    keys.textFocus(on)
    onCleanup(keys.hints(on ? FILTER_HINTS : HINTS, on ? undefined : { exact: true, frame: ["?"], after: KEPT_HINTS }))
  })
  const startFilter = () => {
    setDraft(filter())
    setEditing(true)
  }
  const endFilter = (value: string) => {
    setFilter(value.trim())
    setEditing(false)
  }

  useScreenKeys((key) => {
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
    const a = selected()
    if (ch === "n") void openForm("action")
    else if (ch === "e" && a !== undefined) void openForm("action", a.ref)
    else if (ch === "d" && a !== undefined) void openForm("due", a.ref)
    else if (ch === "l" && a !== undefined) void openForm("links", a.ref)
    else if (ch === "x" && a !== undefined) {
      if (a.status === "open") void complete(a.ref)
    } else if (ch === "/") startFilter()
    else return
    key.preventDefault()
  }, { whileTyping: true })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
      <Panel title={`Actions · ${openCount()} open`} focused={keys.active()} footer={editing() ? undefined : describeFilter(parsed())} grow>
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
            columns={actionColumns(shown())}
            groups={groups()}
            selectedRef={loaded(want()) ? want() : undefined}
            onSelect={select}
            onOpen={(ref) => void nav.open(ref)}
            focused={keys.active()}
            empty={all().length === 0 ? EMPTY : NO_MATCH}
            listId="actions"
          />
        </Show>
      </Panel>
    </box>
  )
}
