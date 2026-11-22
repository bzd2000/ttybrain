// The Actions screen (slot 4, spec §9): every action in due-date groups.
// - Open actions in `Overdue · n`, `This week · n`, `Next week · n`, `Later · n` and `No date · n`, each by due date then id.
//   `status:done|cancelled|all` lists one group, `Actions`, newest first.
// - Columns: id, action, project code, owner (me or first name), For / from (the for person, else the meeting
//   title, else `inbox I-n` when the action was created from the inbox, else —), due.
// - Keys: x completes, d sets the due date, e edits, n adds, Enter opens the form, / filters (Enter applies, Esc clears).
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import {
  act,
  addDays,
  dayDate,
  displayWidth,
  dueLabel,
  fitWidth,
  Panel,
  printable,
  shortDate,
  Table,
  theme,
  truncate,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  useToday,
  weekEnd,
  type Hint,
  type TableColumn,
  type TableGroup,
  type TableRow,
} from "@ttybrain/api/tui"
import { makeStore, type ActionRecord } from "../logic/records"
import { parseActionFilter, type ActionFilter } from "./action-filter"

export const EMPTY = "No open actions. Press n to add one."
export const NO_MATCH = "No actions match the filter."
// The design's bar (`↑↓ select  x done  d due  e edit  / filter  n new  i capture`); the global `i capture` and the
// frame's `? help` come from the frame, and the kept `enter open` follows them.
const HINTS: Hint[] = [
  { key: "↑↓", label: "select" },
  { key: "x", label: "done" },
  { key: "d", label: "due" },
  { key: "e", label: "edit" },
  { key: "/", label: "filter" },
  { key: "n", label: "new" },
]
const KEPT_HINTS: Hint[] = [{ key: "Enter", label: "open" }]
const FROM_WIDTH = 16
const FILTER_HINTS: Hint[] = [
  { key: "Enter", label: "apply" },
  { key: "Esc", label: "clear" },
]

// An action with what the screen shows besides its record: names and the for / from text.
type Row = { rec: ActionRecord; ownerName: string | null; forFrom: { text: string; person: boolean } }

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
  const store = makeStore(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()
  const thisWeekEnd = () => weekEnd(today())
  const nextWeekEnd = () => addDays(thisWeekEnd(), 7)

  // One query: every action with the people's names, the meeting titles (when the meetings plugin is there) and
  // the inbox origins of those without a for person, the origins in a single batch.
  const q = useQuery(async () => {
    const loaded = await store.load(await store.actionQuery().execute())
    const recs = loaded.map((x) => x.rec)
    const titles = new Map<string, string>()
    if (rt.records.hasType("meeting")) {
      // The meeting's date from the meetings plugin's published view (optional): `SteerCo 28 Oct`.
      const dates = new Map<number, string>()
      try {
        for (const m of await (rt.data as any).selectFrom("meetings.meeting").select(["id", "date"]).execute()) dates.set(Number(m.id), String(m.date))
      } catch {
        // without the view the label is the title alone
      }
      for (const ref of new Set(recs.map((r) => r.meeting).filter((m): m is string => m !== null)))
        try {
          const title = await rt.records.label(ref)
          const date = dates.get(Number(ref.replace(/^\D+/, "")))
          // The date stays whole, the title gives way (the column is 16 wide).
          const tail = date === undefined ? "" : ` ${shortDate(date)}`
          const cut = truncate(title, Math.max(2, FROM_WIDTH - displayWidth(tail)))
          titles.set(ref, `${cut === title ? title : `${cut.slice(0, -1).trimEnd()}…`}${tail}`)
        } catch {
          // a meeting that cannot be labelled falls through to the next source
        }
    }
    const origins = await rt.provenance.originsOf(
      "action",
      recs.filter((r) => r.for === null && !(r.meeting !== null && titles.has(r.meeting))).map((r) => r.id),
    )
    return loaded.map(({ rec, ...x }): Row => {
      const origin = origins.get(rec.id)
      const forName: string | null = rec.for_person_id === null ? null : (x.forName ?? "")
      const meeting = rec.meeting === null ? undefined : titles.get(rec.meeting)
      const forFrom = forName ? { text: forName, person: true } : { text: meeting || (origin?.type === "inbox" ? `inbox ${origin.ref}` : "") || "—", person: false }
      return { rec, ownerName: firstName(x.ownerName, x.ownerHandle), forFrom }
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

  // `week`: 0 overdue, 1 this week, 2 next week (weekdays too), 3 later, 4 no date.
  const row = (r: Row, week: number): TableRow => {
    const code = r.rec.project?.replace(/^#/, "")
    const due = r.rec.due_date
    return {
      ref: r.rec.ref,
      cells: {
        id: { text: r.rec.ref, tone: "muted" },
        title: r.rec.title,
        project: code ? { text: code, tone: "cyan" } : { text: "—", tone: "muted" },
        owner: r.ownerName === null ? { text: "me", tone: "muted" } : r.ownerName,
        from: r.forFrom.person ? { text: r.forFrom.text, tone: "magenta" } : { text: r.forFrom.text, tone: "muted" },
        due:
          week === 0
            ? { text: due === null ? "—" : shortDate(due), tone: "red" }
            : week === 2 && due !== null
              ? dayDate(due).split(" ")[0]!
              : dueLabel(due, today()),
      },
    }
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

  // The project column fits the longest code shown (6 to 16): codes are never cut.
  const columns = (): TableColumn[] => [
    { id: "id", title: "ID", width: 5 },
    { id: "title", title: "Action", width: "grow", minWidth: 28 },
    { id: "project", title: "Proj.", width: fitWidth(shown().map((r) => r.rec.project?.replace(/^#/, "") ?? ""), 6, 16) },
    // Narrow terminals drop For / from first, then Owner; the action, its project code and its due date stay.
    { id: "owner", title: "Owner", width: 9, drop: 1 },
    { id: "from", title: "For / from", width: FROM_WIDTH, drop: 2 },
    { id: "due", title: "Due", width: 7 },
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
            columns={columns()}
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
