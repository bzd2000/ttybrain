export class PmError extends Error {
  code: string
  hint?: string
  exitCode: 0 | 1 | 2 | 3
  details?: unknown
  constructor(message: string, code: string, exitCode: 0 | 1 | 2 | 3, opts: { hint?: string; details?: unknown } = {}) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.exitCode = exitCode
    this.hint = opts.hint
    this.details = opts.details
  }
}

export class ValidationError extends PmError {
  field?: string
  constructor(message: string, opts: { field?: string; hint?: string } = {}) {
    super(message, "validation", 1, { hint: opts.hint })
    this.field = opts.field
  }
}

export class NotFoundError extends PmError {
  // The hint is "did you mean …" when there are suggestions, else `opts.hint`.
  constructor(message: string, opts: { suggestions?: string[]; hint?: string } = {}) {
    const s = opts.suggestions ?? []
    super(message, "not_found", 2, {
      hint: s.length ? `did you mean ${s.map((x) => `"${x}"`).join(", ")}?` : opts.hint,
      details: s.length ? { suggestions: s } : undefined,
    })
  }
}

export class ConflictError extends PmError {
  constructor(message: string, opts: { hint?: string } = {}) {
    super(message, "conflict", 3, { hint: opts.hint })
  }
}

export class BusyError extends PmError {
  constructor(message: string) {
    super(message, "busy", 3, { hint: "another ttybrain process is writing; try again" })
  }
}

export class IsolationError extends PmError {
  constructor(message: string, opts: { hint?: string } = {}) {
    super(message, "isolation", 1, { hint: opts.hint })
  }
}

export class ViewUnavailableError extends PmError {
  constructor(view: string) {
    super(`view "${view}" is unavailable`, "view_unavailable", 1, { details: { view } })
  }
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]!
}

// Distance is to the whole candidate or to its same-length prefix (so "ana" also suggests "annie").
export function suggest(input: string, candidates: string[], max = 3): string[] {
  const q = input.toLowerCase()
  return candidates
    .map((c, i) => ({ c, i, d: Math.min(distance(q, c.toLowerCase()), distance(q, c.toLowerCase().slice(0, q.length))) }))
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, max)
    .map((x) => x.c)
}
