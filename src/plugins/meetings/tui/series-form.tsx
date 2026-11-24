// The "New recurring meeting" form (the 2026-11-20 `series` design), on the record type `series` (form id `series`),
// drawn in the designs' form look (Form `look`): a rounded panel, a 14-cell label column, only the focused field as
// an input, `ctrl+s save · esc cancel` on the bottom border and `tab field` in the bar.
// - About (`prefill.about`: filled in when opened from a person or project, which then starts on Rhythm and titles
//   a person's series `1:1 <first name>`), shown as `Karim Haddad · person`.
// - Kind (`1:1 (project · board)`) follows About as it is typed (a person: 1:1, a project: project, a board: board)
//   until changed.
// - Rhythm, with the dates it gives read back under it (`→ Wed 25 Nov, 9 Dec, 23 Dec, 6 Jan …`).
// - First date: the rhythm's first date from today until changed, shown as `Wed 25 Nov`.
// - Attendees: the person it is about until changed, shown by name. Ends: `never` when empty.
// Saved with addSeries, which makes the occurrences of the next 8 weeks.
import { Form, useRuntime, type FieldSpec, type FormValues, type RecordFormProps } from "@ttybrain/api/tui"
import { rhythmFirst, rhythmPreview } from "../logic/rhythm"
import { defined, KIND_FIELD_LABELS, KINDS, save, tags, With } from "./forms"

export const SERIES_TITLE = "New recurring meeting"
const LOOK = { labelWidth: 14, tabLabel: "field" }
const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === ""
const firstRef = (v: string | null | undefined) => (v ?? "").trim().split(/[\s,]+/)[0] ?? ""

export function SeriesForm(props: RecordFormProps) {
  const rt = useRuntime()
  const today = rt.clock.today()
  const about = props.prefill?.about?.trim()
  // A person's name, for the title of their 1:1 series; the board codes, for the kind a `#CODE` gives.
  const load = async () => ({
    name: about !== undefined && about.startsWith("@") ? await rt.records.label(about).catch(() => null) : null,
    boards: new Set((await rt.data.selectFrom("board").select("code").execute()).map((r) => String(r.code))),
  })
  const kindOf = (ref: string, boards: Set<string>) =>
    ref.startsWith("@") ? "one_on_one" : ref.startsWith("#") ? (boards.has(ref.slice(1).toUpperCase()) ? "board" : "project") : null
  return (
    <With load={load} close={props.close}>
      {(loaded: { name: string | null; boards: Set<string> } | null) => {
        const name = loaded?.name ?? null
        const boards = loaded?.boards ?? new Set<string>()
        const base: FieldSpec[] = [
          { name: "about", label: "About", kind: "refs", required: true, show: "labelType", initial: about },
          { name: "title", label: "Title", kind: "text", required: true, initial: name === null ? undefined : `1:1 ${name.split(/\s+/)[0]}` },
          {
            name: "kind",
            label: "Kind",
            kind: "enum",
            values: KINDS,
            labels: KIND_FIELD_LABELS,
            derive: (v) => kindOf(firstRef(v.about), boards),
          },
          { name: "every", label: "Rhythm", kind: "text", required: true, note: (v) => rhythmPreview(v.every, v.from, today) },
          { name: "from", label: "First date", kind: "date", show: "day", placeholder: "today", derive: (v) => rhythmFirst(v.every, today) ?? null },
          { name: "attendees", label: "Attendees", kind: "refs", show: "label", derive: (v) => (firstRef(v.about).startsWith("@") ? firstRef(v.about) : null) },
          { name: "until", label: "Ends", kind: "date", show: "day", placeholder: "never" },
        ]
        const fields = base.map((f) => (props.prefill?.[f.name] === undefined || f.name === "about" ? f : { ...f, initial: props.prefill[f.name] }))
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
        return (
          <Form
            title={SERIES_TITLE}
            fields={fields}
            look={LOOK}
            footer="ctrl+s save · esc cancel"
            {...(about === undefined ? {} : { start: "every" })}
            submit={submit}
            close={props.close}
          />
        )
      }}
    </With>
  )
}
