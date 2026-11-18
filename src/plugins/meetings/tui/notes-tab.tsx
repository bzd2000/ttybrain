// The meeting record view's Notes tab: the agenda list on the left and, on the right, the meeting notes (plain
// text, scrolling) above what was logged in the meeting: the actions (`A-3 title · owner · due`) and decisions
// linked to it, read through the projects views. Keys: ↑↓ select an item, e edit the notes in the built-in editor
// (keeping a draft per meeting), E in $VISUAL/$EDITOR, a log an action, D log a decision (both linked to the
// meeting and the selected item's project), x close the meeting, PgUp/PgDn scroll the notes.
import type { ScrollBoxRenderable } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import {
  act,
  Panel,
  printable,
  shortDate,
  theme,
  truncate,
  useEditExternal,
  useKeys,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  type Hint,
} from "../../../kernel/tui/api"
import { makeStore } from "../logic/records"
import type { MeetingRecord } from "../logic/schema"
import { useMeetingWrites } from "./agenda-tab"
import { AgendaList } from "./agenda-list"

export const EMPTY = "No notes yet. Press e to write them."
const HINTS: Hint[] = [
  { key: "↑↓", label: "item" },
  { key: "e", label: "edit notes" },
  { key: "E", label: "edit in $EDITOR" },
  { key: "a", label: "action" },
  { key: "D", label: "decision" },
  { key: "x", label: "close" },
  { key: "PgUp/PgDn", label: "scroll" },
]
const PAGE = 10 // lines a PgUp/PgDn scrolls
const UNMEASURED = 200 // the logged lines' width before the first measure

type Store = ReturnType<typeof makeStore>
type Runtime = ReturnType<typeof useRuntime>

// The actions and decisions linked to the meeting, in the order they were logged, one line each.
async function loggedLines(rt: Runtime, store: Store, m: MeetingRecord): Promise<string[]> {
  const actions = await store.unlessUnavailable([] as Array<{ id: unknown; title: unknown; due_date: unknown; owner_id: unknown; handle: unknown }>, () =>
    rt.data
      .selectFrom("projects.action as a")
      .leftJoin("people.person as o", "o.id", "a.owner_id")
      .select(["a.id", "a.title", "a.due_date", "a.owner_id", "o.handle"])
      .where("a.meeting_id", "=", m.id)
      .orderBy("a.id")
      .execute(),
  )
  const decisions = await store.unlessUnavailable([] as Array<{ id: unknown; title: unknown }>, () =>
    rt.data.selectFrom("projects.decision").select(["id", "title"]).where("meeting_id", "=", m.id).orderBy("id").execute(),
  )
  const owner = (r: (typeof actions)[number]) => (r.owner_id === null ? "me" : r.handle === null ? `person:${r.owner_id}` : `@${r.handle}`)
  const out: string[] = []
  for (const r of actions) {
    const due = r.due_date === null ? [] : [shortDate(String(r.due_date))]
    out.push([`${await rt.records.refOf("action", Number(r.id))} ${r.title}`, owner(r), ...due].join(" · "))
  }
  for (const r of decisions) out.push(`${await rt.records.refOf("decision", Number(r.id))} ${r.title}`)
  return out
}

// How many actions and decisions are linked to the meeting (the tab's count).
export async function loggedCount(rt: Runtime, store: Store, ref: string): Promise<number> {
  const m = await store.meeting(ref)
  const count = (view: "projects.action" | "projects.decision") =>
    store.unlessUnavailable(0, async () => {
      const row = await rt.data.selectFrom(view).select((eb) => eb.fn.countAll().as("n")).where("meeting_id", "=", m.id).executeTakeFirstOrThrow()
      return Number(row.n)
    })
  return (await count("projects.action")) + (await count("projects.decision"))
}

export function NotesTab(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const overlay = useOverlay()
  const keys = useKeys()
  const editExternal = useEditExternal()
  const writes = useMeetingWrites()
  keys.hints(HINTS)

  const q = useQuery(
    async () => {
      const meeting = await store.meeting(props.recordRef)
      return { meeting, logged: await loggedLines(rt, store, meeting) }
    },
    { key: () => props.recordRef },
  )
  const [position, setPosition] = createSignal<number | undefined>()
  const item = createMemo(() => q.data()?.meeting.agenda.find((a) => a.position === position()))
  const [width, setWidth] = createSignal(0)
  let box: ScrollBoxRenderable | undefined

  const save = async (m: MeetingRecord, markdown: string): Promise<{ ok: true } | { ok: false; error: unknown }> => {
    const r = await act(() => rt.self().write.setNotes!({ meeting: m.ref, markdown }) as Promise<unknown>)
    return r.ok ? { ok: true } : r
  }
  // One draft per meeting (the kernel keeps it as `meetings:notes:<ref>`).
  const editBuiltin = (m: MeetingRecord) =>
    overlay.openEditor({ title: `Notes · ${m.ref}`, initial: m.notes, save: (text) => save(m, text), draftKey: `notes:${m.ref}` })
  const editOutside = async (m: MeetingRecord) => {
    const edited = await editExternal(m.notes)
    if (edited !== null) await save(m, edited)
  }

  // Screen keys before the list's own (↑↓ belong to the list).
  useScreenKeys((key) => {
    if (keys.typing()) return
    const m = q.data()?.meeting
    if (m === undefined) return
    const ch = printable(key)
    const project = item()?.project ?? null
    if (key.name === "pageup") box?.scrollBy(-PAGE)
    else if (key.name === "pagedown") box?.scrollBy(PAGE)
    else if (ch === "e") writes.live(m, () => editBuiltin(m))
    else if (ch === "E") writes.live(m, () => void editOutside(m))
    else if (ch === "a") writes.live(m, () => writes.logAction(m, project))
    else if (ch === "D") writes.live(m, () => writes.logDecision(m, project))
    else if (ch === "x") writes.live(m, () => void writes.close(m))
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="row" flexGrow={1} minHeight={0} paddingTop={1} gap={1}>
      <AgendaList recordRef={props.recordRef} onSelect={setPosition} />
      <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} minHeight={0}>
        <Panel title="Notes" grow>
          <Show when={q.data()}>
            {(d: () => { meeting: MeetingRecord }) => (
              <Show when={d().meeting.notes.trim() !== ""} fallback={<text fg={theme.muted}>{EMPTY}</text>}>
                <scrollbox ref={(r: ScrollBoxRenderable) => (box = r)} flexGrow={1} minHeight={0}>
                  <text fg={theme.text}>{d().meeting.notes}</text>
                </scrollbox>
              </Show>
            )}
          </Show>
        </Panel>
        <Panel title="Logged in this meeting">
          <box
            flexDirection="column"
            onSizeChange={function () {
              setWidth(this.width)
            }}
          >
            <For each={q.data()?.logged ?? []} fallback={<text fg={theme.muted}>Nothing logged yet. Press a or D.</text>}>
              {(l) => (
                <text wrapMode="none" fg={theme.text}>
                  {truncate(l, width() === 0 ? UNMEASURED : Math.max(1, width()))}
                </text>
              )}
            </For>
          </box>
        </Panel>
      </box>
    </box>
  )
}
