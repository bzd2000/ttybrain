import { describe, expect, test } from "bun:test"
import { currentContext, runWithContext, type OpContext } from "./context"

const ctx: OpContext = { actor: "me", today: "2026-11-13", now: "2026-11-13T09:00:00" }
const tick = () => new Promise<void>((r) => setTimeout(r, 1))

describe("runWithContext", () => {
  test("propagates through await and nested calls", async () => {
    async function inner(): Promise<string> {
      await tick()
      return currentContext().today
    }
    const out = await runWithContext(ctx, async () => {
      await tick()
      const a = currentContext().now
      const b = await inner()
      const c = await Promise.all([inner(), inner()])
      return [a, b, ...c]
    })
    expect(out).toEqual(["2026-11-13T09:00:00", "2026-11-13", "2026-11-13", "2026-11-13"])
  })

  test("a nested context applies inside only, then the outer one is back", async () => {
    const seen: Array<string | undefined> = []
    await runWithContext(ctx, async () => {
      await runWithContext({ ...ctx, origin: { type: "inbox", ref: "I-7" } }, async () => {
        await tick()
        seen.push(currentContext().origin?.ref)
      })
      await tick()
      seen.push(currentContext().origin?.ref)
    })
    expect(seen).toEqual(["I-7", undefined])
  })

  test("concurrent runs keep their own context", async () => {
    const run = (today: string) =>
      runWithContext({ ...ctx, today }, async () => {
        await tick()
        await tick()
        return currentContext().today
      })
    expect(await Promise.all([run("2026-11-13"), run("2026-11-14")])).toEqual(["2026-11-13", "2026-11-14"])
  })

  test("currentContext throws outside an operation", async () => {
    expect(() => currentContext()).toThrow("no operation context")
    await runWithContext(ctx, async () => {})
    expect(() => currentContext()).toThrow("no operation context")
  })
})
