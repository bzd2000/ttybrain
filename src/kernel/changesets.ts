// Change sets: a list of proposed write-operation calls, previewed as their `describe` lines and applied in
// one kernel write. Each call goes through the OperationRegistry (validation, provenance, record.changed) as a
// nested write; the first failure rolls back the whole set. Applied sets are logged in kernel_change_set(_op).
import { currentContext, runWithContext, type Origin } from "./context"
import type { KernelDb } from "./db/kernel-db"
import { NotFoundError, PmError, ValidationError } from "./errors"
import type { OperationRegistry } from "./operations"
import type { ProvenanceStore } from "./provenance"
import type { RecordTypeRegistry } from "./records"

export type ChangeOp = { plugin: string; operation: string; input: unknown }

export type ChangeSetDeps = {
  db: KernelDb
  ops: OperationRegistry
  records: RecordTypeRegistry
  provenance: ProvenanceStore
}

// The error of op `index`: a PmError keeps its class, code, hint and details, plus `index`; anything else
// becomes an internal PmError (exit 1) with the same message.
function atIndex(e: unknown, index: number): PmError {
  if (e instanceof PmError) {
    const details = e.details && typeof e.details === "object" ? e.details : {}
    e.details = { ...details, index }
    return e
  }
  return new PmError(e instanceof Error ? e.message : String(e), "internal", 1, { details: { index } })
}

export class ChangeSetService {
  constructor(private readonly deps: ChangeSetDeps) {}

  async preview(ops: ChangeOp[]): Promise<string[]> {
    const lines: string[] = []
    for (const [index, op] of ops.entries()) {
      try {
        lines.push(await this.deps.ops.describe(op.plugin, op.operation, op.input))
      } catch (e) {
        throw atIndex(e, index)
      }
    }
    return lines
  }

  // Runs in the caller's operation context. Every op runs with origin `{ type: "changeset", ref: "CS-<id>" }`,
  // so its record's provenance names the set; the set's own `origin` (an inbox item, say) is logged on the set
  // and recorded as provenance of each result too.
  async apply(ops: ChangeOp[], origin?: Origin): Promise<{ id: number; refs: string[] }> {
    if (ops.length === 0) throw new ValidationError("a change set needs at least one operation")
    const ctx = currentContext()
    const { db, provenance, records } = this.deps
    return db.write(async () => {
      const set = await db.kysely
        .insertInto("kernel_change_set")
        .values({ origin_type: origin?.type ?? null, origin_ref: origin?.ref ?? null, created_at: ctx.now })
        .executeTakeFirstOrThrow()
      const id = Number(set.insertId)
      const refs: string[] = []
      await runWithContext({ ...ctx, origin: { type: "changeset", ref: `CS-${id}` } }, async () => {
        for (const [index, op] of ops.entries()) {
          try {
            const description = await this.deps.ops.describe(op.plugin, op.operation, op.input)
            const call = this.deps.ops.api(op.plugin)?.write[op.operation]
            if (!call) throw new NotFoundError(`no write operation "${op.plugin}.${op.operation}"`)
            const { ref } = await call(op.input)
            if (origin) {
              const found = await records.resolveAny(ref)
              if (found) await provenance.record(found.type, found.id, origin)
            }
            await db.kysely
              .insertInto("kernel_change_set_op")
              .values({
                change_set_id: id,
                position: index,
                plugin: op.plugin,
                operation: op.operation,
                input_json: JSON.stringify(op.input),
                description,
                result_ref: ref,
              })
              .execute()
            refs.push(ref)
          } catch (e) {
            throw atIndex(e, index)
          }
        }
      })
      return { id, refs }
    })
  }
}
