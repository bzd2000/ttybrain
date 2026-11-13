export function formatRef(prefix: string, id: number): string {
  return `${prefix}${id}`
}

export function parseRef(input: string, prefix: string): number | null {
  const s = input.trim()
  const rest = s.toLowerCase().startsWith(prefix.toLowerCase()) ? s.slice(prefix.length) : s
  return /^\d+$/.test(rest) ? Number(rest) : null
}

export function makeHandle(name: string, taken: (h: string) => boolean): string {
  const first = name.trim().split(/\s+/)[0] ?? ""
  const base =
    first
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "") || "person"
  if (!taken(base)) return base
  for (let n = 2; ; n++) if (!taken(`${base}${n}`)) return `${base}${n}`
}

export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase()
}

export function isValidCode(s: string): boolean {
  return /^[A-Z0-9]{2,8}$/.test(s)
}

export function normalizeCode(input: string): string {
  return input.trim().replace(/^#/, "").toUpperCase()
}
