// The "Inbox" section of the overview report: the items still new.
import type { PluginContext } from "@pm/api"

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function registerReport(ctx: PluginContext): void {
  ctx.reportSection("overview", {
    id: "inbox",
    order: 70,
    run: async () => {
      const rows = await ctx.data.selectFrom("item").select(["id", "captured_at", "text"]).where("status", "=", "new").orderBy("id").execute()
      return {
        title: "Inbox",
        columns: ["ID", "Captured", "Text"],
        rows: rows.map((r) => ({ ID: `I-${r.id}`, Captured: String(r.captured_at).slice(0, 10), Text: clip(String(r.text)) })),
        empty: "Inbox is empty",
      }
    },
  })
}
