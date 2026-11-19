// The project detail's People tab: who is involved and in which role (`Person`, `Role`, `Team/Stakeholder`),
// from the involvements joined with people.person. `n` adds an involvement (the involvement form), `Del` removes
// the selected one after a confirmation.
import { createMemo, createSignal, Show } from "solid-js"
import {
  act,
  Panel,
  printable,
  Table,
  useKeys,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  type Hint,
  type TableColumn,
  type TableRow,
} from "@pm/api/tui"
import { makeStore } from "../logic/records"

export const EMPTY = "No people yet. Press n to add one."
const HINTS: Hint[] = [
  { key: "n", label: "add" },
  { key: "Del", label: "remove" },
]
const COLUMNS: TableColumn[] = [
  { id: "person", title: "Person", width: "grow" },
  { id: "role", title: "Role", width: 24 },
  { id: "kind", title: "Team/Stakeholder", width: 16 },
]

type Involved = { handle: string; name: string; role: string; team: boolean; stakeholder: boolean }
const rowRef = (i: Involved) => `@${i.handle}\n${i.role}`

export function ProjectPeople(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const overlay = useOverlay()
  const keys = useKeys()
  keys.hints(HINTS)
  const code = () => (props.recordRef.startsWith("#") ? props.recordRef.slice(1) : props.recordRef)

  const q = useQuery(
    async (): Promise<Involved[]> => {
      const p = await store.project(props.recordRef)
      const rows = await rt.data
        .selectFrom("involvement as i")
        .innerJoin("people.person as pp", "pp.id", "i.person_id")
        .select(["pp.handle", "pp.name", "pp.is_team", "pp.is_stakeholder", "i.role"])
        .where("i.project_id", "=", p.id)
        .orderBy("pp.name")
        .orderBy("i.role")
        .execute()
      return rows.map((r) => ({
        handle: String(r.handle),
        name: String(r.name),
        role: String(r.role),
        team: Number(r.is_team) === 1,
        stakeholder: Number(r.is_stakeholder) === 1,
      }))
    },
    { key: () => props.recordRef },
  )
  const rows = createMemo((): TableRow[] =>
    (q.data() ?? []).map((i) => ({
      ref: rowRef(i),
      cells: { person: `${i.name} @${i.handle}`, role: i.role, kind: [i.team ? "Team" : "", i.stakeholder ? "Stakeholder" : ""].filter(Boolean).join(" · ") },
    })),
  )
  const [current, setCurrent] = createSignal<string | undefined>()
  // The selected involvement, only while it is shown.
  const selected = () => (q.data() ?? []).find((i) => rowRef(i) === current())

  const remove = async (i: Involved) => {
    const yes = await overlay.confirm(`Remove @${i.handle} as ${i.role} from ${code()}?`)
    if (!yes) return
    await act(() => rt.self().write.removeInvolvement!({ project: props.recordRef, person: `@${i.handle}`, role: i.role }))
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    if (ch === "n") void overlay.openForm("project", "involvement", { recordRef: props.recordRef })
    else if (key.name === "delete") {
      const i = selected()
      if (i !== undefined) void remove(i)
    } else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Panel title="People" count={q.data()?.length} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Table columns={COLUMNS} rows={rows()} onSelect={setCurrent} focused={keys.active()} empty={EMPTY} />
        </Show>
      </Panel>
    </box>
  )
}
