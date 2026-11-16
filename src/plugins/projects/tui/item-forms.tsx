// The record forms of the five item kinds (milestone, deliverable, risk, decision, action), add and edit, from one
// factory configured per kind. Field names are the operations' input names, so a ValidationError lands under its
// field. With `prefill.project` the project is set and its field left out. An edit sends only the changed fields.
import { createEffect, Show, untrack } from "solid-js"
import { act, Form, useQuery, useRuntime, type FieldSpec, type FormValues, type RecordFormProps, type SubmitResult } from "../../../kernel/tui/api"
import { makeItems, type Kind } from "../logic/items"
import { makeStore } from "../logic/records"

type Rec = Record<string, any>
type Write = (input: Record<string, unknown>) => Promise<any>

type KindForm = {
  kind: Kind
  label: string
  // The fields; `r` is the record being edited (null when adding), `hasProject` whether the project is fixed.
  fields(r: Rec | null, today: string, hasProject: boolean): FieldSpec[]
  addOp: string
  editOp: string
  // The op input names whose empty value is `""` rather than null (their input type has no null).
  required: string[]
  // Fields written by another operation than add/edit: `after` runs after a save (milestone `done`, deliverable status).
  extra?: string[]
  afterWrite?(write: (op: string) => Write, ref: string, v: FormValues, changed: Set<string> | null): Promise<void>
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null)
const RISK_TYPES = ["risk", "issue"]
const SEVERITIES = ["low", "medium", "high"]
const STATUSES = ["not_started", "in_progress", "in_review", "delivered"]

const KINDS: Record<Kind, KindForm> = {
  milestone: {
    kind: "milestone",
    label: "Milestone",
    fields: (r) => [
      { name: "title", label: "Title", kind: "text", required: true, initial: r?.title },
      { name: "due", label: "Due", kind: "date", required: true, initial: r?.due_date },
      { name: "done", label: "Done", kind: "date", initial: r?.done_date },
    ],
    addOp: "addMilestone",
    editOp: "editMilestone",
    required: ["title", "due"],
    extra: ["done"],
    afterWrite: async (write, ref, v, changed) => {
      if ((changed === null || changed.has("done")) && v.done) await write("completeMilestone")({ ref, date: v.done })
    },
  },
  deliverable: {
    kind: "deliverable",
    label: "Deliverable",
    fields: (r) => [
      { name: "title", label: "Title", kind: "text", required: true, initial: r?.title },
      { name: "owner", label: "Owner", kind: "record", recordType: "person", initial: r?.owner },
      { name: "due", label: "Due", kind: "date", initial: r?.due_date },
      { name: "status", label: "Status", kind: "enum", values: STATUSES, required: true, initial: r?.status },
      { name: "milestone", label: "Milestone", kind: "record", recordType: "milestone", initial: r?.milestone },
    ],
    addOp: "addDeliverable",
    editOp: "editDeliverable",
    required: ["title"],
    extra: ["status"],
    afterWrite: async (write, ref, v, changed) => {
      if (changed !== null && changed.has("status") && v.status) await write("setDeliverableStatus")({ ref, status: v.status })
    },
  },
  risk: {
    kind: "risk",
    label: "Risk / issue",
    fields: (r) => [
      { name: "type", label: "Type", kind: "enum", values: RISK_TYPES, required: true, initial: r?.type },
      { name: "title", label: "Title", kind: "text", required: true, initial: r?.title },
      { name: "description", label: "Description", kind: "longtext", initial: r?.description },
      { name: "severity", label: "Severity", kind: "enum", values: SEVERITIES, required: true, initial: r?.severity ?? "medium" },
      { name: "owner", label: "Owner", kind: "record", recordType: "person", initial: r?.owner },
      { name: "mitigation", label: "Mitigation", kind: "text", initial: r?.mitigation },
    ],
    addOp: "addRisk",
    editOp: "editRisk",
    required: ["title", "type", "severity"],
  },
  decision: {
    kind: "decision",
    label: "Decision",
    fields: (r, today) => [
      { name: "date", label: "Date", kind: "date", initial: r?.date ?? today },
      { name: "title", label: "Title", kind: "text", required: true, initial: r?.title },
      { name: "description", label: "Description", kind: "longtext", initial: r?.description },
      { name: "decidedBy", label: "Decided by", kind: "text", initial: r?.decided_by },
    ],
    addOp: "addDecision",
    editOp: "editDecision",
    required: ["title", "date"],
  },
  action: {
    kind: "action",
    label: "Action",
    fields: (r, _t, hasProject) => [
      { name: "title", label: "Title", kind: "text", required: true, initial: r?.title },
      { name: "due", label: "Due", kind: "date", initial: r?.due_date },
      { name: "owner", label: "Owner (empty = me)", kind: "record", recordType: "person", initial: r?.owner },
      ...(hasProject ? [] : [{ name: "project", label: "Project", kind: "record" as const, recordType: "project", initial: r?.project }]),
      { name: "forPerson", label: "For", kind: "record", recordType: "person", initial: r?.for },
      { name: "notes", label: "Notes", kind: "longtext", initial: r?.notes },
    ],
    addOp: "addAction",
    editOp: "editAction",
    required: ["title"],
  },
}

