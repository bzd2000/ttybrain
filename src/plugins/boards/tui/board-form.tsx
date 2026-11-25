// The board form (record type `board`): Code, Name and Note, an add without a recordRef or an edit with one. Field
// names are the operations' input names, so a ValidationError (a code a project has) shows under its field. An edit
// starts on the name and sends only the fields that changed; with no change it closes without a write.
import { createEffect, Show, untrack } from "solid-js"
import { act, Form, useQuery, useRuntime, type FieldSpec, type FormValues, type RecordFormProps, type SubmitResult } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import type { BoardRecord } from "../logic/schema"

type Write = (input: Record<string, unknown>) => Promise<unknown>

async function save(run: () => Promise<unknown>, props: RecordFormProps, verb: string): Promise<SubmitResult> {
  const r = await act(run, { origin: props.origin, ok: (out) => `${verb} ${(out as { ref: string }).ref}` })
  return r.ok ? { ok: true, ref: (r.value as { ref: string }).ref } : r
}

export function BoardForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const write = (op: string): Write => rt.self().write[op]! as Write
  // A ref that does not load closes the form (useQuery has shown the error); live reloads keep what was typed.
  const q = useQuery(async () => (props.recordRef === undefined ? null : store.board(props.recordRef)))
  createEffect(() => {
    if (q.error() !== undefined && q.data() === undefined) props.close()
  })
  const form = (b: BoardRecord | null) => {
    const fields: FieldSpec[] = [
      { name: "code", label: "Code", kind: "text", required: true, initial: b?.code ?? props.prefill?.code },
      { name: "name", label: "Name", kind: "text", required: true, initial: b?.name ?? props.prefill?.name },
      { name: "note", label: "Note", kind: "text", initial: b?.note ?? props.prefill?.note },
    ]
    const submit = (v: FormValues): Promise<SubmitResult> => {
      if (b === null) {
        const note = v.note ?? ""
        return save(() => write("addBoard")({ code: v.code ?? "", name: v.name ?? "", ...(note.trim() === "" ? {} : { note }) }), props, "added")
      }
      const changed = fields.filter((f) => (v[f.name] ?? null) !== (f.initial ?? null)).map((f) => f.name)
      if (changed.length === 0) return Promise.resolve({ ok: true, ref: b.ref })
      const input: Record<string, unknown> = { board: b.ref }
      for (const name of changed) input[name] = name === "note" ? (v.note ?? null) : (v[name] ?? "")
      return save(() => write("editBoard")(input), props, "saved")
    }
    return (
      <Form
        title={b === null ? "New board" : `Edit ${b.code}`}
        fields={fields}
        {...(b === null ? {} : { start: "name" })}
        submit={submit}
        close={props.close}
      />
    )
  }
  return <Show when={q.data() !== undefined}>{untrack(() => form(q.data()!))}</Show>
}
