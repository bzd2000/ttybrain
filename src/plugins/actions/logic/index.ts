// The actions plugin: what you or someone else has to do, with its owner, due date and the project, meeting and
// person it relates to (design 2026-11-20 §4). Its table, the A- record type, the actions.action view, the
// operations, the `ttybrain action` commands, its sections on the projects plugin's reports, the guide section,
// and the one-time handover of the actions the projects plugin used to own.
import { definePlugin } from "@ttybrain/api"
import { registerCommands } from "./commands"
import { registerGuide } from "./guide"
import { registerHandover } from "./handover"
import { registerOps } from "./ops"
import { makeStore, registerRecordTypes } from "./records"
import { registerReports } from "./report"
import { registerSchema } from "./schema"
import { registerViews } from "./views"

export const actions = definePlugin({
  id: "actions",
  name: "Actions",
  version: "2.0.0",
  apiVersion: 1,
  // All optional: people.person (owner and for names), projects.project (codes) and its legacyActions read (the
  // handover), meetings (meeting titles and dates).
  reads: { people: "^1", projects: "^2", meetings: "^2" },
  activate(ctx) {
    const store = makeStore(ctx)
    registerSchema(ctx)
    registerViews(ctx)
    registerRecordTypes(ctx, store)
    registerOps(ctx, store)
    registerCommands(ctx, store)
    registerReports(ctx, store)
    registerGuide(ctx)
    registerHandover(ctx)
  },
})

export default actions
