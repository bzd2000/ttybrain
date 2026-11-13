import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { EventBus } from "./events"

let errors: unknown[][]
const original = console.error

beforeEach(() => {
  errors = []
  console.error = (...args: unknown[]) => void errors.push(args)
})
afterEach(() => {
  console.error = original
})

describe("EventBus", () => {
  test("handlers get the payload in registration order; off() unsubscribes", () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.on("record.changed", (p) => seen.push(`a:${p.ref}`))
    const off = bus.on("record.changed", (p) => seen.push(`b:${p.ref}`))
    bus.on("inbox.captured", () => seen.push("other"))
    bus.emit("record.changed", { ref: "A-1" })
    off()
    bus.emit("record.changed", { ref: "A-2" })
    expect(seen).toEqual(["a:A-1", "b:A-1", "a:A-2"])
  })

  test("a failing handler is logged and does not stop the others", () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.on("record.changed", () => {
      throw new Error("boom")
    })
    bus.on("record.changed", (p) => seen.push(p.ref))
    expect(() => bus.emit("record.changed", { ref: "A-1" })).not.toThrow()
    expect(seen).toEqual(["A-1"])
    expect(errors.length).toBe(1)
    expect(String(errors[0]![0])).toBe('event "record.changed": handler failed: boom')
  })
})
