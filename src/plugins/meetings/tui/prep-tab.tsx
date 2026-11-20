// The meeting record view's Prep tab, as the meeting prep design draws it: the Agenda panel on the left and, on the
// right, the focused Prep panel for the selected item (`read.prep`): its project's status sections in their compact
// form (since the last meeting that covered it; the footer on the border says from when), then a blank line and the
// ask under `Ask for this meeting (your text)`. An item without a project shows only its ask. Keys: ↑↓ select an
// item, J/K move it down/up (the selection follows it), e edit its ask, a log an action, D log a decision (both
// linked to the meeting and the item's project), x close the meeting, PgUp/PgDn scroll the sections. When they do
// not fit, a muted `…` at the bottom says there is more.
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
} from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import type { SinceResult } from "../logic/since"
import { useMeetingWrites } from "./agenda-tab"
import { AgendaList } from "./agenda-list"

type PrepEntry = { position: number; text: string; project: string | null; ask: string | null; since: SinceResult | null; sections: ReportSectionResult[] }

// The status bar as the design draws it, then the keys the tab keeps beyond it.
const HINTS: Hint[] = [
  { key: "←→", label: "tabs" },
  { key: "↑↓", label: "agenda item" },
  { key: "J/K", label: "reorder" },
  { key: "e", label: "edit ask" },
  { key: "a", label: "action" },
  { key: "D", label: "decision" },
]
const KEPT: Hint[] = [
  { key: "Esc", label: "back" },
  { key: "x", label: "close" },
  { key: "PgUp/PgDn", label: "scroll" },
]
const NO_PROJECT = "No project on this item."
const ASK = "Ask for this meeting (your text)"
const UNMEASURED = 200 // the Export tab's lines' width before the first measure
const PAGE = 10 // lines a PgUp/PgDn scrolls

// Where the prep starts from (the panel footer, after `generated from data · `).
export function sinceText(s: SinceResult): string {
  const date = shortDate(s.since)
  if (s.source === "previous" && s.previous !== null) return `since ${s.previous.title} ${date}`
  if (s.source === "meeting") return `since ${date} (set on the meeting)`
  return `since ${date} (30 days before)`
}

// Plain lines cut to the measured width (the Export tab shows the Markdown with them).
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
  keys.hints(HINTS, { exact: true, frame: [], after: KEPT })

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
  // A position to select once the list shows it (a moved item), dropped as soon as the list has selected it.
  const [want, setWant] = createSignal<string | undefined>()
  let box: ScrollBoxRenderable | undefined
  // The sections' scroll: how far down, the height shown and the height they need (for the `…`).
  const [top, setTop] = createSignal(0)
  const [view, setView] = createSignal(0)
  const [need, setNeed] = createSignal(0)
  // The panel's inner height and the ask's: the sections get what the ask leaves, at most what they need.
  const [room, setRoom] = createSignal(0)
  const [askHeight, setAskHeight] = createSignal(0)
  const sectionsHeight = () => (need() === 0 || room() === 0 ? undefined : Math.max(1, Math.min(need(), room() - askHeight())))
  const scroll = (to: (b: ScrollBoxRenderable) => void) => {
    if (box === undefined) return
    to(box)
    setTop(box.scrollTop)
  }
  const entry = createMemo(() => q.data()?.entries.find((e) => e.position === position()))
  const title = () => {
    const e = entry()
    if (e === undefined) return "Prep"
    return `Prep · ${e.project === null ? e.text : (q.data()?.names.get(e.project) ?? e.project.slice(1))}`
  }
  const footer = () => {
    const s = entry()?.since
    return s === null || s === undefined ? undefined : `generated from data · ${sinceText(s)}`
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
    const move = (to: number) =>
      writes.live(m, () => {
        if (item) void writes.moveItem(m, item, to).then((moved) => moved && setWant(String(to)))
      })
    if (key.name === "pageup") scroll((b) => b.scrollBy(-PAGE))
    else if (key.name === "pagedown") scroll((b) => b.scrollBy(PAGE))
    else if (ch === "J") move((item?.position ?? 0) + 1)
    else if (ch === "K") move((item?.position ?? 0) - 1)
    else if (ch === "e") writes.live(m, () => item && writes.editItem(m, item))
    else if (ch === "a") writes.live(m, () => writes.logAction(m, e?.project ?? null))
    else if (ch === "D") writes.live(m, () => writes.logDecision(m, e?.project ?? null))
    else if (ch === "x") writes.live(m, () => void writes.close(m))
    else return
    key.preventDefault()
  })

  const Ask = (ap: { text: string | null }) => (
    <box
      flexDirection="column"
      flexShrink={0}
      paddingTop={1}
      onSizeChange={function () {
        setAskHeight(this.height)
      }}
    >
      <text fg={theme.muted} wrapMode="none">
        {ASK}
      </text>
      <text fg={theme.text} wrapMode="word">
        {ap.text ?? "—"}
      </text>
    </box>
  )

  return (
    <box flexDirection="row" flexGrow={1} minHeight={0} paddingTop={1} gap={1}>
      <AgendaList
        recordRef={props.recordRef}
        selectedRef={q.data()?.meeting.agenda.some((a) => String(a.position) === want()) ? want() : undefined}
        onSelect={(p) => {
          if (p !== undefined && String(p) === want()) setWant(undefined)
          // Another item's prep starts at its top.
          if (p !== position()) scroll((b) => b.scrollTo(0))
          setPosition(p)
        }}
      />
      <box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} minHeight={0}>
        <Panel title={title()} footer={footer()} focused={keys.active()} grow>
          <Show
            when={entry()}
            fallback={
              <Show when={q.data()?.entries.length === 0}>
                <text fg={theme.muted}>No agenda yet.</text>
              </Show>
            }
          >
            {(e: () => PrepEntry) => (
              <box
                flexDirection="column"
                flexGrow={1}
                flexShrink={1}
                minHeight={0}
                overflow="hidden"
                onSizeChange={function () {
                  setRoom(this.height)
                }}
              >
                <Show when={e().project !== null} fallback={<text fg={theme.muted} flexShrink={0}>{NO_PROJECT}</text>}>
                  {/* The sections, as tall as they need, scrolling (PgUp/PgDn) when the panel is shorter; the ask
                      follows them and stays in view. */}
                  <box flexDirection="column" height={sectionsHeight()} flexShrink={0} minHeight={0} overflow="hidden">
                    <scrollbox
                      ref={(r: ScrollBoxRenderable) => (box = r)}
                      flexGrow={1}
                      minHeight={0}
                      verticalScrollbarOptions={{ visible: false }}
                      onSizeChange={function () {
                        setView(this.height)
                      }}
                    >
                      <box
                        flexDirection="column"
                        onSizeChange={function () {
                          setNeed(this.height)
                        }}
                      >
                        <ReportSections sections={e().sections} skipColumns={["Project", "Name"]} compact />
                      </box>
                    </scrollbox>
                    <Show when={view() > 0 && need() > view() + top()}>
                      <text position="absolute" bottom={0} right={0} fg={theme.muted} bg={theme.bg}>
                        …
                      </text>
                    </Show>
                  </box>
                </Show>
                <Ask text={e().ask} />
              </box>
            )}
          </Show>
        </Panel>
      </box>
    </box>
  )
}
