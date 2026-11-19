// The person record view's Projects & roles tab: the person's involvements (`Project`, `Name`, `Role`, `Status`),
// ordered by code, then role; an archived project's row is muted. Enter opens the project, `n` adds an involvement
// (the involvement form, which asks for the project, with the person prefilled), `Del` removes the selected one
// after a confirmation.
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
  type Hint,
  type TableColumn,
  type TableRow,
} from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"

export const EMPTY = "No projects yet. Press n to add one."
const HINTS: Hint[] = [
  { key: "Enter", label: "open" },
  { key: "n", label: "add" },
  { key: "Del", label: "remove" },
]
// The project column fits the longest code shown (8 to 16): codes are never cut.
const columns = (codes: string[]): TableColumn[] => [
  { id: "code", title: "Project", width: fitWidth(codes, 8, 16) },
  { id: "name", title: "Name", width: "grow" },
  { id: "role", title: "Role", width: 20 },
  { id: "status", title: "Status", width: 8 },
]

type Role = { code: string; name: string; role: string; status: string; archived: boolean }
// One row per involvement: a person may hold several roles on one project.
const rowRef = (r: Role) => `#${r.code}\n${r.role}`

export function PersonProjects(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  keys.hints(HINTS)

  const q = useQuery(
    async (): Promise<{ handle: string; roles: Role[] }> => {
      const person = await store.person(props.recordRef)
      const rows = await rt.data
        .selectFrom("involvement as i")
        .innerJoin("project as p", "p.id", "i.project_id")
        .select(["p.code", "p.name", "p.status", "p.archived_at", "i.role"])
        .where("i.person_id", "=", person.id)
        .orderBy("p.code")
        .orderBy("i.role")
        .execute()
      return {
        handle: person.handle,
        roles: rows.map((r) => ({ code: String(r.code), name: String(r.name), role: String(r.role), status: String(r.status), archived: r.archived_at !== null })),
      }
    },
    { key: () => props.recordRef },
  )
  const rows = createMemo((): TableRow[] =>
    (q.data()?.roles ?? []).map((r) => {
      const tone = r.archived ? ("muted" as const) : undefined
      const cell = (text: string) => ({ text, tone })
      return { ref: rowRef(r), cells: { code: cell(r.code), name: cell(r.name), role: cell(r.role), status: cell(r.status) } }
    }),
  )
  const [current, setCurrent] = createSignal<string | undefined>()
  // The selected involvement, only while it is shown.
  const selected = () => (q.data()?.roles ?? []).find((r) => rowRef(r) === current())

  const remove = async (handle: string, r: Role) => {
    if (!(await overlay.confirm(`Remove @${handle} as ${r.role} from ${r.code}?`))) return
    await act(() => rt.self().write.removeInvolvement!({ project: r.code, person: `@${handle}`, role: r.role }))
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    if (ch === "n") void overlay.openForm("project", "involvement", { prefill: { person: props.recordRef } })
    else if (key.name === "delete") {
      const r = selected()
      const handle = q.data()?.handle
      if (r !== undefined && handle !== undefined) void remove(handle, r)
    } else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Panel title="Projects & roles" count={q.data()?.roles.length} focused={keys.active()} grow>
        <Show when={q.data() !== undefined}>
          <Table
            columns={columns((q.data()?.roles ?? []).map((r) => r.code))}
            rows={rows()}
            onSelect={setCurrent}
            onOpen={(ref) => void nav.open(ref.split("\n")[0]!)}
            focused={keys.active()}
            empty={EMPTY}
          />
        </Show>
      </Panel>
    </box>
  )
}
