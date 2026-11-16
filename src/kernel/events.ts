// Kernel and plugin events (`record.changed`, `inbox.captured`, ...). Synchronous; a failing handler is
// logged and never affects the emitter or the other handlers.
export class EventBus {
  private readonly handlers = new Map<string, Set<(p: any) => void>>()

  on(event: string, fn: (p: any) => void): () => void {
    let set = this.handlers.get(event)
    if (!set) this.handlers.set(event, (set = new Set()))
    const handler = (p: any) => fn(p) // own identity, so registering the same fn twice gives two subscriptions
    set.add(handler)
    return () => void set.delete(handler)
  }

  emit(event: string, payload: unknown): void {
    for (const fn of [...(this.handlers.get(event) ?? [])]) {
      try {
        fn(payload)
      } catch (e) {
        console.error(`event "${event}": handler failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}
