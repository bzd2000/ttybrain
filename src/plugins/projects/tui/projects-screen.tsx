// The Projects screen (slot 2, spec §9): every project in one table, in groups.
// - `Projects · <n> active` (the panel title, no group header; `· <n> shown` under a filter): red → amber → green → not set, then by next
//   milestone due (none last), then by code; `On hold · n` and `Closed · n` by code; `Archived · n` only after `a`.
// - Columns: a health dot, code, name, next milestone and its due date, open actions, open risks, effort, then
//   the columns other plugins registered for the list "projects".
// - Keys: Enter opens the record, n new, e edit, h health update, / filter, a archived. The filter is free text
//   on code or name plus `status:<s>` and `health:<h>`; Enter applies it, Esc clears it.
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import {
  dueLabel,
  fitWidth,
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
  useToday,
  type Hint,
  type TableColumn,
  type TableGroup,
  type TableRow,
} from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import type { ProjectRecord } from "../logic/schema"

export const EMPTY = "No projects yet. Press n to add one."
export const NO_MATCH = "No projects match the filter."
// The design's bar (`↑↓ select   enter open   n new   h health   / filter   i capture   ? help`); the global
// `i capture` and the frame's `? help` come from the frame, and the kept `e edit` and `a archived` follow them.
const HINTS: Hint[] = [
  { key: "↑↓", label: "select" },
  { key: "Enter", label: "open" },
  { key: "n", label: "new" },
  { key: "h", label: "health" },
  { key: "/", label: "filter" },
]
const KEPT_HINTS: Hint[] = [
  { key: "e", label: "edit" },
  { key: "a", label: "archived" },
]
const FILTER_HINTS: Hint[] = [
  { key: "Enter", label: "apply" },
  { key: "Esc", label: "clear" },
]
const HEALTH_RANK: Record<string, number> = { red: 0, amber: 1, green: 2 }
const CODE_MAX = 16 // codes are 2–16 characters and never cut
const CODE_MIN = 5 // the design's Code column

const byCode = (a: ProjectRecord, b: ProjectRecord) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
// Health (not set last), then the next milestone's due date (none last), then code.
function byHealth(a: ProjectRecord, b: ProjectRecord): number {
  const h = (HEALTH_RANK[a.health ?? ""] ?? 3) - (HEALTH_RANK[b.health ?? ""] ?? 3)
  if (h !== 0) return h
  const [x, y] = [a.next_milestone_due, b.next_milestone_due]
  if (x !== y) return x === null ? 1 : y === null ? -1 : x < y ? -1 : 1
  return byCode(a, b)
}

// Every whitespace-separated term must match: `status:<s>`, `health:<h>` (`none` for not set), or text found in
// the code or the name (case-insensitive).
export function matches(p: ProjectRecord, filter: string): boolean {
  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== "")
    .every((t) => {
      if (t.startsWith("status:")) return p.status === t.slice(7)
      if (t.startsWith("health:")) return (p.health ?? "none") === t.slice(7)
      return p.code.toLowerCase().includes(t) || p.name.toLowerCase().includes(t)
    })
}

// `high`: the ids of the projects with an open high-severity risk or issue (their Risk count is red).
function row(p: ProjectRecord, today: string, high: ReadonlySet<number>): TableRow {
  const due = p.next_milestone_due
  // An on-hold project is drawn muted all through, with `◌` for its dot.
  const hold = p.status === "on_hold"
  const muted = (text: string) => ({ text, tone: "muted" as const })
  return {
    ref: p.ref,
    cells: hold
      ? {
          health: muted("◌"),
          code: muted(p.code),
          name: muted(p.name),
          next: muted(p.next_milestone_title ?? "—"),
          due: muted(dueLabel(due, today)),
          actions: muted(String(p.open_actions)),
          risks: muted(String(p.open_risks)),
          effort: muted(p.effort_estimate_days === null ? "" : `${p.effort_estimate_days}pd`),
        }
      : {
          health: p.health === null ? { text: "○", tone: "muted" } : { text: "●", tone: p.health },
          code: { text: p.code, tone: "cyan" },
          name: p.name,
          next: p.next_milestone_title ?? "—",
          due: { text: dueLabel(due, today), tone: due !== null && due < today ? "red" : undefined },
          actions: String(p.open_actions),
          risks: { text: String(p.open_risks), tone: high.has(p.id) ? "red" : undefined },
          effort: muted(p.effort_estimate_days === null ? "" : `${p.effort_estimate_days}pd`),
        },
  }
}

