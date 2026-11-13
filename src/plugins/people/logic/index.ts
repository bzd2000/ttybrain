// The people plugin: your team and your stakeholders, notes on them, and team members' goals (plugin reference §1).
import { definePlugin } from "../../../kernel/api"
import { registerCommands } from "./commands"
import { registerGuide } from "./guide"
import { registerOps } from "./ops"
import { makeStore, registerRecordTypes } from "./records"
import { registerReport } from "./report"
import { registerSchema } from "./schema"
import { registerViews } from "./views"

export const people = definePlugin({
  id: "people",
  name: "People",
  version: "1.0.0",
  apiVersion: 1,
  reads: { projects: "^1" }, // projects.involvement and projects.project, for each person's projects
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
