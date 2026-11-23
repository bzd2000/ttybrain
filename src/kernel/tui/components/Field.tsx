// One form field: `› Label*  <editor>  <preview>`, then its `✗ <message>` and, for a record or refs field, the
// suggestions. The editor is an <input>, except an enum field, which shows `‹ value ›` and cycles with ←→ (the
// keys themselves are handled by <Form>), and a longtext field, which is a <textarea> that keeps newlines (an
// <input> strips them): Enter adds a line (<Form> leaves it to the textarea; in any other field it does nothing),
// and its height follows its lines up to LONGTEXT_MAX_LINES; a value set from outside replaces its text. An `editor` element replaces the default editor.
// An enum field with `labels` reads `<label> (<the other labels>)`, the others muted (`1:1 (project · board)`); a
// `note` is a muted line under the field, worked out from the form's values as they are typed (a rhythm's next
// dates); a `placeholder` shows, muted, in an empty input (`never`). With `plain` (a Form's `look`), the label is a
// plain muted column and a field that is not focused shows its `display` (a value as read: resolved refs, a day
// date, the placeholder) instead of an input.
import type { TextareaRenderable } from "@opentui/core"
import { createEffect, For, onMount, Show, type JSX } from "solid-js"
import { theme } from "../theme"

// `refs`: several record refs separated by spaces (`#CRM @anna M-4`); the one being typed at the end autocompletes
// from the record type its prefix names.
export type FieldKind = "text" | "longtext" | "date" | "number" | "enum" | "record" | "refs"

export type FieldSpec = {
  name: string
  label: string
  kind: FieldKind
  // Marks the label with `*`; an enum field that is required has no empty choice. Validation itself is the
  // owning plugin's (its ValidationError shows under the field).
  required?: boolean
  // The choices of an enum field.
  values?: string[]
  // The record type a record field autocompletes from (`kernel.records.byName(recordType).search`).
  recordType?: string
  initial?: string | null
  // How an enum field's values read (by value); without it the value itself shows as `‹ value ›`.
  labels?: Record<string, string>
  // A muted line under the field from the form's current values (own fields, by name); undefined: none.
  note?: (values: Record<string, string | null>) => string | undefined
  // Shown, muted, while the input is empty.
  placeholder?: string
  // How a Form with a `look` shows the value while the field is not focused: "label" the refs' labels
  // (`Karim Haddad`), "labelType" with the first one's record type after it, muted (`Karim Haddad · person`),
  // "day" a date as its day (`Wed 25 Nov`); as typed otherwise.
  show?: "label" | "labelType" | "day"
  // The value worked out from the form's other values, followed until the field is edited (a kind from what the
  // meeting is about); undefined: leave it.
  derive?: (values: Record<string, string | null>) => string | null | undefined
  // Whether the field is shown, from the form's current values (own fields, by name): a hidden field takes no
  // focus and reaches `submit` as null (a talk item's Project only for a person's item). One that throws shows.
  when?: (values: Record<string, string | null>) => boolean
}

// A value as a Form with a `look` shows it: pieces of text, some muted.
export type FieldDisplay = Array<{ text: string; muted?: boolean }>

export type Suggestion = { ref: string; label: string }

export const INPUT_WIDTH = 32
// The look's inputs (Form `look`): wide enough for a phrase such as `every 2 weeks on wednesday` to show whole.
export const LOOK_INPUT_WIDTH = 40
export const LONGTEXT_MAX_LINES = 4

function LongText(props: { value: string | null; focused: boolean; onInput(value: string): void }) {
  let area: TextareaRenderable | undefined
  const initial = props.value ?? ""
  const lines = () => Math.min(LONGTEXT_MAX_LINES, Math.max(1, (props.value ?? "").split("\n").length))
  onMount(() => {
    if (area) area.cursorOffset = initial.length // like an <input>: typing continues the text
  })
  // A value set from outside (a restored draft) replaces the text; the echo of typing is already the text.
  createEffect(() => {
    const v = props.value ?? ""
    if (area && area.plainText !== v) {
      area.setText(v)
      area.cursorOffset = v.length
    }
  })
  return (
    <textarea
      ref={(r: TextareaRenderable) => (area = r)}
      width={INPUT_WIDTH}
      height={lines()}
      initialValue={initial}
      focused={props.focused}
      backgroundColor={theme.selectedBg}
      focusedBackgroundColor={theme.selectedBg}
      textColor={theme.text}
      focusedTextColor={theme.text}
      onContentChange={() => area && props.onInput(area.plainText)}
    />
  )
}

