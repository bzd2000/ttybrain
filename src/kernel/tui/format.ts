// Display formatting for the TUI. Dates are ISO strings (YYYY-MM-DD) from the kernel clock; they are read as
// UTC calendar dates, so the result never depends on the local time zone.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function parts(iso: string): { y: number; m: number; d: number; weekday: number } {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number]
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}

// `Fri 13 Nov 2026`
export function longDate(iso: string): string {
  const { y, m, d, weekday } = parts(iso)
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]} ${y}`
}
