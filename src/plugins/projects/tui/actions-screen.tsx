// The Actions screen (slot 4, spec §9): every action in due-date groups.
// - Open actions in `Overdue · n`, `This week · n`, `Next week · n`, `Later · n` and `No date · n`, each by due date then id.
//   `status:done|cancelled|all` lists one group, `Actions`, newest first.
// - Columns: id, action, project code, owner (me or first name), For / from (the for person, else the meeting
//   title, else `inbox I-n` when the action was created from the inbox, else —), due.
// - Keys: x completes, d sets the due date, e edits, n adds, Enter opens the form, / filters (Enter applies, Esc clears).
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import { addDays, weekEnd } from "../../../kernel/api"
import {
  act,
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
  type Hint,
  type TableColumn,
  type TableGroup,
  type TableRow,
} from "../../../kernel/tui/api"
import { makeItems, type ActionRecord } from "../logic/items"
import { makeStore } from "../logic/records"
import { parseActionFilter, type ActionFilter } from "./action-filter"

export const EMPTY = "No open actions. Press n to add one."
export const NO_MATCH = "No actions match the filter."
const HINTS: Hint[] = [
  { key: "Enter", label: "open" },
  { key: "x", label: "done" },
  { key: "d", label: "due" },
  { key: "e", label: "edit" },
  { key: "n", label: "new" },
  { key: "/", label: "filter" },
]
const FILTER_HINTS: Hint[] = [
  { key: "Enter", label: "apply" },
  { key: "Esc", label: "clear" },
]

// An action with what the screen shows besides its record: names and the for / from text.
type Row = { rec: ActionRecord; ownerName: string | null; forFrom: string }

const firstName = (name: unknown, handle: unknown) => (name ? String(name).split(/\s+/)[0]! : handle ? `@${handle}` : null)
const byDue = (a: Row, b: Row) => {
  const [x, y] = [a.rec.due_date ?? "9999", b.rec.due_date ?? "9999"]
  return x < y ? -1 : x > y ? 1 : a.rec.id - b.rec.id
}

// The filter as the header shows it: `status:open owner:anna project:CRM words`.
export const describeFilter = (f: ActionFilter) => [`status:${f.status}`, ...(f.owner ? [`owner:${f.owner}`] : []), ...(f.project ? [`project:${f.project}`] : []), ...f.text].join(" ")

// Whether an action passes the filter's owner / project / words (the status is applied by the caller).
function passes(r: Row, f: ActionFilter, owner: { handle: string | null; name: string | null }): boolean {
  if (f.owner !== undefined) {
    const want = f.owner.replace(/^@/, "").toLowerCase()
    if (want === "me") {
      if (r.rec.owner_id !== null) return false
    } else if (r.rec.owner_id === null) return false
    else if (!(owner.handle ?? "").toLowerCase().startsWith(want) && !(owner.name ?? "").toLowerCase().split(/\s+/).some((w) => w.startsWith(want))) return false
  }
  if (f.project !== undefined && (r.rec.project ?? "").replace(/^#/, "").toLowerCase() !== f.project.replace(/^#/, "").toLowerCase()) return false
  const title = r.rec.title.toLowerCase()
  return f.text.every((w) => title.includes(w.toLowerCase()))
}

export function ActionsScreen() {
  const rt = useRuntime()
  const items = makeItems(rt, makeStore(rt))
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()
  const thisWeekEnd = () => weekEnd(today())
  const nextWeekEnd = () => addDays(thisWeekEnd(), 7)

  // One query: every action with the people's names, the meeting titles (when the meetings plugin is there) and
  // the inbox origins of those without a for person, the origins in a single batch.
  const q = useQuery(async () => {
    const raw = await items.actionQuery().execute()
    const recs = raw.map(items.toAction)
    const titles = new Map<string, string>()
    if (rt.records.hasType("meeting"))
      for (const ref of new Set(recs.map((r) => r.meeting).filter((m): m is string => m !== null)))
        try {
          titles.set(ref, await rt.records.label(ref))
        } catch {
          // a meeting that cannot be labelled falls through to the next source
        }
    const origins = await rt.provenance.originsOf(
      "action",
      recs.filter((r) => r.for === null && !(r.meeting !== null && titles.has(r.meeting))).map((r) => r.id),
    )
    return recs.map((rec, i): Row => {
      const r = raw[i] as any
      const origin = origins.get(rec.id)
      const forName: string | null = rec.for_person_id === null ? null : String(r.for_name ?? (r.for_handle ? `@${r.for_handle}` : ""))
      const meeting = rec.meeting === null ? undefined : titles.get(rec.meeting)
      const forFrom = forName || meeting || (origin?.type === "inbox" ? `inbox ${origin.ref}` : "") || "—"
      return { rec, ownerName: firstName(r.owner_name, r.owner_handle), forFrom }
    })
  })

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

  const all = () => q.data() ?? []
  const parsed = createMemo(() => parseActionFilter(filter()))
  // owner handle / name by owner_id, for the owner filter (the owner cell shows the first name only).
  const ownerOf = (r: Row) => ({ handle: r.rec.owner?.replace(/^@/, "") ?? null, name: r.ownerName })
  const shown = createMemo(() => {
    const f = parsed()
    return all().filter((r) => (f.status === "all" || r.rec.status === f.status) && passes(r, f, ownerOf(r)))
  })

  const row = (r: Row, overdue: boolean): TableRow => ({
    ref: r.rec.ref,
    cells: {
      id: r.rec.ref,
      title: r.rec.title,
      project: r.rec.project?.replace(/^#/, "") ?? "",
      owner: r.ownerName ?? "me",
      from: r.forFrom,
      due: overdue ? { text: r.rec.due_date === null ? "—" : shortDate(r.rec.due_date), tone: "red" } : dueLabel(r.rec.due_date, today()),
    },
  })
  const groups = createMemo((): TableGroup[] => {
    const list = shown()
    if (parsed().status !== "open") return [{ title: "Actions", rows: [...list].sort((a, b) => b.rec.id - a.rec.id).map((r) => row(r, false)) }]
    const bucket = (r: Row) => {
      const d = r.rec.due_date
      return d === null ? 4 : d < today() ? 0 : d <= thisWeekEnd() ? 1 : d <= nextWeekEnd() ? 2 : 3
    }
    const titles = ["Overdue", "This week", "Next week", "Later", "No date"]
    return titles
      .map((title, i) => ({ title, rows: list.filter((r) => bucket(r) === i).sort(byDue).map((r) => row(r, i === 0)) }))
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

  const columns: TableColumn[] = [
    { id: "id", title: "ID", width: 5 },
    { id: "title", title: "Action", width: "grow" },
    { id: "project", title: "Proj.", width: 6 },
    { id: "owner", title: "Owner", width: 9 },
    { id: "from", title: "For / from", width: 16 },
    { id: "due", title: "Due", width: 6 },
  ]

  const openForm = async (formId: string, recordRef?: string) => {
    const saved = await overlay.openForm("action", formId, recordRef === undefined ? {} : { recordRef })
    if (saved !== undefined && recordRef === undefined) setWant(saved)
  }
  const complete = (ref: string) => act(() => rt.self().write.completeAction!({ ref, date: today() }))

  // --- the filter line ---
  createEffect(() => {
    const on = editing() && keys.active()
    keys.textFocus(on)
    onCleanup(keys.hints(on ? FILTER_HINTS : HINTS))
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
            columns={columns}
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
