// The inbox plugin's tui part: quick capture (`i` on every screen), the `● n new in inbox` badge, the Inbox screen
// (slot 6), the item's edit form and the Overview's Inbox panel.
import { defineTui, truncate } from "../../../kernel/tui/api"
import { CaptureOverlay } from "./capture"
import { InboxScreen, ItemForm } from "./inbox-screen"

const CLIP = 60

export const inboxTui = defineTui({
  plugin: "inbox",
  activate(ui) {
    const newCount = async () => {
      const row = await ui.data.selectFrom("item").select((eb) => eb.fn.countAll().as("n")).where("status", "=", "new").executeTakeFirstOrThrow()
      return Number(row.n)
    }
    ui.screen({ id: "inbox", title: "Inbox", slot: 6, component: InboxScreen, count: newCount })
    ui.globalAction({ id: "capture", key: "i", label: "capture", overlay: CaptureOverlay })
    ui.statusBadge({
      id: "inbox",
      order: 10,
      text: async () => {
        const n = await newCount()
        return n > 0 ? `● ${n} new in inbox` : null
      },
    })
    ui.recordForm("inbox_item", { id: "item", label: "Inbox item", component: ItemForm })
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
