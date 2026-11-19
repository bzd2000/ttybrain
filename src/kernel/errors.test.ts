import { expect, test } from "bun:test"
import { NotFoundError, ValidationError, ConflictError, BusyError, IsolationError, ViewUnavailableError, suggest, PmError } from "./errors"

test("suggest", () => {
  expect(suggest("ana", ["anna", "bob", "annie"])).toEqual(["anna", "annie"])
  expect(suggest("ANA", ["anna"])).toEqual(["anna"])
})
test("NotFoundError", () => {
  const e = new NotFoundError('unknown person "ana"', { suggestions: ["anna"] })
  expect(e.hint).toBe('did you mean "anna"?')
  expect(e.exitCode).toBe(2)
  expect(e.code).toBe("not_found")
  expect(e).toBeInstanceOf(PmError)
})
test("other errors", () => {
  expect(new ValidationError("x", { field: "f", hint: "h" })).toMatchObject({ code: "validation", exitCode: 1, hint: "h" })
  expect(new ConflictError("x").exitCode).toBe(3)
  expect(new BusyError("x")).toMatchObject({ code: "busy", exitCode: 3, hint: "another ttybrain process is writing; try again" })
  expect(new IsolationError("x")).toMatchObject({ code: "isolation", exitCode: 1 })
  expect(new ViewUnavailableError("people.person")).toMatchObject({ code: "view_unavailable", exitCode: 1 })
})
