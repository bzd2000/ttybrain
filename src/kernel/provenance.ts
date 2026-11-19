// Provenance: which records were created from which origin (an inbox item, a meeting, a change set).
// Written by the kernel for every write operation that runs with an origin; plugins only read it.
import { currentContext, type Origin } from "./context"
import type { KernelDb } from "./db/kernel-db"
import type { RecordTypeRegistry } from "./records"
import { parseRef } from "./refs"

// What a write operation returns, as far as provenance cares: its main record's ref, and `deleted: true`
// when the operation deleted that record (the one delete convention). A delete of a record whose type has a
// custom ref (`#CODE`, `@handle`) also returns the record's `id`: the ref no longer resolves, and says nothing
// about the id.
export type WriteOutput = { ref: string; deleted?: unknown; id?: number }

export class ProvenanceStore {
  constructor(
    private readonly kdb: KernelDb,
    private readonly records: RecordTypeRegistry,
  ) {}

  // The kernel's provenance rule for one write's output, inside its transaction. A delete (`deleted: true`)
  // records nothing and forgets the deleted record's origins: ids are rowids and get reused, and a later record
  // must not inherit them (the id comes from a numeric ref, or from `out.id` for a custom-ref type). Otherwise,
  // with an origin, the ref is resolved (it must resolve) and recorded, unless it is the origin itself (`ttybrain inbox done I-2 --from-inbox I-2`). Used by operations and change sets.
  // `plugin` is the plugin whose operation returned `out`: a write may only delete its own plugin's records, or a
  // forged delete output (`{ ref: "#CRM", deleted: true, id }` from another plugin) would erase their origins.
  // A non-delete may name another plugin's record (a `field` set op returns the record's ref).
  async recordWrite(plugin: string, operation: string, out: WriteOutput, origin: Origin | undefined): Promise<void> {
    const key = `${plugin}.${operation}`
    const type = this.records.typeOfRef(out.ref)
    if (out.deleted === true) {
      if (!type) return // no registered type: nothing can have been recorded for it
      if (type.plugin !== plugin) {
        throw new Error(
          `write operation "${key}" deleted "${out.ref}", a record of plugin "${type.plugin}": a write may only delete its own plugin's records`,
        )
      }
      const id = type.ref ? (Number.isSafeInteger(out.id) && out.id! > 0 ? out.id! : null) : parseRef(out.ref, type.prefix)
      if (id === null) {
        throw new Error(
          `write operation "${key}" deleted "${out.ref}" without its id: a record whose ref is not numeric must return its id ({ ref, deleted: true, id })`,
        )
      }
      await this.forget(type.name, id)
      return
    }
    if (!origin || sameRef(out.ref, origin.ref)) return
    if (!type) throw new Error(`write operation "${key}" returned ref "${out.ref}" of no registered record type`)
    const id = await type.resolve(out.ref)
    if (id === null) throw new Error(`write operation "${key}" returned ref "${out.ref}", which does not resolve`)
    await this.record(type.name, id, origin)
  }

  async forget(type: string, id: number): Promise<void> {
    await this.kdb.kysely.deleteFrom("kernel_record_origin").where("record_type", "=", type).where("record_id", "=", id).execute()
  }

  // Inside the write's transaction, so it rolls back with it. Recording the same pair twice is a no-op.
  async record(type: string, id: number, origin: Origin): Promise<void> {
    await this.kdb.kysely
      .insertInto("kernel_record_origin")
      .values({ record_type: type, record_id: id, origin_type: origin.type, origin_ref: origin.ref, created_at: currentContext().now })
      .onConflict((oc) => oc.doNothing())
      .execute()
  }

  // The origin a record was created from (the earliest recorded one), or undefined.
  async originOf(recordType: string, recordId: number): Promise<Origin | undefined> {
    return (await this.originsOf(recordType, [recordId])).get(recordId)
  }

  // The origins of many records of one type in ONE query (no N+1): record id -> its earliest origin; records
  // with none are absent from the map.
  async originsOf(recordType: string, ids: number[]): Promise<Map<number, Origin>> {
    const out = new Map<number, Origin>()
    if (ids.length === 0) return out
    const rows = await this.kdb.kysely
      .selectFrom("kernel_record_origin")
      .select(["record_id", "origin_type", "origin_ref"])
      .where("record_type", "=", recordType)
      .where("record_id", "in", ids)
      .orderBy("created_at")
      .orderBy("rowid" as any)
      .execute()
    for (const r of rows) {
      const id = Number(r.record_id)
      if (!out.has(id)) out.set(id, { type: String(r.origin_type) as Origin["type"], ref: String(r.origin_ref) })
    }
    return out
  }

  async createdFrom(originType: string, originRef: string): Promise<Array<{ recordType: string; recordId: number; ref: string }>> {
    const rows = await this.kdb.kysely
      .selectFrom("kernel_record_origin")
      .select(["record_type", "record_id"])
      .where("origin_type", "=", originType)
      .where("origin_ref", "=", originRef)
      .orderBy("created_at")
      .orderBy("rowid" as any)
      .execute()
    return Promise.all(
      rows.map(async (r) => ({
        recordType: String(r.record_type),
        recordId: Number(r.record_id),
        ref: await this.records.refOf(String(r.record_type), Number(r.record_id)),
      })),
    )
  }
}

const sameRef = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