// Loads the record behind `recordRef` (null without one); a ref that does not load closes the form.
function WithRecord(props: { kind: Kind; recordRef?: string; close(): void; children: (r: Rec | null) => any }) {
  const rt = useRuntime()
  const items = makeItems(rt, makeStore(rt))
  const q = useQuery(async () => (props.recordRef === undefined ? null : ((await items.find(props.kind, props.recordRef)) as Rec)))
  createEffect(() => {
    if (q.error() !== undefined && q.data() === undefined) props.close()
  })
  return <Show when={q.data() !== undefined}>{untrack(() => props.children(q.data()!))}</Show>
}

function itemForm(spec: KindForm) {
  return function ItemForm(props: RecordFormProps) {
    const rt = useRuntime()
    const write = (op: string): Write => rt.self().write[op]! as Write
    const today = rt.clock.today()
    return (
      <WithRecord kind={spec.kind} recordRef={props.recordRef} close={props.close}>
        {(r) => {
          const project = props.prefill?.project
          // A kind that carries its project (everything but the action's optional one) takes it from the prefill.
          const fields = spec.fields(r, today, project !== undefined)
          const noun = spec.label.toLowerCase()
          const save = async (run: () => Promise<any>, verb: string): Promise<SubmitResult> => {
            const res = await act(run, { origin: props.origin, ok: (out) => `${verb} ${(out as { ref: string }).ref}` })
            return res.ok ? { ok: true, ref: (res.value as { ref: string }).ref } : res
          }
          const add = (v: FormValues) =>
            save(async () => {
              const input: Record<string, unknown> = {}
              if (project !== undefined) input.project = project
              else if (spec.kind !== "decision" && spec.kind !== "action") input.project = ""
              for (const f of fields) {
                if (f.name === "done") continue
                const val = v[f.name]
                if (val !== null && val !== undefined) input[f.name] = val
                else if (spec.required.includes(f.name)) input[f.name] = ""
              }
              const out = await write(spec.addOp)(input)
              await spec.afterWrite?.(write, out.ref, v, null)
              return out
            }, "added")
          const edit = async (rec: Rec, v: FormValues): Promise<SubmitResult> => {
            const changed = new Set(fields.filter((f) => !same(v[f.name], f.initial)).map((f) => f.name))
            if (changed.size === 0) return { ok: true, ref: rec.ref }
            if (changed.has("done") && !v.done) return { ok: false, error: new Error("a done milestone cannot be reopened here") }
            return save(async () => {
              const input: Record<string, unknown> = { ref: rec.ref }
              for (const name of changed) {
                if (spec.extra?.includes(name)) continue
                input[name] = v[name] ?? (spec.required.includes(name) ? "" : null)
              }
              const out = Object.keys(input).length > 1 ? await write(spec.editOp)(input) : rec
              await spec.afterWrite?.(write, rec.ref, v, changed)
              return { ref: rec.ref, ...(out as object) }
            }, "saved")
          }
          return (
            <Form
              title={r === null ? `New ${noun}` : `Edit ${r.ref}`}
              fields={fields}
              submit={(v) => (r === null ? add(v) : edit(r, v))}
              close={props.close}
            />
          )
        }}
      </WithRecord>
    )
  }
}

export const MilestoneForm = itemForm(KINDS.milestone)
export const DeliverableForm = itemForm(KINDS.deliverable)
export const RiskForm = itemForm(KINDS.risk)
export const DecisionForm = itemForm(KINDS.decision)
export const ActionForm = itemForm(KINDS.action)
export const ITEM_FORMS = { milestone: MilestoneForm, deliverable: DeliverableForm, risk: RiskForm, decision: DecisionForm, action: ActionForm }
export const FORM_LABELS = Object.fromEntries(Object.values(KINDS).map((k) => [k.kind, k.label])) as Record<Kind, string>
