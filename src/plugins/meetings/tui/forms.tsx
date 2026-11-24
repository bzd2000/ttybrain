// The meetings plugin's record forms on the record type `meeting`: `meeting` (an add, or an edit with a
// recordRef; About first, the kind read as `1:1 (project · board)`), `agenda-item` (recordRef the meeting; an edit
// names its position in `prefill.item`), `attendees` and `move` (a planned meeting's new date). The talk-item form
// is in talk-form.tsx.
// Attendees and projects are typed as tags separated by spaces and/or commas (`@marie, @luc`, `#CRM #ERP`); the
// `@` and `#` are optional. An unknown person or project shows under its field. An edit sends only the fields that
// changed, and closes without a write when nothing did.
import { createEffect, Show, untrack, type JSX } from "solid-js"
import { act, dayDate, Form, useQuery, useRuntime, type FieldSpec, type FormValues, type RecordFormProps, type SubmitResult } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import { KIND_LABELS, type AgendaItem, type MeetingRecord } from "../logic/schema"

type Write = (input: Record<string, unknown>) => Promise<unknown>

export const KINDS = ["one_on_one", "project", "board"]
// How a kind reads in a form: `1:1`, `project`, `board`.
export const KIND_FIELD_LABELS: Record<string, string> = { ...KIND_LABELS }
export const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
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
export function With<T>(props: { load: () => Promise<T | null>; close(): void; children: (loaded: T | null) => JSX.Element }) {
  const q = useQuery(props.load)
  createEffect(() => {
    if (q.error() !== undefined && q.data() === undefined) props.close()
  })
  return <Show when={q.data() !== undefined}>{untrack(() => props.children(q.data()!))}</Show>
}

// The field an unknown person or project belongs under (the operations name none for these lookups). A subject
// that does not resolve is named with its `@` or `#` (`unknown person "@zorro"`, `unknown project or board "#X"`),
// or as `unknown person, project or board`.
type Lookups = { person?: string; project?: string; about?: string }
export function fieldOf(error: unknown, lookups: Lookups): string | undefined {
  const m = error instanceof Error ? /\bunknown (person, project or board|project or board|person|project) "([@#]?)/.exec(error.message) : null
  if (!m) return undefined
  if (lookups.about !== undefined && (m[1]!.includes(" or ") || m[2] !== "")) return lookups.about
  return lookups[m[1] as "person" | "project"]
}

// Runs the writes with one act() and turns its result into the form's SubmitResult.
export async function save(run: () => Promise<unknown>, props: RecordFormProps, verb: string, lookups: Lookups = {}): Promise<SubmitResult> {
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
  // The meeting being edited and the board codes (what a `#CODE` is: a board or a project).
  const load = async () => ({
    meeting: props.recordRef === undefined ? null : await store.meeting(props.recordRef),
    boards: new Set((await rt.data.selectFrom("board").select("code").execute()).map((r) => String(r.code))),
  })
  return (
    <With load={load} close={props.close}>
      {(loaded: { meeting: MeetingRecord | null; boards: Set<string> } | null) => {
        const m = loaded?.meeting ?? null
        const boards = loaded?.boards ?? new Set<string>()
        // An edit that gives the meeting a subject of another kind changes its Kind with it, so the change shows
        // before saving: until Kind is edited by hand it follows About (so it has no `initial`: a field with one never follows).
        const kindOf = (about: string | null | undefined): string | null | undefined => {
          const ref = (about ?? "").trim().split(/[\s,]+/)[0] ?? ""
          if (m === null) return undefined
          if (ref === (m.about ?? "")) return m.kind
          return ref.startsWith("@") ? "one_on_one" : ref.startsWith("#") ? (boards.has(ref.slice(1).toUpperCase()) ? "board" : "project") : undefined
        }
        // What it is about comes first; a new meeting's kind may be left empty: it then follows from that.
        const fields: FieldSpec[] = [
          { name: "about", label: "About", kind: "refs", required: true, show: "labelType", initial: m?.about },
          { name: "title", label: "Title", kind: "text", required: true, initial: m?.title },
          { name: "kind", label: "Kind", kind: "enum", values: KINDS, labels: KIND_FIELD_LABELS, required: m !== null, derive: (v) => kindOf(v.about) },
          { name: "date", label: "Date", kind: "date", required: true, initial: m?.date ?? rt.clock.today() },
          attendeesField(m),
          ...(m === null ? [{ name: "projects", label: "Projects", kind: "text" as const }] : []),
          { name: "sinceDate", label: "Since", kind: "date", initial: m?.since_date },
        ]
        const add = (v: FormValues) =>
          save(
            () =>
              write("addMeeting")(
                defined({
                  about: v.about?.trim() ?? "",
                  title: v.title ?? "",
                  date: v.date ?? "",
                  kind: given(v.kind),
                  sinceDate: given(v.sinceDate),
                  attendees: given(v.attendees) === undefined ? undefined : tags(v.attendees),
                  projects: tags(v.projects),
                }),
              ),
            props,
            "added",
            { person: "attendees", project: "projects", about: "about" },
          )
        const edit = (meeting: MeetingRecord, v: FormValues): Promise<SubmitResult> => {
          const changed = changedFields(fields.map((f) => (f.name === "kind" ? { ...f, initial: meeting.kind } : f)), v).filter((n) => n !== "attendees" && n !== "about")
          const about = (v.about ?? "").trim()
          const subject = about !== (meeting.about ?? "")
          if (subject) changed.splice(0, changed.length, ...changed.filter((n) => n !== "kind")) // setSubject carries the kind
          const people = tags(v.attendees)
          const attendees = !sameTags(people, tags(attendeesField(meeting).initial))
          if (changed.length === 0 && !attendees && !subject) return Promise.resolve({ ok: true, ref: meeting.ref })
          const input: Record<string, unknown> = { ref: meeting.ref }
          for (const name of changed) input[name] = name === "sinceDate" ? (given(v.sinceDate) ?? null) : (v[name] ?? "")
          return save(
            async () => {
              let out: unknown
              if (subject) out = await write("setSubject")({ meeting: meeting.ref, about, ...(given(v.kind) === undefined ? {} : { kind: v.kind }) })
              if (changed.length > 0) out = await write("editMeeting")(input)
              if (attendees) out = await write("setAttendees")({ meeting: meeting.ref, people })
              return out
            },
            props,
            "saved",
            { person: "attendees", about: "about" },
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
          const changed = changedFields(fields.map((f) => (f.name === "kind" ? { ...f, initial: meeting.kind } : f)), v)
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

// A planned meeting's new date (`m` on screen 5): moveMeeting, which keeps a series' occurrence its series date.
export function MoveForm(props: RecordFormProps) {
  const rt = useRuntime()
  const store = makeStore(rt)
  return (
    <With load={() => store.meeting(props.recordRef ?? "")} close={props.close}>
      {(m: MeetingRecord | null) => {
        const meeting = m!
        const submit = (v: FormValues): Promise<SubmitResult> => {
          const to = (v.to ?? "").trim()
          if (to === meeting.date) return Promise.resolve({ ok: true, ref: meeting.ref })
          return save(() => rt.self().write.moveMeeting!({ ref: meeting.ref, to }), props, "moved")
        }
        return (
          <Form
            title={`Move ${meeting.title} · ${dayDate(meeting.date)}`}
            fields={[{ name: "to", label: "New date", kind: "date", required: true, initial: meeting.date }]}
            submit={submit}
            close={props.close}
          />
        )
      }}
    </With>
  )
}
