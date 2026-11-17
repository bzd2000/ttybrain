// Status-bar messages: notify() replaces the key hints with a message for 5 s (spec §10). One message at a time;
// a newer one replaces the older and restarts the timer. Callable from anywhere (components, data hooks).
import { createSignal } from "solid-js"

export type Message = { text: string; kind: "info" | "error" }

const DEFAULT_TIMEOUT_MS = 5000
let timeoutMs = DEFAULT_TIMEOUT_MS
let timer: ReturnType<typeof setTimeout> | undefined
const [message, setMessage] = createSignal<Message | null>(null)

export const currentMessage = message

export function notify(text: string, kind: "info" | "error" = "info"): void {
  if (timer !== undefined) clearTimeout(timer)
  setMessage({ text, kind })
  timer = setTimeout(() => {
    timer = undefined
    setMessage(null)
  }, timeoutMs)
  // A pending message must not keep the process alive after the TUI has quit.
  ;(timer as { unref?: () => void }).unref?.()
}

export function clearMessages(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  setMessage(null)
}

// Test hook: a shorter message lifetime (no argument restores 5000 ms).
export function setMessageTimeout(ms: number = DEFAULT_TIMEOUT_MS): void {
  timeoutMs = ms
}
