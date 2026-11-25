// Rhythms (design §5.2): the short phrase a series repeats by, the dates it gives and how it reads back. Pure: dates
// are ISO calendar dates, compared as strings. Days are 0 = Sunday … 6 = Saturday.
import { addDays, dayDate, daysBetween, parseDate, shortDate, ValidationError } from "@ttybrain/api"

export type Rhythm =
  | { every: "weeks"; weeks: number; day: number } // weekly on <day> (weeks 1), every <n> weeks on <day>
  | { every: "month"; nth: 1 | 2 | 3 | 4 | -1; day: number } // monthly on the <1st|2nd|3rd|4th|last> <day>
  | { every: "month-day"; date: number } // monthly on day <n> (the month's last day when it is shorter)

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const NTH: Record<string, 1 | 2 | 3 | 4 | -1> = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, last: -1 }
const nthText = (n: number) => Object.keys(NTH).find((k) => NTH[k] === n)!
const HINT = "use weekly on <day>, every <n> weeks on <day>, monthly on the <1st|2nd|3rd|4th|last> <day> or monthly on day <n>"
const SUNDAY = "2023-01-01"

const dayOf = (word: string): number | undefined => {
  const i = DAYS.findIndex((d) => d === word || d.slice(0, 3) === word)
  return i < 0 ? undefined : i
}
const weekday = (iso: string) => (((daysBetween(SUNDAY, iso) % 7) + 7) % 7)
const pad = (n: number) => String(n).padStart(2, "0")
const daysIn = (y: number, m: number) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

export function parseRhythm(text: string): Rhythm {
  const s = text.trim().toLowerCase().replace(/\s+/g, " ")
  const bad = () => new ValidationError(`invalid rhythm "${text}"`, { field: "every", hint: HINT })
  let m = /^weekly on (\w+)$/.exec(s)
  if (m) {
    const day = dayOf(m[1]!)
    if (day === undefined) throw bad()
    return { every: "weeks", weeks: 1, day }
  }
  m = /^(?:every )?(\d+) weeks? on (\w+)$/.exec(s)
  if (m) {
    const weeks = Number(m[1])
    const day = dayOf(m[2]!)
    if (day === undefined || weeks < 1) throw bad()
    return { every: "weeks", weeks, day }
  }
  m = /^monthly on the (1st|2nd|3rd|4th|last) (\w+)$/.exec(s)
  if (m) {
    const day = dayOf(m[2]!)
    if (day === undefined) throw bad()
    return { every: "month", nth: NTH[m[1]!]!, day }
  }
  m = /^monthly on day (\d+)$/.exec(s)
  if (m) {
    const date = Number(m[1])
    if (date < 1 || date > 31) throw bad()
    return { every: "month-day", date }
  }
  throw bad()
}

// The canonical phrase, as stored on a series: `weekly on mon`, `every 2 weeks on wed`, `monthly on the 4th tue`,
// `monthly on day 15`.
export function rhythmText(r: Rhythm): string {
  if (r.every === "weeks") return r.weeks === 1 ? `weekly on ${DAYS[r.day]!.slice(0, 3)}` : `every ${r.weeks} weeks on ${DAYS[r.day]!.slice(0, 3)}`
  if (r.every === "month") return `monthly on the ${nthText(r.nth)} ${DAYS[r.day]!.slice(0, 3)}`
  return `monthly on day ${r.date}`
}

// How a rhythm reads on screen: "short" for a narrow column (`every 2 wk Mon`), "long" where there is room
// (`every 2 weeks, Monday`). Monthly ones read the same in both (`monthly, 4th Tue`, `monthly, day 15`).
export function rhythmLabel(r: Rhythm, form: "short" | "long"): string {
  if (r.every === "weeks") {
    if (r.weeks === 1) return form === "short" ? `weekly ${SHORT[r.day]}` : `weekly, ${LONG[r.day]}`
    return form === "short" ? `every ${r.weeks} wk ${SHORT[r.day]}` : `every ${r.weeks} weeks, ${LONG[r.day]}`
  }
  if (r.every === "month") return `monthly, ${nthText(r.nth)} ${SHORT[r.day]}`
  return `monthly, day ${r.date}`
}

