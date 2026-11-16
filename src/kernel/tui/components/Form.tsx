// <Form>: the overlay every create and edit goes through (spec §9 "Forms").
// - Tab / Shift+Tab move between fields; Enter moves on, and on the last field submits; Ctrl+S, or Esc then `s`
//   (also Alt+S, which is how a fast Esc s arrives), submits from anywhere. Esc not followed by `s` within
//   ESC_WINDOW_MS cancels.
// - enum fields cycle with ←→; record fields autocomplete from the kernel's record type search (↑↓ pick, Tab
//   accepts); date fields preview the parsed ISO date (`→ 2026-11-15`) or `invalid date`, with the CLI's parsing.
// - While the form is open it holds text focus, so single-letter global keys type into the field.
// - A failed submit keeps the form open with its values: a ValidationError naming a field shows under that field
//   as `✗ <message>`, any other error at the bottom. A submit in flight ignores further submits.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { runWithContext } from "../../context"
import { parseDate } from "../../dates"
import { ValidationError } from "../../errors"
import { useQuery } from "../data"
import { printable, useKeys, useScreenKeys } from "../keys"
import { useApp } from "../scope"
import { theme } from "../theme"
import { Field, type FieldSpec, type Suggestion } from "./Field"

export type { FieldSpec } from "./Field"

export type FormValues = Record<string, string | null>
export type SubmitResult = { ok: true; ref?: string } | { ok: false; error: unknown }

export const ESC_WINDOW_MS = 1000
export const SUGGESTION_LIMIT = 8

