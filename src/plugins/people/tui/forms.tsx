// The people plugin's record forms: `person`, `note` and `goal` (each an add, or an edit with a recordRef). Field
// names are the operations' input names, so a ValidationError shows under its field. `prefill` (by field name)
// and `origin` (provenance) come from whoever opens the form: a person's tab, or the inbox turning an item into a
// note. An edit sends only the fields that changed, and closes without a write when nothing did.
import { createEffect, Show, untrack, type JSX } from "solid-js"
import { act, Form, useQuery, useRuntime, type FieldSpec, type FormValues, type RecordFormProps, type SubmitResult } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import type { GoalRecord, NoteRecord, PersonRecord } from "../logic/schema"

type Write = (input: Record<string, unknown>) => Promise<unknown>

const TYPES = ["stakeholder", "team", "both", "other"]
const FLAGS: Record<string, { is_team: boolean; is_stakeholder: boolean }> = {
  stakeholder: { is_team: false, is_stakeholder: true },
  team: { is_team: true, is_stakeholder: false },
  both: { is_team: true, is_stakeholder: true },
  other: { is_team: false, is_stakeholder: false },
}
const typeOf = (p: { is_team: boolean; is_stakeholder: boolean }) => TYPES.find((t) => FLAGS[t]!.is_team === p.is_team && FLAGS[t]!.is_stakeholder === p.is_stakeholder)!

const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
// A value for an optional field: undefined (left out) when empty.
const given = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? undefined : v)

function withPrefill(fields: FieldSpec[], prefill: Record<string, string> | undefined): FieldSpec[] {
  if (!prefill) return fields
  return fields.map((f) => (prefill[f.name] === undefined ? f : { ...f, initial: prefill[f.name] }))
}

// The names of the fields whose value differs from where the form started.
const changedFields = (fields: FieldSpec[], v: FormValues) => fields.filter((f) => (v[f.name] ?? null) !== (f.initial ?? null)).map((f) => f.name)

// Loads what `load` returns (null: nothing to load) and renders `children` once it is there. A load that fails
// closes the form (useQuery has shown the error). Live reloads do not rebuild the form: its fields keep what was typed.
function With<T>(props: { load: () => Promise<T | null>; close(): void; children: (loaded: T | null) => JSX.Element }) {
  const q = useQuery(props.load)
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

const personField = (): FieldSpec => ({ name: "person", label: "Person", kind: "record", recordType: "person", required: true })

export function PersonForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const write = (op: string): Write => rt.self().write[op]! as Write
  return (
    <With load={async () => (props.recordRef === undefined ? null : store.person(props.recordRef))} close={props.close}>
      {(p: PersonRecord | null) => {
        const fields: FieldSpec[] = [
          { name: "name", label: "Name", kind: "text", required: true, initial: p?.name },
          { name: "handle", label: "Handle", kind: "text", initial: p?.handle },
          { name: "type", label: "Type", kind: "enum", values: TYPES, required: true, initial: p === null ? "stakeholder" : typeOf(p) },
          { name: "influence", label: "Influence", kind: "enum", values: ["low", "high"], initial: p?.influence },
          { name: "interest", label: "Interest", kind: "enum", values: ["low", "high"], initial: p?.interest },
          { name: "job_title", label: "Job title", kind: "text", initial: p?.job_title },
          { name: "organisation", label: "Organisation", kind: "text", initial: p?.organisation },
          { name: "email", label: "Email", kind: "text", initial: p?.email },
          { name: "phone", label: "Phone", kind: "text", initial: p?.phone },
        ]
        const OPTIONAL = ["influence", "interest", "job_title", "organisation", "email", "phone"]
        const add = (v: FormValues) =>
          save(
            () =>
              write("addPerson")(
                defined({
                  name: v.name ?? "",
                  handle: given(v.handle),
                  ...FLAGS[v.type ?? "stakeholder"],
                  ...Object.fromEntries(OPTIONAL.map((n) => [n, given(v[n])])),
                }),
              ),
            props,
            "added",
          )
        const edit = (person: PersonRecord, v: FormValues): Promise<SubmitResult> => {
          const changed = changedFields(fields, v)
          if (changed.length === 0) return Promise.resolve({ ok: true, ref: person.ref })
          const input: Record<string, unknown> = { ref: person.ref }
          for (const name of changed) {
            if (name === "type") Object.assign(input, FLAGS[v.type ?? "stakeholder"])
            else if (name === "name" || name === "handle") input[name] = v[name] ?? ""
            else input[name] = given(v[name]) ?? null
          }
          return save(() => write("editPerson")(input), props, "saved")
        }
        return (
          <Form
            title={p === null ? "New person" : `Edit ${p.ref}`}
            fields={withPrefill(fields, props.prefill)}
            recordType="person"
            {...(p === null ? {} : { recordRef: p.ref })}
            submit={(v) => (p === null ? add(v) : edit(p, v))}
            close={props.close}
          />
        )
      }}
    </With>
  )
}

