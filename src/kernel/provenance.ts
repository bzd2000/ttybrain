// Provenance: which records were created from which origin (an inbox item, a meeting, a change set).
// Written by the kernel for every write operation that runs with an origin; plugins only read it.
import { currentContext, type Origin } from "./context"
import type { KernelDb } from "./db/kernel-db"
import type { RecordTypeRegistry } from "./records"

export class ProvenanceStore {
  constructor(
    private readonly kdb: KernelDb,
    private readonly records: RecordTypeRegistry,
  ) {}

  // Inside the write's transaction, so it rolls back with it. Recording the same pair twice is a no-op.
  async record(type: string, id: number, origin: Origin): Promise<void> {
    await this.kdb.kysely
      .insertInto("kernel_record_origin")
      .values({ record_type: type, record_id: id, origin_type: origin.type, origin_ref: origin.ref, created_at: currentContext().now })
      .onConflict((oc) => oc.doNothing())
      .execute()
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
