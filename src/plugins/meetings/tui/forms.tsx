// The meetings plugin's record forms on the record type `meeting`: `meeting` (an add, or an edit with a
// recordRef), `agenda-item` (recordRef the meeting; an edit names its position in `prefill.item`) and `attendees`.
// Attendees and projects are typed as tags separated by spaces and/or commas (`@marie, @luc`, `#CRM #ERP`); the
// `@` and `#` are optional. An unknown person or project shows under its field. An edit sends only the fields that
// changed, and closes without a write when nothing did.
import { createEffect, Show, untrack, type JSX } from "solid-js"
import { act, Form, useQuery, useRuntime, type FieldSpec, type FormValues, type RecordFormProps, type SubmitResult } from "@pm/api/tui"
import { makeStore } from "../logic/records"
import type { AgendaItem, MeetingRecord } from "../logic/schema"

type Write = (input: Record<string, unknown>) => Promise<unknown>

const KINDS = ["steering", "board", "other"]
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
// A value for an optional field: undefined (left out) when empty.
const given = (v: string | null | undefined) => (v === null || v === undefined || v.trim() === "" ? undefined : v)

// The tags of a field, without their `@` or `#`.
export const tags = (v: string | null | undefined): string[] =>
  (v ?? "")
    .split(/[\s,]+/)
    .map((t) => t.replace(/^[@#]/, ""))
    .filter((t) => t !== "")
const sameTags = (a: string[], b: string[]) => [...a].sort().join(" ") === [...b].sort().join(" ")

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

// The field an unknown person or project belongs under (the operations name none for these lookups).
type Lookups = { person?: string; project?: string }
function fieldOf(error: unknown, lookups: Lookups): string | undefined {
  const m = error instanceof Error ? /\bunknown (person|project)\b/.exec(error.message) : null
  return m ? lookups[m[1] as keyof Lookups] : undefined
}

// Runs the writes with one act() and turns its result into the form's SubmitResult.
async function save(run: () => Promise<unknown>, props: RecordFormProps, verb: string, lookups: Lookups = {}): Promise<SubmitResult> {
  const r = await act(run, { origin: props.origin, ok: (out) => `${verb} ${(out as { ref: string }).ref}` })
  if (r.ok) return { ok: true, ref: (r.value as { ref: string }).ref }
  const field = fieldOf(r.error, lookups)
  return field === undefined ? r : { ...r, field }
}

const attendeesField = (m: MeetingRecord | null): FieldSpec => ({ name: "attendees", label: "Attendees", kind: "text", initial: m === null ? null : m.attendees.join(" ") })

export function MeetingForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const write = (op: string): Write => rt.self().write[op]! as Write
  return (
    <With load={async () => (props.recordRef === undefined ? null : store.meeting(props.recordRef))} close={props.close}>
      {(m: MeetingRecord | null) => {
        const fields: FieldSpec[] = [
          { name: "title", label: "Title", kind: "text", required: true, initial: m?.title },
          { name: "date", label: "Date", kind: "date", required: true, initial: m?.date ?? rt.clock.today() },
          { name: "kind", label: "Kind", kind: "enum", values: KINDS, required: true, initial: m?.kind ?? "steering" },
          { name: "sinceDate", label: "Since", kind: "date", initial: m?.since_date },
          attendeesField(m),
          ...(m === null ? [{ name: "projects", label: "Projects", kind: "text" as const }] : []),
        ]
        const add = (v: FormValues) =>
          save(
            () =>
              write("addMeeting")(
                defined({
                  title: v.title ?? "",
                  date: v.date ?? "",
                  kind: v.kind ?? "steering",
                  sinceDate: given(v.sinceDate),
                  attendees: tags(v.attendees),
                  projects: tags(v.projects),
                }),
              ),
            props,
            "added",
            { person: "attendees", project: "projects" },
          )
        const edit = (meeting: MeetingRecord, v: FormValues): Promise<SubmitResult> => {
          const changed = changedFields(fields, v).filter((n) => n !== "attendees")
          const people = tags(v.attendees)
          const attendees = !sameTags(people, tags(attendeesField(meeting).initial))
          if (changed.length === 0 && !attendees) return Promise.resolve({ ok: true, ref: meeting.ref })
          const input: Record<string, unknown> = { ref: meeting.ref }
          for (const name of changed) input[name] = name === "sinceDate" ? (given(v.sinceDate) ?? null) : (v[name] ?? "")
          return save(
            async () => {
              let out: unknown
              if (changed.length > 0) out = await write("editMeeting")(input)
              if (attendees) out = await write("setAttendees")({ meeting: meeting.ref, people })
              return out
            },
            props,
            "saved",
            { person: "attendees" },
          )
        }
        return (
          <Form
            title={m === null ? "New meeting" : `Edit ${m.ref}`}
            fields={withPrefill(fields, props.prefill)}
            recordType="meeting"
            {...(m === null ? {} : { recordRef: m.ref })}
            submit={(v) => (m === null ? add(v) : edit(m, v))}
            close={props.close}
          />
        )
      }}
    </With>
  )
}

type ItemLoad = { meeting: MeetingRecord; item: AgendaItem | null }

export function AgendaItemForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const write = (op: string): Write => rt.self().write[op]! as Write
  const load = async (): Promise<ItemLoad> => {
    const meeting = await store.meeting(props.recordRef ?? "")
    const n = props.prefill?.item
    if (n === undefined) return { meeting, item: null }
    const item = meeting.agenda.find((a) => String(a.position) === n.trim())
    if (item === undefined) throw new Error(`${meeting.ref} has no item ${n}`)
    return { meeting, item }
  }
  return (
    <With load={load} close={props.close}>
      {(l: ItemLoad | null) => {
        const { meeting, item } = l!
        const fields: FieldSpec[] = [
          { name: "text", label: "Text", kind: "text", required: true, initial: item?.text },
          { name: "project", label: "Project", kind: "record", recordType: "project", initial: item?.project },
          { name: "ask", label: "Ask", kind: "longtext", initial: item?.ask },
        ]
        const add = (v: FormValues) =>
          save(
            () => write("addAgendaItem")(defined({ meeting: meeting.ref, text: v.text ?? "", project: given(v.project), ask: given(v.ask) })),
            props,
            "added",
            { project: "project" },
          )
        const edit = (it: AgendaItem, v: FormValues): Promise<SubmitResult> => {
          const changed = changedFields(fields, v)
          if (changed.length === 0) return Promise.resolve({ ok: true, ref: meeting.ref })
          const input: Record<string, unknown> = { meeting: meeting.ref, item: it.position }
          for (const name of changed) input[name] = name === "text" ? (v.text ?? "") : (given(v[name]) ?? null)
          return save(() => write("editAgendaItem")(input), props, "saved", { project: "project" })
        }
        return (
          <Form
            title={item === null ? `New agenda item · ${meeting.ref}` : `Edit item ${item.position} · ${meeting.ref}`}
            fields={withPrefill(fields, props.prefill)}
            submit={(v) => (item === null ? add(v) : edit(item, v))}
            close={props.close}
          />
        )
      }}
    </With>
  )
}

export function AttendeesForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const write = (op: string): Write => rt.self().write[op]! as Write
  return (
    <With load={() => store.meeting(props.recordRef ?? "")} close={props.close}>
      {(m: MeetingRecord | null) => {
        const meeting = m!
        const field = attendeesField(meeting)
        const submit = (v: FormValues): Promise<SubmitResult> => {
          const people = tags(v.attendees)
          if (sameTags(people, tags(field.initial))) return Promise.resolve({ ok: true, ref: meeting.ref })
          return save(() => write("setAttendees")({ meeting: meeting.ref, people }), props, "saved", { person: "attendees" })
        }
        return <Form title={`Attendees · ${meeting.ref}`} fields={[field]} submit={submit} close={props.close} />
      }}
    </With>
  )
}
