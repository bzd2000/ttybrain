// Record types: the kinds of records others can reference by display ref (`A-41`, `#CRM`, `@anna`).
// Each belongs to one plugin, which resolves its refs and labels its records.
import { NotFoundError, ValidationError } from "./errors"
import { formatRef } from "./refs"

export type RecordTypeDef = {
  name: string
  plugin: string
  prefix: string // "A-", "DE-", or a non-dash prefix such as "#" or "@"
  // Several types may share a prefix (`#`: projects and boards) when every one of them sets this; their owners keep
  // the codes apart (a code is one type's only). Without it, a second type on a taken prefix is refused.
  sharedPrefix?: boolean
  resolve(input: string): Promise<number | null>
  label(id: number): Promise<string>
  // `detail`: an optional short description shown beside the label (a role, a status).
  search(text: string, limit: number): Promise<Array<{ ref: string; label: string; detail?: string }>>
  // The display ref of a record. Defaults to prefix + id; types whose refs are not numeric (`#CRM`) supply it.
  ref?(id: number): Promise<string>
}

// "project", "project or board", "project, board or goal": what a ref of a (shared) prefix may be.
export function typeNames(names: string[]): string {
  const n = names.map((x) => x.replace(/_/g, " "))
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} or ${n[n.length - 1]}`
}

export class RecordTypeRegistry {
  private readonly defs = new Map<string, RecordTypeDef>() // by name, in registration order
  private byLength: RecordTypeDef[] = [] // longest prefix first; registration order within a prefix

  register(def: RecordTypeDef): void {
    if (def.prefix === "") throw new ValidationError(`record type "${def.name}" needs a prefix`)
    if (this.defs.has(def.name)) throw new ValidationError(`record type "${def.name}" is already registered`)
    const taken = this.allOfPrefix(def.prefix)
    if (taken.length > 0 && !(def.sharedPrefix === true && taken.every((d) => d.sharedPrefix === true)))
      throw new ValidationError(`record type prefix "${def.prefix}" is already registered by "${taken[0]!.name}"`)
    this.defs.set(def.name, def)
    this.sort()
  }

  byName(name: string): RecordTypeDef | undefined {
    return this.defs.get(name)
  }

  // The type of a prefix; of a shared prefix, the first registered (`typesOfRef` gives them all).
  byPrefix(prefix: string): RecordTypeDef | undefined {
    return this.allOfPrefix(prefix)[0]
  }

  // The type whose prefix starts `ref`, case-insensitively; the longest prefix wins, so `DE-4` is not a `D-`.
  // Of a shared prefix it is the first registered type only: use `typesOfRef`, or `resolveAny`, which asks each.
  typeOfRef(ref: string): RecordTypeDef | undefined {
    return this.typesOfRef(ref)[0]
  }

  // Every type of the (longest) prefix that starts `ref`, in registration order; [] for none.
  typesOfRef(ref: string): RecordTypeDef[] {
    const r = ref.trim().toLowerCase()
    const first = this.byLength.find((d) => r.startsWith(d.prefix.toLowerCase()))
    return first ? this.allOfPrefix(first.prefix) : []
  }

  // The record `ref` names, or null. Of a shared prefix each type is asked, in registration order; two that both
  // know it is a data error (the owners' shared code namespace prevents it). `type` asks only that type (null when
  // the ref does not start with its prefix).
  async resolveAny(ref: string, opts: { type?: string } = {}): Promise<{ type: string; id: number } | null> {
    let found: { type: string; id: number } | null = null
    for (const def of this.typesOfRef(ref)) {
      if (opts.type !== undefined && def.name !== opts.type) continue
      const id = await def.resolve(ref.trim())
      if (id === null) continue
      if (found) throw new ValidationError(`"${ref.trim()}" is both a ${found.type} and a ${def.name}`)
      found = { type: def.name, id }
    }
    return found
  }

  // A ref nothing resolves: `no record "X-1"`, or of a shared prefix what it may be (`no project or board "#X"`).
  async label(ref: string): Promise<string> {
    const found = await this.resolveAny(ref)
    if (!found) {
      const types = this.typesOfRef(ref)
      throw new NotFoundError(types.length > 1 ? `no ${typeNames(types.map((d) => d.name))} "${ref}"` : `no record "${ref}"`)
    }
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

  private allOfPrefix(prefix: string): RecordTypeDef[] {
    const p = prefix.toLowerCase()
    return this.byLength.filter((d) => d.prefix.toLowerCase() === p)
  }

  // A stable sort: the types of one prefix keep their registration order.
  private sort() {
    this.byLength = [...this.defs.values()].sort((a, b) => b.prefix.length - a.prefix.length)
  }
}