export function ProjectsScreen() {
  const rt = useRuntime()
  const store = makeStore(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()

  // One query: the record query carries the health, next milestone and open counts per project.
  const q = useQuery(async () => (await store.recordQuery().execute()).map(store.toProject))
  const highQ = useQuery(async () => {
    const rows = await rt.data.selectFrom("risk").select("project_id").where("status", "=", "open").where("severity", "=", "high").execute()
    return new Set(rows.map((r) => Number(r.project_id)))
  })
  const high = () => highQ.data() ?? new Set<number>()
  const [archived, setArchived] = createSignal(false)
  const [filter, setFilter] = createSignal("")
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  // `current`: the row the table has selected (undefined while it shows none); `want`: a row to select once it
  // is loaded (a new project), dropped as soon as the table has selected it.
  const [current, setCurrent] = createSignal<string | undefined>()
  // The route's `selected` param brings the selection back after a record was open (Esc pops to this screen again).
  const [want, setWant] = createSignal<string | undefined>(untrack(() => {
    const r = nav.route()
    return r.kind === "screen" ? r.params?.selected : undefined
  }))

  const shown = createMemo(() => (q.data() ?? []).filter((p) => matches(p, filter())))
  const groups = createMemo((): TableGroup[] => {
    const list = shown()
    const live = list.filter((p) => !p.archived)
    const of = (status: string) => live.filter((p) => p.status === status).sort(byCode)
    const out: TableGroup[] = [{ rows: of("active").sort(byHealth).map((p) => row(p, today(), high())) }]
    const add = (title: string, ps: ProjectRecord[]) => ps.length > 0 && out.push({ title, rows: ps.map((p) => row(p, today(), high())) })
    add("On hold", of("on_hold"))
    add("Closed", of("closed"))
    if (archived()) add("Archived", list.filter((p) => p.archived).sort(byCode))
    return out
  })
  const activeCount = () => groups()[0]!.rows.length
  // What the list shows: the design's `status=active` (active projects, the on-hold ones under them), `closed`
  // when a Closed group shows, `+archived` while archived ones are shown, then the filter text.
  const footer = () => {
    const closed = groups().some((g) => g.title === "Closed")
    return `filter: status=active${closed ? ",closed" : ""}${archived() ? " +archived" : ""}${filter() === "" ? "" : ` ${filter()}`}`
  }
  // Under a filter the count is what the filter leaves (the switcher's count stays the unfiltered one).
  const title = () => `Projects · ${activeCount()} ${filter() === "" ? "active" : "shown"}${archived() ? " · archived shown" : ""}`
  const loaded = (ref: string | undefined) => ref !== undefined && groups().some((g) => g.rows.some((r) => r.ref === ref))
  // The selected row, only while it is shown (a filter or a reload may have removed it).
  const selected = () => {
    const ref = current()
    return loaded(ref) ? ref : undefined
  }
  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
    const here = nav.route()
    if (ref !== undefined && here.kind === "screen" && here.params?.selected !== ref) nav.replaceParams({ ...here.params, selected: ref })
  }

  const columns = (): TableColumn[] => [
    { id: "health", title: " ", width: 2 },
    { id: "code", title: "Code", width: fitWidth(shown().map((p) => p.code), CODE_MIN, CODE_MAX) },
    { id: "name", title: "Name", width: "grow", minWidth: 26 },
    // Narrow terminals drop columns from the right: Effort, Risk, Act., then Next milestone with its Due.
    { id: "next", title: "Next milestone", width: 21, drop: 1 },
    { id: "due", title: "Due", width: 7, drop: 1 },
    { id: "actions", title: "Act.", width: 6, drop: 2 },
    { id: "risks", title: "Risk", width: 6, drop: 3 },
    { id: "effort", title: "Effort", width: 7, drop: 4 },
  ]

  const openForm = async (formId: string, recordRef?: string) => {
    const saved = await overlay.openForm("project", formId, recordRef === undefined ? {} : { recordRef })
    if (saved !== undefined) setWant(saved)
  }

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
    const ref = selected()
    if (ch === "n") void openForm("project")
    else if (ch === "e" && ref !== undefined) void openForm("project", ref)
    else if (ch === "h" && ref !== undefined) void openForm("health", ref)
    else if (ch === "a") setArchived((a) => !a)
    else if (ch === "/") startFilter()
    else return
    key.preventDefault()
  }, { whileTyping: true })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
      <Panel title={title()} focused={keys.active()} footer={footer()} grow>
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
            empty={(q.data() ?? []).length === 0 ? EMPTY : NO_MATCH}
            listId="projects"
          />
        </Show>
      </Panel>
    </box>
  )
}
