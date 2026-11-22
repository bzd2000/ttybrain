// The "New recurring meeting" form (the 2026-11-20 `series` design), on the record type `series` (form id `series`):
// About (`prefill.about`: filled in when opened from a person or project), Title, Kind (`1:1 (project · board)`; left
// empty it follows from what the series is about), Rhythm with the dates it gives read back under it
// (`→ Wed 25 Nov, 9 Dec, 23 Dec, 6 Jan …`), First date (today when left empty), Attendees (the person it is about
// when left empty) and Ends (`never` when left empty). `ctrl+s save · esc cancel` on the bottom border. Saved with
// addSeries, which makes the occurrences of the next 8 weeks.
import { Form, useRuntime, type FieldSpec, type FormValues, type RecordFormProps } from "@ttybrain/api/tui"
import { rhythmPreview } from "../logic/rhythm"
import { defined, KIND_FIELD_LABELS, KINDS, save, tags } from "./forms"

export const SERIES_TITLE = "New recurring meeting"
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ""

export function SeriesForm(props: RecordFormProps) {
  const rt = useRuntime()
  const today = rt.clock.today()
  const about = props.prefill?.about
  const person = about !== undefined && about.trim().startsWith("@")
  const fields: FieldSpec[] = [
    { name: "about", label: "About", kind: "refs", required: true },
    { name: "title", label: "Title", kind: "text", required: true },
    { name: "kind", label: "Kind", kind: "enum", values: KINDS, labels: KIND_FIELD_LABELS, initial: about === undefined ? undefined : person ? "one_on_one" : "project" },
    { name: "every", label: "Rhythm", kind: "text", required: true, note: (v: Record<string, string | null>) => rhythmPreview(v.every, v.from, today) },
    { name: "from", label: "First date", kind: "date", placeholder: "today" },
    { name: "attendees", label: "Attendees", kind: "text", initial: person ? about!.trim() : undefined },
    { name: "until", label: "Ends", kind: "date", placeholder: "never" },
  ].map((f) => (props.prefill?.[f.name] === undefined ? f : { ...f, initial: props.prefill[f.name] })) as FieldSpec[]
  const submit = (v: FormValues) =>
    save(
      () =>
        rt.self().write.addSeries!(
          defined({
            about: (v.about ?? "").trim(),
            title: v.title ?? "",
            kind: blank(v.kind) ? undefined : v.kind,
            every: v.every ?? "",
            from: blank(v.from) ? "today" : v.from,
            until: blank(v.until) ? undefined : v.until,
            attendees: blank(v.attendees) ? undefined : tags(v.attendees),
          }),
        ),
      props,
      "added",
      { person: "attendees", about: "about" },
    )
  return <Form title={SERIES_TITLE} fields={fields} footer="ctrl+s save · esc cancel" submit={submit} close={props.close} />
}
