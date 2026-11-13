// The inbox plugin: quick notes with #project and @person tags, processed by an agent (plugin reference §4).
// It knows nothing about other plugins: tags, labels and provenance all come through the kernel.
import { definePlugin } from "../../../kernel/api"
import { registerCommands } from "./commands"
import { registerGuide } from "./guide"
import { registerOps } from "./ops"
import { makeStore, registerRecordTypes } from "./records"
import { registerReport } from "./report"
import { registerSchema } from "./schema"
import { registerViews } from "./views"

export const inbox = definePlugin({
  id: "inbox",
  name: "Inbox",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    const store = makeStore(ctx)
    registerSchema(ctx)
    registerViews(ctx)
    registerRecordTypes(ctx, store)
    registerOps(ctx, store)
    registerCommands(ctx, store)
    registerReport(ctx)
    registerGuide(ctx)
  },
})
