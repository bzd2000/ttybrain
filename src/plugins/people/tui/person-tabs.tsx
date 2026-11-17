// The person record view's tabs (mockup "Person detail"):
// - Summary: `@handle · Team · Stakeholder` (`· archived`), the extra fields (<RecordFields>) and <PersonDetail>
//   with five rows a list. Keys: e edit, n note, Del archive (after a confirmation), r restore.
// - Notes: the person's notes, newest first. Keys: n add, e edit (the note form), Enter the text in the editor,
//   Del delete (after a confirmation).
// - Goals (team members only): open goals by target date, then achieved, then dropped. Keys: n add, e edit,
//   x achieved (an open goal) or open again (an achieved or dropped one), d dropped.
import { createMemo, createSignal, Show } from "solid-js"
import {
  act,
  dueLabel,
  notify,
  Panel,
  printable,
  RecordFields,
  shortDate,
  Table,
  theme,
  useKeys,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  useToday,
  type Cell,
  type Hint,
  type TableColumn,
  type TableRow,
} from "../../../kernel/tui/api"
import { makeStore } from "../logic/records"
import type { GoalRecord, NoteRecord, PersonRecord } from "../logic/schema"
import { archiveQuestion } from "./people-screen"
import { PersonDetail } from "./person-detail"

const firstLine = (s: string) => s.split("\n")[0] ?? ""

// `@marie · Stakeholder`, `@anna · Team · Stakeholder`.
const personHeader = (p: PersonRecord) => [p.ref, ...(p.is_team ? ["Team"] : []), ...(p.is_stakeholder ? ["Stakeholder"] : [])].join(" · ")

// The row a table has selected (`current`), and a row to select once it is loaded (`want`: a new record), dropped
// as soon as the table has selected it.
function useSelection() {
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>()
  return {
    current,
    want,
    setWant,
    select(ref: string | undefined) {
      setCurrent(ref)
      if (ref !== undefined && ref === want()) setWant(undefined)
    },
  }
}

const SUMMARY_HINTS: Hint[] = [
  { key: "e", label: "edit" },
  { key: "n", label: "note" },
  { key: "Del", label: "archive" },
  { key: "r", label: "restore" },
]

