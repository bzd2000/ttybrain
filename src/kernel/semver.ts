function parts(v: string): number[] | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1
  return 0
}

// Supports `*`, exact `1.2.3`, `^N`, `^N.M`, `^N.M.P` (caret: same major, at least the given version).
export function satisfies(version: string, range: string): boolean {
  const r = range.trim()
  if (r === "*") return true
  const v = parts(version)
  if (!v) return false
  if (r.startsWith("^")) {
    const min = parts(r.slice(1))
    return !!min && v[0] === min[0] && cmp(v, min) >= 0
  }
  const exact = parts(r)
  return !!exact && cmp(v, exact) === 0
}
