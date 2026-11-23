// A 1:1 or project meeting, in progress (the 2026-11-20 `oneonone` design; ruling M11: the meeting's only view, no
// tab row). Board meetings keep their tabs (Agenda · Prep · Notes · Export).
// - left: "Talk · 2 of 5 discussed", the meeting's talk items (agendaFor: ticked first, `✓` green and the text muted
//   and struck through; the others `○`), with the project an item is tagged with (cyan); under it "Agreed actions ·
//   n": the actions linked to this meeting (`new` in accent while it is planned, else their A-n; owner `me` muted or
//   a first name; due as the design reads it: `Fri`, `4 Dec`, `-7d` red, `done` green), then "Open from before": open actions linked to the subject's earlier meetings.
// - right: "Notes" (`e edit · E $EDITOR` on its bottom border).
// Keys (the design's bar): Space ticks the selected item discussed in this meeting, or reopens a ticked one (M5: at
// once); Tab the next panel; e edits the notes (a draft per meeting), E in $VISUAL/$EDITOR; a agrees an action (the
// action form, linked to the meeting and its subject: agreeLinks); D logs a decision; x closes the meeting (closeMeeting's
// message); Enter on an action opens it. A held or cancelled meeting says so (its crumb and the Talk title end in
// `· held` / `· cancelled`), and the bar shows only the keys that work there: a held meeting is not closed again; a
// cancelled one is read-only (its keys say so).
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import {
  act,
  dueLabel,
  Panel,
  printable,
  Table,
  theme,
  useEditExternal,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  type Cell,
  type Hint,
  type TableColumn,
  type TableRow,
} from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import type { MeetingRecord, TalkRecord } from "../logic/schema"
import { useMeetingWrites } from "./agenda-tab"
import { DASH } from "./subject"

const HINTS: Hint[] = [
  { key: "Space", label: "discussed" },
  { key: "Tab", label: "panel" },
  { key: "e", label: "notes" },
  { key: "a", label: "action" },
  { key: "D", label: "decision" },
  { key: "x", label: "close" },
  { key: "Esc", label: "back" },
]
// The bar by status: a held meeting keeps all but close; a cancelled one only moves.
const HELD = new Set(["x"])
const CANCELLED_KEEP = new Set(["Tab", "Esc"])
export const barFor = (status: string): Hint[] =>
  status === "planned" ? HINTS : status === "held" ? HINTS.filter((h) => !HELD.has(h.key)) : HINTS.filter((h) => CANCELLED_KEEP.has(h.key))
// `· held`, `· cancelled`; nothing while planned.
export const statusTail = (status: string) => (status === "planned" ? "" : ` · ${status}`)
export const NOTES_EMPTY = "No notes yet. Press e to write them."
export const TALK_EMPTY = "Nothing to talk about. Add items on the Talk tab."
const NOTES_FOOTER = "e edit · E $EDITOR"

const talkColumns: TableColumn[] = [
  { id: "mark", title: "", width: 3 },
  { id: "text", title: "", width: "grow", minWidth: 30 }, // the project tag gives way first on a narrow terminal
  { id: "project", title: "", width: 6, drop: 1 },
]
const actionColumns: TableColumn[] = [
  { id: "id", title: "", width: 5 },
  { id: "title", title: "", width: "grow" },
  { id: "owner", title: "", width: 8, drop: 2 },
  { id: "due", title: "", width: 6, drop: 1 },
]

type Act = { id: number; ref: string; title: string; owner: string | null; due: string | null; status: string }
type Loaded = { meeting: MeetingRecord; items: TalkRecord[]; agreed: Act[]; before: Act[]; links: string[] }

const ticked = (t: TalkRecord, m: MeetingRecord) => t.status === "discussed" && t.meeting === m.ref

