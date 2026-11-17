// The restore prompt of a draft (drafts.ts), shown by Form, Editor and quick capture before they take keys:
// `Unsaved draft from HH:MM · r restore · x discard` (with the date when the draft is not from today). It claims
// every key, so none reaches the field below or the global keys: `r` restores, `x` discards, Esc closes the
// whole overlay (leaving the draft).
import { onCleanup } from "solid-js"
import { printable, useKeys, useScreenKeys } from "../keys"
import { useToday } from "../data"
import { draftPromptText } from "../drafts"
import { theme } from "../theme"

export function DraftPrompt(props: { savedAt: string; restore(): void; discard(): void; close(): void }) {
  const today = useToday()
  onCleanup(useKeys().hints([
    { key: "r", label: "restore draft" },
    { key: "x", label: "discard draft" },
    { key: "Esc", label: "close" },
  ]))
  useScreenKeys(
    (key) => {
      key.preventDefault()
      const ch = printable(key)
      if (ch === "r") props.restore()
      else if (ch === "x") props.discard()
      else if (key.name === "escape") props.close()
    },
    { whileTyping: true },
  )
  return <text fg={theme.amber}>{draftPromptText(props.savedAt, today())}</text>
}
