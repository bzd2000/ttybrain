// Tags in free text: `#CRM`, `@anna`, `$contract-42`. The kernel parses them; plugins register a tag type per
// prefix whose resolver turns the token into a record id (the inbox links an item to what its tags name).
import { ValidationError } from "./errors"
import type { RecordTypeRegistry } from "./records"

// `sharedPrefix`: several tag types may share a prefix (`#`: projects and boards) when every one of them sets it.
export type TagTypeDef = { prefix: "#" | "@" | string; recordType: string; sharedPrefix?: boolean; resolve(token: string): Promise<number | null> }
export type ParsedTag = { prefix: string; token: string; raw: string }

const PREFIXES = ["#", "@", "$"]
// At the start, or after whitespace, `(` or `[`, so `anna@example.com` and `C#` are not tags. The token's
// character class already stops before trailing `.,;:!?)]`.
const TAG = /(?<=^|[\s([])([#@$])([A-Za-z0-9][A-Za-z0-9-]*)/g

export function parseTags(text: string): ParsedTag[] {
  return [...text.matchAll(TAG)].map((m) => ({ prefix: m[1]!, token: m[2]!, raw: m[0] }))
}

export class TagRegistry {
  private entries: Array<{ def: TagTypeDef; plugin?: string }> = [] // in registration order

  // `records` lets `suggest` search the record type a prefix names; without it, `suggest` finds nothing.
  constructor(private readonly records?: Pick<RecordTypeRegistry, "byName">) {}

  // `plugin` lets the host remove a failed plugin's tag types.
  register(def: TagTypeDef, plugin?: string): void {
    if (!PREFIXES.includes(def.prefix)) throw new ValidationError(`tag prefix "${def.prefix}" must be one of ${PREFIXES.join(", ")}`)
    const taken = this.of(def.prefix)
    if (taken.length > 0 && !(def.sharedPrefix === true && taken.every((d) => d.sharedPrefix === true)))
      throw new ValidationError(`tag prefix "${def.prefix}" is already registered for "${taken[0]!.recordType}"`)
    this.entries.push({ def, plugin })
  }

  // Each record is linked once (the first spelling wins) and each unresolved tag listed once, in text order. A tag
  // of a shared prefix is asked of each of its types in registration order; two that both know it is a data error.
  async resolve(text: string): Promise<{ links: Array<{ recordType: string; recordId: number; raw: string }>; unresolved: string[] }> {
    const links: Array<{ recordType: string; recordId: number; raw: string }> = []
    const unresolved: string[] = []
    const linked = new Set<string>()
    for (const tag of parseTags(text)) {
      let found: { recordType: string; id: number } | undefined
      for (const def of this.of(tag.prefix)) {
        const id = await def.resolve(tag.token)
        if (id === null) continue
        if (found) throw new ValidationError(`"${tag.raw}" is both a ${found.recordType} and a ${def.recordType}`)
        found = { recordType: def.recordType, id }
      }
      if (found) {
        const key = `${found.recordType}:${found.id}`
        if (!linked.has(key)) links.push({ recordType: found.recordType, recordId: found.id, raw: tag.raw })
        linked.add(key)
      } else if (!unresolved.includes(tag.raw)) unresolved.push(tag.raw)
    }
    return { links, unresolved }
  }

  // One entry per tag type; a shared prefix has one per type, in registration order.
  types(): Array<{ prefix: string; recordType: string }> {
    return this.entries.map(({ def }) => ({ prefix: def.prefix, recordType: def.recordType }))
  }

  // Completions for a tag being typed (`#cr`, `@ma`): the record type of that prefix searches the rest. A shared
  // prefix merges its types' candidates, ordered by ref, at most `limit` of them.
  async suggest(partial: string, limit: number): Promise<Array<{ ref: string; label: string; detail?: string }>> {
    const types = this.of(partial.slice(0, 1)).flatMap((def) => this.records?.byName(def.recordType) ?? [])
    if (types.length <= 1) return types[0] ? types[0].search(partial.slice(1), limit) : []
    const all: Array<{ ref: string; label: string; detail?: string }> = []
    for (const t of types) all.push(...(await t.search(partial.slice(1), limit)))
    return all.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)).slice(0, limit)
  }

  remove(pluginId: string): void {
    this.entries = this.entries.filter((e) => e.plugin !== pluginId)
  }

  private of(prefix: string): TagTypeDef[] {
    return this.entries.filter((e) => e.def.prefix === prefix).map((e) => e.def)
  }
}