export function MeetingView(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const nav = useNav()
  const overlay = useOverlay()
  const keys = useKeys()
  const editExternal = useEditExternal()
  const writes = useMeetingWrites()
  // The actions linked to these meetings (the people who own them by first name), by id.
  const actionsOf = async (meetings: number[], opts: { open?: boolean } = {}): Promise<Act[]> => {
    if (meetings.length === 0) return []
    const rows = await store.unlessUnavailable([] as Array<Record<string, unknown>>, () => {
      let query = rt.data
        .selectFrom("actions.link as l")
        .innerJoin("actions.action as a", "a.id", "l.action_id")
        .leftJoin("people.person as o", "o.id", "a.owner_id")
        .select(["a.id", "a.title", "a.due_date", "a.owner_id", "a.status", "o.name"])
        .distinct()
        .where("l.record_type", "=", "meeting")
        .where("l.record_id", "in", meetings)
      if (opts.open) query = query.where("a.status", "=", "open")
      return query.orderBy("a.id").execute()
    })
    return rows.map((r) => ({
      id: Number(r.id),
      ref: `A-${Number(r.id)}`,
      title: String(r.title),
      owner: r.owner_id === null ? null : r.name === null ? "—" : String(r.name).split(/\s+/)[0]!,
      due: r.due_date === null ? null : String(r.due_date),
      status: String(r.status),
    }))
  }

  const q = useQuery(
    async (): Promise<Loaded> => {
      const meeting = await store.meeting(props.recordRef)
      const { items } = (await rt.self().read.agendaFor!({ meeting: meeting.ref })) as { items: TalkRecord[] }
      const agreed = await actionsOf([meeting.id])
      // The subject's earlier meetings: what was agreed there and is still open.
      const own = await rt.data.selectFrom("meeting").select(["subject_type", "subject_id"]).where("id", "=", meeting.id).executeTakeFirstOrThrow()
      const earlier =
        own.subject_type === null
          ? []
          : await rt.data
              .selectFrom("meeting")
              .select("id")
              .where("subject_type", "=", own.subject_type)
              .where("subject_id", "=", own.subject_id)
              .where("id", "!=", meeting.id)
              .where("date", "<=", meeting.date)
              .execute()
      const here = new Set(agreed.map((a) => a.id))
      const before = (await actionsOf(earlier.map((r) => Number(r.id)), { open: true })).filter((a) => !here.has(a.id))
      const links = (await rt.self().read.agreeLinks!({ meeting: meeting.ref })) as string[]
      return { meeting, items, agreed, before, links }
    },
    { key: () => props.recordRef },
  )
  const meeting = () => q.data()?.meeting
  const status = () => meeting()?.status ?? "planned"
  createEffect(() => {
    const drop = keys.hints(barFor(status()), { exact: true, frame: [], globals: false })
    onCleanup(drop)
  })

  const [focus, setFocus] = createSignal<0 | 1 | 2>(0)
  const [item, setItem] = createSignal<string | undefined>()
  const [action, setAction] = createSignal<string | undefined>()
  const selectedItem = () => q.data()?.items.find((t) => t.ref === item())

  const talkRows = createMemo((): TableRow[] => {
    const d = q.data()
    if (!d) return []
    return d.items.map((t) => {
      const done = ticked(t, d.meeting)
      const tag = t.project !== null && t.project !== d.meeting.about ? t.project.replace(/^#/, "") : ""
      return {
        ref: t.ref,
        cells: {
          mark: done ? { text: "✓", tone: "green" } : { text: "○" },
          text: done ? { text: t.text, tone: "muted", strike: true } : { text: t.text },
          project: { text: tag, tone: done ? "muted" : "cyan" },
        },
      }
    })
  })
  const actionCells = (a: Act, fresh: boolean): TableRow => {
    const today = rt.clock.today()
    const owner: Cell = a.owner === null ? { text: "me", tone: "muted" } : { text: a.owner }
    return {
      ref: a.ref,
      cells: {
        id: fresh ? { text: "new", tone: "accent" } : { text: a.ref, tone: "muted" },
        title: a.title,
        owner,
        due: a.status !== "open" ? { text: "done", tone: "green" } : a.due === null ? DASH : { text: dueLabel(a.due, today), tone: a.due < today ? "red" : undefined },
      },
    }
  }
  const actionGroups = createMemo(() => {
    const d = q.data()
    if (!d) return []
    const planned = d.meeting.status === "planned"
    return [
      { rows: d.agreed.map((a) => actionCells(a, planned)) },
      ...(d.before.length === 0 ? [] : [{ title: "Open from before", count: false, rows: d.before.map((a) => actionCells(a, false)) }]),
    ]
  })
  const discussed = () => {
    const d = q.data()
    return d ? d.items.filter((t) => ticked(t, d.meeting)).length : 0
  }

  // Space: discussed in this meeting, or open again.
  const tick = async (m: MeetingRecord, t: TalkRecord) => {
    if (ticked(t, m)) await act(() => rt.self().write.reopenTalk!({ ref: t.ref }))
    else await act(() => rt.self().write.discussTalk!({ ref: t.ref, meeting: m.ref }))
  }
  const saveNotes = async (m: MeetingRecord, markdown: string): Promise<{ ok: true } | { ok: false; error: unknown }> => {
    const r = await act(() => rt.self().write.setNotes!({ meeting: m.ref, markdown }) as Promise<unknown>)
    return r.ok ? { ok: true } : r
  }
  const editNotes = (m: MeetingRecord) =>
    overlay.openEditor({ title: `Notes · ${m.ref}`, initial: m.notes, save: (text) => saveNotes(m, text), draftKey: `notes:${m.ref}` })
  const editOutside = async (m: MeetingRecord) => {
    const edited = await editExternal(m.notes)
    if (edited !== null) await saveNotes(m, edited)
  }
  // An agreed action: linked to the meeting and its subject (agreeLinks).
  const agree = (m: MeetingRecord) => {
    const links = (q.data()?.links ?? [m.ref]).filter((l) => l !== m.ref)
    void overlay.openForm("action", "action", { prefill: { meeting: m.ref, ...(links.length === 0 ? {} : { links: links.join(" ") }) } })
  }
  const decisionProject = (m: MeetingRecord) => selectedItem()?.project ?? (m.about?.startsWith("#") ? m.about : null)

  useScreenKeys((key) => {
    if (keys.typing()) return
    const m = meeting()
    if (m === undefined) return
    const ch = printable(key)
    if (key.name === "tab" && !key.shift) setFocus((f) => ((f + 1) % 3) as 0 | 1 | 2)
    else if (key.name === "tab" && key.shift) setFocus((f) => ((f + 2) % 3) as 0 | 1 | 2)
    else if (key.name === "space" || ch === " ") {
      const t = selectedItem()
      if (focus() === 0 && t) writes.live(m, () => void tick(m, t))
    } else if (ch === "e") writes.live(m, () => editNotes(m))
    else if (ch === "E") writes.live(m, () => void editOutside(m))
    else if (ch === "a") writes.live(m, () => agree(m))
    else if (ch === "D") writes.live(m, () => writes.logDecision(m, decisionProject(m)))
    else if (ch === "x") writes.live(m, () => void writes.close(m))
    else if (key.name === "return" && focus() === 1) {
      const ref = action()
      if (ref !== undefined) void nav.open(ref)
    } else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show when={q.data()}>
        {(d: () => Loaded) => (
          <box flexDirection="row" flexShrink={1} minHeight={0} gap={1} overflow="hidden">
            <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0}>
              <box flexDirection="column" flexShrink={1} minHeight={0} overflow="hidden">
                <Panel title={`Talk · ${discussed()} of ${d().items.length} discussed${statusTail(d().meeting.status)}`} focused={keys.active() && focus() === 0}>
                  <Table columns={talkColumns} rows={talkRows()} header={false} onSelect={setItem} focused={keys.active() && focus() === 0} empty={TALK_EMPTY} />
                </Panel>
              </box>
              <Panel title="Agreed actions" count={d().agreed.length} focused={keys.active() && focus() === 1}>
                <Table
                  columns={actionColumns}
                  groups={actionGroups()}
                  header={false}
                  onSelect={setAction}
                  focused={keys.active() && focus() === 1}
                  empty="None yet. Press a to agree one."
                />
              </Panel>
            </box>
            <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0}>
              <Panel title="Notes" footer={NOTES_FOOTER} focused={keys.active() && focus() === 2} grow>
                <Show when={d().meeting.notes.trim() !== ""} fallback={<text fg={theme.muted}>{NOTES_EMPTY}</text>}>
                  <text fg={theme.text} wrapMode="word">
                    {d().meeting.notes}
                  </text>
                </Show>
              </Panel>
            </box>
          </box>
        )}
      </Show>
    </box>
  )
}
