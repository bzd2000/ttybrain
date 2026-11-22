// <Form>: the overlay every create and edit goes through (spec §9 "Forms").
// - One meaning per key: Tab / Shift+Tab move between fields; Enter is "new line" (it reaches a longtext field's
//   textarea, and does nothing in any one-line field: it never saves and never moves); Ctrl+S, or Esc then `s`
//   (also Alt+S, which is how a fast Esc s arrives), submits from anywhere. Esc not followed by `s` within
//   ESC_WINDOW_MS cancels.
// - enum fields cycle with ←→; record fields autocomplete from the kernel's record type search (↑↓ pick, Tab
//   accepts); a refs field (several refs, space-separated) autocompletes its last word from the record type whose
//   prefix starts it (`#cr`, `@an`, `M-`), Tab replacing that word with the ref and a space; date fields preview the parsed ISO date (`→ 2026-11-15`) or `invalid date`, with the CLI's parsing.
// - While the form is open it holds text focus, so single-letter global keys type into the field.
// - A failed submit keeps the form open with its values: a ValidationError naming a field (or a failed
//   SubmitResult's `field`) shows under that field as `✗ <message>`, any other error at the bottom. While a submit is in flight (`saving…`, busy retries
//   included) further submits and Esc are ignored, so a cancel never races a save that still lands.
// - With `recordType`, the fields other plugins registered for it (kernel.fields, the `field` extension point) follow
//   the form's own, starting from the values of `recordRef` read through each owning plugin's `get` operation (a
//   plugin's fieldEditor replaces the default editor). `submit(values)` gets the own fields' values only; the
//   kernel saves the changed extra fields itself: the act the submit runs saves them in the same write, after the
//   plugin's own operation, for the ref it returned (all-or-nothing). A submit that wrote nothing (an edit with no
//   change of its own) has them saved in an act of their own for its result's ref; without a ref the form stays
//   open with an error.
// - Drafts (drafts.ts): a form openForm opened keeps a draft of every field it shows (own and extra), written a
//   moment after typing stops and at once on Esc and on quit; a save deletes it, a cancel keeps it (`draft kept`).
//   Reopened with a draft that differs from the initial values, the form first shows <DraftPrompt> and takes no
//   keys until `r` (restore), `x` (discard) or Esc (close, keeping the draft); an equal draft is deleted silently.
// - `footer`: muted text on the form's bottom border, right-aligned (`ctrl+s save · esc cancel`); `start`: the field
//   focused first. A field's `derive` sets its value from the others until it is edited.
// - `look` (as the screen designs draw a form): a rounded panel with the title padded on its top border, a muted
//   label column `labelWidth` wide (no `›` or `*`), only the focused field as an input and the others as read (a
//   field's `show`: refs by label, with their type, a date as its day; the placeholder when empty), and Tab's hint
//   labelled `tabLabel` (`tab field`). A field's `note` is worked out from the current values of the own fields (Field.tsx).
import { createEffect, createMemo, onCleanup, createSignal, For, onMount, Show, useContext } from "solid-js"
import { runWithContext } from "../../context"
import { parseDate } from "../../dates"
import { ValidationError } from "../../errors"
import { act, NO_REF_FOR_EXTRAS, useQuery, withFormExtras, type PendingExtras } from "../data"
import { DRAFT_KEPT, FormDraftKey, sameValues, useDraftKey, type Draft } from "../drafts"
import { createEscChord, ESC_WINDOW_MS } from "../escChord"
import { printable, useKeys, useScreenKeys } from "../keys"
import { notify } from "../messages"
import { PluginScope, useApp } from "../scope"
import { theme } from "../theme"
import type { FieldDef } from "../../fields"
import { DraftPrompt } from "./DraftPrompt"
import { Field, type FieldDisplay, type FieldSpec, type Suggestion } from "./Field"
import { dayDate } from "../format"

export type { FieldSpec } from "./Field"

export type FormValues = Record<string, string | null>
export type FormLook = { labelWidth: number; tabLabel?: string }
// A failure may name the field to show its error under (`field`), for an error that names none itself (an
// operation's NotFoundError for one of the values, say); a ValidationError's own `field` is used otherwise.
export type SubmitResult = { ok: true; ref?: string } | { ok: false; error: unknown; field?: string }

export { ESC_WINDOW_MS }
export const SUGGESTION_LIMIT = 8

