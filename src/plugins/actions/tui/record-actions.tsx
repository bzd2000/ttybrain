// The Actions tab of every record actions link to (project, person, meeting): one component. It lists the actions
// linked to the record (a person's also the ones they own), open ones first by due date (none last), then the done
// and dropped ones, newest done date first. Columns as on the Actions screen (rows.ts), the record itself left out
// of Linked to (on a person's tab, Linked to gives way before Owner); the panel title is `Actions · n open`. Keys: n
// add (linked to the record, a meeting's as `New action · M-n`; a person who is not a stakeholder owns it instead),
// e edit, x done, d due, l links, Del delete (after a confirm), Enter opens the action.
import { createMemo, createSignal, Show } from "solid-js"
import {
  act,
  KeyHints,
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
  type TableRow,
  type TuiContext,
} from "@ttybrain/api/tui"
import { makeStore, type ActionRecord, type Target } from "../logic/records"
import { actionCells, actionColumns, loadRows, type Row } from "./rows"

export const EMPTY = "No actions yet. Press n to add one."
const HINTS: Hint[] = [
  { key: "n", label: "add" },
  { key: "e", label: "edit" },
  { key: "x", label: "done" },
  { key: "d", label: "due" },
  { key: "l", label: "links" },
  { key: "Del", label: "delete" },
]

type Runtime = Pick<TuiContext, "data" | "records">
type Found = { target: Target; person?: { stakeholder: boolean } }

// The record behind a tab's ref, and for a person whether they are a stakeholder (who gets actions "for" them).
async function recordOf(rt: Runtime, recordRef: string): Promise<Found | null> {
  const found = await rt.records.resolve(recordRef)
  if (found === null) return null
  if (found.type !== "person") return { target: found }
  const flags = await (rt.data as any).selectFrom("people.person").select("is_stakeholder").where("id", "=", found.id).executeTakeFirst()
  return { target: found, person: { stakeholder: Number(flags?.is_stakeholder) === 1 } }
}

// The where-clause of the tab's actions: linked to the record, or (a person) owned by them.
function whereOf(rt: Parameters<typeof makeStore>[0], target: Target) {
  const linked = makeStore(rt).linkedTo([target])
  return (eb: any) => (target.type === "person" ? eb.or([eb("a.owner_id", "=", target.id), linked(eb)]) : linked(eb))
}

// The tab's count: the open actions it lists.
export async function openCount(ui: TuiContext, recordRef: string): Promise<number | null> {
  const found = await ui.records.resolve(recordRef)
  if (found === null) return null
  const row = await ui.data
    .selectFrom("action as a")
    .where("a.status", "=", "open")
    .where(whereOf(ui, found))
    .select((eb: any) => eb.fn.countAll().as("n"))
    .executeTakeFirstOrThrow()
  return Number((row as { n: unknown }).n)
}

// Open by due date (none last), then the closed ones by done date, newest first; ties by id.
function byOpenThenDone(a: ActionRecord, b: ActionRecord): number {
  const openA = a.status === "open"
  const openB = b.status === "open"
  if (openA !== openB) return openA ? -1 : 1
  if (openA) {
    const [x, y] = [a.due_date ?? "9999", b.due_date ?? "9999"]
    return x < y ? -1 : x > y ? 1 : a.id - b.id
  }
  const [x, y] = [a.done_date ?? "", b.done_date ?? ""]
  return x > y ? -1 : x < y ? 1 : b.id - a.id
}

export function RecordActions(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()
  keys.hints(HINTS)

  const q = useQuery(
    async () => {
      const found = await recordOf(rt, props.recordRef)
      if (found === null) return { found, rows: [] as Row[], meetings: new Map() }
      const loaded = await loadRows(rt, store, await store.actionQuery().where(whereOf(rt, found.target)).execute())
      return { found, ...loaded, rows: loaded.rows.sort((a, b) => byOpenThenDone(a.rec, b.rec)) }
    },
    { key: () => props.recordRef },
  )
  const list = () => q.data()?.rows ?? []
  const rows = createMemo((): TableRow[] => {
    const data = q.data()
    if (data === undefined || data.found === null) return []
    return data.rows.map((r) => ({ ref: r.rec.ref, cells: actionCells(r, data.meetings, today(), { except: data.found!.target }) }))
  })
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>()
  // The selected action, only while it is shown (a reload may have removed it).
  const selected = () => list().find((r) => r.rec.ref === current())?.rec
  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
  }

  const add = async () => {
    const found = q.data()?.found
    if (found === undefined || found === null) return
    // A meeting's action is opened as the meetings plugin's "log action" opens it: `New action · M-n`.
    const prefill: Record<string, string> =
      found.person !== undefined && !found.person.stakeholder
        ? { owner: props.recordRef }
        : found.target.type === "meeting"
          ? { meeting: props.recordRef }
          : { links: props.recordRef }
    const saved = await overlay.openForm("action", "action", { prefill })
    if (saved !== undefined) setWant(saved)
  }
  const remove = async (a: ActionRecord) => {
    if (!(await overlay.confirm(`Delete ${a.ref} "${a.title}"?`))) return
    await act(() => rt.self().write.deleteAction!({ ref: a.ref }))
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    const a = selected()
    if (ch === "n") void add()
    else if (ch === "e" && a !== undefined) void overlay.openForm("action", "action", { recordRef: a.ref })
    else if (ch === "x" && a !== undefined) {
      if (a.status === "open") void act(() => rt.self().write.completeAction!({ ref: a.ref, date: today() }))
    } else if (ch === "d" && a !== undefined) void overlay.openForm("action", "due", { recordRef: a.ref })
    else if (ch === "l" && a !== undefined) void overlay.openForm("action", "links", { recordRef: a.ref })
    else if (key.name === "delete" && a !== undefined) void remove(a)
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Panel title={`Actions · ${list().filter((r) => r.rec.status === "open").length} open`} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Table
            columns={actionColumns(list(), { keepOwner: q.data()?.found?.target.type === "person" })}
            rows={rows()}
            selectedRef={rows().some((r) => r.ref === want()) ? want() : undefined}
            onSelect={select}
            onOpen={(ref) => void nav.open(ref)}
            focused={keys.active()}
            empty={EMPTY}
          />
        </Show>
      </Panel>
      {/* Registered after the Table's own hints, so on a narrow bar `enter open` gives way before `↑↓ select`. */}
      <Show when={q.data() !== undefined}>
        <KeyHints hints={[{ key: "Enter", label: "open" }]} />
      </Show>
    </box>
  )
}
