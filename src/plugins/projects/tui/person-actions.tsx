// The person record view's Actions tab: the actions the person owns or that are for them (`As`: owner or for;
// both reads owner). Open ones first by due date (none last), then done and cancelled ones, newest done date
// first. Keys: n add (prefilled for a stakeholder, else owned by them), e edit, x done (as the project's Actions
// tab does), Enter opens the action's project when it has one.
import { createMemo, createSignal, Show } from "solid-js"
import {
  act,
  fitWidth,
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
  type TableColumn,
  type TableRow,
} from "@ttybrain/api/tui"
import { makeItems, type ActionRecord } from "../logic/items"
import { makeStore } from "../logic/records"
import { ITEM_KINDS } from "./item-tab"

export const EMPTY = "No actions yet. Press n to add one."
const HINTS: Hint[] = [
  { key: "n", label: "add" },
  { key: "e", label: "edit" },
  { key: "x", label: "done" },
  { key: "Enter", label: "project" },
]
// The project column fits the longest code shown (6 to 16): codes are never cut.
const columns = (codes: string[]): TableColumn[] => [
  { id: "ref", title: "Ref", width: 6 },
  { id: "title", title: "Action", width: "grow" },
  { id: "project", title: "Proj.", width: fitWidth(codes, 6, 16) },
  { id: "as", title: "As", width: 5 },
  { id: "due", title: "Due", width: 6 },
]
const ACTIONS = ITEM_KINDS.actions!

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

export function PersonActions(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const items = makeItems(rt, store)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  const today = useToday()
  keys.hints(HINTS)

  const q = useQuery(
    async (): Promise<{ personId: number; stakeholder: boolean; actions: ActionRecord[] }> => {
      const person = await store.person(props.recordRef)
      const flags = await rt.data.selectFrom("people.person").select("is_stakeholder").where("id", "=", person.id).executeTakeFirstOrThrow()
      const actions = (await items.actionQuery().where((eb) => eb.or([eb("a.owner_id", "=", person.id), eb("a.for_person_id", "=", person.id)])).execute()).map(items.toAction)
      return { personId: person.id, stakeholder: Number(flags.is_stakeholder) === 1, actions: actions.sort(byOpenThenDone) }
    },
    { key: () => props.recordRef },
  )
  const rows = createMemo((): TableRow[] => {
    const data = q.data()
    if (data === undefined) return []
    return data.actions.map((a) => {
      const shared = ACTIONS.cells(a, today())
      return {
        ref: a.ref,
        cells: {
          ref: { text: a.ref, tone: "muted" },
          title: shared.title!,
          project: a.project ? { text: a.project.replace(/^#/, ""), tone: "cyan" } : "",
          as: a.owner_id === data.personId ? "owner" : "for",
          due: shared.due!,
        },
      }
    })
  })
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>()
  // The selected action, only while it is shown (a reload may have removed it).
  const selected = () => (q.data()?.actions ?? []).find((a) => a.ref === current())
  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
  }

  const add = async () => {
    const data = q.data()
    if (data === undefined) return
    const prefill: Record<string, string> = data.stakeholder ? { forPerson: props.recordRef } : { owner: props.recordRef }
    const saved = await overlay.openForm("action", "action", { prefill })
    if (saved !== undefined) setWant(saved)
  }
  const complete = async (a: ActionRecord) => {
    const x = ACTIONS.complete!(a, today())
    if (x === undefined) return
    await act(() => (rt.self().write[x.op]! as (i: Record<string, unknown>) => Promise<unknown>)(x.input))
  }
  const openProject = (ref: string) => {
    const project = (q.data()?.actions ?? []).find((a) => a.ref === ref)?.project
    if (project !== undefined && project !== null) void nav.open(project)
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    const a = selected()
    if (ch === "n") void add()
    else if (ch === "e" && a !== undefined) void overlay.openForm("action", "action", { recordRef: a.ref })
    else if (ch === "x" && a !== undefined) void complete(a)
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Panel title="Actions" count={q.data()?.actions.length} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Table
            columns={columns((q.data()?.actions ?? []).map((a) => a.project?.replace(/^#/, "") ?? ""))}
            rows={rows()}
            selectedRef={rows().some((r) => r.ref === want()) ? want() : undefined}
            onSelect={select}
            onOpen={openProject}
            focused={keys.active()}
            empty={EMPTY}
          />
        </Show>
      </Panel>
    </box>
  )
}
