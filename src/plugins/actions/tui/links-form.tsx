// The `l` form (record type "action", form id "links"): the action's links in one refs field, autocompleted as in
// quick capture (`#` projects, `@` people, `M-` meetings). Saving removes the links taken out and adds the ones
// typed (links.ts), in one act; an error (an archived project, an unknown ref) shows under the field and nothing is
// written. Unchanged links close the form without a write.
import { createEffect, Show, untrack } from "solid-js"
import { act, Form, useQuery, useRuntime, type RecordFormProps, type SubmitResult } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import { linkChanges, linkWords, words, writeLinks } from "./links"

export const LINKS_LABEL = "Links"

export function LinksForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const q = useQuery(async () => (props.recordRef === undefined ? undefined : await store.find(props.recordRef)))
  createEffect(() => {
    if (props.recordRef === undefined || (q.error() !== undefined && q.data() === undefined)) props.close()
  })
  return (
    <Show when={q.data() !== undefined}>
      {untrack(() => {
        const a = q.data()!
        const before = linkWords(a)
        const submit = async (v: { links?: string | null }): Promise<SubmitResult> => {
          const changes = linkChanges(before, words(v.links))
          if (changes.removed.length === 0 && changes.added.length === 0) return { ok: true, ref: a.ref }
          const res = await act(() => writeLinks(rt.self().write, a.ref, changes), { origin: props.origin, ok: () => `saved ${a.ref}` })
          return res.ok ? { ok: true, ref: a.ref } : { ok: false, error: res.error, field: "links" }
        }
        return (
          <Form
            title={`Links of ${a.ref}`}
            fields={[{ name: "links", label: LINKS_LABEL, kind: "refs", initial: before.join(" ") }]}
            submit={submit}
            close={props.close}
          />
        )
      })}
    </Show>
  )
}