// The kernel prefixes an operation's input errors with the operation (`todo.addThing: title must not be blank`);
// under the field the field's own message is enough.
const OP_PREFIX = /^[\w-]+\.[\w-]+: /
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function Form(props: { title: string; fields: FieldSpec[]; submit(values: FormValues): Promise<SubmitResult>; close(savedRef?: string): void }) {
  const { kernel, track } = useApp()
  const keys = useKeys()
  const today = kernel.clock.today()

  const initial = (f: FieldSpec): string | null => {
    if (f.initial !== undefined && f.initial !== null) return f.initial
    return f.kind === "enum" && f.required ? (f.values?.[0] ?? null) : null
  }
  const [values, setValues] = createSignal<FormValues>(Object.fromEntries(props.fields.map((f) => [f.name, initial(f)])))
  const [index, setIndex] = createSignal(0)
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({})
  const [formError, setFormError] = createSignal<string | undefined>(undefined)
  let saving = false

  const current = () => props.fields[index()]
  const valueOf = (name: string) => values()[name] ?? null
  const setValue = (name: string, v: string | null) => setValues((all) => ({ ...all, [name]: v }))

  // --- record autocomplete: open after typing in a record field, closed once a suggestion is accepted ---
  const [suggesting, setSuggesting] = createSignal(false)
  const [picked, setPicked] = createSignal(0)
  const searchKey = () => {
    const f = current()
    const text = f ? (valueOf(f.name) ?? "").trim() : ""
    return f?.kind === "record" && f.recordType && suggesting() && text !== "" ? { type: f.recordType, text } : null
  }
  const search = useQuery(
    async (): Promise<Suggestion[]> => {
      const k = searchKey()
      if (!k) return []
      return (await kernel.records.byName(k.type)?.search(k.text, SUGGESTION_LIMIT)) ?? []
    },
    { key: () => JSON.stringify(searchKey()) },
  )
  const suggestions = () => (searchKey() ? (search.data() ?? []) : [])
  const accept = () => {
    const f = current()
    const s = suggestions()[picked()]
    if (!f || !s) return false
    setValue(f.name, s.ref)
    setSuggesting(false)
    return true
  }

  const datePreview = (f: FieldSpec): { text: string; error: boolean } | undefined => {
    if (f.kind !== "date") return undefined
    const raw = (valueOf(f.name) ?? "").trim()
    if (raw === "") return undefined
    try {
      return { text: `→ ${parseDate(raw, today)}`, error: false }
    } catch {
      return { text: "invalid date", error: true }
    }
  }

  // Empty text is null; a date that parses is sent as ISO, one that does not as typed (the plugin reports it).
  const collect = (): FormValues => {
    const out: FormValues = {}
    for (const f of props.fields) {
      const v = valueOf(f.name)
      if (f.kind === "enum") out[f.name] = v
      else if (v === null || v === "") out[f.name] = null
      else if (f.kind === "date") {
        try {
          out[f.name] = parseDate(v, today)
        } catch {
          out[f.name] = v
        }
      } else out[f.name] = v
    }
    return out
  }

  const submit = () => {
    if (saving) return
    saving = true
    const run = async () => {
      let result: SubmitResult
      try {
        result = await runWithContext(kernel.context(), () => props.submit(collect()))
      } catch (e) {
        result = { ok: false, error: e }
      }
      saving = false
      if (result.ok) return props.close(result.ref)
      const e = result.error
      const field = e instanceof ValidationError ? e.field : undefined
      if (field !== undefined && props.fields.some((f) => f.name === field)) {
        setFieldErrors({ [field]: message(e).replace(OP_PREFIX, "") })
        setFormError(undefined)
      } else {
        setFieldErrors({})
        setFormError(message(e))
      }
    }
    void track(run())
  }

  const move = (d: number) => {
    setSuggesting(false)
    setIndex((i) => Math.min(props.fields.length - 1, Math.max(0, i + d)))
  }
  const cycle = (f: FieldSpec, d: number) => {
    const choices: Array<string | null> = f.required ? [...(f.values ?? [])] : [null, ...(f.values ?? [])]
    if (choices.length === 0) return
    const at = Math.max(0, choices.indexOf(valueOf(f.name)))
    setValue(f.name, choices[(at + d + choices.length) % choices.length]!)
  }

  let escTimer: ReturnType<typeof setTimeout> | undefined
  const clearEsc = () => {
    if (escTimer !== undefined) clearTimeout(escTimer)
    escTimer = undefined
  }
  onCleanup(clearEsc)
  const cancel = () => {
    clearEsc()
    props.close()
  }

  onMount(() => {
    keys.textFocus(true)
    keys.hints([
      { key: "Tab", label: "next field" },
      { key: "Ctrl+S", label: "save" },
      { key: "Esc", label: "cancel" },
    ])
  })

  useScreenKeys((key) => {
    if (escTimer !== undefined) {
      // The key after Esc: `s` saves, anything else confirms the cancel.
      key.preventDefault()
      clearEsc()
      if (printable(key) === "s") submit()
      else cancel()
      return
    }
    const f = current()
    if (key.name === "escape") {
      key.preventDefault()
      escTimer = setTimeout(cancel, ESC_WINDOW_MS)
      ;(escTimer as { unref?: () => void }).unref?.()
    } else if (key.name === "s" && (key.ctrl || key.meta || key.option)) {
      key.preventDefault()
      submit()
    } else if (key.name === "tab") {
      key.preventDefault()
      if (key.shift) move(-1)
      else if (!accept()) move(1)
    } else if (key.name === "return") {
      key.preventDefault()
      if (index() === props.fields.length - 1) submit()
      else move(1)
    } else if ((key.name === "up" || key.name === "down") && suggestions().length > 0) {
      key.preventDefault()
      const d = key.name === "up" ? -1 : 1
      setPicked((p) => Math.min(suggestions().length - 1, Math.max(0, p + d)))
    } else if ((key.name === "left" || key.name === "right") && f?.kind === "enum") {
      key.preventDefault()
      cycle(f, key.name === "left" ? -1 : 1)
    } else if (f?.kind === "enum" && printable(key) !== undefined) {
      key.preventDefault() // nothing to type into
    }
  })

  const labelWidth = Math.max(0, ...props.fields.map((f) => f.label.length + (f.required ? 1 : 0))) + 2

  return (
    <box
      border
      borderColor={theme.accent}
      backgroundColor={theme.panel}
      flexDirection="column"
      minWidth={60}
      paddingLeft={1}
      paddingRight={1}
      title={props.title}
    >
      <For each={props.fields}>
        {(f, i) => (
          <Field
            spec={f}
            value={valueOf(f.name)}
            focused={keys.active() && index() === i()}
            labelWidth={labelWidth}
            preview={datePreview(f)?.text}
            previewError={datePreview(f)?.error}
            error={fieldErrors()[f.name]}
            suggestions={index() === i() ? suggestions() : []}
            picked={picked()}
            onInput={(v) => {
              if (v === (valueOf(f.name) ?? "")) return // the echo of a value set here (an accepted suggestion)
              setValue(f.name, v)
              if (f.kind === "record") {
                setSuggesting(true)
                setPicked(0)
              }
            }}
          />
        )}
      </For>
      <Show when={formError()}>
        <text fg={theme.red}>{`✗ ${formError()}`}</text>
      </Show>
    </box>
  )
}
