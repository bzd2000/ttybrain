// What the Actions screen and the Actions tabs share: loading actions with what their rows show (the owner's first
// name, the linked meetings' titles and dates), the columns `ID · Action · Owner · Linked to · Due` of the 2026-11-20
// design, and the cells. "Linked to" shows each link as the project code (cyan), the `@handle` (magenta), the
// meeting's title and date (muted) or the ref (muted), joined by spaces and cut whole: a code or a handle shows whole
// or not at all, and `…` says links were left out; only a meeting's title gives way (its date stays).
import { displayWidth, dueLabel, fitWidth, shortDate, truncate, type Cell, type CellPart, type TableColumn, type useRuntime } from "@ttybrain/api/tui"
import type { ActionLink, ActionRecord, Store, Target } from "../logic/records"

export type Meeting = { title: string; date: string }
export type Row = { rec: ActionRecord; ownerName: string | null; ownerHandle: string | null }
export type Loaded = { rows: Row[]; meetings: Map<number, Meeting> }

export const LINKED_WIDTH = 30
const OWNER = { min: 8, max: 14 }
// `A-1` to `A-1000001` (the handover's high range) and beyond stay whole.
const ID = { min: 5, max: 10 }
// The title keeps this much before Owner, then Linked to, give way (at 80×24 Owner goes, Linked to stays).
const TITLE_MIN = 24
const MORE = "…"
// A meeting title cut shorter than this leaves the meeting out instead.
const MIN_TITLE = 3

const firstName = (name: string | null, handle: string | null) => (name ? name.split(/\s+/)[0]! : handle ? `@${handle}` : null)
const chunks = <T>(xs: T[], n = 500): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

// The rows of actionQuery (narrowed by the caller) as rows, with the titles and dates of the meetings they link to
// (from meetings.meeting, when the meetings plugin is loaded).
export async function loadRows(rt: ReturnType<typeof useRuntime>, store: Store, rows: any[]): Promise<Loaded> {
  const loaded = await store.load(rows)
  const ids = [...new Set(loaded.flatMap((x) => x.rec.links.filter((l) => l.type === "meeting").map((l) => l.id)))]
  const meetings = new Map<number, Meeting>()
  if (ids.length > 0 && rt.records.hasType("meeting"))
    for (const part of chunks(ids))
      for (const m of await store.unlessUnavailable([] as any[], () => (rt.data as any).selectFrom("meetings.meeting").select(["id", "title", "date"]).where("id", "in", part).execute()))
        meetings.set(Number(m.id), { title: String(m.title), date: String(m.date) })
  return {
    rows: loaded.map((x) => ({ rec: x.rec, ownerName: firstName(x.ownerName, x.ownerHandle), ownerHandle: x.ownerHandle })),
    meetings,
  }
}

type Piece = { text: string; tone: CellPart["tone"]; meeting?: { title: string; tail: string } }

function piece(l: ActionLink, meetings: Map<number, Meeting>): Piece {
  if (l.type === "project" && l.ref.startsWith("#")) return { text: l.ref.slice(1), tone: "cyan" }
  if (l.type === "person" && l.ref.startsWith("@")) return { text: l.ref, tone: "magenta" }
  const m = l.type === "meeting" ? meetings.get(l.id) : undefined
  if (m !== undefined) {
    const tail = ` ${shortDate(m.date)}`
    return { text: `${m.title}${tail}`, tone: "muted", meeting: { title: m.title, tail } }
  }
  return { text: l.ref, tone: "muted" }
}

// A meeting title cut to `room` cells, ending in `…` (no space before it).
function cutTitle(title: string, room: number): string {
  const cut = truncate(title, room)
  return cut === title ? title : `${cut.slice(0, -1).trimEnd()}${MORE}`
}

// The links of an action as the parts of one cell of `width` cells: whole pieces while they fit (leaving room for
// ` …` while more follow), a meeting's title cut to keep its date, then ` …`. `except`: a link left out (the record
// whose Actions tab this is). No links: a muted `—`.
export function linkedCell(rec: ActionRecord, meetings: Map<number, Meeting>, except?: Target, width = LINKED_WIDTH): Cell {
  const pieces = rec.links.filter((l) => except === undefined || l.type !== except.type || l.id !== except.id).map((l) => piece(l, meetings))
  if (pieces.length === 0) return { text: "—", tone: "muted" }
  const parts: CellPart[] = []
  let used = 0
  for (const [i, p] of pieces.entries()) {
    const sep = parts.length === 0 ? "" : " "
    const more = i < pieces.length - 1 ? 1 + displayWidth(MORE) : 0
    const room = width - used - sep.length - more
    if (displayWidth(p.text) <= room) {
      parts.push({ text: `${sep}${p.text}`, tone: p.tone })
      used += sep.length + displayWidth(p.text)
      continue
    }
    const titleRoom = p.meeting ? room - displayWidth(p.meeting.tail) : 0
    if (p.meeting && titleRoom >= MIN_TITLE + 1) {
      parts.push({ text: `${sep}${cutTitle(p.meeting.title, titleRoom)}${p.meeting.tail}`, tone: p.tone })
      if (more > 0) parts.push({ text: ` ${MORE}`, tone: "muted" })
    } else if (parts.length === 0) {
      // Not even the first piece fits (a code or handle longer than the column): it is cut, as a last resort.
      parts.push({ text: truncate(p.text, width), tone: p.tone })
    } else parts.push({ text: ` ${MORE}`, tone: "muted" })
    break
  }
  return { text: parts.map((p) => p.text).join(""), parts }
}

// The design's columns: the ids and owners fit the longest shown (so `A-1000001` and names stay whole); narrow
// terminals drop Owner first, then Linked to.
export function actionColumns(rows: Row[]): TableColumn[] {
  return [
    { id: "id", title: "ID", width: fitWidth(rows.map((r) => r.rec.ref), ID.min, ID.max) },
    { id: "title", title: "Action", width: "grow", minWidth: TITLE_MIN },
    { id: "owner", title: "Owner", width: fitWidth(rows.map((r) => r.ownerName ?? ""), OWNER.min, OWNER.max), drop: 2 },
    { id: "linked", title: "Linked to", width: LINKED_WIDTH, drop: 1 },
    { id: "due", title: "Due", width: 7 },
  ]
}

// A closed action's due cell says what became of it; an open one's is `due` (or its due label, red when overdue).
export function dueCell(rec: ActionRecord, today: string, due?: string | Cell): string | Cell {
  if (rec.status === "done") return { text: "done", tone: "green" }
  if (rec.status === "cancelled") return { text: "dropped", tone: "muted" }
  if (due !== undefined) return due
  const overdue = rec.due_date !== null && rec.due_date < today
  return overdue ? { text: shortDate(rec.due_date!), tone: "red" } : dueLabel(rec.due_date, today)
}

// A row's cells; `due` overrides the open action's due cell, `except` leaves a link out of Linked to.
export function actionCells(r: Row, meetings: Map<number, Meeting>, today: string, opts: { due?: string | Cell; except?: Target } = {}): Record<string, string | Cell> {
  return {
    id: { text: r.rec.ref, tone: "muted" },
    title: r.rec.title,
    owner: r.ownerName === null ? { text: "me", tone: "muted" } : r.ownerName,
    linked: linkedCell(r.rec, meetings, opts.except),
    due: dueCell(r.rec, today, opts.due),
  }
}
