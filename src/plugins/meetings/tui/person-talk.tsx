// A person's Talk tab (the 2026-11-20 `talk` design), and the same list on a project's Talk tab (project-talk.tsx):
// - left (1.4 : 1), focused: "To talk about · n open" with `next: 1:1 Mon 23 Nov` on its bottom border; # (muted
//   `1.`), Item, Project (a code cyan, `—` muted; on a project's list: the person a tagged item comes from), Added
//   (muted: `today`, a day of this week, else the date); then, after a blank line, "Carried over from 9 Nov" and the
//   items from before the last meeting, muted, marked `↻`.
// - right: "Meetings" (Next, Rhythm, Last: `Mon 9 Nov · 3 discussed, 1 carried`) and "Your actions for Anna · n"
//   (owner me, linked to the subject or one of its meetings), then for a person "Anna's actions · n" (they own them;
//   ruling M10: the design's "Her actions").
// Keys (the design's bar): n add an item (the talk form, its subject filled in; `t` does the same), e edit the
// selected one, J/K move it down/up within its group, Del drop it (after a confirmation), Enter open the next meeting.
import { createMemo, createSignal, For, Show } from "solid-js"
import {
  act,
  dayDate,
  Panel,
  printable,
  shortDate,
  Table,
  theme,
  toneColor,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  type Cell,
  type CellPart,
  type Hint,
  type TableColumn,
  type TableGroup,
  type TableRow,
} from "@ttybrain/api/tui"
import type { TalkRecord } from "../logic/schema"
import { addedLabel, DASH, makeSubjects, meetingName, type Last, type MeetingRow } from "./subject"
import { dueCell, type MyAction } from "./upcoming"

const HINTS: Hint[] = [
  { key: "←→", label: "tabs" },
  { key: "n", label: "add" },
  { key: "e", label: "edit" },
  { key: "J/K", label: "reorder" },
  { key: "Del", label: "drop" },
  { key: "Enter", label: "next meeting" },
  { key: "Esc", label: "back" },
]
export const TALK_EMPTY = "Nothing to talk about yet. Press n to add an item."
const FACT_LABEL = 10 // the label column of the Meetings facts: 8 cells and the gap

const columns = (who: string): TableColumn[] => [
  { id: "n", title: "", width: 3 },
  { id: "text", title: "Item", width: "grow", minWidth: 24 }, // on a narrow terminal Added gives way first
  { id: "project", title: who, width: 7, drop: 1 },
  { id: "added", title: "Added", width: 8, drop: 2 },
]
const actionColumns: TableColumn[] = [
  { id: "ref", title: "", width: 5 },
  { id: "title", title: "", width: "grow" },
  { id: "due", title: "", width: 6 },
]

// A label and its value in pieces, as the designs' facts (`Next    Mon 23 Nov · 1:1 Anna`).
export function Fact(props: { label: string; width: number; parts: CellPart[] }) {
  return (
    <box flexDirection="row" height={1} flexShrink={0} overflow="hidden">
      <text fg={theme.muted} width={props.width} flexShrink={0} wrapMode="none">
        {props.label}
      </text>
      <For each={props.parts}>
        {(p) => (
          <text fg={toneColor(p.tone)} flexShrink={0} wrapMode="none">
            {p.text}
          </text>
        )}
      </For>
    </box>
  )
}

// `Mon 23 Nov · 1:1 Anna`, `—`.
export const nextParts = (m: MeetingRow | null): CellPart[] => (m === null ? [DASH] : [{ text: dayDate(m.date) }, { text: ` · ${m.title}`, tone: "muted" }])
export const lastParts = (m: Last | null): CellPart[] =>
  m === null
    ? [DASH]
    : [{ text: dayDate(m.date) }, ...(m.discussed + m.carried === 0 ? [] : [{ text: ` · ${m.discussed} discussed, ${m.carried} carried`, tone: "muted" as const }])]

export const actionRow = (a: MyAction, today: string): TableRow => ({ ref: a.ref, cells: { ref: { text: a.ref, tone: "muted" }, title: a.title, due: dueCell(a.due, today) } })

type Loaded = {
  subject: { ref: string; type: "person" | "project" | "board"; id: number; label: string; first: string }
  open: TalkRecord[]
  carried: TalkRecord[]
  carriedFrom: string | undefined
  from: Map<string, string> // a tagged item's person (@handle → first name), on a project's list
  next: MeetingRow | null
  last: Last | null
  rhythm: string | null
  mine: MyAction[]
  owned: MyAction[]
}

