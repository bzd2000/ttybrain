// <Editor>: the full-screen long-text overlay (useOverlay().openEditor). Edits stay in the overlay until saved.
// Ctrl+S (Alt+S), or Esc then `s`, saves; Esc then `d` (Alt+D) discards, after `confirm("Discard changes?")` when
// the text differs from `initial`; Esc then anything else, or no key within
// ESC_WINDOW_MS, goes back to editing (never discards). A failed save shows its error and keeps the text; while
// a save is in flight further saves and Esc are ignored. Holds text focus while open.
// With `draftKey` the unsaved text is kept as a draft (drafts.ts): written a moment after typing stops and at once
// on Esc and quit, deleted by a save or a confirmed discard; reopened with a draft that differs from
// `initial`, the editor first shows <DraftPrompt> (r restore · x discard · Esc close). Without it, no draft.
import type { TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { runWithContext } from "../../context"
import { DRAFT_KEPT, useDraftKey, type Draft } from "../drafts"
import { createEscChord } from "../escChord"
import { printable, useKeys, useScreenKeys } from "../keys"
import { notify } from "../messages"
import { useApp } from "../scope"
import { theme } from "../theme"
import { DraftPrompt } from "./DraftPrompt"

export type EditorOptions = {
  title: string
  initial: string
  save(text: string): Promise<{ ok: true } | { ok: false; error: unknown }>
  // Keeps the unsaved text as a draft under this key (unique within the calling plugin; the kernel prefixes the
  // plugin id). Without it the editor keeps no draft.
  draftKey?: string
}

type TextDraft = { text: string }

export const DISCARD_QUESTION = "Discard changes?"

// `confirm` is the overlay service's (passed in by overlay.tsx, which imports this file).
export function Editor(props: EditorOptions & { close(): void; confirm(text: string): Promise<boolean> }) {
  const { kernel, track } = useApp()
  const keys = useKeys()
  const dims = useTerminalDimensions()
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [armed, setArmed] = createSignal(false)
  let area: TextareaRenderable | undefined

  const draft = useDraftKey<TextDraft>(props.draftKey, () => ({ text: props.initial }))
  const found = draft.saved && typeof draft.saved.values?.text === "string" ? draft.saved : undefined
  const [offer, setOffer] = createSignal<Draft<TextDraft> | undefined>(found && found.values.text !== props.initial ? found : undefined)
  if (draft.saved && !offer()) draft.discard()
  const restore = () => {
    const d = offer()
    setOffer(undefined)
    if (d) area?.setText(d.values.text)
  }
  const discardDraft = () => {
    draft.discard()
    setOffer(undefined)
  }
  const changed = () => {
    if (!offer() && area) draft.schedule({ text: area.plainText })
  }
  const leave = () => {
    if (draft.kept()) notify(DRAFT_KEPT)
    props.close()
  }

  const esc = createEscChord(() => setArmed(false))
  const disarm = () => {
    esc.clear()
    setArmed(false)
  }

  onMount(() => keys.textFocus(true))
  createEffect(() => {
    if (offer()) return // the draft prompt shows its own
    const drop = keys.hints([
      { key: "Ctrl+S", label: "save" },
      { key: "Esc s", label: "save" },
      { key: "Esc d", label: "discard" },
    ])
    onCleanup(drop)
  })

  const save = () => {
    if (saving()) return
    setSaving(true)
    setError(undefined)
    const run = async () => {
      let result: Awaited<ReturnType<EditorOptions["save"]>>
      try {
        result = await runWithContext(kernel.context(), () => props.save(area?.plainText ?? props.initial))
      } catch (e) {
        result = { ok: false, error: e }
      }
      setSaving(false)
      if (result.ok) {
        draft.discard()
        return props.close()
      }
      setError(result.error instanceof Error ? result.error.message : String(result.error))
    }
    void track(run())
  }

  const discard = () => {
    if (saving()) return
    draft.flush()
    if ((area?.plainText ?? props.initial) === props.initial) return leave()
    // A confirmed discard throws the draft away too; answering no keeps editing (and the draft).
    void props.confirm(DISCARD_QUESTION).then((yes) => {
      if (!yes) return
      draft.discard()
      props.close()
    })
  }

  useScreenKeys((key) => {
    if (offer()) return // the draft prompt has the keys
    if (esc.pending()) {
      key.preventDefault()
      disarm()
      const ch = printable(key)
      if (ch === "s") save()
      else if (ch === "d") discard()
      return
    }
    if (key.name === "escape") {
      key.preventDefault()
      if (saving()) return
      draft.flush()
      setArmed(true)
      esc.arm()
    } else if (key.name === "s" && (key.ctrl || key.meta || key.option)) {
      key.preventDefault()
      save()
    } else if (key.name === "d" && (key.meta || key.option) && !key.ctrl) {
      // A fast Esc d arrives as one Alt+D key press.
      key.preventDefault()
      discard()
    }
  }, { whileTyping: true })

  return (
    <box
      border
      borderColor={theme.accent}
      backgroundColor={theme.panel}
      flexDirection="column"
      width="100%"
      height={Math.max(5, dims().height - 3)}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme.accent}>{`${props.title} · ctrl+s save · esc s save · esc d discard`}</text>
      <Show when={offer()}>
        {(d: () => Draft<TextDraft>) => <DraftPrompt savedAt={d().savedAt} restore={restore} discard={discardDraft} close={() => props.close()} />}
      </Show>
      <textarea
        ref={(r: TextareaRenderable) => (area = r)}
        initialValue={props.initial}
        focused={keys.active() && !armed() && !offer()}
        onContentChange={changed}
        flexGrow={1}
        backgroundColor={theme.panel}
        focusedBackgroundColor={theme.panel}
        textColor={theme.text}
        focusedTextColor={theme.text}
      />
      <Show when={armed()}>
        <text fg={theme.muted}>esc: s save · d discard · any other key keeps editing</text>
      </Show>
      <Show when={saving()}>
        <text fg={theme.muted}>saving…</text>
      </Show>
      <Show when={error()}>
        <text fg={theme.red}>{`✗ ${error()}`}</text>
      </Show>
    </box>
  )
}
