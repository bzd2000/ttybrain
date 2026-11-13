// Exposed operations: typed functions a plugin offers to itself and to the plugins that require it.
// Writes are the only way one plugin changes another's data. The kernel validates their input, runs them
// in its transaction (a savepoint when nested), records provenance and emits `record.changed`.
import type { TSchema } from "typebox"
import Value from "typebox/value"
import { currentContext, runWithContext, type Origin } from "./context"
import type { KernelDb } from "./db/kernel-db"
import { NotFoundError, ValidationError } from "./errors"
import type { EventBus } from "./events"
import type { ProvenanceStore } from "./provenance"
import type { RecordTypeRegistry } from "./records"

export type ReadOp = {
  input: TSchema
  output: TSchema
  run(input: any): Promise<any>
  assistant?: boolean
  toolDescription?: string
}
export type WriteOp = ReadOp & { describe(input: any): string | Promise<string> }
export type PluginApi = {
  read: Record<string, (input: any) => Promise<any>>
  write: Record<string, (input: any) => Promise<any>>
}

type Kind = "read" | "write"
type Entry = { plugin: string; name: string; kind: Kind; op: ReadOp | WriteOp }

export type OperationDeps = {
  db: KernelDb
  events: EventBus
  records: RecordTypeRegistry
  provenance: ProvenanceStore
  validateOutputs?: boolean // on under PM_TEST=1: the bootKernel caller decides
}

// The first schema error as a field ("/a/b" → "a.b"; a missing property names that property) and a text.
function firstError(schema: TSchema, value: unknown): { field?: string; text: string } | undefined {
  const [e] = Value.Errors(schema, value)
  if (!e) return undefined
  const path = e.instancePath
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
  const missing = e.keyword === "required" ? (e.params as { requiredProperties?: string[] }).requiredProperties?.[0] : undefined
  if (missing !== undefined) path.push(missing)
  const field = path.length ? path.join(".") : undefined
  const text = missing !== undefined ? `${field} is required` : field ? `${field} ${e.message}` : e.message
  return { field, text }
}

export class OperationRegistry {
  private readonly entries = new Map<string, Entry>() // keyed "<plugin>.<name>", in expose order

  constructor(private readonly deps: OperationDeps) {}

  expose(pluginId: string, ops: { read?: Record<string, ReadOp>; write?: Record<string, WriteOp> }): void {
    const add: Entry[] = [
      ...Object.entries(ops.read ?? {}).map(([name, op]) => ({ plugin: pluginId, name, kind: "read" as const, op })),
      ...Object.entries(ops.write ?? {}).map(([name, op]) => ({ plugin: pluginId, name, kind: "write" as const, op })),
    ]
    const seen = new Set<string>()
    for (const e of add) {
      const key = `${pluginId}.${e.name}`
      if (this.entries.has(key) || seen.has(key)) throw new ValidationError(`operation "${key}" is already exposed`)
      if (e.kind === "write" && typeof (e.op as WriteOp).describe !== "function")
        throw new ValidationError(`write operation "${key}" has no describe`)
      seen.add(key)
    }
    for (const e of add) this.entries.set(`${pluginId}.${e.name}`, e)
  }

  // The plugin's callable API, or undefined if it exposes nothing. Calls look the operation up each time,
  // so an API handed out before the plugin was removed fails with NotFoundError instead of running.
  api(pluginId: string): PluginApi | undefined {
    const mine = [...this.entries.values()].filter((e) => e.plugin === pluginId)
    if (mine.length === 0) return undefined
    const api: PluginApi = { read: {}, write: {} }
    for (const e of mine) api[e.kind][e.name] = (input: any) => this.call(pluginId, e.name, e.kind, input)
    return api
  }

  async describe(pluginId: string, op: string, input: unknown): Promise<string> {
    const e = this.find(pluginId, op, "write")
    this.checkInput(e, input)
    return (e.op as WriteOp).describe(input)
  }

  list(): Array<{ plugin: string; name: string; kind: Kind; input: TSchema; output: TSchema; assistant: boolean }> {
    return [...this.entries.values()].map((e) => ({
      plugin: e.plugin,
      name: e.name,
      kind: e.kind,
      input: e.op.input,
      output: e.op.output,
      assistant: e.op.assistant ?? false,
    }))
  }

  remove(pluginId: string): void {
    for (const [key, e] of this.entries) if (e.plugin === pluginId) this.entries.delete(key)
  }

  private find(pluginId: string, name: string, kind: Kind): Entry {
    const e = this.entries.get(`${pluginId}.${name}`)
    if (!e || e.kind !== kind) throw new NotFoundError(`no ${kind} operation "${pluginId}.${name}"`)
    return e
  }

  private checkInput(e: Entry, input: unknown) {
    const err = firstError(e.op.input, input)
    if (err) throw new ValidationError(`${e.plugin}.${e.name}: ${err.text}`, { field: err.field })
  }

  private checkOutput(e: Entry, output: unknown) {
    if (!this.deps.validateOutputs) return
    const err = firstError(e.op.output, output)
    if (err) throw new Error(`operation "${e.plugin}.${e.name}" returned invalid output: ${err.text}`)
  }

  private async call(pluginId: string, name: string, kind: Kind, input: unknown): Promise<any> {
    const ctx = currentContext() // throws before any work when called outside an operation context
    const e = this.find(pluginId, name, kind)
    this.checkInput(e, input)
    if (kind === "read") {
      const out = await e.op.run(input)
      this.checkOutput(e, out)
      return out
    }
    const { db, events } = this.deps
    return db.write(async () => {
      const out = await e.op.run(input)
      const key = `${e.plugin}.${e.name}`
      if (typeof out?.ref !== "string") throw new Error(`write operation "${key}" must return { ref: string }`)
      this.checkOutput(e, out)
      const origin = ctx.origin
      if (origin) await this.recordProvenance(key, out.ref, origin)
      const payload = { plugin: e.plugin, op: e.name, ref: out.ref }
      // Handlers run in the same actor/today/now but without the origin, so their own writes are not
      // recorded as created from it.
      const hookCtx = { actor: ctx.actor, today: ctx.today, now: ctx.now }
      db.afterCommit(() => void runWithContext(hookCtx, async () => events.emit("record.changed", payload)))
      return out
    })
  }

  private async recordProvenance(key: string, ref: string, origin: Origin) {
    const { records, provenance } = this.deps
    const type = records.typeOfRef(ref)
    if (!type) throw new Error(`write operation "${key}" returned ref "${ref}" of no registered record type`)
    const id = await type.resolve(ref)
    if (id === null) throw new Error(`write operation "${key}" returned ref "${ref}", which does not resolve`)
    await provenance.record(type.name, id, origin)
  }
}
