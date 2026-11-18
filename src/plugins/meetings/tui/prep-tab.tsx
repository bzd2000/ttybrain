// The meeting record view's Prep tab: the agenda list on the left and, on the right, the selected item's prep
// (`read.prep`): its project's status sections since the last meeting that covered it (the panel footer says from
// when), then the ask. An item without a project shows only its ask. Keys: ↑↓ select an item, e edit its ask,
// a log an action, D log a decision (both linked to the meeting and the item's project), x close the meeting.
import type { ScrollBoxRenderable } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import {
  Panel,
  printable,
  ReportSections,
  shortDate,
  theme,
  truncate,
  useKeys,
  useQuery,
  useRuntime,
  useScreenKeys,
  type Hint,
  type ReportSectionResult,
} from "../../../kernel/tui/api"
import { makeStore } from "../logic/records"
import type { SinceResult } from "../logic/since"
import { useMeetingWrites } from "./agenda-tab"
import { AgendaList } from "./agenda-list"

type PrepEntry = { position: number; text: string; project: string | null; ask: string | null; since: SinceResult | null; sections: ReportSectionResult[] }

const HINTS: Hint[] = [
  { key: "↑↓", label: "item" },
  { key: "e", label: "edit ask" },
  { key: "a", label: "action" },
  { key: "D", label: "decision" },
  { key: "x", label: "close" },
  { key: "PgUp/PgDn", label: "scroll" },
]
const NO_PROJECT = "No project on this item."
const UNMEASURED = 200 // the ask's width before the first measure
const PAGE = 10 // lines a PgUp/PgDn scrolls

// The panel footer: where the prep starts from.
export function sinceText(s: SinceResult): string {
  const date = shortDate(s.since)
  if (s.source === "previous" && s.previous !== null) return `since ${s.previous.title} ${date}`
  if (s.source === "meeting") return `since ${date} (set on the meeting)`
  return `since ${date} (30 days before)`
}

// Plain lines cut to the measured width (the Export tab shows the Markdown with them too).
export function Lines(props: { text: string }) {
  const [width, setWidth] = createSignal(0)
  return (
    <box
      flexDirection="column"
      onSizeChange={function () {
        setWidth(this.width)
      }}
    >
      <For each={props.text.split("\n")}>
        {(l) => (
          <text wrapMode="none" fg={theme.text}>
            {truncate(l, width() === 0 ? UNMEASURED : Math.max(1, width()))}
          </text>
        )}
      </For>
    </box>
  )
}

export function PrepTab(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const keys = useKeys()
  const writes = useMeetingWrites()
  keys.hints(HINTS)

  const q = useQuery(
    async () => {
      const meeting = await store.meeting(props.recordRef)
      const entries = (await rt.self().read.prep!({ meeting: meeting.ref })) as PrepEntry[]
      // The project names, for the panel title, by `#CODE`.
      const ids = [...new Set(meeting.agenda.flatMap((a) => (a.project_id === null ? [] : [a.project_id])))]
      const rows =
        ids.length === 0
          ? []
          : await store.unlessUnavailable([] as Array<{ code: unknown; name: unknown }>, () =>
              rt.data.selectFrom("projects.project").select(["code", "name"]).where("id", "in", ids).execute(),
            )
      return { meeting, entries, names: new Map(rows.map((r) => [`#${r.code}`, String(r.name)])) }
    },
    { key: () => props.recordRef },
  )
  const [position, setPosition] = createSignal<number | undefined>()
  let box: ScrollBoxRenderable | undefined
  const entry = createMemo(() => q.data()?.entries.find((e) => e.position === position()))
  const title = () => {
    const e = entry()
    if (e === undefined) return "Prep"
    return `Prep · ${e.project === null ? e.text : (q.data()?.names.get(e.project) ?? e.project.slice(1))}`
  }
  const footer = () => {
    const s = entry()?.since
    return s === null || s === undefined ? undefined : sinceText(s)
  }

  // Screen keys before the list's own (↑↓ belong to the list).
  useScreenKeys((key) => {
    if (keys.typing()) return
    const d = q.data()
    if (d === undefined) return
    const m = d.meeting
    const ch = printable(key)
    const e = entry()
    const item = e === undefined ? undefined : m.agenda.find((a) => a.position === e.position)
    if (key.name === "pageup") box?.scrollBy(-PAGE)
    else if (key.name === "pagedown") box?.scrollBy(PAGE)
    else if (ch === "e") writes.live(m, () => item && writes.editItem(m, item))
    else if (ch === "a") writes.live(m, () => writes.logAction(m, e?.project ?? null))
    else if (ch === "D") writes.live(m, () => writes.logDecision(m, e?.project ?? null))
    else if (ch === "x") writes.live(m, () => void writes.close(m))
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="row" flexGrow={1} minHeight={0} paddingTop={1} gap={1}>
      <AgendaList
        recordRef={props.recordRef}
        onSelect={(p) => {
          // Another item's prep starts at its top.
          if (p !== position()) box?.scrollTo(0)
          setPosition(p)
        }}
      />
      <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} minHeight={0}>
        <Panel title={title()} footer={footer()} grow>
          <Show
            when={entry()}
            fallback={
              <Show when={q.data()?.entries.length === 0}>
                <text fg={theme.muted}>No agenda yet.</text>
              </Show>
            }
          >
            {(e: () => PrepEntry) => (
              <box flexDirection="column" flexGrow={1} minHeight={0}>
                <Show
                  when={e().project !== null}
                  fallback={
                    <text fg={theme.muted} flexShrink={0} marginBottom={1}>
                      {NO_PROJECT}
                    </text>
                  }
                >
                  {/* The sections scroll (PgUp/PgDn); the ask below them stays in view. */}
                  <scrollbox ref={(r: ScrollBoxRenderable) => (box = r)} flexGrow={1} minHeight={0}>
                    <ReportSections sections={e().sections} skipColumns={["Project", "Name"]} />
                  </scrollbox>
                </Show>
                <box flexDirection="column" flexShrink={0}>
                  <text fg={theme.accent}>Ask for this meeting</text>
                  <Lines text={e().ask ?? "—"} />
                </box>
              </box>
            )}
          </Show>
        </Panel>
      </box>
    </box>
  )
}
