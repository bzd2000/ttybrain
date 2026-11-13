// The operation context: who acts, the injected "today"/"now", and where the change came from.
// Carried by AsyncLocalStorage, so it survives `await` and nested calls without being passed around.
import { AsyncLocalStorage } from "node:async_hooks"

export type Origin = { type: "inbox" | "meeting" | "changeset"; ref: string }
export type OpContext = { actor: "me"; today: string; now: string; origin?: Origin }

const storage = new AsyncLocalStorage<OpContext>()

export function runWithContext<T>(ctx: OpContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn)
}

export function currentContext(): OpContext {
  const ctx = storage.getStore()
  if (!ctx) throw new Error("no operation context: call this inside runWithContext")
  return ctx
}
