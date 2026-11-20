// The Inbox screen (slot 6), as the screen design draws it: two panels, `New · n` (oldest first, as tall as its
// rows) and `Processed · last 7 days` (processed or dismissed since today − 7, newest first, the rest of the
// height). Tags show in their colours inside the text, an unresolved one followed by an amber `⚠ unknown <type>`.
// Each processed item has its outcome under it, in the time and text columns: `✓ <by>` green and `→ <summary>`
// muted with the records created from it in normal text; or `✗ dismissed` and `by <by>`, muted like a dismissed
// item's text; a blank line between processed items. `<by>` is the configured assistant's name for the
// assistant. ↑↓ move through both panels (the focus follows the selection). Keys (on a shown item only): Enter
// opens the first record created from it (a new item: its edit form), e edits, z dismisses, u reopens, p processes
// by hand. Times compare the stored timestamp with the kernel clock.
import { createEffect, createSignal, Show, untrack } from "solid-js"
import {
  act,
  addDays,
  daysBetween,
  Form,
  longDate,
  Panel,
  printable,
  Table,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  type Cell,
  type CellPart,
  type FormValues,
  type Hint,
  type RecordFormProps,
  type SubmitResult,
  type TableColumn,
  type TableRow,
} from "@ttybrain/api/tui"
import type { ItemDetail } from "../logic/ops"
import { makeStore } from "../logic/records"
import type { ItemRecord } from "../logic/schema"
import { useProcessByHand } from "./process"
import { tagParts } from "./tags"

const HINTS: Hint[] = [
  { key: "↑↓", label: "select" },
  { key: "Enter", label: "open" },
  { key: "p", label: "process" },
  { key: "z", label: "dismiss" },
  { key: "e", label: "edit" },
]
// Kept beyond the design (R2).
const KEPT: Hint[] = [{ key: "u", label: "reopen" }]
const RECENT_DAYS = 7
const COLUMNS: TableColumn[] = [
  { id: "ref", title: "Ref", width: 5 },
  { id: "time", title: "Captured", width: 12 },
  { id: "text", title: "Text", width: "grow" },
]

type Entry = ItemRecord & { links: Array<{ ref: string }>; created: string[] }
type PanelId = "new" | "done"

