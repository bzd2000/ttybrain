// The quick-capture overlay (`i` on any screen). A multi-line text: Enter saves through `capture` and closes with
// `captured I-n`; Shift+Enter or Ctrl+J (the one every terminal sends distinctly) insert a newline; Esc cancels.
// While the word at the cursor is a tag being typed (`#cr`, `@ma`), up to 5 `tags.suggest` results show: ↑↓ pick,
// Tab replaces the word with the ref and a space. On a project's or a person's record view, the text starts with
// its tag and a line says why.
import type { TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal, For, onMount, Show } from "solid-js"
import { act, theme, useKeys, useNav, useQuery, useRuntime, useScreenKeys } from "../../../kernel/tui/api"

export const CAPTURE_TITLE = "Capture to inbox · enter save · esc cancel"
const SUGGESTIONS = 5
// A tag being typed right before the cursor: the prefix and at least one character, at a word start.
const TYPING_TAG = /(?:^|[\s([])([#@][A-Za-z0-9][A-Za-z0-9-]*)$/
const TAG_REST = /^[A-Za-z0-9-]*/

type Prefill = { tag: string; why: string }

export function CaptureOverlay(props: { close(): void }) {
  const rt = useRuntime()
  const keys = useKeys()
  const route = useNav().route() // where `i` was pressed
  let area: TextareaRenderable | undefined
  const [text, setText] = createSignal("")
  const [cursor, setCursor] = createSignal(0)
  const [picked, setPicked] = createSignal(0)
  const [saving, setSaving] = createSignal(false)

  const sync = () => {
    if (!area) return
    setText(area.plainText)
    setCursor(area.cursorOffset)
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
    if (!c || prefill() || !area) return
    setPrefill(c)
    const typed = area.plainText
    replace(`${c.tag} ${typed}`, c.tag.length + 1 + typed.length)
  })

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
    if (r.ok) props.close()
  }

  onMount(() => {
    keys.textFocus(true)
    keys.hints([
      { key: "Enter", label: "save" },
      { key: "Tab", label: "accept suggestion" },
      { key: "Ctrl+J", label: "new line" },
      { key: "Esc", label: "cancel" },
    ])
  })

  useScreenKeys((key) => {
    const name = key.name
    if (name === "escape") {
      key.preventDefault()
      if (!saving()) props.close()
    } else if (name === "linefeed" || (name === "return" && (key.shift || key.meta || key.option))) {
      key.preventDefault()
      area?.insertText("\n")
      sync()
    } else if (name === "return") {
      key.preventDefault()
      void save()
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
      <textarea
        ref={(r: TextareaRenderable) => (area = r)}
        focused={keys.active()}
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
