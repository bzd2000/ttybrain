// The quick-capture overlay (`i` on any screen), as the screen design draws it: the panel `Capture to inbox` with
// `ctrl+s save · esc cancel` on its bottom border, the text in its own accent-bordered box with `#tags` cyan and
// `@tags` magenta, the suggestions in a bordered box (the tag, then the label and a muted detail: a person's role),
// and under a blank line the prefill note. A multi-line text: Enter inserts a newline; Ctrl+S, or Esc then
// `s` (a fast Esc s arrives as Alt+S, which saves too), saves through `capture` and closes with `captured I-n`;
// Esc not followed by `s` within ESC_WINDOW_MS cancels. While saving, further saves and Esc are ignored.
// While the word at the cursor is a tag being typed (`#cr`, `@ma`), up to 5 `tags.suggest` results show: ↑↓ pick,
// Tab replaces the word with the ref and a space. On a project's or a person's record view, the text starts with
// its tag and a line says why.
// The text is kept as a draft (`inbox:capture`): a cancel keeps it (`draft kept`), a save deletes it, and the next
// capture first offers it (r restore · x discard · Esc close); a restored draft takes the place of the prefill.
// Capture routes (TuiContext.captureRoute, the meetings plugin's `talk @anna …`): the first route whose preview of the
// text is not null has it. Its lines show under the input, after a blank line; the panel is titled `Capture` and
// Ctrl+S saves through the route (its message in the status bar). A `declined` preview (text that looks like the
// route's but is not) only shows its lines: the text still goes to the inbox, as does text no route takes.
import { SyntaxStyle, type TextareaRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import {
  act,
  createEscChord,
  matchCapture,
  DRAFT_KEPT,
  DraftPrompt,
  fitWidth,
  notify,
  Panel,
  printable,
  theme,
  toneColor,
  truncate,
  useDraft,
  useKeys,
  useNav,
  useQuery,
  useCaptureRoutes,
  useRuntime,
  useScreenKeys,
  type CaptureMatch,
  type CellPart,
  type Draft,
} from "@ttybrain/api/tui"
import { tagRanges, tagTone } from "./tags"

// The designs' capture overlay is 76 cells wide (the kernel centres it); never wider than the terminal.
const CAPTURE_WIDTH = 76
export const CAPTURE_TITLE = "Capture to inbox"
// The title while a route takes the text (the `capture` design of 2026-11-20).
export const ROUTED_TITLE = "Capture"
const CAPTURE_FOOTER = "ctrl+s save · esc cancel"
// The suggestion box's width, and its tag column's: the designs' 10 cells, growing to the longest tag shown (a
// 16-character code and its `#`) so tags stay whole.
const SUGGEST_WIDTH = 46
const SUGGEST_TAG = { min: 10, max: 17 }
// The text box grows with its lines up to this many, then scrolls.
const MAX_LINES = 6
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
  const renderer = useRenderer()
  let area: TextareaRenderable | undefined
  const [text, setText] = createSignal("")
  const [cursor, setCursor] = createSignal(0)

  // --- the tags' colours inside the text ---
  const style = SyntaxStyle.fromStyles({ cyan: { fg: theme.cyan }, magenta: { fg: theme.magenta } }, renderer.nativeScene)
  onCleanup(() => style.destroy())
  const highlight = () => {
    if (!area) return
    area.clearAllHighlights()
    for (const t of tagRanges(area.plainText)) {
      const tone = tagTone(t.prefix)
      const id = tone === undefined ? null : style.getStyleId(tone)
      if (id !== null) area.addHighlightByCharRange({ start: t.start, end: t.end, styleId: id })
    }
  }
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
    if (area.plainText !== text()) highlight()
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
  const tagWidth = () => fitWidth(suggestions().map((s) => s.ref), SUGGEST_TAG.min, SUGGEST_TAG.max)
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

  // --- capture routes: where the text goes ---
  const routes = useCaptureRoutes()
  const target = useQuery(() => matchCapture(routes, text()), { key: () => text() })
  const routed = (m: CaptureMatch | null | undefined): m is CaptureMatch => m !== null && m !== undefined && m.preview.declined !== true
  const previewLines = (): CellPart[][] => target.data()?.preview.lines ?? []

  // --- save ---
  const save = async () => {
    if (saving() || !area) return
    setSaving(true)
    const value = area.plainText
    const match = routes.length === 0 ? null : await matchCapture(routes, value)
    let ok = false
    if (routed(match)) {
      try {
        notify(await match.route.submit(value), "info")
        ok = true
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), "error")
      }
    } else {
      const r = await act(() => rt.self().write.capture!({ text: value }) as Promise<{ ref: string }>, { ok: (out) => `captured ${out.ref}` })
      ok = r.ok
    }
    setSaving(false)
    if (ok) {
      draft.discard()
      props.close()
    }
  }

  onMount(() => keys.textFocus(true))
  createEffect(() => {
    if (offer()) return // the draft prompt shows its own
    // As the design's bar, with Ctrl+S for save (Enter is a new line, design §3).
    const drop = keys.hints([
      { key: "Ctrl+S", label: "save" },
      { key: "Tab", label: "accept suggestion" },
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
    <box width={CAPTURE_WIDTH} maxWidth="100%" flexDirection="column">
      <Panel title={routed(target.data()) ? ROUTED_TITLE : CAPTURE_TITLE} footer={CAPTURE_FOOTER} focused>
        <Show when={offer()}>
          {(d: () => Draft<TextDraft>) => <DraftPrompt savedAt={d().savedAt} restore={restore} discard={discardDraft} close={() => props.close()} />}
        </Show>
        <box border borderStyle="rounded" borderColor={theme.borderFocused} backgroundColor={theme.bg} paddingLeft={1} paddingRight={1}>
          <textarea
            ref={(r: TextareaRenderable) => (area = r)}
            focused={keys.active() && !offer()}
            minHeight={1}
            maxHeight={MAX_LINES}
            wrapMode="word"
            syntaxStyle={style}
            backgroundColor={theme.bg}
            focusedBackgroundColor={theme.bg}
            textColor={theme.text}
            focusedTextColor={theme.text}
            onContentChange={sync}
            onCursorChange={sync}
          />
        </box>
        <Show when={suggestions().length > 0}>
          <box border borderStyle="rounded" borderColor={theme.border} width={SUGGEST_WIDTH} maxWidth="100%" flexDirection="column" paddingLeft={1} paddingRight={1}>
            <For each={suggestions()}>
              {(s, i) => (
                <box flexDirection="row" height={1} backgroundColor={i() === picked() ? theme.selectedBg : theme.bg}>
                  <text fg={toneColor(tagTone(s.ref.slice(0, 1)))} width={tagWidth()} flexShrink={0} wrapMode="none">
                    {truncate(s.ref, tagWidth())}
                  </text>
                  <text fg={theme.text} marginLeft={2} flexShrink={0} wrapMode="none">
                    {s.label}
                  </text>
                  <Show when={s.detail}>
                    {(d: () => string) => (
                      <text fg={theme.muted} flexShrink={1} wrapMode="none">
                        {` · ${d()}`}
                      </text>
                    )}
                  </Show>
                </box>
              )}
            </For>
          </box>
        </Show>
        <Show when={previewLines().length > 0}>
          <box flexDirection="column">
            <text> </text>
            <For each={previewLines()}>
              {(l) => (
                <box flexDirection="row" height={1} overflow="hidden">
                  <For each={l}>
                    {(p) => (
                      <text fg={toneColor(p.tone)} flexShrink={0} wrapMode="none">
                        {p.text}
                      </text>
                    )}
                  </For>
                </box>
              )}
            </For>
          </box>
        </Show>
        <Show when={prefill()}>
          {(p: () => Prefill) => (
            <box flexDirection="column">
              <text> </text>
              <box flexDirection="row">
                <text fg={toneColor(tagTone(p().tag.slice(0, 1)))} flexShrink={0}>
                  {p().tag}
                </text>
                <text fg={theme.muted}>{` added because you're on ${p().why}`}</text>
              </box>
            </box>
          )}
        </Show>
        <Show when={saving()}>
          <text fg={theme.muted}>saving…</text>
        </Show>
      </Panel>
    </box>
  )
}
