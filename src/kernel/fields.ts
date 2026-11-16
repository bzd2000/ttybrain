// Extra fields on another plugin's records (the `field` extension point, logic side). A plugin declares the field
// (name, label, type) and names two of its own operations: `get` (read, `{ ref }` → `{ value }`) and `set` (write,
// `{ ref, value }` → `{ ref }`); it stores the value in its own table. The TUI shows the field in the record's
// Summary (<RecordFields>) and forms through those operations; the CLI side (`show --json`, `edit --<flag>`) is
// phase 5 (R22).
import { ValidationError } from "./errors"
import type { OperationRegistry } from "./operations"

export type FieldType = "text" | "number" | "date" | "enum"
export type FieldDef = { name: string; label: string; type: FieldType; values?: string[]; get: string; set: string }

const TYPES: ReadonlySet<string> = new Set(["text", "number", "date", "enum"])

export class FieldRegistry {
  private list: Array<{ plugin: string; recordType: string; def: FieldDef }> = []

  register(plugin: string, recordType: string, def: FieldDef): void {
    if (!TYPES.has(def.type)) throw new ValidationError(`field "${def.name}": unknown type "${def.type}"`)
    if (def.type === "enum" && !(def.values && def.values.length > 0)) throw new ValidationError(`field "${def.name}": an enum field needs values`)
    if (this.list.some((f) => f.recordType === recordType && f.def.name === def.name)) {
      throw new ValidationError(`field "${def.name}" of "${recordType}" is already registered`)
    }
    this.list.push({ plugin, recordType, def })
  }

  // The fields on `recordType`, in registration order.
  for(recordType: string): Array<{ plugin: string; def: FieldDef }> {
    return this.list.filter((f) => f.recordType === recordType).map(({ plugin, def }) => ({ plugin, def }))
  }

  // Throws unless every field `plugin` registered names its own read `get` and write `set` operations (boot runs
  // this after activate, when the plugin's operations are exposed).
  check(plugin: string, ops: OperationRegistry): void {
    const mine = ops.list().filter((o) => o.plugin === plugin)
    const has = (name: string, kind: "read" | "write") => mine.some((o) => o.name === name && o.kind === kind)
    for (const { def } of this.list.filter((f) => f.plugin === plugin)) {
      if (!has(def.get, "read")) throw new ValidationError(`field "${def.name}": no read operation "${def.get}"`)
      if (!has(def.set, "write")) throw new ValidationError(`field "${def.name}": no write operation "${def.set}"`)
    }
  }

  remove(plugin: string): void {
    this.list = this.list.filter((f) => f.plugin !== plugin)
  }
}
