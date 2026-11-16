// The project's record forms: `project` (add, or edit with a recordRef) and `health` (a health update through
// setHealth). Field names are the operations' input names, so a ValidationError shows under its field. Both take
// `prefill` (by field name) and `origin` (provenance), which the inbox uses when it turns an item into a record.
import { createEffect, Show, untrack, type JSX } from "solid-js"
import { act, Form, useQuery, useRuntime, type FieldSpec, type FormValues, type RecordFormProps, type SubmitResult } from "../../../kernel/tui/api"
import { makeStore } from "../logic/records"
import type { ProjectRecord } from "../logic/schema"

export const STATUSES = ["active", "on_hold", "closed"]
export const HEALTHS = ["green", "amber", "red"]

type Write = (input: Record<string, unknown>) => Promise<unknown>

// The input without the keys whose value is undefined (left out, so the operation keeps its default).
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
// A number field: empty is none; text that is no number goes through as NaN, so the operation reports the field.
const number = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v.trim()))
const text = (v: string | number | null | undefined) => (v === null || v === undefined ? null : String(v))

function withPrefill(fields: FieldSpec[], prefill: Record<string, string> | undefined): FieldSpec[] {
  if (!prefill) return fields
  return fields.map((f) => (prefill[f.name] === undefined ? f : { ...f, initial: prefill[f.name] }))
}

// Loads the project behind `recordRef` (null without one) and renders `children` once it is there. A ref that
// does not load closes the form (useQuery has shown the error). Live reloads do not rebuild the form: its fields
// keep what was typed.
function WithProject(props: { recordRef?: string; close(): void; children: (p: ProjectRecord | null) => JSX.Element }) {
  const store = makeStore(useRuntime())
  const q = useQuery(async () => (props.recordRef === undefined ? null : store.project(props.recordRef)))
  createEffect(() => {
    if (q.error() !== undefined && q.data() === undefined) props.close()
  })
  return <Show when={q.data() !== undefined}>{untrack(() => props.children(q.data()!))}</Show>
}

// Runs one write with act() and turns its result into the form's SubmitResult.
async function save(run: () => Promise<unknown>, props: RecordFormProps, verb: string): Promise<SubmitResult> {
  const r = await act(run, { origin: props.origin, ok: (out) => `${verb} ${(out as { ref: string }).ref}` })
  return r.ok ? { ok: true, ref: (r.value as { ref: string }).ref } : r
}

export function ProjectForm(props: RecordFormProps) {
  const rt = useRuntime()
  const write = (op: string): Write => rt.self().write[op]! as Write
  return (
    <WithProject recordRef={props.recordRef} close={props.close}>
      {(p) => {
        const fields: FieldSpec[] = [
          ...(p === null ? [{ name: "code", label: "Code", kind: "text" as const, required: true }] : []),
          { name: "name", label: "Name", kind: "text", required: true, initial: p?.name },
          { name: "description", label: "Description", kind: "longtext", initial: p?.description },
          { name: "status", label: "Status", kind: "enum", values: STATUSES, required: true, initial: p?.status },
          { name: "startDate", label: "Start", kind: "date", initial: p?.start_date },
          { name: "endDate", label: "End", kind: "date", initial: p?.end_date },
          { name: "effortDays", label: "Effort days", kind: "number", initial: text(p?.effort_estimate_days) },
          { name: "effortNote", label: "Effort note", kind: "text", initial: p?.effort_note },
        ]
        const add = (v: FormValues) =>
          save(
            () =>
              write("addProject")(
                defined({
                  code: v.code ?? "",
                  name: v.name ?? "",
                  status: v.status ?? undefined,
                  description: v.description ?? undefined,
                  startDate: v.startDate ?? undefined,
                  endDate: v.endDate ?? undefined,
                  effortDays: number(v.effortDays) ?? undefined,
                  effortNote: v.effortNote ?? undefined,
                }),
              ),
            props,
            "added",
          )
        // An edit sends only the fields that changed, so its change line names just those (as the CLI's does);
        // with no change it closes without a write.
        const edit = (project: ProjectRecord, v: FormValues): Promise<SubmitResult> => {
          const changed = fields.filter((f) => (v[f.name] ?? null) !== (f.initial ?? null)).map((f) => f.name)
          if (changed.length === 0) return Promise.resolve({ ok: true, ref: project.ref })
          const input: Record<string, unknown> = { project: project.ref }
          for (const name of changed) input[name] = name === "effortDays" ? number(v[name]) : name === "name" ? (v.name ?? "") : v[name]
          return save(() => write("editProject")(input), props, "saved")
        }
        const submit = (v: FormValues) => (p === null ? add(v) : edit(p, v))
        return <Form title={p === null ? "New project" : `Edit ${p.code}`} fields={withPrefill(fields, props.prefill)} submit={submit} close={props.close} />
      }}
    </WithProject>
  )
}

// A health update. With a recordRef the project is fixed (it is in the title); without one, a project field asks.
export function HealthForm(props: RecordFormProps) {
  const rt = useRuntime()
  return (
    <WithProject recordRef={props.recordRef} close={props.close}>
      {(p) => {
        const fields: FieldSpec[] = [
          ...(p === null ? [{ name: "project", label: "Project", kind: "record" as const, recordType: "project", required: true }] : []),
          { name: "health", label: "Health", kind: "enum", values: HEALTHS, required: true, initial: p?.health },
          { name: "comment", label: "Comment", kind: "text" },
          { name: "date", label: "Date", kind: "date", initial: rt.clock.today() },
        ]
        const submit = (v: FormValues) =>
          save(
            () =>
              (rt.self().write.setHealth! as Write)(
                defined({ project: p?.ref ?? v.project ?? "", health: v.health ?? undefined, comment: v.comment ?? undefined, date: v.date ?? undefined }),
              ),
            props,
            "health updated on",
          )
        return <Form title={p === null ? "Health update" : `Health update · ${p.code}`} fields={withPrefill(fields, props.prefill)} submit={submit} close={props.close} />
      }}
    </WithProject>
  )
}
