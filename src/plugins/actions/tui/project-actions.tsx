// The project record view's Actions tab (order 60, between the projects plugin's Decisions and People tabs): the
// project's actions, open ones first by due date, as the projects plugin's item tabs show their records. Keys: n add
// (the form gets the project prefilled), e edit, x done, Del delete.
import { createMemo, createSignal, Show } from "solid-js"
import {
  act,
  dueLabel,
  Panel,
  printable,
  Table,
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
} from "@ttybrain/api/tui"
import { makeStore, type ActionRecord } from "../logic/records"

// Refs muted, people (owners, for) magenta, and `me` or none (`—`) muted, as on the designed screens.
const person = (text: string | null | undefined, none = "—"): Cell => (text ? { text, tone: "magenta" } : { text: none, tone: "muted" })
const red = (text: string, on: boolean): Cell => ({ text, tone: on ? "red" : undefined })
const COLUMNS: TableColumn[] = [
  { id: "ref", title: "Ref", width: 6, tone: () => "muted" },
  { id: "title", title: "Action", width: "grow" },
  { id: "owner", title: "Owner", width: 14 },
  { id: "for", title: "For", width: 14 },
  { id: "due", title: "Due", width: 6 },
  { id: "status", title: "Status", width: 9 },
]
const HINTS: Hint[] = [
  { key: "n", label: "add" },
  { key: "e", label: "edit" },
  { key: "x", label: "done" },
  { key: "Del", label: "delete" },
]

// An action's cells in the Actions tabs (the person's tab takes the title and due date from here).
export const cells = (r: ActionRecord, today: string): Record<string, string | Cell> => ({
  ref: r.ref,
  title: r.title,
  owner: person(r.owner, "me"),
  for: person(r.for),
  due: red(dueLabel(r.due_date, today), r.status === "open" && r.due_date !== null && r.due_date < today),
  status: r.status,
})
// What `x` does with an action: complete it today (nothing when it is not open).
export const complete = (r: ActionRecord, today: string): { ref: string; date: string } | undefined => (r.status === "open" ? { ref: r.ref, date: today } : undefined)

const due = (r: ActionRecord) => r.due_date ?? "9999"
const byOpenThenDue = (a: ActionRecord, b: ActionRecord) =>
  Number(a.status !== "open") - Number(b.status !== "open") || (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : a.id - b.id)

export function ProjectActions(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()
  keys.hints(HINTS)

  const q = useQuery(
    async () => {
      const found = await rt.records.resolve(props.recordRef)
      if (found === null || found.type !== "project") return []
      return (await store.toActions(await store.actionQuery().where(store.linkedTo([found])).execute())).sort(byOpenThenDue)
    },
    { key: () => props.recordRef },
  )
  const rows = createMemo((): TableRow[] => (q.data() ?? []).map((r) => ({ ref: r.ref, cells: cells(r, today()) })))
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>()
  // The selected action, only while it is shown (a reload may have removed it).
  const selected = () => (q.data() ?? []).find((r) => r.ref === current())

  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
  }
  const add = async () => {
    const saved = await overlay.openForm("action", "action", { prefill: { project: props.recordRef } })
    if (saved !== undefined) setWant(saved)
  }
  const done = async (r: ActionRecord) => {
    const x = complete(r, today())
    if (x !== undefined) await act(() => rt.self().write.completeAction!(x))
  }
  const remove = async (r: ActionRecord) => {
    if (!(await overlay.confirm(`Delete ${r.ref} "${r.title}"?`))) return
    await act(() => rt.self().write.deleteAction!({ ref: r.ref }))
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    const r = selected()
    if (ch === "n") void add()
    else if (ch === "e" && r !== undefined) void overlay.openForm("action", "action", { recordRef: r.ref })
    else if (ch === "x" && r !== undefined) void done(r)
    else if (key.name === "delete" && r !== undefined) void remove(r)
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Panel title="Actions" count={q.data()?.length} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Table
            columns={COLUMNS}
            rows={rows()}
            selectedRef={rows().some((r) => r.ref === want()) ? want() : undefined}
            onSelect={select}
            focused={keys.active()}
            empty="No actions yet. Press n to add one."
          />
        </Show>
      </Panel>
    </box>
  )
}
