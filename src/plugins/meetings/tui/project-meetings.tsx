// A project's Meetings tab (the 2026-11-20 `project` design), and a person's (person-meetings.tsx):
// - left (1 : 1.15): a panel per series, the next date first: "CRM steering · monthly, 4th Tue" with Next and With
//   (stakeholders as `Peter J.` magenta, team members by first name), then "To talk about · n" and the subject's
//   talk-list (numbered, muted `1.`); without a series, the next one-off meeting (or "Meetings" and how to add one).
//   Under them "Past meetings": date (muted), title (a one-off's with a muted `one-off`), `3 act · 1 dec` (muted).
// - right: for a project "Prep · since 27 Oct" (`generated from data` on its bottom border): the project's status
//   since its last meeting, the board pack's generated prep in its compact form; for a person, your actions for
//   them (as on the Talk tab).
// Keys (the design's bar): Tab the next panel, t add to the talk-list (the talk form, the subject filled in), Enter
// open (a series panel: its next meeting; Past meetings: the selected one), N a new series, n a one-off meeting
// (both with the subject filled in).
import { createMemo, createSignal, For, Show } from "solid-js"
import {
  addDays,
  dayDate,
  displayWidth,
  Panel,
  printable,
  ReportSections,
  shortDate,
  Table,
  theme,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  type CellPart,
  type Hint,
  type ReportSectionResult,
  type TableColumn,
  type TableRow,
} from "@ttybrain/api/tui"
import type { SeriesRecord, TalkRecord } from "../logic/schema"
import { actionRow, Fact } from "./person-talk"
import { DASH, makeSubjects, personCell, type MeetingRow, type Past, type Person } from "./subject"
import type { MyAction } from "./upcoming"

const HINTS: Hint[] = [
  { key: "←→", label: "tabs" },
  { key: "Tab", label: "panel" },
  { key: "t", label: "to talk" },
  { key: "Enter", label: "open" },
  { key: "N", label: "series" },
  { key: "n", label: "one-off" },
  { key: "Esc", label: "back" },
]
export const NO_MEETINGS = "No meetings yet. Press N for a series or n for a one-off."
const FACT_LABEL = 11 // the facts' label column: 9 cells and the gap
const PREP_DAYS = 30 // without a held meeting, the prep covers this many days

const talkColumns: TableColumn[] = [
  { id: "n", title: "", width: 3 },
  { id: "text", title: "", width: "grow" },
]
const pastColumns: TableColumn[] = [
  { id: "date", title: "", width: 9 },
  { id: "title", title: "", width: "grow" },
  { id: "out", title: "", width: 13, drop: 1 },
]
const actionColumns: TableColumn[] = [
  { id: "ref", title: "", width: 5 },
  { id: "title", title: "", width: "grow" },
  { id: "due", title: "", width: 6 },
]

// `3 act · 1 dec`, `5 act`, `—`.
export function outcome(p: Past): string {
  const parts = [p.actions > 0 ? `${p.actions} act` : null, p.decisions > 0 ? `${p.decisions} dec` : null].filter((x) => x !== null)
  return parts.length === 0 ? "—" : parts.join(" · ")
}

// `Marie D., Peter J., Anna, Bob`: the stakeholders first, then the team, each by name.
function withParts(people: Person[]): CellPart[] {
  const sorted = [...people].sort((a, b) => Number(b.stakeholder && !b.team) - Number(a.stakeholder && !a.team) || a.name.localeCompare(b.name))
  return sorted.map(personCell)
}

// The With fact: the names that fit whole, separated by `, `, then a muted `+n` for the others (names are never cut).
function WithFact(props: { names: CellPart[] }) {
  const [width, setWidth] = createSignal(0)
  const shown = createMemo((): CellPart[] => {
    const names = props.names
    if (names.length === 0) return [DASH]
    const room = width() === 0 ? Infinity : width() - FACT_LABEL
    const out: CellPart[] = []
    let used = 0
    for (const [i, n] of names.entries()) {
      const sep = i === 0 ? 0 : 2
      const rest = names.length - i - 1
      const tail = rest === 0 ? 0 : displayWidth(`, +${rest}`)
      if (used + sep + displayWidth(n.text) + tail > room) {
        out.push({ text: i === 0 ? `+${names.length}` : `, +${names.length - i}`, tone: "muted" })
        return out
      }
      if (i > 0) out.push({ text: ", " })
      out.push(n)
      used += sep + displayWidth(n.text)
    }
    return out
  })
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      onSizeChange={function () {
        setWidth(this.width)
      }}
    >
      <Fact label="With" width={FACT_LABEL} parts={shown()} />
    </box>
  )
}

