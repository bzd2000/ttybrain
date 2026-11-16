// Tags in free text: `#CRM`, `@anna`, `$contract-42`. The kernel parses them; plugins register a tag type per
// prefix whose resolver turns the token into a record id (the inbox links an item to what its tags name).
import { ValidationError } from "./errors"

export type TagTypeDef = { prefix: "#" | "@" | string; recordType: string; resolve(token: string): Promise<number | null> }
export type ParsedTag = { prefix: string; token: string; raw: string }

const PREFIXES = ["#", "@", "$"]
// At the start, or after whitespace, `(` or `[`, so `anna@example.com` and `C#` are not tags. The token's
// character class already stops before trailing `.,;:!?)]`.
const TAG = /(?<=^|[\s([])([#@$])([A-Za-z0-9][A-Za-z0-9-]*)/g

export function parseTags(text: string): ParsedTag[] {
  return [...text.matchAll(TAG)].map((m) => ({ prefix: m[1]!, token: m[2]!, raw: m[0] }))
}

export class TagRegistry {
  private readonly defs = new Map<string, { def: TagTypeDef; plugin?: string }>() // by prefix

  // `plugin` lets the host remove a failed plugin's tag types.
  register(def: TagTypeDef, plugin?: string): void {
    if (!PREFIXES.includes(def.prefix)) throw new ValidationError(`tag prefix "${def.prefix}" must be one of ${PREFIXES.join(", ")}`)
    const taken = this.defs.get(def.prefix)
    if (taken) throw new ValidationError(`tag prefix "${def.prefix}" is already registered for "${taken.def.recordType}"`)
    this.defs.set(def.prefix, { def, plugin })
  }

  // Each record is linked once (the first spelling wins) and each unresolved tag listed once, in text order.
  async resolve(text: string): Promise<{ links: Array<{ recordType: string; recordId: number; raw: string }>; unresolved: string[] }> {
    const links: Array<{ recordType: string; recordId: number; raw: string }> = []
    const unresolved: string[] = []
    const linked = new Set<string>()
    for (const tag of parseTags(text)) {
      const def = this.defs.get(tag.prefix)?.def
      const id = def ? await def.resolve(tag.token) : null
      if (def && id !== null) {
        const key = `${def.recordType}:${id}`
        if (!linked.has(key)) links.push({ recordType: def.recordType, recordId: id, raw: tag.raw })
        linked.add(key)
      } else if (!unresolved.includes(tag.raw)) unresolved.push(tag.raw)
    }
    return { links, unresolved }
  }

  remove(pluginId: string): void {
    for (const [prefix, e] of this.defs) if (e.plugin === pluginId) this.defs.delete(prefix)
  }
}
