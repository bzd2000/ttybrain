// The Actions screen's `d` form: one date field calling editAction({ due }). Saving an unchanged date writes nothing;
// an empty date clears the due date.
import { createEffect, Show, untrack } from "solid-js"
import { act, Form, useQuery, useRuntime, type RecordFormProps, type SubmitResult } from "../../../kernel/tui/api"
import { makeItems } from "../logic/items"
import { makeStore } from "../logic/records"

export function DueForm(props: RecordFormProps) {
  const rt = useRuntime()
  const items = makeItems(rt, makeStore(rt))
  const q = useQuery(async () => (props.recordRef === undefined ? undefined : await items.find("action", props.recordRef)))
  createEffect(() => {
    if (props.recordRef === undefined || (q.error() !== undefined && q.data() === undefined)) props.close()
  })
  return (
    <Show when={q.data() !== undefined}>
      {untrack(() => {
        const a = q.data()!
        const submit = async (v: { due?: string | null }): Promise<SubmitResult> => {
          const due = v.due ?? null
          if (due === a.due_date) return { ok: true, ref: a.ref }
          const res = await act(() => rt.self().write.editAction!({ ref: a.ref, due }), { origin: props.origin, ok: () => `saved ${a.ref}` })
          return res.ok ? { ok: true, ref: a.ref } : res
        }
        return <Form title={`Due date of ${a.ref}`} fields={[{ name: "due", label: "Due", kind: "date", initial: a.due_date }]} submit={submit} close={props.close} />
      })}
    </Show>
  )
}
