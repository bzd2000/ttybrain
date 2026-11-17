// The People screen (slot 3): the All / Stakeholders / Team tabs over one grouped table of people.
// - All: `Stakeholders · n`, `Team · n` (team members who are not stakeholders), `Other · n`; the Stakeholders and
//   Team tabs show one untitled group under the panel title `People · <n>`. `Archived · n` only after `A`.
// - Columns: name, role, project codes, influence, interest, last contact (amber for a stale high-influence
//   stakeholder), then the columns other plugins registered for the list "people".
// - Keys: Enter opens the person, n note, N new person, e edit, o next sort, / filter (Enter applies, Esc clears),
//   a / s / t tabs (and ←→), A archived, Del archive (after a confirmation), r restore.
// - At PANEL_MIN_WIDTH columns and wider, the selected person's <PersonDetail> sits in a panel right of the list.
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import {
  act,
  notify,
  Panel,
  printable,
  Table,
  Tabs,
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
import { makeStore } from "../logic/records"
import { PANEL_MIN_WIDTH, PersonDetail } from "./person-detail"
import { lastText, lastTone, matchesFilter, peopleGroups, roleText, SORT_LABELS, SORTS, tabCounts, type PeopleTab, type PersonRow, type SortMode } from "./people-list"

export const EMPTY = "No people yet. Press N to add one."
export const NO_MATCH = "No people match the filter."
// Del's confirmation, here and in the person's Summary tab.
export const archiveQuestion = (ref: string) => `Archive ${ref}? They stay in the history and can be restored.`
const HINTS: Hint[] = [
  { key: "Enter", label: "open" },
  { key: "n", label: "note" },
  { key: "N", label: "new" },
  { key: "e", label: "edit" },
  { key: "o", label: "sort" },
  { key: "/", label: "filter" },
  { key: "a s t", label: "tabs" },
  { key: "A", label: "archived" },
  { key: "Del", label: "archive" },
  { key: "r", label: "restore" },
]
const FILTER_HINTS: Hint[] = [
  { key: "Enter", label: "apply" },
  { key: "Esc", label: "clear" },
]
const TAB_KEYS: Record<string, PeopleTab> = { a: "all", s: "stakeholders", t: "team" }
const COLUMNS: TableColumn[] = [
  { id: "name", title: "Name", width: 18 },
  { id: "role", title: "Role", width: "grow" },
  { id: "projects", title: "Projects", width: 9 },
  { id: "infl", title: "Infl.", width: 5 },
  { id: "int", title: "Int.", width: 5 },
  { id: "last", title: "Last", width: 6 },
]

const level = (v: string | null) => (v === null ? { text: "—" } : { text: v, tone: v === "low" ? ("muted" as const) : undefined })

function row(p: PersonRow, today: string, days: number): TableRow {
  return {
    ref: p.ref,
    cells: {
      name: p.name,
      role: roleText(p),
      projects: p.projects.join(" "),
      infl: level(p.influence),
      int: level(p.interest),
      last: { text: lastText(p, today), tone: lastTone(p, today, days) },
    },
  }
}

export function PeopleScreen() {
  const rt = useRuntime()
  const store = makeStore(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()
  const days = rt.config.staleContactDays
  const dims = useTerminalDimensions()
  const wide = () => dims().width >= PANEL_MIN_WIDTH

  // One query: every person (archived too) with their last contact, then their project codes.
  const q = useQuery(async (): Promise<PersonRow[]> => {
    const list = (await store.personQuery().execute()).map(store.toPerson)
    const projects = await store.projectsOfPeople(list.map((p) => p.id))
    return list.map((p) => ({ ...p, projects: projects.get(p.id) ?? [] }))
  })
  const [tab, setTab] = createSignal<PeopleTab>("all")
  const [sort, setSort] = createSignal<SortMode>(SORTS[0]!)
  const [archived, setArchived] = createSignal(false)
  const [filter, setFilter] = createSignal("")
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  // `current`: the row the table has selected (undefined while it shows none); `want`: a row to select once it
  // is loaded (a new person), dropped as soon as the table has selected it.
  const [current, setCurrent] = createSignal<string | undefined>()
  // The route's `selected` param brings the selection back after a record was open (Esc pops to this screen again).
  const [want, setWant] = createSignal<string | undefined>(untrack(() => {
    const r = nav.route()
    return r.kind === "screen" ? r.params?.selected : undefined
  }))

  const all = () => q.data() ?? []
  const counts = createMemo(() => tabCounts(all()))
  const groups = createMemo(() => peopleGroups(all().filter((p) => matchesFilter(p, filter())), tab(), sort(), archived()))
  const tableGroups = createMemo((): TableGroup[] =>
    groups().map((g) => ({ title: g.title, rows: g.rows.map((p) => row(p, today(), days)) })),
  )
  // The people the current tab shows, archived excluded.
  const shownCount = () => groups().filter((g) => g.title !== "Archived").reduce((n, g) => n + g.rows.length, 0)
  const footer = () => `sort: ${SORT_LABELS[sort()]}${!editing() && filter() !== "" ? ` · filter: ${filter()}` : ""}`
  // The selected person, only while shown (a filter, a tab or a reload may have removed them).
  const selected = (): PersonRow | undefined => {
    const ref = current()
    return ref === undefined ? undefined : groups().flatMap((g) => g.rows).find((p) => p.ref === ref)
  }
  const loaded = (ref: string | undefined) => ref !== undefined && groups().some((g) => g.rows.some((p) => p.ref === ref))
  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
    const here = nav.route()
    if (ref !== undefined && here.kind === "screen" && here.params?.selected !== ref) nav.replaceParams({ ...here.params, selected: ref })
  }

  // A saved person becomes the selection (an edit may have changed the handle, so the ref).
  const personForm = async (recordRef?: string) => {
    const saved = await overlay.openForm("person", "person", recordRef === undefined ? {} : { recordRef })
    if (saved !== undefined) setWant(saved)
  }
  const archive = async (p: PersonRow) => {
    const yes = await overlay.confirm(archiveQuestion(p.ref))
    if (!yes) return
    await act(() => rt.self().write.archivePerson!({ ref: p.ref }), { ok: () => `archived ${p.ref}` })
  }
  const restore = (p: PersonRow) => void act(() => rt.self().write.restorePerson!({ ref: p.ref }), { ok: () => `restored ${p.ref}` })
  // n and e need a person who is not archived.
  const live = (p: PersonRow | undefined, run: (p: PersonRow) => void) => {
    if (p === undefined) return
    if (p.archived) notify(`${p.ref} is archived — press r to restore`, "error")
    else run(p)
  }

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
    const p = selected()
    if (key.name === "delete") {
      if (p !== undefined && !p.archived) void archive(p)
    } else if (ch === "n") live(p, (x) => void overlay.openForm("note", "note", { prefill: { person: x.ref } }))
    else if (ch === "N") void personForm()
    else if (ch === "e") live(p, (x) => void personForm(x.ref))
    else if (ch === "o") setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]!)
    else if (ch === "/") startFilter()
    else if (ch !== undefined && TAB_KEYS[ch] !== undefined) setTab(TAB_KEYS[ch]!)
    else if (ch === "A") setArchived((a) => !a)
    else if (ch === "r") {
      if (p !== undefined && p.archived) restore(p)
    } else return
    key.preventDefault()
  }, { whileTyping: true })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
      <Tabs
        tabs={[
          { id: "all", title: "All", count: counts().all },
          { id: "stakeholders", title: "Stakeholders", count: counts().stakeholders },
          { id: "team", title: "Team", count: counts().team },
        ]}
        active={tab()}
        onChange={(id) => setTab(id as PeopleTab)}
        focused={keys.active()}
      />
      <box flexDirection="row" flexGrow={1} minHeight={0} gap={1}>
        <box flexDirection="column" flexGrow={1.7} flexBasis={0} minWidth={0} minHeight={0}>
          <Panel title="People" count={q.data() === undefined ? undefined : shownCount()} focused={keys.active()} footer={footer()} grow>
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
                columns={COLUMNS}
                groups={tableGroups()}
                selectedRef={loaded(want()) ? want() : undefined}
                onSelect={select}
                onOpen={(ref) => void nav.open(ref)}
                focused={keys.active()}
                empty={filter() === "" ? EMPTY : NO_MATCH}
                listId="people"
              />
            </Show>
          </Panel>
        </box>
        <Show when={wide()}>
          <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0} minHeight={0}>
            <Panel title={selected()?.name ?? ""} grow>
              <Show when={selected()?.ref} fallback={<text fg={theme.muted}>Select a person.</text>}>
                {(ref: () => string) => <PersonDetail recordRef={ref()} />}
              </Show>
            </Panel>
          </box>
        </Show>
      </box>
    </box>
  )
}
