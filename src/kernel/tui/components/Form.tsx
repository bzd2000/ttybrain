// <Form>: the overlay every create and edit goes through (spec §9 "Forms").
// - One meaning per key: Tab / Shift+Tab move between fields; Enter is "new line" (it reaches a longtext field's
//   textarea, opens a one-line field's drop-down when it has one, and otherwise does nothing: it never saves and
//   never moves); Ctrl+S, or Esc then `s`
//   (also Alt+S, which is how a fast Esc s arrives), submits from anywhere. Esc not followed by `s` within
//   ESC_WINDOW_MS cancels.
// - Drop-downs (Dropdown.tsx; docs/architecture.md, Forms): Enter opens an enum field's values, a text field's
//   `choices` (with its `custom` entry) or a record field's candidates under the field (above it near the bottom);
//   ↑↓ move, Enter picks, a letter jumps (enum, choices), Esc closes the list only, Tab moves on, Ctrl+S closes it
//   unpicked and saves. enum fields also cycle with ←→; record fields autocomplete from the kernel's record type
//   search as typed, in that list (↑↓ pick, Enter or Tab accepts); a refs field (several refs, space-separated) autocompletes its last word from the record type whose
//   prefix starts it (`#cr`, `@an`, `M-`), Tab replacing that word with the ref and a space; date fields preview the parsed ISO date (`→ 2026-11-15`) or `invalid date`, with the CLI's parsing, show the
//   weekday in front of the input while focused, and take ←→ (empty: today; a date: a day, Shift a week; other text:
//   the cursor).
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
// - Every form is drawn as the screen designs draw one (the 2026-11-20 `series` mock): a rounded panel with the
//   title padded on its top border, `ctrl+s save · esc cancel` on its bottom border (unless `footer` says
//   otherwise), a muted label column (no `›` or `*`; its longest label and 4 cells, or `look.labelWidth`), only the
//   focused field as an input and the others as read (a field's `show`: refs by label, with their type, a date as
//   its day, which is also how a date field reads without one, red when it does not parse; the placeholder when
//   empty; a longtext its first line; a value too long for its column ends in `…` after a whole word), and Tab's
//   hint labelled `tab field` (`look.tabLabel`). The form's width is fixed (see `layout`), so moving the focus never
//   changes it. On a narrow terminal the label column gives way first (down to its longest label), then the
//   inputs; an error under a field wraps in the value column. A field's `note` is worked out from the current
//   values of the own fields (Field.tsx).
import type { BoxRenderable, KeyEvent } from "@opentui/core"
import { createEffect, createMemo, onCleanup, createSignal, For, onMount, Show, useContext } from "solid-js"
import { runWithContext } from "../../context"
import { addDays, parseDate } from "../../dates"
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
import { Dropdown, DROPDOWN_ROWS } from "./Dropdown"
import { useTerminalDimensions } from "@opentui/solid"
import { Field, LOOK_INPUT_WIDTH, type FieldDisplay, type FieldSpec, type Suggestion } from "./Field"
import { dayDate } from "../format"

export type { FieldSpec } from "./Field"

export type FormValues = Record<string, string | null>
// The label column's width (default: the longest label and 4 cells) and Tab's hint (default `field`).
export type FormLook = { labelWidth?: number; tabLabel?: string }
export const FORM_FOOTER = "ctrl+s save · esc cancel"
// A failure may name the field to show its error under (`field`), for an error that names none itself (an
// operation's NotFoundError for one of the values, say); a ValidationError's own `field` is used otherwise.
export type SubmitResult = { ok: true; ref?: string } | { ok: false; error: unknown; field?: string }

export { ESC_WINDOW_MS }
export const SUGGESTION_LIMIT = 8
// The cells a form row takes besides its label column and value: the border and the padding on both sides.
const FRAME = 4
const GAP = 2 // between the label column and the value, and between an input and its preview
const PREVIEW = 12 // a date field's `→ 2026-11-15` or `invalid date`
const MIN_INPUT = 16
const MIN_FORM = 60

