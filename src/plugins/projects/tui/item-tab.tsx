// The project detail's item tabs (Milestones, Deliverables, Risks & issues, Decisions, Actions) as ONE component
// configured per kind: how its rows load and sort, its columns, the form to add and edit with, what `x` does and
// which operation `Del` calls. Keys: n add (the form gets the project prefilled), e edit, x complete, Del delete.
import { createMemo, createSignal, Show } from "solid-js"
import {
  act,
  dueLabel,
  Panel,
  printable,
  shortDate,
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
import { makeItems, type Kind } from "../logic/items"
import { makeStore } from "../logic/records"

// The records are the logic's typed records; the config reads them by field name.
type Rec = Record<string, any> & { ref: string; title: string }
type Items = ReturnType<typeof makeItems>
type XOp = { op: string; input: Record<string, unknown> }

export type ItemKind = {
  kind: Kind
  title: string
  noun: string
  // The record's own queries run under the project filter; each returns its records in display order.
  load(items: Items, projectId: number): Promise<Rec[]>
  columns: TableColumn[]
  cells(r: Rec, today: string): Record<string, string | Cell>
  // What `x` does with a record (nothing when it is already complete, or for decisions).
  complete?(r: Rec, today: string): XOp | undefined
  completeHint?: string
  deleteOp: string
}

// Refs muted, people (owners, for) magenta, and `me` or none (`—`) muted, as on the designed screens.
const REF: TableColumn = { id: "ref", title: "Ref", width: 6, tone: () => "muted" }
const person = (text: string | null | undefined, none = "—"): Cell => (text ? { text, tone: "magenta" } : { text: none, tone: "muted" })
const DELIVERABLE_FLOW = ["not_started", "in_progress", "in_review", "delivered"]
const byDate = (key: string) => (a: Rec, b: Rec) => (a[key] ?? "9999") < (b[key] ?? "9999") ? -1 : (a[key] ?? "9999") > (b[key] ?? "9999") ? 1 : a.id - b.id
const SEVERITY: Record<string, number> = { high: 0, medium: 1, low: 2 }
const red = (text: string, on: boolean): Cell => ({ text, tone: on ? "red" : undefined })

export const ITEM_KINDS: Record<string, ItemKind> = {
  milestones: {
    kind: "milestone",
    title: "Milestones",
    noun: "milestones",
    load: async (items, pid) => (await items.milestoneQuery().where("m.project_id", "=", pid).execute()).map(items.toMilestone).sort(byDate("due_date")),
    columns: [REF, { id: "done", title: " ", width: 1 }, { id: "title", title: "Milestone", width: "grow" }, { id: "due", title: "Due", width: 6 }, { id: "late", title: "", width: 4 }],
    cells: (r, today) => ({
      ref: r.ref,
      done: r.done_date !== null ? { text: "✓", tone: "green" } : "○",
      title: r.title,
      // A done milestone's date is history, not a countdown.
      due: r.done_date !== null ? { text: shortDate(r.due_date), tone: "muted" } : dueLabel(r.due_date, today),
      late: red(r.done_date === null && r.due_date < today ? "late" : "", true),
    }),
    complete: (r, today) => (r.done_date === null ? { op: "completeMilestone", input: { ref: r.ref, date: today } } : undefined),
    completeHint: "done",
    deleteOp: "deleteMilestone",
  },
  deliverables: {
    kind: "deliverable",
    title: "Deliverables",
    noun: "deliverables",
    load: async (items, pid) =>
      (await items.deliverableQuery().where("d.project_id", "=", pid).execute())
        .map(items.toDeliverable)
        .sort((a, b) => Number(a.status === "delivered") - Number(b.status === "delivered") || byDate("due_date")(a, b)),
    columns: [REF, { id: "title", title: "Deliverable", width: "grow" }, { id: "owner", title: "Owner", width: 14 }, { id: "status", title: "Status", width: 12 }, { id: "due", title: "Due", width: 6 }],
    cells: (r, today) => ({
      ref: r.ref,
      title: r.title,
      owner: person(r.owner),
      status: r.status,
      due: red(dueLabel(r.due_date, today), r.status !== "delivered" && r.due_date !== null && r.due_date < today),
    }),
    complete: (r) => {
      const next = DELIVERABLE_FLOW[DELIVERABLE_FLOW.indexOf(r.status) + 1]
      return next === undefined ? undefined : { op: "setDeliverableStatus", input: { ref: r.ref, status: next } }
    },
    completeHint: "advance",
    deleteOp: "deleteDeliverable",
  },
  risks: {
    kind: "risk",
    title: "Risks & issues",
    noun: "risks or issues",
    load: async (items, pid) =>
      (await items.riskQuery().where("r.project_id", "=", pid).execute())
        .map(items.toRisk)
        .sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open") || SEVERITY[a.severity]! - SEVERITY[b.severity]! || a.id - b.id),
    columns: [REF, { id: "type", title: "Type", width: 5 }, { id: "title", title: "Title", width: "grow" }, { id: "severity", title: "Severity", width: 8 }, { id: "owner", title: "Owner", width: 14 }, { id: "status", title: "Status", width: 6 }],
    cells: (r) => ({ ref: r.ref, type: r.type, title: r.title, severity: red(r.severity, r.severity === "high"), owner: person(r.owner), status: r.status }),
    complete: (r, today) => (r.status === "open" ? { op: "closeRisk", input: { ref: r.ref, date: today } } : undefined),
    completeHint: "close",
    deleteOp: "deleteRisk",
  },
  decisions: {
    kind: "decision",
    title: "Decisions",
    noun: "decisions",
    load: async (items, pid) => (await items.decisionQuery().where("d.project_id", "=", pid).execute()).map(items.toDecision).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)),
    columns: [REF, { id: "date", title: "Date", width: 6 }, { id: "title", title: "Decision", width: "grow" }, { id: "by", title: "Decided by", width: 16 }],
    cells: (r) => ({ ref: r.ref, date: shortDate(r.date), title: r.title, by: r.decided_by ?? "—" }),
    deleteOp: "deleteDecision",
  },
  actions: {
    kind: "action",
    title: "Actions",
    noun: "actions",
    load: async (items, pid) =>
      (await items.actionQuery().where("a.project_id", "=", pid).execute())
        .map(items.toAction)
        .sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open") || byDate("due_date")(a, b)),
    columns: [REF, { id: "title", title: "Action", width: "grow" }, { id: "owner", title: "Owner", width: 14 }, { id: "for", title: "For", width: 14 }, { id: "due", title: "Due", width: 6 }, { id: "status", title: "Status", width: 9 }],
    cells: (r, today) => ({
      ref: r.ref,
      title: r.title,
      owner: person(r.owner, "me"),
      for: person(r.for),
      due: red(dueLabel(r.due_date, today), r.status === "open" && r.due_date !== null && r.due_date < today),
      status: r.status,
    }),
    complete: (r, today) => (r.status === "open" ? { op: "completeAction", input: { ref: r.ref, date: today } } : undefined),
    completeHint: "done",
    deleteOp: "deleteAction",
  },
}

