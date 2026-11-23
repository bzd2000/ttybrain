// The talk-item form (record type `talk_item`, form `talk`), in the designs' form look as the series form draws it: a
// rounded panel, a 14-cell label column, only the focused field as an input, `ctrl+s save · esc cancel` on the
// bottom border and `tab field` in the bar. No design draws this form; it follows the series form.
// - New (no recordRef): About (a person or project; `prefill.about` fills it in, as `t` and `n` do from a person,
//   a project or an upcoming meeting, and the form then starts on Text), shown as `Anna Peeters · person`; Text;
//   Project, for a person's item (it then also shows at that project's meetings). Saved with addTalk.
// - Edit (recordRef `T-n`): Text and Project of an item; only what changed is sent (editTalk).
import { Form, useRuntime, type FieldSpec, type FormValues, type RecordFormProps, type SubmitResult } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import type { SubjectType, TalkRecord } from "../logic/schema"
import { defined, save, With } from "./forms"

export const TALK_TITLE = "New talk item"
const LOOK = { labelWidth: 14, tabLabel: "field" }
const FOOTER = "ctrl+s save · esc cancel"
const given = (v: string | null | undefined) => (v === null || v === undefined || v.trim() === "" ? undefined : v)

export function TalkForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  // An edit's item, from its subject's talk-list (only open items are edited here).
  const load = async (): Promise<TalkRecord | null> => {
    if (props.recordRef === undefined) return null
    const id = await store.talkId(props.recordRef)
    const r = id === null ? undefined : await rt.data.selectFrom("talk_item").select(["subject_type", "subject_id"]).where("id", "=", id).executeTakeFirst()
    if (!r) throw new Error(`unknown talk item "${props.recordRef}"`)
    const about = await store.subjectRef(r.subject_type as SubjectType, Number(r.subject_id))
    const list = (await rt.self().read.talkList!({ about })) as { open: TalkRecord[]; carried: TalkRecord[] }
    const found = [...list.open, ...list.carried].find((t) => t.id === id)
    if (!found) throw new Error(`${props.recordRef} is not open`)
    return found
  }
  return (
    <With load={load} close={props.close}>
      {(t: TalkRecord | null) => {
        if (t !== null) {
          const fields: FieldSpec[] = [
            { name: "text", label: "Text", kind: "text", required: true, initial: t.text },
            { name: "project", label: "Project", kind: "record", recordType: "project", initial: t.project },
          ]
          const submit = (v: FormValues): Promise<SubmitResult> => {
            const input: Record<string, unknown> = { ref: t.ref }
            if ((v.text ?? "") !== t.text) input.text = v.text ?? ""
            if ((given(v.project) ?? null) !== (t.project ?? null)) input.project = given(v.project) ?? null
            if (Object.keys(input).length === 1) return Promise.resolve({ ok: true, ref: t.ref })
            return save(() => rt.self().write.editTalk!(input), props, "saved", { project: "project" })
          }
          return <Form title={`Edit ${t.ref}`} fields={fields} look={LOOK} footer={FOOTER} submit={submit} close={props.close} />
        }
        const fields: FieldSpec[] = [
          { name: "about", label: "About", kind: "refs", required: true, show: "labelType", initial: props.prefill?.about },
          { name: "text", label: "Text", kind: "text", required: true, initial: props.prefill?.text },
          { name: "project", label: "Project", kind: "record", recordType: "project", initial: props.prefill?.project },
        ]
        const submit = (v: FormValues) =>
          save(
            () => rt.self().write.addTalk!(defined({ about: (v.about ?? "").trim(), text: v.text ?? "", project: given(v.project) })),
            props,
            "added",
            { project: "project", about: "about" },
          )
        const start = props.prefill?.about === undefined ? undefined : "text"
        return <Form title={TALK_TITLE} fields={fields} look={LOOK} footer={FOOTER} {...(start ? { start } : {})} submit={submit} close={props.close} />
      }}
    </With>
  )
}