// A meeting panel: a series (its title and rhythm, its next occurrence) or a one-off meeting.
type Block = { title: string; next: MeetingRow | null; with: CellPart[] }
type Loaded = {
  subject: { ref: string; type: "person" | "project"; first: string }
  blocks: Block[]
  talk: TalkRecord[]
  past: Past[]
  prep: { since: string; sections: ReportSectionResult[] } | null
  mine: MyAction[]
}

export function SubjectMeetings(props: { recordRef: string }) {
  const rt = useRuntime()
  const subjects = makeSubjects(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  keys.hints(HINTS, { exact: true, frame: [], globals: false })

  const q = useQuery(
    async (): Promise<Loaded> => {
      const s = await subjects.subject(props.recordRef)
      const today = rt.clock.today()
      const series = await subjects.series(s)
      // A series' next occurrence (its planned meeting on that date).
      const nextOf = async (x: SeriesRecord): Promise<MeetingRow | null> => {
        if (x.next === null) return null
        const r = await rt.data.selectFrom("meeting").select(["id", "title", "date", "kind"]).where("series_id", "=", x.id).where("date", "=", x.next).where("status", "=", "planned").executeTakeFirst()
        return r ? { ref: `M-${Number(r.id)}`, id: Number(r.id), title: String(r.title), date: String(r.date), kind: r.kind as MeetingRow["kind"], series: x.id } : null
      }
      const blocks: Block[] = []
      for (const x of series) blocks.push({ title: `${x.title} · ${subjects.rhythm(x, "short")}`, next: await nextOf(x), with: withParts(await subjects.people(x.attendees)) })
      if (blocks.length === 0) {
        const next = await subjects.next(s)
        if (next !== null) {
          const m = await subjects.store.meeting(next.ref)
          blocks.push({ title: next.title, next, with: withParts(await subjects.people(m.attendees)) })
        }
      }
      const list = await subjects.talkList(s)
      const last = await subjects.last(s)
      let prep: Loaded["prep"] = null
      if (s.type === "project") {
        const since = last?.date ?? addDays(today, -PREP_DAYS)
        const params = { project: s.ref.replace(/^#/, ""), since, reference: today, ...(last ? { "previous-meeting": last.ref } : {}) }
        prep = { since, sections: (await rt.reports.run("project-status", params)).sections }
      }
      return {
        subject: { ref: s.ref, type: s.type, first: s.type === "person" ? s.label.split(/\s+/)[0]! : s.ref.replace(/^#/, "") },
        blocks,
        talk: [...list.open, ...list.carried],
        past: await subjects.past(s),
        prep,
        mine: s.type === "person" ? await subjects.mine(s) : [],
      }
    },
    { key: () => props.recordRef },
  )

  const today = () => rt.clock.today()
  // The panels that take focus: the meeting blocks (their talk-lists), then Past meetings.
  const panels = () => (q.data()?.blocks.length ?? 0) + 1
  const [focus, setFocus] = createSignal(0)
  const focused = (i: number) => keys.active() && focus() === Math.min(i, panels() - 1)
  const talkRows = createMemo((): TableRow[] =>
    (q.data()?.talk ?? []).map((t, i) => ({ ref: t.ref, cells: { n: t.carried ? { text: "↻", tone: "muted" } : { text: `${i + 1}.`, tone: "muted" }, text: t.text } })),
  )
  const pastRows = createMemo((): TableRow[] =>
    (q.data()?.past ?? []).map((p) => ({
      ref: p.ref,
      cells: {
        date: { text: shortDate(p.date), tone: "muted" },
        title: p.series === null ? { text: `${p.title} one-off`, parts: [{ text: `${p.title} ` }, { text: "one-off", tone: "muted" }] } : p.title,
        out: { text: outcome(p), tone: "muted" },
      },
    })),
  )
  const [pastSelected, setPastSelected] = createSignal<string | undefined>()
  // The columns end on the same line, as the design's grid draws them: each at least as tall as what it shows (the
  // left: its meeting panels and the past meetings; the right: the prep, measured), the shorter one stretched.
  const leftNeed = () => {
    const d = q.data()
    if (!d) return 0
    const block = 2 + 2 + 1 + 1 + Math.max(1, d.talk.length)
    return (d.blocks.length === 0 ? 3 : d.blocks.length * block) + 2 + Math.max(1, d.past.length)
  }
  const [rightContent, setRightContent] = createSignal(0)
  const rightNeed = () => {
    const d = q.data()
    if (!d) return 0
    return d.prep ? 2 + rightContent() : 2 + Math.max(1, d.mine.length)
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const d = q.data()
    if (!d) return
    const ch = printable(key)
    const at = Math.min(focus(), panels() - 1)
    if (key.name === "tab" && !key.shift) setFocus((at + 1) % panels())
    else if (key.name === "tab" && key.shift) setFocus((at + panels() - 1) % panels())
    else if (ch === "t") void overlay.openForm("talk_item", "talk", { prefill: { about: d.subject.ref }, draftFor: d.subject.ref })
    else if (ch === "N") void overlay.openForm("series", "series", { prefill: { about: d.subject.ref }, draftFor: d.subject.ref })
    else if (ch === "n") void overlay.openForm("meeting", "meeting", { prefill: { about: d.subject.ref }, draftFor: d.subject.ref })
    else if (key.name === "return") {
      const ref = at < d.blocks.length ? d.blocks[at]!.next?.ref : pastSelected()
      if (ref !== undefined) void nav.open(ref)
    } else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show when={q.data()}>
        {(d: () => Loaded) => (
          <box flexDirection="row" flexShrink={1} minHeight={0} gap={1} overflow="hidden">
            <box flexDirection="column" flexGrow={20} flexBasis={0} minWidth={0} minHeight={leftNeed()}>
              <Show
                when={d().blocks.length > 0}
                fallback={
                  <Panel title="Meetings" focused={false}>
                    <text fg={theme.muted}>{NO_MEETINGS}</text>
                  </Panel>
                }
              >
                <For each={d().blocks}>
                  {(b, i) => (
                    <Panel title={b.title} focused={focused(i())}>
                      <Fact label="Next" width={FACT_LABEL} parts={b.next === null ? [DASH] : [{ text: dayDate(b.next.date) }]} />
                      <WithFact names={b.with} />
                      <text> </text>
                      <text fg={theme.muted}>{`To talk about · ${d().talk.filter((t) => !t.carried).length}`}</text>
                      <Table columns={talkColumns} rows={talkRows()} header={false} focused={focused(i())} empty="Nothing yet. Press t to add an item." />
                    </Panel>
                  )}
                </For>
              </Show>
              <Panel title="Past meetings" focused={focused(d().blocks.length)} grow>
                <Table
                  columns={pastColumns}
                  rows={pastRows()}
                  header={false}
                  onSelect={setPastSelected}
                  focused={focused(d().blocks.length)}
                  empty="No meetings held yet."
                />
              </Panel>
            </box>
            <box flexDirection="column" flexGrow={23} flexBasis={0} minWidth={0} minHeight={rightNeed()}>
              <Show
                when={d().prep}
                fallback={
                  <Panel title={`Your actions for ${d().subject.first}`} count={d().mine.length} grow>
                    <Table columns={actionColumns} rows={d().mine.map((a) => actionRow(a, today()))} header={false} focused={false} empty="No open actions." />
                  </Panel>
                }
              >
                {(p: () => NonNullable<Loaded["prep"]>) => (
                  <Panel title={`Prep · since ${shortDate(p().since)}`} footer="generated from data" grow>
                    <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
                      <box
                        flexDirection="column"
                        flexShrink={0}
                        onSizeChange={function () {
                          setRightContent(this.height)
                        }}
                      >
                        <ReportSections sections={p().sections} skipColumns={["Project", "Name"]} compact />
                      </box>
                    </box>
                  </Panel>
                )}
              </Show>
            </box>
          </box>
        )}
      </Show>
    </box>
  )
}

export const ProjectMeetings = SubjectMeetings