// The kernel prefixes an operation's input errors with the operation (`todo.addThing: title must not be blank`);
// under the field the field's own message is enough.
const OP_PREFIX = /^[\w-]+\.[\w-]+: /
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Extra = { key: string; plugin: string; def: FieldDef }

// The word a refs field is typing: after its last space (empty right after one).
const lastWord = (value: string) => /\S*$/.exec(value)![0]

// An extra field's value as the form edits it, and back as its `set` operation takes it.
const asText = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

// A number field's value for an operation: empty is null; a decimal is its number; anything else (`0x10`,
// `1_000`, `Infinity`) is NaN, so the operation's validation reports the field instead of saving a surprise.
export function numberValue(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v.trim() === "") return null
  return DECIMAL.test(v.trim()) ? Number(v.trim()) : Number.NaN
}

export function Form(props: {
  title: string
  fields: FieldSpec[]
  // The record type whose extra fields (kernel.fields) follow the own ones, and the record they start from.
  recordType?: string
  recordRef?: string
  // Muted text on the bottom border, right-aligned.
  footer?: string
  // The name of the field focused first (default: the first field), as when the first is filled in already.
  start?: string
  look?: FormLook
  submit(values: FormValues): Promise<SubmitResult>
  close(savedRef?: string): void
}) {
  const { kernel, registry, track } = useApp()
  const keys = useKeys()
  const today = kernel.clock.today()

  const initial = (f: FieldSpec): string | null => {
    if (f.initial !== undefined && f.initial !== null) return f.initial
    return f.kind === "enum" && f.required ? (f.values?.[0] ?? null) : null
  }
  const [values, setValues] = createSignal<FormValues>(Object.fromEntries(props.fields.map((f) => [f.name, initial(f)])))
  const [index, setIndex] = createSignal(Math.max(0, props.fields.findIndex((f) => f.name === props.start)))
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({})
  const [formError, setFormError] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)

  // --- the extra fields: keyed apart from the own ones (`<plugin>:<name>`), shown once their values are loaded ---
  const extras: Extra[] = props.recordType === undefined ? [] : kernel.fields.for(props.recordType).map((f) => ({ key: `${f.plugin}:${f.def.name}`, ...f }))
  const [extraInitial, setExtraInitial] = createSignal<Record<string, string | null> | undefined>(
    extras.length === 0 || props.recordRef === undefined ? Object.fromEntries(extras.map((x) => [x.key, null])) : undefined,
  )
  if (extras.length > 0 && props.recordRef !== undefined) {
    const ref = props.recordRef
    const loaded = useQuery(async () =>
      Object.fromEntries(
        await Promise.all(
          extras.map(async (x) => {
            const get = kernel.ops.api(x.plugin)?.read[x.def.get]
            if (!get) throw new Error(`field "${x.def.name}": no read operation "${x.def.get}"`)
            return [x.key, asText((await get({ ref }))?.value)] as const
          }),
        ),
      ),
    )
    // The first load only: a live reload must not overwrite what is being typed.
    createEffect(() => {
      const v = loaded.data()
      if (v !== undefined && extraInitial() === undefined) {
        setValues((all) => ({ ...all, ...v }))
        setExtraInitial(v)
      }
    })
  }
  const extraSpecs = extras.map(
    (x): FieldSpec => ({ name: x.key, label: x.def.label, kind: x.def.type, ...(x.def.values ? { values: x.def.values } : {}) }),
  )
  const fields = createMemo((): FieldSpec[] => (extraInitial() === undefined ? props.fields : [...props.fields, ...extraSpecs]))
  const extraOf = (name: string) => extras.find((x) => x.key === name)

  // --- the draft: the values of every field shown, against the values the form opened with ---
  const ownInitial = Object.fromEntries(props.fields.map((f) => [f.name, initial(f)]))
  const ready = () => extraInitial() !== undefined
  const initialValues = (): FormValues => ({ ...ownInitial, ...(extraInitial() ?? {}) })
  const draft = useDraftKey<FormValues>(useContext(FormDraftKey), initialValues)
  const pick = (v: FormValues, names: string[]) => Object.fromEntries(names.filter((n) => n in v).map((n) => [n, v[n] ?? null]))
  // The draft offered: set while the form waits for r / x / Esc (it takes no keys meanwhile).
  const [offer, setOffer] = createSignal<Draft<FormValues> | undefined>(
    draft.saved && typeof draft.saved.values === "object" && draft.saved.values !== null ? draft.saved : undefined,
  )
  if (draft.saved && !offer()) draft.discard()
  createEffect(() => {
    const d = offer()
    if (!d || !ready()) return
    const names = fields().map((f) => f.name)
    const shown = pick(d.values, names)
    if (sameValues({ ...pick(initialValues(), names), ...shown }, pick(initialValues(), names))) {
      draft.discard()
      setOffer(undefined)
    }
  })
  createEffect(() => {
    const v = values()
    if (ready() && !offer()) draft.schedule(v)
  })
  const restore = () => {
    const d = offer()
    if (!d) return
    setOffer(undefined)
    for (const name of Object.keys(d.values)) touch(name)
    setValues((all) => ({ ...all, ...pick(d.values, Object.keys(all)) }))
  }
  const discardDraft = () => {
    draft.discard()
    setOffer(undefined)
  }

  const current = () => fields()[index()]
  const valueOf = (name: string) => values()[name] ?? null
  const setValue = (name: string, v: string | null) => setValues((all) => ({ ...all, [name]: v }))

  // --- derived values: a field with `derive` follows the others until it is edited (or restored from a draft) ---
  const [touched, setTouched] = createSignal(new Set<string>())
  const touch = (name: string) => setTouched((t) => (t.has(name) ? t : new Set([...t, name])))
  createEffect(() => {
    const v = values()
    for (const f of props.fields) {
      if (!f.derive || touched().has(f.name)) continue
      const d = f.derive(v)
      if (d !== undefined && d !== (v[f.name] ?? null)) setValue(f.name, d)
    }
  })

  // --- the look's values as read: refs resolved to their labels (and type), dates as their day ---
  const refWords = (v: string | null) => (v ?? "").split(/[\s,]+/).filter((w) => w !== "")
  const resolved = useQuery(
    async () => {
      const out = new Map<string, { label: string; type: string }>()
      if (!props.look) return out
      for (const f of props.fields)
        if (f.show === "label" || f.show === "labelType")
          for (const w of refWords(valueOf(f.name))) {
            const def = kernel.records.typeOfRef(w)
            if (!def || out.has(w)) continue
            try {
              out.set(w, { label: await kernel.records.label(w), type: def.name })
            } catch {}
          }
      return out
    },
    { key: () => (props.look ? props.fields.filter((f) => f.show === "label" || f.show === "labelType").map((f) => valueOf(f.name)).join("\n") : "") },
  )
  const displayOf = (f: FieldSpec): FieldDisplay | undefined => {
    if (!props.look) return undefined
    const raw = (valueOf(f.name) ?? "").trim()
    if (raw === "") return [{ text: f.placeholder ?? "", muted: true }]
    if (f.show === "day") {
      try {
        return [{ text: dayDate(parseDate(raw, today)) }]
      } catch {
        return [{ text: raw }]
      }
    }
    if (f.show === "label" || f.show === "labelType") {
      const words = refWords(raw)
      const found = words.map((w) => resolved.data()?.get(w))
      const text = words.map((w, i) => found[i]?.label ?? w).join(", ")
      const type = found[0]?.type
      return f.show === "labelType" && type !== undefined ? [{ text }, { text: ` · ${type}`, muted: true }] : [{ text }]
    }
    return [{ text: raw }]
  }

  // --- record autocomplete: open after typing in a record field, closed once a suggestion is accepted ---
  const [suggesting, setSuggesting] = createSignal(false)
  const [picked, setPicked] = createSignal(0)
  // A refs field searches the record type whose prefix starts its last word (`@an` people, `M-` meetings).
  const searchKey = () => {
    const f = current()
    if (!f || !suggesting()) return null
    const value = valueOf(f.name) ?? ""
    if (f.kind === "record") return f.recordType && value.trim() !== "" ? { type: f.recordType, text: value.trim() } : null
    if (f.kind !== "refs") return null
    const word = lastWord(value)
    const def = word === "" ? undefined : kernel.records.typeOfRef(word)
    return def ? { type: def.name, text: word.slice(def.prefix.length) } : null
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
    // A refs field: the last word becomes the ref, and a space follows for the next one.
    const value = valueOf(f.name) ?? ""
    touch(f.name) // before the value: a derive must not run on it again
    setValue(f.name, f.kind === "refs" ? `${value.slice(0, value.length - lastWord(value).length)}${s.ref} ` : s.ref)
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

  // A field's note from the own fields' current values; one that throws shows none.
  const noteOf = (f: FieldSpec): string | undefined => {
    if (!f.note) return undefined
    try {
      return f.note(values())
    } catch {
      return undefined
    }
  }

  // Empty text is null; a date that parses is sent as ISO, one that does not as typed (the plugin reports it).
  // A number field is trimmed first, so blank clears it.
  const collectOne = (f: FieldSpec): string | null => {
    const raw = valueOf(f.name)
    if (f.kind === "enum") return raw
    const v = f.kind === "number" && raw !== null ? raw.trim() : raw
    if (v === null || v === "") return null
    if (f.kind === "date") {
      try {
        return parseDate(v, today)
      } catch {
        return v
      }
    }
    return v
  }
  const collect = (): FormValues => Object.fromEntries(props.fields.map((f) => [f.name, collectOne(f)]))

  // The extra fields whose value differs from the one loaded, each saved through its plugin's `set` operation; a
  // number field's text goes as a number when it is a plain decimal (NaN otherwise, `0x10` included, so the
  // operation reports it). A ValidationError shows under the extra field.
  const collectExtra = (): PendingExtras => {
    const initial = extraInitial() ?? {}
    const changed = extraInitial() === undefined ? [] : extraSpecs.filter((f) => collectOne(f) !== (initial[f.name] ?? null))
    const values = changed.map((f) => {
      const v = collectOne(f)
      return { x: extraOf(f.name)!, value: f.kind === "number" ? numberValue(v) : v }
    })
    return {
      changed: values.length > 0,
      claimed: false,
      async save(ref) {
        for (const { x, value } of values) {
          const set = kernel.ops.api(x.plugin)?.write[x.def.set]
          if (!set) throw new Error(`field "${x.def.name}": no write operation "${x.def.set}"`)
          try {
            await set({ ref, value })
          } catch (e) {
            if (e instanceof ValidationError) throw new ValidationError(e.message, { field: x.key, ...(e.hint !== undefined ? { hint: e.hint } : {}) })
            throw e
          }
        }
      },
    }
  }

  const submit = () => {
    if (saving()) return
    setSaving(true)
    const run = async () => {
      let result: SubmitResult
      const extras = collectExtra()
      try {
        result = await runWithContext(kernel.context(), () => withFormExtras(extras, () => props.submit(collect())))
        // The submit wrote nothing (no act took the extra fields): save them on their own for its ref.
        if (result.ok && extras.changed && !extras.claimed) {
          const ref = result.ref
          if (ref === undefined) result = { ok: false, error: new Error(NO_REF_FOR_EXTRAS) }
          else {
            const saved = await withFormExtras(extras, () => act(async () => ({ ref }), { ok: () => `saved ${ref}` }))
            if (!saved.ok) result = saved
          }
        }
      } catch (e) {
        result = { ok: false, error: e }
      }
      setSaving(false)
      if (result.ok) {
        draft.discard()
        return props.close(result.ref)
      }
      const e = result.error
      const field = result.field ?? (e instanceof ValidationError ? e.field : undefined)
      if (field !== undefined && fields().some((f) => f.name === field)) {
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
    setIndex((i) => Math.min(fields().length - 1, Math.max(0, i + d)))
  }
  const cycle = (f: FieldSpec, d: number) => {
    const choices: Array<string | null> = f.required ? [...(f.values ?? [])] : [null, ...(f.values ?? [])]
    if (choices.length === 0) return
    const at = Math.max(0, choices.indexOf(valueOf(f.name)))
    touch(f.name)
    setValue(f.name, choices[(at + d + choices.length) % choices.length]!)
  }

  // A cancel keeps the draft (written now) and says so when it holds something.
  const leave = () => {
    if (draft.kept()) notify(DRAFT_KEPT)
    props.close()
  }
  const esc = createEscChord(leave)
  const cancel = () => {
    esc.clear()
    leave()
  }

  onMount(() => {
    keys.textFocus(true)
  })
  // A focused longtext field says Enter adds a line.
  createEffect(() => {
    if (offer()) return // the draft prompt shows its own
    const longtext = current()?.kind === "longtext"
    const drop = keys.hints([
      { key: "Tab", label: props.look?.tabLabel ?? "next field" },
      ...(longtext ? [{ key: "Enter", label: "new line" }] : []),
      { key: "Ctrl+S", label: "save" },
      { key: "Esc", label: "cancel" },
    ])
    onCleanup(drop)
  })

  useScreenKeys((key) => {
    if (offer()) return // the draft prompt has the keys
    if (esc.pending()) {
      // The key after Esc: `s` (or Ctrl+S / Alt+S, still meaning save) saves, anything else confirms the cancel.
      key.preventDefault()
      esc.clear()
      if (printable(key) === "s" || (key.name === "s" && (key.ctrl || key.meta || key.option))) submit()
      else cancel()
      return
    }
    const f = current()
    if (key.name === "escape") {
      key.preventDefault()
      if (saving()) return // the save goes on (busy retry included); cancelling now would still create the record
      draft.flush()
      esc.arm()
    } else if (key.name === "s" && (key.ctrl || key.meta || key.option)) {
      key.preventDefault()
      submit()
    } else if (key.name === "tab") {
      key.preventDefault()
      if (key.shift) move(-1)
      else if (!accept()) move(1)
    } else if (key.name === "return") {
      // A longtext field's textarea takes Enter as a new line; anywhere else it does nothing.
      if (f?.kind !== "longtext") key.preventDefault()
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
  }, { whileTyping: true })

  const labelWidth = () => props.look?.labelWidth ?? Math.max(0, ...fields().map((f) => f.label.length + (f.required ? 1 : 0))) + 2

  // A plugin's fieldEditor for an extra field, in that plugin's scope.
  const customEditor = (f: FieldSpec, focused: () => boolean) => {
    const x = extraOf(f.name)
    const custom = x && props.recordType !== undefined ? registry.editorOf(props.recordType, x.def.name) : undefined
    if (!custom) return undefined
    const Editor = custom.editor
    return (
      <PluginScope kernel={kernel} plugin={custom.plugin} label={`${custom.plugin} editor`}>
        <Editor value={valueOf(f.name)} onChange={(v) => setValue(f.name, v)} focused={focused()} />
      </PluginScope>
    )
  }

  return (
    <box
      border
      borderStyle={props.look ? "rounded" : undefined}
      titleColor={props.look ? theme.accent : undefined}
      borderColor={theme.accent}
      backgroundColor={theme.panel}
      flexDirection="column"
      minWidth={60}
      paddingLeft={1}
      paddingRight={1}
      title={props.look ? ` ${props.title} ` : props.title}
    >
      <Show when={ready() ? offer() : undefined}>
        {(d: () => Draft<FormValues>) => <DraftPrompt savedAt={d().savedAt} restore={restore} discard={discardDraft} close={() => props.close()} />}
      </Show>
      <For each={fields()}>
        {(f, i) => {
          const focused = () => keys.active() && !offer() && index() === i()
          const editor = customEditor(f, focused)
          return (
            <Field
              spec={f}
              value={valueOf(f.name)}
              focused={focused()}
              editor={editor}
              labelWidth={labelWidth()}
              preview={datePreview(f)?.text}
              note={noteOf(f)}
              plain={props.look !== undefined}
              display={displayOf(f)}
              previewError={datePreview(f)?.error}
              error={fieldErrors()[f.name]}
              suggestions={index() === i() ? suggestions() : []}
              picked={picked()}
              onInput={(v) => {
                if (v === (valueOf(f.name) ?? "")) return // the echo of a value set here (an accepted suggestion)
                touch(f.name)
                setValue(f.name, v)
                if (f.kind === "record" || f.kind === "refs") {
                  setSuggesting(true)
                  setPicked(0)
                }
              }}
            />
          )
        }}
      </For>
      <Show when={saving()}>
        <text fg={theme.muted}>saving…</text>
      </Show>
      <Show when={formError()}>
        <text fg={theme.red}>{`✗ ${formError()}`}</text>
      </Show>
      <Show when={props.footer}>
        {(f: () => string) => (
          // On the bottom border row, one `─` before the corner (as a Panel footer).
          <text position="absolute" bottom={-1} right={1} fg={theme.muted} bg={theme.panel} wrapMode="none">
            {` ${f()} `}
          </text>
        )}
      </Show>
    </box>
  )
}
