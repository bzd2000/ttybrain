// The Inbox screen (slot 6): `New · n` (oldest first) and `Processed · last 7 days` (processed or dismissed since
// today − 7, newest first), each processed item with a second line: `✓ <by> → <summary>  → <created refs>` or
// `✗ dismissed by <by>`. Unresolved tags are marked `⚠` and the text amber. Keys (on a shown item only): Enter
// opens the first record created from it (a new item: its edit form), e edits, z dismisses, u reopens, p processes
// by hand. Times compare the stored timestamp with the kernel clock.
import { createEffect, createSignal, Show, untrack } from "solid-js"
import {
  act,
  addDays,
  daysBetween,
  Form,
  KeyHints,
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
  type FormValues,
  type RecordFormProps,
  type SubmitResult,
  type TableGroup,
  type TableRow,
} from "@ttybrain/api/tui"
import type { ItemDetail } from "../logic/ops"
import { makeStore } from "../logic/records"
import type { ItemRecord } from "../logic/schema"
import { useProcessByHand } from "./process"

const HINTS = [
  { key: "Enter", label: "open" },
  { key: "p", label: "process" },
  { key: "z", label: "dismiss" },
  { key: "u", label: "reopen" },
  { key: "e", label: "edit" },
]
const RECENT_DAYS = 7

type Entry = ItemRecord & { links: Array<{ ref: string }>; created: string[] }

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

// One line, each unresolved tag followed by `⚠`.
function shownText(text: string, unresolved: string[]): string {
  let out = oneLine(text)
  for (const tag of unresolved) out = out.replace(new RegExp(`${escape(tag)}(?![A-Za-z0-9-])`, "g"), `${tag} ⚠`)
  return out
}

function outcome(e: Entry): Cell {
  if (e.status === "dismissed") return { text: `✗ dismissed${e.processed_by ? ` by ${e.processed_by}` : ""}`, tone: "muted" }
  const made = e.created.length > 0 ? `  → ${e.created.join(", ")}` : ""
  return { text: `✓ ${e.processed_by ?? "?"} → ${e.summary ?? ""}${made}`, tone: "green" }
}

export function InboxScreen() {
  const rt = useRuntime()
  const keys = useKeys()
  const nav = useNav()
  const overlay = useOverlay()
  const process = useProcessByHand()
  const store = makeStore(rt)

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

  const row = (e: Entry, today: string): TableRow => ({
    ref: e.ref,
    cells: {
      ref: { text: e.ref, tone: "muted" },
      time: { text: capturedLabel(e.captured_at, today), tone: "muted" },
      text: { text: shownText(e.text, e.unresolved), tone: e.unresolved.length > 0 ? "amber" : e.status === "new" ? undefined : "muted" },
    },
    ...(e.status === "new" ? {} : { detail: outcome(e) }),
  })
  const groups = (): TableGroup[] => {
    const d = q.data()
    if (!d) return []
    return [
      { title: "New", rows: d.fresh.map((e) => row(e, d.today)) },
      ...(d.done.length > 0 ? [{ title: "Processed · last 7 days", count: false, rows: d.done.map((e) => row(e, d.today)) }] : []),
    ]
  }

  const [selected, setSelected] = createSignal<string | undefined>(undefined)
  // The selected item, only while it is shown.
  const current = (): Entry | undefined => {
    const d = q.data()
    const ref = selected()
    return ref === undefined ? undefined : [...(d?.fresh ?? []), ...(d?.done ?? [])].find((e) => e.ref === ref)
  }

  const edit = (e: Entry) => void overlay.openForm("inbox_item", "item", { recordRef: e.ref })
  const openEntry = (ref: string) => {
    const e = current()
    if (!e || e.ref !== ref) return
    if (e.status !== "new" && e.created[0] !== undefined) void nav.open(e.created[0])
    else edit(e)
  }

  useScreenKeys((key) => {
    if (key.defaultPrevented) return
    const e = current()
    if (!e) return
    const ch = printable(key)
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
      <KeyHints hints={HINTS} />
      <Panel title="Inbox" grow focused={keys.active()}>
        <Table
          columns={[
            { id: "ref", title: "Ref", width: 5 },
            { id: "time", title: "Captured", width: 12 },
            { id: "text", title: "Text", width: "grow" },
          ]}
          groups={groups()}
          header={false}
          onSelect={setSelected}
          onOpen={openEntry}
          focused={keys.active()}
          empty="Inbox is empty"
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
