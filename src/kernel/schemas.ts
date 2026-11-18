// Small TypeBox helpers for operation inputs, shared by every plugin through api.ts.
import Type from "typebox"

// A required text field that is not blank: at least one non-space character. The kernel's input check then
// rejects "" and "   " with a ValidationError naming the field ("name must not be blank"). Plugins still trim
// what they store.
export function NonBlank(opts: Parameters<typeof Type.String>[0] = {}) {
  return Type.String({ minLength: 1, pattern: "\\S", errorMessage: "must not be blank", ...opts })
}

// The output of every delete write operation: the deleted record's ref and `deleted: true`, plus its `id` when
// its type has a custom ref (`#CODE`, `@handle`). The kernel reads `deleted` to forget the record's provenance
// instead of recording any (provenance.ts).
export const Deleted = Type.Object({ ref: Type.String(), deleted: Type.Literal(true), id: Type.Optional(Type.Integer({ minimum: 1 })) })
