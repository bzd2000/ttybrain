// The `action` record form, add and edit (record type "action", form id "action": the Actions screen, the Actions
// tabs, the meeting's agenda and notes, and the inbox's "process as action" open it). Field names are the operations'
// input names, so a ValidationError lands under its field. Links are one refs field (`#CRM @peter M-4`, autocompleted
// as in quick capture). A new action's links start from `prefill.links`, `prefill.project`, `prefill.forPerson` and
// `prefill.meeting` (the meeting is also named in the title); its other fields from `prefill` by name. `origin` goes
// to act(), so the kernel records provenance. An edit sends only the changed fields, and the links that changed
// through unlinkAction / linkAction (links.ts), in the same act.
import { createEffect, Show, untrack } from "solid-js"
import { act, Form, useQuery, useRuntime, type FieldSpec, type FormValues, type RecordFormProps, type SubmitResult } from "@ttybrain/api/tui"
import { makeStore, type ActionRecord } from "../logic/records"
import { linkChanges, linkWords, words, writeLinks } from "./links"

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null)

const fields = (r: ActionRecord | null, links: string): FieldSpec[] => [
  { name: "title", label: "Title", kind: "text", required: true, initial: r?.title },
  { name: "due", label: "Due", kind: "date", initial: r?.due_date },
  { name: "owner", label: "Owner (empty = me)", kind: "record", recordType: "person", initial: r?.owner },
  { name: "links", label: "Links", kind: "refs", initial: links === "" ? null : links },
  { name: "notes", label: "Notes", kind: "longtext", initial: r?.notes },
]
const PREFILLED_LINKS = ["links", "project", "forPerson", "meeting"]

export function ActionForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  // The action behind `recordRef` (null without one); a ref that does not load closes the form.
  const q = useQuery(async () => (props.recordRef === undefined ? null : await store.find(props.recordRef)))
  createEffect(() => {
    if (q.error() !== undefined && q.data() === undefined) props.close()
  })

  const save = async (run: () => Promise<{ ref: string }>, verb: string): Promise<SubmitResult> => {
    const res = await act(run, { origin: props.origin, ok: (out) => `${verb} ${(out as { ref: string }).ref}` })
    return res.ok ? { ok: true, ref: (res.value as { ref: string }).ref } : res
  }

  return (
    <Show when={q.data() !== undefined}>
      {untrack(() => {
        const r = q.data()!
        // A new action starts from the prefill (the inbox's "process by hand" passes the item's text as title).
        const prefill = r === null ? (props.prefill ?? {}) : {}
        const before = r === null ? [] : linkWords(r)
        const links = r === null ? PREFILLED_LINKS.flatMap((k) => words(prefill[k])).join(" ") : before.join(" ")
        const shown = fields(r, links).map((f) => (f.name === "links" || prefill[f.name] === undefined ? f : { ...f, initial: prefill[f.name] }))
        const meeting = r === null ? props.prefill?.meeting : undefined
        const add = (v: FormValues) =>
          save(() => {
            const input: Record<string, unknown> = {}
            for (const f of shown) {
              const val = v[f.name]
              if (f.name === "links") input.links = words(val)
              else if (val !== null && val !== undefined) input[f.name] = val
              else if (f.name === "title") input[f.name] = ""
            }
            return rt.self().write.addAction!(input)
          }, "added")
        const edit = async (rec: ActionRecord, v: FormValues): Promise<SubmitResult> => {
          const changed = shown.filter((f) => f.name !== "links" && !same(v[f.name], f.initial)).map((f) => f.name)
          const changes = linkChanges(before, words(v.links))
          const relinked = changes.removed.length > 0 || changes.added.length > 0
          if (changed.length === 0 && !relinked) return { ok: true, ref: rec.ref }
          return save(async () => {
            const write = rt.self().write
            // Unlinking first lets an action leave an archived project in the same save.
            await writeLinks(write, rec.ref, changes)
            if (changed.length === 0) return { ref: rec.ref }
            const input: Record<string, unknown> = { ref: rec.ref }
            for (const name of changed) input[name] = v[name] ?? (name === "title" ? "" : null)
            return write.editAction!(input)
          }, "saved").then((res) => (res.ok || !relinked || changed.length > 0 ? res : { ...res, field: "links" }))
        }
        return (
          <Form
            title={r === null ? `New action${meeting !== undefined ? ` · ${meeting}` : ""}` : `Edit ${r.ref}`}
            fields={shown}
            submit={(v) => (r === null ? add(v) : edit(r, v))}
            close={props.close}
          />
        )
      })}
    </Show>
  )
}
