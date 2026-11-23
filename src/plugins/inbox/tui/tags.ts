// How tags show in the inbox's texts (the Inbox screen and quick capture): `#tags` cyan, `@tags` magenta, any
// other prefix in the text's own colour; an unresolved tag stays coloured and is followed by an amber
// `⚠ unknown <record type>`.
import type { CellPart, Tone } from "@ttybrain/api/tui"

// A tag: at the start, or after whitespace, `(` or `[` (as the kernel parses them).
const TAG = /(?<=^|[\s([])([#@$])([A-Za-z0-9][A-Za-z0-9-]*)/g

export const tagTone = (prefix: string): Tone => (prefix === "#" ? "cyan" : prefix === "@" ? "magenta" : undefined)

// Where the tags are in `text`: [start, end) offsets and the prefix.
export function tagRanges(text: string): Array<{ start: number; end: number; prefix: string; raw: string }> {
  return [...text.matchAll(TAG)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, prefix: m[1]!, raw: m[0] }))
}

// `text` in parts: the tags in their colours, the rest in `tone`; each unresolved tag followed by its warning
// (`types`: the tag prefixes' record types, which name what is unknown).
export function tagParts(text: string, opts: { tone?: Tone; unresolved?: string[]; types?: Array<{ prefix: string; recordType: string }> } = {}): CellPart[] {
  const parts: CellPart[] = []
  let at = 0
  for (const t of tagRanges(text)) {
    if (t.start > at) parts.push({ text: text.slice(at, t.start), tone: opts.tone })
    parts.push({ text: t.raw, tone: tagTone(t.prefix) ?? opts.tone })
    if (opts.unresolved?.includes(t.raw)) {
      // A prefix several types share (`#`: projects and boards) names them all: `unknown project or board`.
      const names = (opts.types ?? []).filter((x) => x.prefix === t.prefix).map((x) => x.recordType.replace(/_/g, " "))
      const type = names.length === 0 ? "tag" : names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
      parts.push({ text: " " }, { text: `⚠ unknown ${type}`, tone: "amber" })
    }
    at = t.end
  }
  if (at < text.length) parts.push({ text: text.slice(at), tone: opts.tone })
  return parts
}
