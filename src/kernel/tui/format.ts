// Display formatting for the TUI: terminal display width, truncation and dates. Dates are ISO strings
// (YYYY-MM-DD) from the kernel clock, read as UTC calendar dates, so the result never depends on the time zone.
import { daysBetween, weekday, weekEnd } from "../dates"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const ELLIPSIS = "…"

// --- display width ---

// East Asian Wide and Fullwidth ranges (the common blocks: Hangul Jamo, CJK, kana, Hangul syllables, fullwidth forms).
const WIDE: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
]
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}​-‏︀-️]*$/u
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function isWide(cp: number): boolean {
  return WIDE.some(([lo, hi]) => cp >= lo && cp <= hi)
}

function graphemeWidth(g: string): number {
  if (EMOJI.test(g)) return 2
  if (ZERO_WIDTH.test(g)) return 0
  return isWide(g.codePointAt(0)!) ? 2 : 1
}

function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), (x) => x.segment)
}

// The number of terminal cells `s` takes: East Asian wide characters and emoji count 2.
export function displayWidth(s: string): number {
  let n = 0
  for (const g of graphemes(s)) n += graphemeWidth(g)
  return n
}

// A column width that fits the widest of `texts`, kept between `min` and `max` cells: a column that grows with
// what it shows (a code column), so short values keep the usual layout.
export function fitWidth(texts: readonly string[], min: number, max: number): number {
  return Math.min(max, Math.max(min, ...texts.map(displayWidth)))
}

// `items` joined with spaces in at most `width` cells, never cutting an item: whole items while they fit, then ` …`
// for the rest. The first item stands alone (without the `…`) when the two do not fit together; give a column at
// least the width of its widest item (fitWidth) and it always fits.
export function joinFit(items: readonly string[], width: number): string {
  const all = items.join(" ")
  if (displayWidth(all) <= width) return all
  let out = ""
  for (const item of items) {
    const next = out === "" ? item : `${out} ${item}`
    if (displayWidth(`${next} ${ELLIPSIS}`) > width) break
    out = next
  }
  if (out !== "") return `${out} ${ELLIPSIS}`
  return displayWidth(items[0]!) <= width ? items[0]! : ELLIPSIS
}

// `s` cut to at most `width` cells, ending with `…` when it was cut.
export function truncate(s: string, width: number): string {
  if (displayWidth(s) <= width) return s
  if (width <= 0) return ""
  const budget = width - 1
  let out = ""
  let used = 0
  for (const g of graphemes(s)) {
    const w = graphemeWidth(g)
    if (used + w > budget) break
    out += g
    used += w
  }
  return out + ELLIPSIS
}

// --- dates ---

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number]
  return { y, m, d }
}

// `13 Nov`
export function shortDate(iso: string): string {
  const { m, d } = parts(iso)
  return `${d} ${MONTHS[m - 1]}`
}

// `Fri 13 Nov 2026`
export function longDate(iso: string): string {
  return `${WEEKDAYS[weekday(iso)]} ${shortDate(iso)} ${parts(iso).y}`
}

// A due date relative to today: `-3d` when overdue, `today`, the weekday up to the end of this week (Sunday),
// otherwise `26 Nov`; `—` for none.
export function dueLabel(date: string | null, today: string): string {
  if (date === null) return "—"
  const days = daysBetween(today, date)
  if (days < 0) return `${days}d`
  if (days === 0) return "today"
  if (date <= weekEnd(today)) return WEEKDAYS[weekday(date)]!
  return shortDate(date)
}