export function Field(props: {
  spec: FieldSpec
  value: string | null
  focused: boolean
  labelWidth: number
  // Shown right of the editor (a date field's `→ 2026-11-15`), dimmed or red when `previewError`.
  preview?: string
  // The spec's note for the current values.
  note?: string
  previewError?: boolean
  error?: string
  suggestions: Suggestion[]
  picked: number
  onInput(value: string): void
  // Replaces the default editor (a plugin's fieldEditor for an extra field).
  editor?: JSX.Element
  // The plain look (see above), and the value shown while not focused.
  plain?: boolean
  display?: FieldDisplay
}) {
  const label = () => (props.plain ? props.spec.label : `${props.focused ? "›" : " "} ${props.spec.label}${props.spec.required ? "*" : ""}`)
  const gap = () => (props.plain ? 2 : 1)
  const indent = () => " ".repeat(props.labelWidth + gap())
  // Plain and not focused: the value as read (an enum keeps its labels).
  const asText = () => props.plain === true && !props.focused && props.editor === undefined && props.spec.kind !== "enum"
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={gap()}>
        <text fg={props.focused && !props.plain ? theme.accent : theme.muted} width={props.labelWidth}>
          {label()}
        </text>
        <Show when={asText()}>
          <box flexDirection="row">
            <For each={props.display ?? [{ text: props.value ?? "" }]}>{(d) => <text fg={d.muted ? theme.muted : theme.text}>{d.text}</text>}</For>
          </box>
        </Show>
        <Show when={props.editor === undefined} fallback={asText() ? null : props.editor}>
          {/* Kept mounted while the value shows as text (only hidden), so it has focus as soon as the field does. */}
          <box flexDirection="row" visible={!asText()} width={asText() ? 0 : undefined} flexShrink={0}>
          <Show
            when={props.spec.kind === "enum"}
            fallback={
              props.spec.kind === "longtext" ? (
                <LongText value={props.value} focused={props.focused} onInput={(v) => props.onInput(v)} />
              ) : (
              <input
                width={props.plain ? LOOK_INPUT_WIDTH : INPUT_WIDTH}
                flexShrink={0}
                value={props.value ?? ""}
                placeholder={props.spec.placeholder ?? ""}
                placeholderColor={theme.muted}
                focused={props.focused}
                backgroundColor={theme.selectedBg}
                focusedBackgroundColor={theme.selectedBg}
                textColor={theme.text}
                focusedTextColor={theme.text}
                onInput={(v: string) => props.onInput(v)}
              />
              )
            }
          >
            <Show when={props.spec.labels} fallback={<text fg={props.focused ? theme.accent : theme.text}>{`‹ ${props.value ?? "—"} ›`}</text>}>
              {(labels: () => Record<string, string>) => {
                const label = (v: string) => labels()[v] ?? v
                const others = () => (props.spec.values ?? []).filter((v) => v !== props.value).map(label)
                return (
                  <box flexDirection="row" gap={1}>
                    <text fg={props.focused ? theme.accent : theme.text}>{props.value === null ? "—" : label(props.value)}</text>
                    <Show when={others().length > 0}>
                      <text fg={theme.muted}>{`(${others().join(" · ")})`}</text>
                    </Show>
                  </box>
                )
              }}
            </Show>
          </Show>
          </box>
        </Show>
        <Show when={props.preview && !asText()}>
          <text fg={props.previewError ? theme.red : theme.muted}>{props.preview}</text>
        </Show>
      </box>
      <Show when={props.note}>
        <text fg={theme.muted} wrapMode="none">{`${indent()}${props.note}`}</text>
      </Show>
      <Show when={props.error}>
        <text fg={theme.red}>{`${indent()}✗ ${props.error}`}</text>
      </Show>
      <For each={props.suggestions}>
        {(s, i) => (
          <box flexDirection="row" backgroundColor={i() === props.picked ? theme.selectedBg : theme.panel}>
            <text fg={i() === props.picked ? theme.accent : theme.text}>{`${indent()}${s.ref} ${s.label}`}</text>
          </box>
        )}
      </For>
    </box>
  )
}