type NoteLoad = { note: NoteRecord | null; person: PersonRecord | null; project: string | null }

export function NoteForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const write = (op: string): Write => rt.self().write[op]! as Write
  const load = async (): Promise<NoteLoad> => {
    if (props.recordRef !== undefined) {
      const note = await store.note(props.recordRef)
      const code = note.project_id === null ? undefined : (await store.projectCodes([note.project_id])).get(note.project_id)
      return { note, person: null, project: code === undefined ? null : `#${code}` }
    }
    return { note: null, person: props.prefill?.person === undefined ? null : await store.person(props.prefill.person), project: null }
  }
  return (
    <With load={load} close={props.close}>
      {(l: NoteLoad | null) => {
        const { note, person, project } = l!
        const fixed = person !== null // a prefilled person: not asked
        const teamOnly = person !== null && person.is_team && !person.is_stakeholder
        const fields: FieldSpec[] = [
          ...(note === null && !fixed ? [personField()] : []),
          { name: "kind", label: "Kind", kind: "enum", values: ["interaction", "one_on_one"], required: true, initial: note?.kind ?? (teamOnly ? "one_on_one" : "interaction") },
          { name: "date", label: "Date", kind: "date", initial: note?.date ?? rt.clock.today() },
          { name: "project", label: "Project", kind: "record", recordType: "project", initial: project },
          { name: "text", label: "Text", kind: "longtext", required: true, initial: note?.text },
        ]
        const add = (v: FormValues) =>
          save(
            () =>
              write("addNote")(
                defined({ person: person?.ref ?? v.person ?? "", kind: v.kind ?? "interaction", text: v.text ?? "", date: given(v.date), project: given(v.project) }),
              ),
            props,
            "added",
          )
        const edit = (n: NoteRecord, v: FormValues, shown: FieldSpec[]): Promise<SubmitResult> => {
          const changed = changedFields(shown, v)
          if (changed.length === 0) return Promise.resolve({ ok: true, ref: n.ref })
          const input: Record<string, unknown> = { ref: n.ref }
          for (const name of changed) input[name] = name === "project" ? given(v.project) ?? null : (v[name] ?? "")
          return save(() => write("editNote")(input), props, "saved")
        }
        const shown = withPrefill(fields, props.prefill)
        return (
          <Form
            title={note !== null ? `Edit ${note.ref}` : person !== null ? `New note · ${person.ref}` : "New note"}
            fields={shown}
            submit={(v) => (note === null ? add(v) : edit(note, v, shown))}
            close={props.close}
          />
        )
      }}
    </With>
  )
}

type GoalLoad = { goal: GoalRecord | null; person: PersonRecord | null }

export function GoalForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const write = (op: string): Write => rt.self().write[op]! as Write
  const load = async (): Promise<GoalLoad> => {
    if (props.recordRef !== undefined) return { goal: await store.goal(props.recordRef), person: null }
    return { goal: null, person: props.prefill?.person === undefined ? null : await store.person(props.prefill.person) }
  }
  return (
    <With load={load} close={props.close}>
      {(l: GoalLoad | null) => {
        const { goal, person } = l!
        const fields: FieldSpec[] = [
          ...(goal === null && person === null ? [personField()] : []),
          { name: "title", label: "Title", kind: "text", required: true, initial: goal?.title },
          { name: "target_date", label: "Target date", kind: "date", initial: goal?.target_date },
          { name: "notes", label: "Notes", kind: "longtext", initial: goal?.notes },
        ]
        const add = (v: FormValues) =>
          save(
            () => write("addGoal")(defined({ person: person?.ref ?? v.person ?? "", title: v.title ?? "", target_date: given(v.target_date), notes: given(v.notes) })),
            props,
            "added",
          )
        const edit = (g: GoalRecord, v: FormValues): Promise<SubmitResult> => {
          const changed = changedFields(fields, v)
          if (changed.length === 0) return Promise.resolve({ ok: true, ref: g.ref })
          const input: Record<string, unknown> = { ref: g.ref }
          for (const name of changed) input[name] = name === "title" ? (v.title ?? "") : (given(v[name]) ?? null)
          return save(() => write("editGoal")(input), props, "saved")
        }
        return (
          <Form
            title={goal !== null ? `Edit ${goal.ref}` : person !== null ? `New goal · ${person.ref}` : "New goal"}
            fields={withPrefill(fields, props.prefill)}
            submit={(v) => (goal === null ? add(v) : edit(goal, v))}
            close={props.close}
          />
        )
      }}
    </With>
  )
}
