// One form field: `› Label*  <editor>  <preview>`, then its `✗ <message>` and, for a record field, the
// suggestions. The editor is an <input>, except an enum field, which shows `‹ value ›` and cycles with ←→ (the
// keys themselves are handled by <Form>), and a longtext field, which is a <textarea> that keeps newlines (an
// <input> strips them): Enter adds a line (<Form> leaves it to the textarea; in any other field it does nothing),
// and its height follows its lines up to LONGTEXT_MAX_LINES. An `editor` element replaces the default editor.
import type { TextareaRenderable } from "@opentui/core"
import { For, onMount, Show, type JSX } from "solid-js"
import { theme } from "../theme"

export type FieldKind = "text" | "longtext" | "date" | "number" | "enum" | "record"

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
}

export type Suggestion = { ref: string; label: string }

export const INPUT_WIDTH = 32
export const LONGTEXT_MAX_LINES = 4

function LongText(props: { value: string | null; focused: boolean; onInput(value: string): void }) {
  let area: TextareaRenderable | undefined
  const initial = props.value ?? ""
  const lines = () => Math.min(LONGTEXT_MAX_LINES, Math.max(1, (props.value ?? "").split("\n").length))
  onMount(() => {
    if (area) area.cursorOffset = initial.length // like an <input>: typing continues the text
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
  previewError?: boolean
  error?: string
  suggestions: Suggestion[]
  picked: number
  onInput(value: string): void
  // Replaces the default editor (a plugin's fieldEditor for an extra field).
  editor?: JSX.Element
}) {
  const label = () => `${props.focused ? "›" : " "} ${props.spec.label}${props.spec.required ? "*" : ""}`
  const indent = () => " ".repeat(props.labelWidth + 1)
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <text fg={props.focused ? theme.accent : theme.muted} width={props.labelWidth}>
          {label()}
        </text>
        <Show when={props.editor === undefined} fallback={props.editor}>
          <Show
            when={props.spec.kind === "enum"}
            fallback={
              props.spec.kind === "longtext" ? (
                <LongText value={props.value} focused={props.focused} onInput={(v) => props.onInput(v)} />
              ) : (
              <input
                width={INPUT_WIDTH}
                value={props.value ?? ""}
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
            <text fg={props.focused ? theme.accent : theme.text}>{`‹ ${props.value ?? "—"} ›`}</text>
          </Show>
        </Show>
        <Show when={props.preview}>
          <text fg={props.previewError ? theme.red : theme.muted}>{props.preview}</text>
        </Show>
      </box>
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