export function SubjectTalk(props: { recordRef: string }) {
  const rt = useRuntime()
  const subjects = makeSubjects(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  keys.hints(HINTS, { exact: true, frame: [], globals: false })

  const q = useQuery(
    async (): Promise<Loaded> => {
      const s = await subjects.subject(props.recordRef)
      const list = await subjects.talkList(s)
      const series = await subjects.series(s)
      const from = new Map<string, string>()
      if (s.type === "project")
        for (const t of list.open) if (t.about !== s.ref && !from.has(t.about)) from.set(t.about, (await rt.records.label(t.about).catch(() => t.about)).split(/\s+/)[0]!)
      return {
        subject: { ref: s.ref, type: s.type, id: s.id, label: s.label, first: s.type === "person" ? s.label.split(/\s+/)[0]! : s.ref.replace(/^#/, "") },
        open: list.open,
        carried: list.carried,
        carriedFrom: list.carriedFrom,
        from,
        next: await subjects.next(s),
        last: await subjects.last(s),
        rhythm: series[0] === undefined ? null : subjects.rhythm(series[0], "long"),
        mine: await subjects.mine(s),
        owned: s.type === "person" ? await subjects.owned(s.id) : [],
      }
    },
    { key: () => props.recordRef },
  )

  const today = () => rt.clock.today()
  const groups = createMemo((): TableGroup[] => {
    const d = q.data()
    if (!d) return []
    const project = (t: TalkRecord): Cell => {
      if (d.subject.type === "project") return t.about === d.subject.ref ? DASH : { text: d.from.get(t.about) ?? t.about }
      return t.project === null ? DASH : { text: t.project.replace(/^#/, ""), tone: "cyan" }
    }
    const open: TableRow[] = d.open.map((t, i) => ({
      ref: t.ref,
      cells: { n: { text: `${i + 1}.`, tone: "muted" }, text: t.text, project: project(t), added: { text: addedLabel(t.added_date, today()), tone: "muted" } },
    }))
    const carried: TableRow[] = d.carried.map((t) => ({
      ref: t.ref,
      cells: {
        n: { text: "↻", tone: "muted" },
        text: { text: t.text, tone: "muted" },
        project: { ...project(t), tone: "muted" },
        added: { text: addedLabel(t.added_date, today()), tone: "muted" },
      },
    }))
    return [
      { rows: open },
      ...(carried.length === 0 ? [] : [{ title: `Carried over from ${shortDate(d.carriedFrom!)}`, count: false, space: true, rows: carried }]),
    ]
  })
  const items = createMemo(() => [...(q.data()?.open ?? []), ...(q.data()?.carried ?? [])])
  const [current, setCurrent] = createSignal<string | undefined>()
  const [want, setWant] = createSignal<string | undefined>()
  const select = (ref: string | undefined) => {
    setCurrent(ref)
    if (ref !== undefined && ref === want()) setWant(undefined)
  }
  const selected = () => items().find((t) => t.ref === current())
  const shownWant = () => (items().some((t) => t.ref === want()) ? want() : undefined)

  const add = async () => {
    const d = q.data()
    if (!d) return
    const saved = await overlay.openForm("talk_item", "talk", { prefill: { about: d.subject.ref }, draftFor: d.subject.ref })
    if (saved !== undefined) setWant(saved)
  }
  // Within its group, on its own subject's list (a person's item tagged with a project moves on that person's list).
  const move = async (t: TalkRecord, by: number) => {
    const d = q.data()
    if (!d || t.about !== d.subject.ref || t.position === null) return
    const group = t.carried ? d.carried : d.open.filter((x) => x.about === d.subject.ref)
    const to = t.position + by
    if (to < 1 || to > group.length) return
    if ((await act(() => rt.self().write.moveTalk!({ ref: t.ref, to }))).ok) setWant(t.ref)
  }
  const drop = async (t: TalkRecord) => {
    if (!(await overlay.confirm(`Drop "${t.text}"?`))) return
    await act(() => rt.self().write.dropTalk!({ ref: t.ref }), { ok: () => `dropped ${t.ref}` })
  }

  useScreenKeys((key) => {
    if (keys.typing()) return
    const ch = printable(key)
    const t = selected()
    if (ch === "n" || ch === "t") void add()
    else if (ch === "e") {
      if (t) void overlay.openForm("talk_item", "talk", { recordRef: t.ref })
    } else if (ch === "J") {
      if (t) void move(t, 1)
    } else if (ch === "K") {
      if (t) void move(t, -1)
    } else if (key.name === "delete") {
      if (t) void drop(t)
    } else if (key.name === "return") {
      const next = q.data()?.next
      if (next) void nav.open(next.ref)
    } else return
    key.preventDefault()
  })

  // The left panel is at least as tall as its rows (the header, the items, the carried group), so the right column
  // decides only when it is the taller one: both end on the same line, as the design draws them.
  const leftNeed = () => {
    const d = q.data()
    if (!d) return 0
    return 3 + d.open.length + (d.carried.length > 0 ? 2 + d.carried.length : 0)
  }
  const footer = () => {
    const n = q.data()?.next
    return n ? `next: ${meetingName(n)} ${dayDate(n.date)}` : undefined
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show when={q.data()}>
        {(d: () => Loaded) => (
          <box flexDirection="row" flexShrink={1} minHeight={0} gap={1} overflow="hidden">
            <box flexDirection="column" flexGrow={14} flexBasis={0} minWidth={0} minHeight={leftNeed()}>
              <Panel title={`To talk about · ${d().open.length} open`} footer={footer()} focused={keys.active()} grow>
                <Table
                  columns={columns(d().subject.type === "project" ? "From" : "Project")}
                  groups={groups()}
                  selectedRef={shownWant()}
                  onSelect={select}
                  focused={keys.active()}
                  empty={TALK_EMPTY}
                />
              </Panel>
            </box>
            <box flexDirection="column" flexGrow={10} flexBasis={0} minWidth={0}>
              <Panel title="Meetings">
                <Fact label="Next" width={FACT_LABEL} parts={nextParts(d().next)} />
                <Fact label="Rhythm" width={FACT_LABEL} parts={d().rhythm === null ? [DASH] : [{ text: d().rhythm! }]} />
                <Fact label="Last" width={FACT_LABEL} parts={lastParts(d().last)} />
              </Panel>
              <Panel title={`Your actions for ${d().subject.first}`} count={d().mine.length}>
                <Table
                  columns={actionColumns}
                  header={false}
                  focused={false}
                  groups={[
                    { rows: d().mine.map((a) => actionRow(a, today())) },
                    ...(d().subject.type === "person" && d().owned.length > 0
                      ? [{ title: `${d().subject.first}'s actions`, rows: d().owned.map((a) => actionRow(a, today())) }]
                      : []),
                  ]}
                  empty="No open actions."
                />
              </Panel>
            </box>
          </box>
        )}
      </Show>
    </box>
  )
}

export const PersonTalk = SubjectTalk
