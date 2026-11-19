// The `contracts` fixture's tui part: the screen "Contracts" (the first external slot, key 7) and a "Contracts" tab
// on projects. It imports only "@ttybrain/api/tui" and "solid-js"; the build points both (and the JSX runtime,
// "@opentui/solid") at ttybrain's own modules.
import { defineTui, useQuery, useRuntime, type TuiContext } from "@ttybrain/api/tui"
import { For, Show } from "solid-js"

type Runtime = Pick<TuiContext, "data" | "records">

const contracts = (rt: Runtime, projectId?: number) => {
  let q = rt.data
    .selectFrom("contract as c")
    .innerJoin("projects.project as p", "p.id", "c.project_id")
    .select(["c.id", "c.title", "p.code"])
    .orderBy("c.id")
  if (projectId !== undefined) q = q.where("c.project_id", "=", projectId)
  return q.execute()
}

const projectId = async (rt: Runtime, recordRef: string): Promise<number | null> => {
  const found = await rt.records.resolve(recordRef)
  return found && found.type === "project" ? found.id : null
}

function ContractsScreen() {
  const rt = useRuntime()
  const q = useQuery(() => contracts(rt))
  return (
    <box flexDirection="column">
      <Show when={(q.data() ?? []).length > 0} fallback={<text>No contracts</text>}>
        <For each={q.data() ?? []}>{(c) => <text>{`C-${c.id} ${c.title} · #${c.code}`}</text>}</For>
      </Show>
    </box>
  )
}

function ProjectContracts(props: { recordRef: string }) {
  const rt = useRuntime()
  const q = useQuery(
    async () => {
      const id = await projectId(rt, props.recordRef)
      return id === null ? [] : contracts(rt, id)
    },
    { key: () => props.recordRef },
  )
  return (
    <box flexDirection="column">
      <text>{`${(q.data() ?? []).length} contract${(q.data() ?? []).length === 1 ? "" : "s"}`}</text>
      <For each={q.data() ?? []}>{(c) => <text>{`C-${c.id} ${c.title}`}</text>}</For>
    </box>
  )
}

export default defineTui({
  plugin: "contracts",
  activate(ui) {
    ui.screen({ id: "contracts", title: "Contracts", component: ContractsScreen })
    ui.recordTab("project", {
      id: "contracts",
      title: "Contracts",
      order: 90,
      count: async (recordRef) => {
        const id = await projectId(ui, recordRef)
        return id === null ? null : (await contracts(ui, id)).length
      },
      component: ProjectContracts,
    })
  },
})
