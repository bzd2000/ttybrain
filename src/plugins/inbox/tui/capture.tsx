// The quick-capture overlay (`i` on any screen). A multi-line text: Enter inserts a newline; Ctrl+S, or Esc then
// `s` (a fast Esc s arrives as Alt+S, which saves too), saves through `capture` and closes with `captured I-n`;
// Esc not followed by `s` within ESC_WINDOW_MS cancels. While saving, further saves and Esc are ignored.
// While the word at the cursor is a tag being typed (`#cr`, `@ma`), up to 5 `tags.suggest` results show: ↑↓ pick,
// Tab replaces the word with the ref and a space. On a project's or a person's record view, the text starts with
// its tag and a line says why.
// The text is kept as a draft (`inbox:capture`): a cancel keeps it (`draft kept`), a save deletes it, and the next
// capture first offers it (r restore · x discard · Esc close); a restored draft takes the place of the prefill.
import type { TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import {
  act,
  createEscChord,
  DRAFT_KEPT,
  DraftPrompt,
  notify,
  printable,
  theme,
  useDraft,
  useKeys,
  useNav,
  useQuery,
  useRuntime,
  useScreenKeys,
  type Draft,
} from "../../../kernel/tui/api"

export const CAPTURE_TITLE = "Capture to inbox · ctrl+s save · esc cancel"
const SUGGESTIONS = 5
// A tag being typed right before the cursor: the prefix and at least one character, at a word start.
const TYPING_TAG = /(?:^|[\s([])([#@][A-Za-z0-9][A-Za-z0-9-]*)$/
const TAG_REST = /^[A-Za-z0-9-]*/

type Prefill = { tag: string; why: string }
type TextDraft = { text: string }

export function CaptureOverlay(props: { close(): void }) {
  const rt = useRuntime()
  const keys = useKeys()
  const route = useNav().route() // where `i` was pressed
  let area: TextareaRenderable | undefined
  const [text, setText] = createSignal("")
  const [cursor, setCursor] = createSignal(0)
  const [picked, setPicked] = createSignal(0)
  const [saving, setSaving] = createSignal(false)

  // --- the draft: against the text capture starts with (empty, or the prefilled tag) ---
  const [start, setStart] = createSignal("")
  const draft = useDraft<TextDraft>("capture", () => ({ text: start() }))
  const found = draft.saved && typeof draft.saved.values?.text === "string" ? draft.saved : undefined
  const [offer, setOffer] = createSignal<Draft<TextDraft> | undefined>(found && found.values.text !== "" ? found : undefined)
  if (draft.saved && !offer()) draft.discard()
  let restored = false

  const sync = () => {
    if (!area) return
    setText(area.plainText)
    setCursor(area.cursorOffset)
    if (!offer()) draft.schedule({ text: area.plainText })
  }
  const replace = (value: string, at: number) => {
    if (!area) return
    area.setText(value)
    area.cursorOffset = at
    sync()
  }

  // --- the tag of the record being viewed ---
  const context = useQuery(async (): Promise<Prefill | null> => {
    if (route.kind !== "record") return null
    const found = await rt.records.resolve(route.ref)
    if (!found || (found.type !== "project" && found.type !== "person")) return null
    const tag = await rt.records.refOf(found.type, found.id)
    const why = found.type === "project" ? `the ${tag.replace(/^#/, "")} project` : await rt.records.label(tag)
    return { tag, why }
  })
  const [prefill, setPrefill] = createSignal<Prefill | undefined>(undefined)
  createEffect(() => {
    const c = context.data()
    if (!c || prefill() || !area || offer() || restored) return
    setPrefill(c)
    const typed = area.plainText
    if (typed === "") setStart(`${c.tag} `)
    replace(`${c.tag} ${typed}`, c.tag.length + 1 + typed.length)
  })

  const restore = () => {
    const d = offer()
    if (!d) return
    restored = true
    setOffer(undefined)
    replace(d.values.text, d.values.text.length)
  }
  const discardDraft = () => {
    draft.discard()
    setOffer(undefined)
  }
  // A cancel keeps the draft (written now) and says so when it holds something.
  const leave = () => {
    if (draft.kept()) notify(DRAFT_KEPT)
    props.close()
  }

  // --- autocomplete ---
  const word = () => TYPING_TAG.exec(text().slice(0, cursor()))?.[1]
  const search = useQuery(
    async () => {
      const w = word()
      return w === undefined ? [] : rt.tags.suggest(w, SUGGESTIONS)
    },
    { key: () => word() ?? "" },
  )
  const suggestions = () => (word() === undefined ? [] : (search.data() ?? []))
  createEffect(() => {
    word()
    setPicked(0)
  })
  const accept = () => {
    const w = word()
    const s = suggestions()[picked()]
    if (w === undefined || !s) return
    const at = cursor()
    const before = text().slice(0, at - w.length)
    const after = text().slice(at).replace(TAG_REST, "")
    const value = `${before}${s.ref}${after.startsWith(" ") ? "" : " "}${after}`
    replace(value, before.length + s.ref.length + 1)
  }

  // --- save ---
  const save = async () => {
    if (saving() || !area) return
    setSaving(true)
    const value = area.plainText
    const r = await act(() => rt.self().write.capture!({ text: value }) as Promise<{ ref: string }>, { ok: (out) => `captured ${out.ref}` })
    setSaving(false)
    if (r.ok) {
      draft.discard()
      props.close()
    }
  }

  onMount(() => keys.textFocus(true))
  createEffect(() => {
    if (offer()) return // the draft prompt shows its own
    const drop = keys.hints([
      { key: "Enter", label: "new line" },
      { key: "Tab", label: "accept suggestion" },
      { key: "Ctrl+S", label: "save" },
      { key: "Esc", label: "cancel" },
    ])
    onCleanup(drop)
  })

  const esc = createEscChord(leave)

  useScreenKeys((key) => {
    const name = key.name
    if (offer()) return // the draft prompt has the keys
    if (esc.pending()) {
      // The key after Esc: `s` (or Ctrl+S / Alt+S) saves, anything else confirms the cancel.
      key.preventDefault()
      esc.clear()
      if (printable(key) === "s" || (name === "s" && (key.ctrl || key.meta || key.option))) void save()
      else leave()
      return
    }
    if (name === "escape") {
      key.preventDefault()
      if (saving()) return
      draft.flush()
      esc.arm()
    } else if (name === "s" && (key.ctrl || key.meta || key.option)) {
      key.preventDefault()
      void save()
    } else if (name === "linefeed" || name === "return") {
      key.preventDefault()
      area?.insertText("\n")
      sync()
    } else if (name === "tab") {
      key.preventDefault()
      accept()
    } else if ((name === "up" || name === "down") && suggestions().length > 0) {
      key.preventDefault()
      const d = name === "up" ? -1 : 1
      setPicked((p) => Math.min(suggestions().length - 1, Math.max(0, p + d)))
    }
  }, { whileTyping: true })

  return (
    <box border borderColor={theme.accent} backgroundColor={theme.panel} flexDirection="column" width="80%" paddingLeft={1} paddingRight={1} title={CAPTURE_TITLE}>
      <Show when={offer()}>
        {(d: () => Draft<TextDraft>) => <DraftPrompt savedAt={d().savedAt} restore={restore} discard={discardDraft} close={() => props.close()} />}
      </Show>
      <textarea
        ref={(r: TextareaRenderable) => (area = r)}
        focused={keys.active() && !offer()}
        height={3}
        backgroundColor={theme.selectedBg}
        focusedBackgroundColor={theme.selectedBg}
        textColor={theme.text}
        focusedTextColor={theme.text}
        onContentChange={sync}
        onCursorChange={sync}
      />
      <For each={suggestions()}>
        {(s, i) => (
          <box flexDirection="row" backgroundColor={i() === picked() ? theme.selectedBg : theme.panel}>
            <text fg={i() === picked() ? theme.accent : theme.text}>{`${s.ref}  ${s.label}`}</text>
          </box>
        )}
      </For>
      <Show when={prefill()}>{(p: () => Prefill) => <text fg={theme.muted}>{`${p().tag} added because you're on ${p().why}`}</text>}</Show>
      <Show when={saving()}>
        <text fg={theme.muted}>saving…</text>
      </Show>
    </box>
  )
}
