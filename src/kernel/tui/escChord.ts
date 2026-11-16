// The Esc-then-letter chord shared by Form and Editor: Esc arms it, the next key is the chord's second key
// (`s` saves), and if none arrives within ESC_WINDOW_MS `timeout` runs. Alt+S, which is how a fast Esc s
// arrives from a terminal, is handled by the callers as a plain save key.
import { onCleanup } from "solid-js"

export const ESC_WINDOW_MS = 1000

export type EscChord = { pending(): boolean; arm(): void; clear(): void }

export function createEscChord(timeout: () => void): EscChord {
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  onCleanup(clear)
  return {
    pending: () => timer !== undefined,
    arm() {
      timer = setTimeout(() => {
        timer = undefined
        timeout()
      }, ESC_WINDOW_MS)
      ;(timer as { unref?: () => void }).unref?.()
    },
    clear,
  }
}
