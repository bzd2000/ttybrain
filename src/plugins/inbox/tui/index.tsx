// The inbox plugin's tui part: the Overview's Inbox panel (Task 14 adds capture, the badge and the Inbox screen).
import { defineTui, truncate } from "../../../kernel/tui/api"

const CLIP = 60

export const inboxTui = defineTui({
  plugin: "inbox",
  activate(ui) {
    ui.overviewPanel({
      id: "inbox",
      title: "Inbox",
      priority: 70,
      empty: "Inbox is empty",
      // The new items, oldest first.
      load: async () => {
        const rows = await ui.data.selectFrom("item").select(["id", "text"]).where("status", "=", "new").orderBy("id").execute()
        return rows.map((r) => {
          const ref = `I-${r.id}`
          return { ref, cells: [{ text: ref, tone: "muted" as const }, { text: truncate(String(r.text), CLIP) }] }
        })
      },
    })
  },
})