// `today 09:42`, `yesterday`, else `Mon 9 Nov`.
export function capturedLabel(at: string, today: string): string {
  const date = at.slice(0, 10)
  if (date === today) return `today ${at.slice(11, 16)}`
  if (daysBetween(date, today) === 1) return "yesterday"
  return longDate(date).replace(/ \d{4}$/, "")
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// A multi-line item on one line: each line break shows as ` ↵ ` (the Inbox screen and the Overview panel).
export const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ↵ ")

// `text` muted, with each of `refs` in it in normal text.
function withRefs(text: string, refs: string[]): CellPart[] {
  if (refs.length === 0) return [{ text, tone: "muted" }]
  const re = new RegExp(`(?<![A-Za-z0-9-])(${refs.map(escape).join("|")})(?![A-Za-z0-9-])`, "g")
  return text
    .split(re)
    .filter((s) => s !== "")
    .map((s) => (refs.includes(s) ? { text: s } : { text: s, tone: "muted" as const }))
}

const cell = (parts: CellPart[], tone?: Cell["tone"]): Cell => ({ text: parts.map((p) => p.text).join(""), tone, parts })

export function InboxScreen() {
  const rt = useRuntime()
  const keys = useKeys()
  const nav = useNav()
  const overlay = useOverlay()
  const process = useProcessByHand()
  const store = makeStore(rt)
  const types = rt.tags.types()
  const byName = (by: string | null) => (by === "assistant" ? rt.config.assistant.provider : (by ?? "?"))

  const q = useQuery(async () => {
    const today = rt.clock.today()
    const detail = async (r: unknown): Promise<Entry> => {
      const it = store.toItem(r)
      const d = (await rt.self().read.getItem!({ ref: it.ref })) as ItemDetail
      return { ...it, links: d.links, created: d.created.map((c) => c.ref) }
    }
    const fresh = await store.itemQuery().where("status", "=", "new").orderBy("captured_at").orderBy("id").execute()
    const done = await store
      .itemQuery()
      .where("status", "in", ["processed", "dismissed"])
      .where("processed_at", ">=", addDays(today, -RECENT_DAYS))
      .orderBy("processed_at", "desc")
      .orderBy("id", "desc")
      .execute()
    return { today, fresh: await Promise.all(fresh.map(detail)), done: await Promise.all(done.map(detail)) }
  })

  const row = (e: Entry, today: string): TableRow => {
    const dismissed = e.status === "dismissed"
    const text = oneLine(e.text)
    return {
      ref: e.ref,
      cells: {
        ref: { text: e.ref, tone: "muted" },
        time: { text: capturedLabel(e.captured_at, today), tone: "muted" },
        text: dismissed ? { text, tone: "muted" } : cell(tagParts(text, { unresolved: e.unresolved, types })),
      },
      ...(e.status === "new"
        ? {}
        : {
            detail: {
              cells: dismissed
                ? { time: { text: "✗ dismissed", tone: "muted" }, text: { text: e.processed_by ? `by ${e.processed_by}` : "", tone: "muted" } }
                : { time: { text: `✓ ${byName(e.processed_by)}`, tone: "green" }, text: cell(withRefs(`→ ${oneLine(e.summary ?? "")}`, e.created)) },
            },
          }),
    }
  }
  const fresh = () => q.data()?.fresh ?? []
  const done = () => q.data()?.done ?? []
  const today = () => q.data()?.today ?? ""

  // --- the focused panel: the chosen one, or the other while it has no items ---
  const [chosen, setChosen] = createSignal<PanelId>("new")
  const focus = (): PanelId => (chosen() === "new" ? (fresh().length > 0 || done().length === 0 ? "new" : "done") : done().length > 0 || fresh().length === 0 ? "done" : "new")
  const [newSel, setNewSel] = createSignal<string | undefined>(undefined)
  const [doneSel, setDoneSel] = createSignal<string | undefined>(undefined)
  // Where the selection moves to on entering a panel.
  const [newTo, setNewTo] = createSignal<string | undefined>(undefined)
  const [doneTo, setDoneTo] = createSignal<string | undefined>(undefined)
  // The selected item, only while it is shown.
  const current = (): Entry | undefined => {
    const ref = focus() === "new" ? newSel() : doneSel()
    return ref === undefined ? undefined : [...fresh(), ...done()].find((e) => e.ref === ref)
  }
  const edit = (e: Entry) => void overlay.openForm("inbox_item", "item", { recordRef: e.ref })
  const openEntry = (ref: string) => {
    const e = current()
    if (!e || e.ref !== ref) return
    if (e.status !== "new" && e.created[0] !== undefined) void nav.open(e.created[0])
    else edit(e)
  }

  keys.hints(HINTS, { exact: true, frame: [], after: KEPT })

  useScreenKeys((key) => {
    if (key.defaultPrevented) return
    const ch = printable(key)
    // Across the panels: ↓ past the last new item, ↑ above the first processed one.
    const down = key.name === "down" || ch === "j"
    const up = key.name === "up" || ch === "k"
    if (down && focus() === "new" && done().length > 0 && newSel() === fresh().at(-1)?.ref) {
      setDoneTo(undefined)
      setDoneTo(done()[0]!.ref)
      setChosen("done")
      key.preventDefault()
      return
    }
    if (up && focus() === "done" && fresh().length > 0 && doneSel() === done()[0]?.ref) {
      setNewTo(undefined)
      setNewTo(fresh().at(-1)!.ref)
      setChosen("new")
      key.preventDefault()
      return
    }
    const e = current()
    if (!e) return
    const write = rt.self().write
    if (ch === "e") edit(e)
    else if (ch === "z" && e.status === "new") void act(() => write.dismiss!({ ref: e.ref, by: "you" }), { ok: () => `dismissed ${e.ref}` })
    else if (ch === "u" && e.status !== "new") void act(() => write.reopen!({ ref: e.ref }), { ok: () => `reopened ${e.ref}` })
    else if (ch === "p" && e.status === "new") process(e)
    else return
    key.preventDefault()
  })

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Panel title="New" count={fresh().length} shrink focused={keys.active() && focus() === "new"}>
        <Table
          columns={COLUMNS}
          rows={fresh().map((e) => row(e, today()))}
          header={false}
          selectedRef={newTo()}
          onSelect={setNewSel}
          onOpen={openEntry}
          focused={keys.active() && focus() === "new"}
          empty="Inbox is empty"
        />
      </Panel>
      <Panel title="Processed · last 7 days" grow focused={keys.active() && focus() === "done"}>
        <Table
          columns={COLUMNS}
          groups={[{ rowSpace: true, rows: done().map((e) => row(e, today())) }]}
          header={false}
          selectedRef={doneTo()}
          onSelect={setDoneSel}
          onOpen={openEntry}
          focused={keys.active() && focus() === "done"}
          empty="Nothing processed in the last 7 days"
        />
      </Panel>
    </box>
  )
}

// The item's form: edit its text (editItem, which re-resolves the tags), or without a recordRef capture a new one.
export function ItemForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const q = useQuery(async () => (props.recordRef === undefined ? null : store.item(props.recordRef)))
  createEffect(() => {
    if (q.error() !== undefined && q.data() === undefined) props.close()
  })
  return (
    <Show when={q.data() !== undefined}>
      {untrack(() => {
        const it = q.data()!
        const submit = async (v: FormValues): Promise<SubmitResult> => {
          const text = v.text ?? ""
          if (it !== null && text === it.text) return { ok: true, ref: it.ref }
          const w = rt.self().write
          const run = () => (it === null ? w.capture!({ text }) : w.editItem!({ ref: it.ref, text })) as Promise<{ ref: string }>
          const r = await act(run, { origin: props.origin, ok: (out) => `${it === null ? "captured" : "saved"} ${out.ref}` })
          return r.ok ? { ok: true, ref: r.value.ref } : r
        }
        return (
          <Form
            title={it === null ? "Capture to inbox" : `Edit ${it.ref}`}
            fields={[{ name: "text", label: "Text", kind: "longtext", required: true, initial: it?.text ?? props.prefill?.text ?? null }]}
            submit={submit}
            close={props.close}
          />
        )
      })}
    </Show>
  )
}
