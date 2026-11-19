// Process by hand (`p` on the Inbox screen): a menu of the record forms other plugins registered (found through the
// TUI registry, so the inbox needs none of them), the chosen one opened prefilled with the item's text (tags left
// out) and its first #tag as the project and its first @tag as the person, with the item as origin (provenance). Once the form saved, the item is
// marked processed (`<label> <ref>`, by you). These are two writes: if the second fails, the record stays and the
// item stays new (the error shows in the status bar).
import { act, Menu, notify, useOverlay, useRecordForms, useRuntime } from "@ttybrain/api/tui"

// The record forms the menu offers, in order (a form missing from the registry is left out); without `form`, the
// type's first form (people's note, phase 3).
const CHOICES: Array<{ type: string; form?: string; key: string }> = [
  { type: "action", form: "action", key: "a" },
  { type: "decision", form: "decision", key: "d" },
  { type: "risk", form: "risk", key: "r" },
  { type: "project", form: "health", key: "h" },
  { type: "note", key: "n" },
]

const TAG = /(^|[\s([])[#@$][A-Za-z0-9][A-Za-z0-9-]*/g

// The text without its tags, on one line: `call @anna about #CRM` → `call about`.
export function withoutTags(text: string): string {
  return text.replace(TAG, "$1").replace(/\s+/g, " ").trim()
}

export type ProcessItem = { ref: string; text: string; links: Array<{ ref: string }> }

// Returns the function that runs the flow for one item (call it from a key handler).
export function useProcessByHand(): (item: ProcessItem) => void {
  const rt = useRuntime()
  const overlay = useOverlay()
  const forms = CHOICES.flatMap((c) => {
    const all = useRecordForms(c.type)
    const f = c.form === undefined ? all[0] : all.find((x) => x.id === c.form)
    return f ? [{ type: c.type, form: f.id, label: f.label, key: c.key }] : []
  })

  const run = async (f: (typeof forms)[number], item: ProcessItem) => {
    const title = withoutTags(item.text)
    const project = item.links.find((l) => l.ref.startsWith("#"))?.ref
    const person = item.links.find((l) => l.ref.startsWith("@"))?.ref
    const prefill: Record<string, string> = { title, comment: title, text: title, ...(project !== undefined ? { project } : {}), ...(person !== undefined ? { person } : {}) }
    const saved = await overlay.openForm(f.type, f.form, { prefill, origin: { type: "inbox", ref: item.ref } })
    if (saved === undefined) return
    await act(() => rt.self().write.markProcessed!({ ref: item.ref, summary: `${f.label} ${saved}`, by: "you" }), { ok: () => `processed ${item.ref}` })
  }

  return (item) => {
    if (forms.length === 0) return notify("no record forms to process into", "error")
    let close = () => {}
    close = overlay.open(() => (
      <Menu title={`Process ${item.ref}`} items={forms.map((f) => ({ key: f.key, label: f.label, run: () => void run(f, item) }))} close={() => close()} />
    ))
  }
}