// Pieces of text cut to `width` cells: whole words, then `…` (a single word longer than the room is cut).
export function fitDisplay(pieces: FieldDisplay, width: number): FieldDisplay {
  const text = pieces.map((p) => p.text).join("")
  if (text.length <= width) return pieces
  const room = Math.max(0, width - 1)
  const cut = text.slice(0, room + 1)
  const at = cut.lastIndexOf(" ")
  const keep = (at > 0 ? cut.slice(0, at) : text.slice(0, room)).trimEnd().length
  const out: FieldDisplay = []
  let used = 0
  for (const p of pieces) {
    if (used >= keep) break
    const t = p.text.slice(0, keep - used)
    used += t.length
    out.push({ ...p, text: t })
  }
  return [...out, { text: "…", muted: true }]
}

// The kernel prefixes an operation's input errors with the operation (`todo.addThing: title must not be blank`);
// under the field the field's own message is enough.
const OP_PREFIX = /^[\w-]+\.[\w-]+: /
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Extra = { key: string; plugin: string; def: FieldDef }
// An entry of an enum or choices field's drop-down: null is the empty choice (`—`); `custom` closes the list to type.
type Choice = { value: string | null; label: string; custom?: boolean }

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
  // Muted text on the bottom border, right-aligned (default FORM_FOOTER).
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
  const dims = useTerminalDimensions()

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
  // A field with `when` shows only while the values say so.
  const shownNow = (f: FieldSpec): boolean => {
    if (f.when === undefined) return true
    try {
      return f.when(values())
    } catch {
      return true
    }
  }
  const fields = createMemo((): FieldSpec[] => (extraInitial() === undefined ? props.fields : [...props.fields, ...extraSpecs]).filter(shownNow))
  const extraOf = (name: string) => extras.find((x) => x.key === name)

  // The derived fields that were edited (or given a value to start with): they no longer follow the others.
  const initiallyTouched = new Set<string>(props.fields.filter((f) => f.derive && f.initial !== undefined && f.initial !== null).map((f) => f.name))
  const [touched, setTouched] = createSignal(new Set<string>(initiallyTouched))
  const touch = (name: string) => setTouched((t) => (t.has(name) ? t : new Set([...t, name])))
  // Applies the derives that follow (untouched) to `v`, a few passes so one may follow another.
  const derived = (v: FormValues, only: (name: string) => boolean = (n) => !touched().has(n)): FormValues => {
    const out = { ...v }
    for (let pass = 0; pass < 3; pass++)
      for (const f of props.fields) {
        if (!f.derive || !only(f.name)) continue
        const d = f.derive(out)
        if (d !== undefined) out[f.name] = d
      }
    return out
  }

  // --- the draft: the values of every field shown, against the values the form opened with (after its derives,
  // which count as where it started); a derived field that still follows the others is not part of a draft ---
  const ownInitial = Object.fromEntries(props.fields.map((f) => [f.name, initial(f)]))
  const ready = () => extraInitial() !== undefined
  // Only the fields that follow from the start are derived: one given a value keeps it.
  const baseline = (): FormValues => derived({ ...ownInitial, ...(extraInitial() ?? {}) }, (n) => !initiallyTouched.has(n))
  const following = (name: string) => props.fields.some((f) => f.name === name && f.derive !== undefined) && !touched().has(name)
  const draftOf = (v: FormValues): FormValues => Object.fromEntries(Object.entries(v).filter(([n]) => !following(n)))
  const initialValues = (): FormValues => draftOf(baseline())
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
    if (sameValues({ ...pick(baseline(), names), ...shown }, pick(baseline(), names))) {
      draft.discard()
      setOffer(undefined)
    }
  })
  createEffect(() => {
    const v = values()
    if (ready() && !offer()) draft.schedule(draftOf(v))
  })
  const restore = () => {
    const d = offer()
    if (!d) return
    setOffer(undefined)
    const merged = { ...values(), ...pick(d.values, Object.keys(values())) }
    // A derived field is edited only when the draft's value is not what it would follow to.
    const follow = derived(merged, () => true)
    for (const name of Object.keys(d.values)) if ((d.values[name] ?? null) !== (follow[name] ?? null)) touch(name)
    setValues(merged)
  }
  const discardDraft = () => {
    draft.discard()
    setOffer(undefined)
  }

  // A field that hides while it or one after it is focused: the focus stays on the last one shown.
  createEffect(() => {
    const n = fields().length
    if (index() > n - 1) setIndex(Math.max(0, n - 1))
  })
  const current = () => fields()[index()]
  const valueOf = (name: string) => values()[name] ?? null
  const setValue = (name: string, v: string | null) => setValues((all) => ({ ...all, [name]: v }))

  // --- derived values: a field with `derive` follows the others until it is edited (or restored from a draft) ---
  createEffect(() => {
    const v = values()
    for (const f of props.fields) {
      if (!f.derive || touched().has(f.name)) continue
      const d = f.derive(v)
      if (d !== undefined && d !== (v[f.name] ?? null)) setValue(f.name, d)
    }
  })

  // --- values as read: refs resolved to their labels (and type), dates as their day ---
  const showOf = (f: FieldSpec): FieldSpec["show"] => f.show ?? (f.kind === "date" ? "day" : undefined)
  const refWords = (v: string | null) => (v ?? "").split(/[\s,]+/).filter((w) => w !== "")
  const resolved = useQuery(
    async () => {
      const out = new Map<string, { label: string; type: string }>()
      for (const f of props.fields)
        if (showOf(f) === "label" || showOf(f) === "labelType")
          for (const w of refWords(valueOf(f.name))) {
            if (out.has(w)) continue
            try {
              // The type the ref resolves to (a shared prefix such as `#` has several).
              const found = await kernel.records.resolveAny(w)
              if (found) out.set(w, { label: await kernel.records.label(w), type: found.type })
            } catch {}
          }
      return out
    },
    { key: () => props.fields.filter((f) => showOf(f) === "label" || showOf(f) === "labelType").map((f) => valueOf(f.name)).join("\n") },
  )
  // A value as read, cut to the inputs' width (the form keeps its width as the focus moves).
  const displayOf = (f: FieldSpec): FieldDisplay => fitDisplay(readOf(f), layout().input)
  const readOf = (f: FieldSpec): FieldDisplay => {
    const raw = (valueOf(f.name) ?? "").trim()
    if (raw === "") return [{ text: f.placeholder ?? "", muted: true }]
    const show = showOf(f)
    // A longtext's first line, `…` when more follow.
    if (f.kind === "longtext") {
      const [first, ...more] = raw.split("\n")
      return more.length > 0 ? [{ text: first!.trimEnd() }, { text: " …", muted: true }] : [{ text: raw }]
    }
    if (show === "day") {
      try {
        return [{ text: dayDate(parseDate(raw, today)) }]
      } catch {
        return [{ text: raw, error: true }] // not a date: red, as its preview `invalid date`
      }
    }
    if (show === "label" || show === "labelType") {
      const words = refWords(raw)
      const found = words.map((w) => resolved.data()?.get(w))
      const text = words.map((w, i) => found[i]?.label ?? w).join(", ")
      const type = found[0]?.type
      return show === "labelType" && type !== undefined ? [{ text }, { text: ` · ${type}`, muted: true }] : [{ text }]
    }
    return [{ text: raw }]
  }

  // --- record autocomplete: open after typing in a record field, closed once a suggestion is accepted ---
  const [suggesting, setSuggesting] = createSignal(false)
  const [picked, setPicked] = createSignal(0)
  // A refs field searches the record types whose prefix starts its last word (`@an` people, `M-` meetings; `#` the
  // types sharing it, their candidates merged by ref).
  const searchKey = () => {
    const f = current()
    if (!f || !suggesting()) return null
    const value = valueOf(f.name) ?? ""
    if (f.kind === "record") return f.recordType ? { types: [f.recordType], text: value.trim() } : null
    if (f.kind !== "refs") return null
    const word = lastWord(value)
    const defs = word === "" ? [] : kernel.records.typesOfRef(word)
    return defs.length > 0 ? { types: defs.map((d) => d.name), text: word.slice(defs[0]!.prefix.length) } : null
  }
  const search = useQuery(
    async (): Promise<Suggestion[]> => {
      const k = searchKey()
      if (!k) return []
      const all: Suggestion[] = []
      for (const type of k.types) all.push(...((await kernel.records.byName(type)?.search(k.text, SUGGESTION_LIMIT)) ?? []))
      if (k.types.length === 1) return all
      return all.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)).slice(0, SUGGESTION_LIMIT)
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

  // --- drop-downs: an enum field's values, a text field's `choices`, a record field's candidates (the autocomplete
  // above, shown as a list under the field) ---
  const [listOpen, setListOpen] = createSignal(false)
  const [highlight, setHighlight] = createSignal(0)
  const choicesOf = (f: FieldSpec): Choice[] | undefined => {
    if (f.kind === "enum") {
      const vs: Array<string | null> = f.required ? [...(f.values ?? [])] : [null, ...(f.values ?? [])]
      return vs.map((v) => ({ value: v, label: v === null ? "—" : (f.labels?.[v] ?? v) }))
    }
    if (!f.choices || f.kind !== "text") return undefined
    let list: Array<{ value: string; label?: string }> = []
    try {
      list = f.choices(values())
    } catch {}
    return [...list.map((c) => ({ value: c.value, label: c.label ?? c.value })), ...(f.custom !== undefined ? [{ value: null, label: f.custom, custom: true }] : [])]
  }
  // What the open list shows, and which entry is selected.
  const listItems = (): string[] => {
    const f = current()
    if (!f) return []
    if (f.kind === "record") return suggesting() ? suggestions().map((s) => `${s.ref} ${s.label}`) : []
    return listOpen() ? (choicesOf(f) ?? []).map((c) => c.label) : []
  }
  const listIndex = () => (current()?.kind === "record" ? picked() : highlight())
  const listShown = () => listItems().length > 0
  const openList = (f: FieldSpec) => {
    if (f.kind === "record") {
      setPicked(0)
      return setSuggesting(true)
    }
    const cs = choicesOf(f) ?? []
    setHighlight(Math.max(0, cs.findIndex((c) => !c.custom && c.value === valueOf(f.name))))
    setListOpen(true)
  }
  const pickChoice = (f: FieldSpec) => {
    const c = (choicesOf(f) ?? [])[highlight()]
    setListOpen(false)
    if (!c || c.custom) return
    touch(f.name)
    setValue(f.name, c.value)
  }
  // A letter: the first entry whose label starts with it (the next one when the selected one does already).
  const jump = (ch: string) => {
    const labels = listItems().map((l) => l.toLowerCase())
    const c = ch.toLowerCase()
    const n = labels.length
    const from = labels[highlight()]?.startsWith(c) ? highlight() + 1 : 0
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n
      if (labels[i]!.startsWith(c)) return setHighlight(i)
    }
  }
  // A key that came with an Esc in front (a fast Esc then the key arrives as Alt+key); Alt+S still saves.
  const escPrefixed = (key: KeyEvent) => (key.meta || key.option) && !key.ctrl && key.name !== "s" && key.name !== "escape"
  // The keys while an enum or choices list is open; true when the key was the list's.
  const listKey = (f: FieldSpec, key: KeyEvent): boolean => {
    if (!listOpen() || f.kind === "record") return false
    if (escPrefixed(key)) {
      // Esc and the next key arrived together (Alt+key): the Esc closes the list, the key goes on as usual.
      setListOpen(false)
      return false
    }
    key.preventDefault() // nothing reaches the field's input meanwhile
    const n = listItems().length
    if (key.name === "escape") setListOpen(false)
    else if (key.name === "s" && (key.ctrl || key.meta || key.option)) {
      setListOpen(false)
      submit()
    } else if (key.name === "tab") move(key.shift ? -1 : 1)
    else if (key.name === "return") pickChoice(f)
    else if (key.name === "up") setHighlight((h) => Math.max(0, h - 1))
    else if (key.name === "down") setHighlight((h) => Math.min(n - 1, h + 1))
    else {
      const ch = printable(key)
      if (ch !== undefined && ch.trim() !== "") jump(ch)
    }
    return true
  }
  // ←→ in a date field: empty, today (Shift too); a date, a day (Shift: a week) earlier or later; text that does not
  // parse, nothing (the cursor moves).
  const shiftDate = (f: FieldSpec, key: KeyEvent): boolean => {
    const raw = (valueOf(f.name) ?? "").trim()
    let next: string
    if (raw === "") next = today
    else {
      try {
        next = addDays(parseDate(raw, today), (key.name === "left" ? -1 : 1) * (key.shift ? 7 : 1))
      } catch {
        return false
      }
    }
    key.preventDefault()
    touch(f.name)
    setValue(f.name, next)
    return true
  }
  // A date field's weekday in front of its input while focused (`Mon  `); blank while it does not parse.
  const weekdayOf = (f: FieldSpec): string | undefined => {
    if (f.kind !== "date") return undefined
    const raw = (valueOf(f.name) ?? "").trim()
    if (raw === "") return ""
    try {
      return dayDate(parseDate(raw, today)).slice(0, 3)
    } catch {
      return ""
    }
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
  const collect = (): FormValues => Object.fromEntries(props.fields.map((f) => [f.name, shownNow(f) ? collectOne(f) : null]))

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
    setListOpen(false)
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
    const kind = current()?.kind
    const drop = keys.hints(
      listShown()
        ? [
            { key: "↑↓", label: "move" },
            { key: "Enter", label: "pick" },
            { key: "Esc", label: "close" },
            { key: "Ctrl+S", label: "save" },
          ]
        : [
            { key: "Tab", label: props.look?.tabLabel ?? "field" },
            ...(kind === "longtext" ? [{ key: "Enter", label: "new line" }] : []),
            ...(kind === "date" ? [{ key: "←→", label: "day" }, { key: "Shift+←→", label: "week" }] : []),
            { key: "Ctrl+S", label: "save" },
            { key: "Esc", label: "cancel" },
          ],
    )
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
    if (f?.kind === "record" && listShown() && escPrefixed(key)) setSuggesting(false) // as listKey
    if (f && listKey(f, key)) return
    if (key.name === "escape" && f?.kind === "record" && listShown()) {
      // The candidates close; the form stays (nothing armed).
      key.preventDefault()
      setSuggesting(false)
    } else if (key.name === "escape") {
      setSuggesting(false)
      key.preventDefault()
      if (saving()) return // the save goes on (busy retry included); cancelling now would still create the record
      draft.flush()
      esc.arm()
    } else if (key.name === "s" && (key.ctrl || key.meta || key.option)) {
      key.preventDefault()
      setSuggesting(false)
      submit()
    } else if (key.name === "tab") {
      key.preventDefault()
      if (key.shift) move(-1)
      else if (!accept()) move(1)
    } else if (key.name === "return") {
      // A longtext field's textarea takes Enter as a new line; an enum, choices or record field opens its list (a
      // record field's open list: Enter picks); anywhere else it does nothing.
      if (f?.kind !== "longtext") key.preventDefault()
      if (f?.kind === "record" && listShown()) accept()
      else if (f && (f.kind === "record" || choicesOf(f) !== undefined)) openList(f)
    } else if ((key.name === "up" || key.name === "down") && suggestions().length > 0) {
      key.preventDefault()
      const d = key.name === "up" ? -1 : 1
      setPicked((p) => Math.min(suggestions().length - 1, Math.max(0, p + d)))
    } else if ((key.name === "left" || key.name === "right") && f?.kind === "date" && shiftDate(f, key)) {
      // shifted (or set to today)
    } else if ((key.name === "left" || key.name === "right") && f?.kind === "enum") {
      key.preventDefault()
      cycle(f, key.name === "left" ? -1 : 1)
    } else if (f?.kind === "enum" && printable(key) !== undefined) {
      key.preventDefault() // nothing to type into
    }
  }, { whileTyping: true })

  // The label column, the inputs (a value as read is cut to their width), the form's width (fixed: the frame, the
  // labels, an input and, when the form has a date field, the slot of its preview, at least 60 cells; so moving the
  // focus never changes it) and the value column (what that leaves right of the labels: an error wraps there at
  // words), for the terminal's width: the label column gives way first, down to its longest label, then the inputs.
  const layout = createMemo(() => {
    const longest = Math.max(0, ...fields().map((f) => f.label.length))
    const want = props.look?.labelWidth ?? longest + 4
    const room = dims().width - FRAME
    const preview = fields().some((f) => f.kind === "date") ? GAP + PREVIEW : 0
    const label = Math.max(Math.min(longest, want), Math.min(want, room - GAP - LOOK_INPUT_WIDTH - preview))
    const input = Math.max(MIN_INPUT, Math.min(LOOK_INPUT_WIDTH, room - label - GAP - preview))
    const width = Math.min(dims().width, Math.max(MIN_FORM, FRAME + label + GAP + input + preview))
    return { label, input, width, value: Math.max(MIN_INPUT, width - FRAME - label - GAP) }
  })

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

  // Where the open list goes: under the field when it fits above the status bar, else above it when it fits there,
  // else on the roomier side, scrolling; at the value column, as wide as its longest entry (never past the form).
  let root: BoxRenderable | undefined
  const rowBoxes = new Map<string, BoxRenderable>()
  const listPlace = () => {
    const items = listItems()
    const f = current()
    const row = f && rowBoxes.get(f.name)
    if (items.length === 0 || !row || !root) return undefined
    const y = row.y
    const below = dims().height - 1 - (y + 1)
    const above = y
    let rows = Math.min(items.length, DROPDOWN_ROWS)
    let down = true
    if (below < rows + 2) {
      down = !(above >= rows + 2 || above > below)
      rows = Math.max(1, Math.min(rows, (down ? below : above) - 2))
    }
    const rel = y - root.y - 1 // the field's row in the form's padding box
    const left = layout().label + GAP
    const width = Math.max(6, Math.min(layout().width - 2 - left, Math.max(...items.map((l) => l.length)) + 4))
    return { top: down ? rel + 1 : rel - (rows + 2), left, width, rows }
  }

  return (
    <box
      ref={(r: BoxRenderable) => (root = r)}
      border
      borderStyle="rounded"
      titleColor={theme.accent}
      borderColor={theme.accent}
      backgroundColor={theme.panel}
      flexDirection="column"
      width={layout().width}
      paddingLeft={1}
      paddingRight={1}
      title={` ${props.title} `}
    >
      <Show when={ready() ? offer() : undefined}>
        {(d: () => Draft<FormValues>) => <DraftPrompt savedAt={d().savedAt} restore={restore} discard={discardDraft} close={() => props.close()} />}
      </Show>
      <For each={fields()}>
        {(f, i) => {
          const focused = () => keys.active() && !offer() && index() === i()
          const editor = customEditor(f, focused)
          return (
            <box ref={(r: BoxRenderable) => rowBoxes.set(f.name, r)} flexDirection="column">
            <Field
              spec={f}
              prefix={focused() ? weekdayOf(f) : undefined}
              value={valueOf(f.name)}
              focused={focused()}
              editor={editor}
              labelWidth={layout().label}
              inputWidth={layout().input}
              valueWidth={layout().value}
              preview={datePreview(f)?.text}
              note={noteOf(f)}
              plain
              display={displayOf(f)}
              previewError={datePreview(f)?.error}
              error={fieldErrors()[f.name]}
              suggestions={index() === i() && f.kind === "refs" ? suggestions() : []}
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
            </box>
          )
        }}
      </For>
      <Show when={listPlace()}>
        {(p: () => { top: number; left: number; width: number; rows: number }) => (
          <Dropdown items={listItems()} index={listIndex()} top={p().top} left={p().left} width={p().width} rows={p().rows} />
        )}
      </Show>
      <Show when={saving()}>
        <text fg={theme.muted}>saving…</text>
      </Show>
      <Show when={formError()}>
        <text fg={theme.red}>{`✗ ${formError()}`}</text>
      </Show>
      <Show when={props.footer ?? FORM_FOOTER}>
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
