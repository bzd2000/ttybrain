// All TUI colours (spec §9). Components and plugin parts take colours from here, never inline.
import type { Tone } from "./types"

export const theme = {
  bg: "#11131a",
  panel: "#181b24",
  border: "#2e3442",
  borderFocused: "#7aa2f7",
  text: "#c0caf5",
  muted: "#737aa2",
  accent: "#7aa2f7",
  selectedBg: "#283457",
  red: "#f7768e",
  amber: "#e0af68",
  green: "#9ece6a",
  // Project codes and #tags.
  cyan: "#7dcfff",
  // People names and @tags.
  magenta: "#bb9af7",
} as const

// The colour of a semantic tone; no tone is the normal text colour.
export function toneColor(tone: Tone): string {
  return tone === undefined ? theme.text : theme[tone]
}
