// Record types: the kinds of records others can reference by display ref (`A-41`, `#CRM`, `@anna`).
// Each belongs to one plugin, which resolves its refs and labels its records.
import { NotFoundError, ValidationError } from "./errors"
import { formatRef } from "./refs"

export type RecordTypeDef = {
  name: string
  plugin: string
  prefix: string // "A-", "DE-", or a non-dash prefix such as "#" or "@"
  resolve(input: string): Promise<number | null>
  label(id: number): Promise<string>
  search(text: string, limit: number): Promise<Array<{ ref: string; label: string }>>
  // The display ref of a record. Defaults to prefix + id; types whose refs are not numeric (`#CRM`) supply it.
  ref?(id: number): Promise<string>
}

export class RecordTypeRegistry {
  private readonly defs = new Map<string, RecordTypeDef>() // by name
  private byLength: RecordTypeDef[] = [] // longest prefix first

  register(def: RecordTypeDef): void {
    if (def.prefix === "") throw new ValidationError(`record type "${def.name}" needs a prefix`)
    if (this.defs.has(def.name)) throw new ValidationError(`record type "${def.name}" is already registered`)
    const clash = this.byPrefix(def.prefix)
    if (clash) throw new ValidationError(`record type prefix "${def.prefix}" is already registered by "${clash.name}"`)
    this.defs.set(def.name, def)
    this.sort()
  }

  byName(name: string): RecordTypeDef | undefined {
    return this.defs.get(name)
  }

  byPrefix(prefix: string): RecordTypeDef | undefined {
    const p = prefix.toLowerCase()
    return this.byLength.find((d) => d.prefix.toLowerCase() === p)
  }

  // The type whose prefix starts `ref`, case-insensitively; the longest prefix wins, so `DE-4` is not a `D-`.
  typeOfRef(ref: string): RecordTypeDef | undefined {
    const r = ref.trim().toLowerCase()
    return this.byLength.find((d) => r.startsWith(d.prefix.toLowerCase()))
  }

  async resolveAny(ref: string): Promise<{ type: string; id: number } | null> {
    const def = this.typeOfRef(ref)
    if (!def) return null
    const id = await def.resolve(ref.trim())
    return id === null ? null : { type: def.name, id }
  }

  async label(ref: string): Promise<string> {
    const found = await this.resolveAny(ref)
    if (!found) throw new NotFoundError(`no record "${ref}"`)
    return this.defs.get(found.type)!.label(found.id)
  }

  // The display ref of (type, id). A type no longer registered (its plugin disabled) gives `<type>:<id>`.
  async refOf(type: string, id: number): Promise<string> {
    const def = this.defs.get(type)
    if (!def) return `${type}:${id}`
    return def.ref ? def.ref(id) : formatRef(def.prefix, id)
  }

  // The names of the record types a plugin registered, sorted.
  typesOf(pluginId: string): string[] {
    return [...this.defs.values()].filter((d) => d.plugin === pluginId).map((d) => d.name).sort()
  }

  remove(pluginId: string): void {
    for (const [name, d] of this.defs) if (d.plugin === pluginId) this.defs.delete(name)
    this.sort()
  }

  private sort() {
    this.byLength = [...this.defs.values()].sort((a, b) => b.prefix.length - a.prefix.length)
  }
}