export function PersonSummary(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const overlay = useOverlay()
  const keys = useKeys()
  keys.hints(SUMMARY_HINTS)
  const q = useQuery(() => store.person(props.recordRef), { key: () => props.recordRef })

  const archive = async (p: PersonRecord) => {
    if (!(await overlay.confirm(archiveQuestion(p.ref)))) return
    await act(() => rt.self().write.archivePerson!({ ref: p.ref }), { ok: () => `archived ${p.ref}` })
  }
  // e and n need a person who is not archived.
  const live = (p: PersonRecord, run: () => void) => (p.archived ? notify(`${p.ref} is archived — press r to restore`, "error") : run())

  useScreenKeys((key) => {
    if (keys.typing()) return
    const p = q.data()
    if (p === undefined) return
    const ch = printable(key)
    if (ch === "e") live(p, () => void overlay.openForm("person", "person", { recordRef: p.ref }))
    else if (ch === "n") live(p, () => void overlay.openForm("note", "note", { prefill: { person: p.ref } }))
    else if (key.name === "delete") {
      if (!p.archived) void archive(p)
    } else if (ch === "r") {
      if (p.archived) void act(() => rt.self().write.restorePerson!({ ref: p.ref }), { ok: () => `restored ${p.ref}` })
    } else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingTop={1} overflow="hidden">
      <Show when={q.data()}>
        {(p: () => PersonRecord) => (
          <box flexDirection="row" flexShrink={0} marginBottom={1}>
            <text fg={theme.text}>{personHeader(p())}</text>
            <Show when={p().archived}>
              <text fg={theme.muted}> · archived</text>
            </Show>
          </box>
        )}
      </Show>
      <RecordFields recordType="person" recordRef={props.recordRef} />
      <PersonDetail recordRef={props.recordRef} rows={5} />
    </box>
  )
}

const NOTE_HINTS: Hint[] = [
  { key: "n", label: "add" },
  { key: "e", label: "edit" },
  { key: "Enter", label: "text" },
  { key: "Del", label: "delete" },
]
const NOTE_COLUMNS: TableColumn[] = [
  { id: "ref", title: "Ref", width: 6 },
  { id: "date", title: "Date", width: 6 },
  { id: "kind", title: "Kind", width: 11 },
  { id: "project", title: "Project", width: 8 },
  { id: "text", title: "Note", width: "grow" },
]
type NoteRow = NoteRecord & { project: string | null }

export function PersonNotes(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const overlay = useOverlay()
  const keys = useKeys()
  keys.hints(NOTE_HINTS)
  const sel = useSelection()

  // Newest first, then by id; the project codes come from the projects.project view.
  const q = useQuery(
    async (): Promise<NoteRow[]> => {
      const p = await store.person(props.recordRef)
      const notes = (await store.noteQuery().where("n.person_id", "=", p.id).orderBy("n.date", "desc").orderBy("n.id", "desc").execute()).map(store.toNote)
      const codes = await store.projectCodes([...new Set(notes.flatMap((n) => (n.project_id === null ? [] : [n.project_id])))])
      return notes.map((n) => ({ ...n, project: n.project_id === null ? null : (codes.get(n.project_id) ?? null) }))
    },
    { key: () => props.recordRef },
  )
  const rows = createMemo((): TableRow[] =>
    (q.data() ?? []).map((n) => ({
      ref: n.ref,
      cells: { ref: n.ref, date: shortDate(n.date), kind: n.kind === "one_on_one" ? "1:1" : "interaction", project: n.project ?? "", text: firstLine(n.text) },
    })),
  )
  // The selected note, only while it is shown (a reload may have removed it).
  const selected = () => (q.data() ?? []).find((n) => n.ref === sel.current())

  const add = async () => {
    const saved = await overlay.openForm("note", "note", { prefill: { person: props.recordRef } })
    if (saved !== undefined) sel.setWant(saved)
  }
  const editText = (n: NoteRow) =>
    overlay.openEditor({
      title: `Note ${n.ref}`,
      initial: n.text,
      draftKey: `note:${n.ref}`,
      save: async (text) => {
        const r = await act(() => rt.self().write.editNote!({ ref: n.ref, text }) as Promise<unknown>)
        return r.ok ? { ok: true } : r
      },
    })
  const remove = async (n: NoteRow) => {
    if (!(await overlay.confirm(`Delete ${n.ref}?`))) return
    await act(() => rt.self().write.deleteNote!({ ref: n.ref }))
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    const n = selected()
    if (ch === "n") void add()
    else if (ch === "e" && n !== undefined) void overlay.openForm("note", "note", { recordRef: n.ref })
    else if (key.name === "return" && n !== undefined) editText(n)
    else if (key.name === "delete" && n !== undefined) void remove(n)
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Panel title="Notes" count={q.data()?.length} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Table
            columns={NOTE_COLUMNS}
            rows={rows()}
            selectedRef={rows().some((r) => r.ref === sel.want()) ? sel.want() : undefined}
            onSelect={sel.select}
            focused={keys.active()}
            empty="No notes yet. Press n to add one."
          />
        </Show>
      </Panel>
    </box>
  )
}

const GOAL_HINTS: Hint[] = [
  { key: "n", label: "add" },
  { key: "e", label: "edit" },
  { key: "x", label: "achieved/open" },
  { key: "d", label: "drop" },
]
const GOAL_COLUMNS: TableColumn[] = [
  { id: "ref", title: "Ref", width: 6 },
  { id: "title", title: "Goal", width: "grow" },
  { id: "target", title: "Target", width: 6 },
  { id: "status", title: "Status", width: 9 },
]
const STATUS_ORDER: Record<string, number> = { open: 0, achieved: 1, dropped: 2 }
// Open, achieved, dropped; each by target date (none last), then id.
const byStatusAndTarget = (a: GoalRecord, b: GoalRecord) =>
  STATUS_ORDER[a.status]! - STATUS_ORDER[b.status]! ||
  (a.target_date === b.target_date ? a.id - b.id : a.target_date === null ? 1 : b.target_date === null ? -1 : a.target_date < b.target_date ? -1 : 1)

export function PersonGoals(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()
  keys.hints(GOAL_HINTS)
  const sel = useSelection()

  const q = useQuery(
    async (): Promise<GoalRecord[]> => {
      const p = await store.person(props.recordRef)
      return (await store.goalQuery().where("g.person_id", "=", p.id).execute()).map(store.toGoal).sort(byStatusAndTarget)
    },
    { key: () => props.recordRef },
  )
  const rows = createMemo((): TableRow[] =>
    (q.data() ?? []).map((g) => {
      const target: Cell = { text: dueLabel(g.target_date, today()), tone: g.status === "open" && g.target_date !== null && g.target_date < today() ? "red" : undefined }
      return { ref: g.ref, cells: { ref: g.ref, title: g.title, target, status: g.status } }
    }),
  )
  const selected = () => (q.data() ?? []).find((g) => g.ref === sel.current())

  const add = async () => {
    const saved = await overlay.openForm("goal", "goal", { prefill: { person: props.recordRef } })
    if (saved !== undefined) sel.setWant(saved)
  }
  const setStatus = (g: GoalRecord, status: GoalRecord["status"]) => void act(() => rt.self().write.setGoalStatus!({ ref: g.ref, status }))

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    const g = selected()
    if (ch === "n") void add()
    else if (ch === "e" && g !== undefined) void overlay.openForm("goal", "goal", { recordRef: g.ref })
    else if (ch === "x" && g !== undefined) setStatus(g, g.status === "open" ? "achieved" : "open")
    else if (ch === "d" && g !== undefined) {
      if (g.status !== "dropped") setStatus(g, "dropped")
    } else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Panel title="Goals" count={q.data()?.length} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Table
            columns={GOAL_COLUMNS}
            rows={rows()}
            selectedRef={rows().some((r) => r.ref === sel.want()) ? sel.want() : undefined}
            onSelect={sel.select}
            focused={keys.active()}
            empty="No goals yet. Press n to add one."
          />
        </Show>
      </Panel>
    </box>
  )
}