// The dates the rhythm gives from `first` on, within [from, to] and not after `end`, in order. Every n weeks counts
// from the first such day on or after `first`.
export function rhythmDates(r: Rhythm, first: string, from: string, to: string, end?: string | null): string[] {
  const lo = first > from ? first : from
  const hi = end !== undefined && end !== null && end < to ? end : to
  if (lo > hi) return []
  const out: string[] = []
  if (r.every === "weeks") {
    const start = addDays(first, (r.day - weekday(first) + 7) % 7)
    const step = 7 * r.weeks
    const skip = start >= lo ? 0 : Math.ceil(daysBetween(start, lo) / step)
    for (let d = addDays(start, skip * step); d <= hi; d = addDays(d, step)) out.push(d)
    return out
  }
  let [y, m] = lo.split("-").map(Number) as [number, number]
  while (iso(y, m, 1) <= hi) {
    const d = r.every === "month-day" ? iso(y, m, Math.min(r.date, daysIn(y, m))) : nthWeekday(y, m, r.nth, r.day)
    if (d >= lo && d <= hi) out.push(d)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

function nthWeekday(y: number, m: number, nth: number, day: number): string {
  if (nth > 0) return iso(y, m, 1 + ((day - weekday(iso(y, m, 1)) + 7) % 7) + 7 * (nth - 1))
  const last = daysIn(y, m)
  return iso(y, m, last - ((weekday(iso(y, m, last)) - day + 7) % 7))
}

// How the series form reads a rhythm back (the `series` design): the next four dates from `from` (today when empty),
// `→ Wed 25 Nov, 9 Dec, 23 Dec, 6 Jan …`; nothing while it is empty, not a rhythm (yet: it is being typed; saving
// one says which phrases it understands) or the first date does not parse.
export function rhythmPreview(every: string | null | undefined, from: string | null | undefined, today: string): string | undefined {
  if (every === null || every === undefined || every.trim() === "") return undefined
  let first = today
  if (from !== null && from !== undefined && from.trim() !== "") {
    try {
      first = parseDate(from, today)
    } catch {
      return undefined
    }
  }
  let r: Rhythm
  try {
    r = parseRhythm(every)
  } catch {
    return undefined
  }
  // A year ahead holds four dates of any rhythm.
  const dates = rhythmDates(r, first, first, addDays(first, 366)).slice(0, 4)
  return `→ ${dates.map((d, i) => (i === 0 ? dayDate(d) : shortDate(d))).join(", ")} …`
}

// The first date a rhythm gives from `today` on (the series form's default first date); undefined when it is not one.
export function rhythmFirst(every: string | null | undefined, today: string): string | undefined {
  if (every === null || every === undefined || every.trim() === "") return undefined
  try {
    return rhythmDates(parseRhythm(every), today, today, addDays(today, 366))[0]
  } catch {
    return undefined
  }
}

// The phrases the series form offers for a first date (its Occurrence list), canonical and in this order: weekly,
// every 2 and every 4 weeks on its weekday; monthly on its nth weekday (1st-4th) and on the last one when it is the
// month's last such day; monthly on its day of the month. Each gives `date` itself as its first date.
export function rhythmChoices(date: string): string[] {
  const day = weekday(date)
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  const nth = Math.ceil(d / 7)
  const out: Rhythm[] = [
    { every: "weeks", weeks: 1, day },
    { every: "weeks", weeks: 2, day },
    { every: "weeks", weeks: 4, day },
  ]
  if (nth <= 4) out.push({ every: "month", nth: nth as 1 | 2 | 3 | 4, day })
  if (d + 7 > daysIn(y, m)) out.push({ every: "month", nth: -1, day })
  out.push({ every: "month-day", date: d })
  return out.map(rhythmText)
}
