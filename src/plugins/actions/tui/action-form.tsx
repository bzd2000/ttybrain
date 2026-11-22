// The `action` record form, add and edit (record type "action", form id "action": the Actions screen, the Actions
// tabs, the meeting's agenda and notes, and the inbox's "process as action" open it). Field names are the operations'
// input names, so a ValidationError lands under its field. With `prefill.project` the project is set and its field
// left out; a new action with `prefill.meeting` is linked to that meeting (no field; the title names it); a new
// action's other fields start from `prefill` by name. `origin` goes to act(), so the kernel records provenance. An
// edit sends only the changed fields.
import { createEffect, Show, untrack } from "solid-js"
import { act, Form, useQuery, useRuntime, type FieldSpec, type FormValues, type RecordFormProps, type SubmitResult } from "@ttybrain/api/tui"
import { makeStore, type ActionRecord } from "../logic/records"

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null)

const fields = (r: ActionRecord | null, hasProject: boolean): FieldSpec[] => [
  { name: "title", label: "Title", kind: "text", required: true, initial: r?.title },
  { name: "due", label: "Due", kind: "date", initial: r?.due_date },
  { name: "owner", label: "Owner (empty = me)", kind: "record", recordType: "person", initial: r?.owner },
  ...(hasProject ? [] : [{ name: "project", label: "Project", kind: "record" as const, recordType: "project", initial: r?.project }]),
  { name: "forPerson", label: "For", kind: "record", recordType: "person", initial: r?.for },
  { name: "notes", label: "Notes", kind: "longtext", initial: r?.notes },
]

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
        const project = props.prefill?.project
        // A new action starts from the prefill (the inbox's "process by hand" passes the item's text as title).
        const prefill = r === null ? (props.prefill ?? {}) : {}
        const shown = fields(r, project !== undefined).map((f) => (prefill[f.name] === undefined ? f : { ...f, initial: prefill[f.name] }))
        // Opened from a meeting: no field, the meeting is passed on and named in the title.
        const meeting = r === null ? props.prefill?.meeting : undefined
        const add = (v: FormValues) =>
          save(() => {
            const input: Record<string, unknown> = {}
            if (project !== undefined) input.project = project
            if (meeting !== undefined) input.meeting = meeting
            for (const f of shown) {
              const val = v[f.name]
              if (val !== null && val !== undefined) input[f.name] = val
              else if (f.name === "title") input[f.name] = ""
            }
            return rt.self().write.addAction!(input)
          }, "added")
        const edit = async (rec: ActionRecord, v: FormValues): Promise<SubmitResult> => {
          const changed = shown.filter((f) => !same(v[f.name], f.initial)).map((f) => f.name)
          if (changed.length === 0) return { ok: true, ref: rec.ref }
          return save(() => {
            const input: Record<string, unknown> = { ref: rec.ref }
            for (const name of changed) input[name] = v[name] ?? (name === "title" ? "" : null)
            return rt.self().write.editAction!(input)
          }, "saved")
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
