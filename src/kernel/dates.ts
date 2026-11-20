import { ValidationError } from "./errors"

const DAY_MS = 86_400_000
const HINT = "use YYYY-MM-DD, today, tomorrow, +3d, +2w or mon…sun"
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

const pad = (n: number) => String(n).padStart(2, "0")

function toMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

function fromMs(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  return fromMs(toMs(s)) === s
}

export function addDays(date: string, n: number): string {
  return fromMs(toMs(date) + n * DAY_MS)
}

// 0 = Sunday … 6 = Saturday.
export function weekday(date: string): number {
  return new Date(toMs(date)).getUTCDay()
}

// Whole days from `from` to `to` (negative when `to` is earlier).
export function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS)
}

export function weekEnd(today: string): string {
  return addDays(today, (7 - weekday(today)) % 7)
}

export function parseDate(input: string, today: string): string {
  const s = input.trim().toLowerCase()
  if (isValidDate(s)) return s
  if (s === "today") return today
  if (s === "tomorrow") return addDays(today, 1)
  const rel = /^\+(\d+)([dw])$/.exec(s)
  if (rel) return addDays(today, Number(rel[1]) * (rel[2] === "w" ? 7 : 1))
  const idx = DAYS.indexOf(s)
  if (idx >= 0) {
    const ahead = ((idx - weekday(today) + 6) % 7) + 1 // 1..7: next such day after today
    return addDays(today, ahead)
  }
  throw new ValidationError(`invalid date "${input}"`, { field: "date", hint: HINT })
}

// --- display formats (the TUI and report lines; ISO in, read as UTC calendar dates) ---

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number]
  return { y, m, d }
}

// `13 Nov`
export function shortDate(iso: string): string {
  const { m, d } = parts(iso)
  return `${d} ${MONTHS[m - 1]}`
}

// `Fri 13 Nov`
export function dayDate(iso: string): string {
  return `${WEEKDAYS[weekday(iso)]} ${shortDate(iso)}`
}

// `Fri 13 Nov 2026`
export function longDate(iso: string): string {
  return `${dayDate(iso)} ${parts(iso).y}`
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