export function ItemTab(props: { recordRef: string; config: ItemKind }) {
  const cfg = props.config
  const rt = useRuntime()
  const store = makeStore(rt)
  const items = makeItems(rt, store)
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()
  const hints: Hint[] = [
    { key: "n", label: "add" },
    { key: "e", label: "edit" },
    ...(cfg.complete ? [{ key: "x", label: cfg.completeHint! }] : []),
    { key: "Del", label: "delete" },
  ]
  keys.hints(hints)

  const q = useQuery(
    async () => {
      const id = await store.projectId(props.recordRef)
      return id === null ? [] : cfg.load(items, id)
    },
    { key: () => props.recordRef },
  )
  const rows = createMemo((): TableRow[] => (q.data() ?? []).map((r) => ({ ref: r.ref, cells: cfg.cells(r, today()) })))
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>()
  // The selected record, only while it is shown (a reload may have removed it).
  const selected = () => (q.data() ?? []).find((r) => r.ref === current())

  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
  }
  const add = async () => {
    const saved = await overlay.openForm(cfg.kind, cfg.kind, { prefill: { project: props.recordRef } })
    if (saved !== undefined) setWant(saved)
  }
  const complete = async (r: Rec) => {
    const x = cfg.complete?.(r, today())
    if (x === undefined) return
    await act(() => (rt.self().write[x.op]! as (i: Record<string, unknown>) => Promise<unknown>)(x.input))
  }
  const remove = async (r: Rec) => {
    if (!(await overlay.confirm(`Delete ${r.ref} "${r.title}"?`))) return
    await act(() => (rt.self().write[cfg.deleteOp]! as (i: Record<string, unknown>) => Promise<unknown>)({ ref: r.ref }))
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    const r = selected()
    if (ch === "n") void add()
    else if (ch === "e" && r !== undefined) void overlay.openForm(cfg.kind, cfg.kind, { recordRef: r.ref })
    else if (ch === "x" && r !== undefined && cfg.complete) void complete(r)
    else if (key.name === "delete" && r !== undefined) void remove(r)
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Panel title={cfg.title} count={q.data()?.length} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Table
            columns={cfg.columns}
            rows={rows()}
            selectedRef={rows().some((r) => r.ref === want()) ? want() : undefined}
            onSelect={select}
            focused={keys.active()}
            empty={`No ${cfg.noun} yet. Press n to add one.`}
          />
        </Show>
      </Panel>
    </box>
  )
}
