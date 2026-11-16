export interface Clock {
  today(): string
  now(): string
}

const pad = (n: number) => String(n).padStart(2, "0")

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const systemClock: Clock = {
  today: () => localDate(new Date()),
  now: () => {
    const d = new Date()
    return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  },
}

export function fixedClock(today: string, time = "09:00:00"): Clock {
  return { today: () => today, now: () => `${today}T${time}` }
}
