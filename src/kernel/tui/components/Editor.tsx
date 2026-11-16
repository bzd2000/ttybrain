// <Editor>: the full-screen long-text overlay (useOverlay().openEditor). Edits stay in the overlay until saved.
// Ctrl+S (Alt+S), or Esc then `s`, saves; Esc then `d` (Alt+D) discards, after `confirm("Discard changes?")` when
// the text differs from `initial`; Esc then anything else, or no key within
// ESC_WINDOW_MS, goes back to editing (never discards). A failed save shows its error and keeps the text; while
// a save is in flight further saves and Esc are ignored. Holds text focus while open.
import type { TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, onMount, Show } from "solid-js"
import { runWithContext } from "../../context"
import { createEscChord } from "../escChord"
import { printable, useKeys, useScreenKeys } from "../keys"
import { useApp } from "../scope"
import { theme } from "../theme"

export type EditorOptions = {
  title: string
  initial: string
  save(text: string): Promise<{ ok: true } | { ok: false; error: unknown }>
}

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

  const esc = createEscChord(() => setArmed(false))
  const disarm = () => {
    esc.clear()
    setArmed(false)
  }

  onMount(() => {
    keys.textFocus(true)
    keys.hints([
      { key: "Ctrl+S", label: "save" },
      { key: "Esc s", label: "save" },
      { key: "Esc d", label: "discard" },
    ])
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
      if (result.ok) return props.close()
      setError(result.error instanceof Error ? result.error.message : String(result.error))
    }
    void track(run())
  }

  const discard = () => {
    if (saving()) return
    if ((area?.plainText ?? props.initial) === props.initial) return props.close()
    void props.confirm(DISCARD_QUESTION).then((yes) => yes && props.close())
  }

  useScreenKeys((key) => {
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
      <textarea
        ref={(r: TextareaRenderable) => (area = r)}
        initialValue={props.initial}
        focused={keys.active() && !armed()}
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
