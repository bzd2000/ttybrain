// Small TypeBox helpers for operation inputs, shared by every plugin through api.ts.
import Type from "typebox"

// A required text field that is not blank: at least one non-space character. The kernel's input check then
// rejects "" and "   " with a ValidationError naming the field ("name must not be blank"). Plugins still trim
// what they store.
export function NonBlank(opts: Parameters<typeof Type.String>[0] = {}) {
  return Type.String({ minLength: 1, pattern: "\\S", errorMessage: "must not be blank", ...opts })
}
