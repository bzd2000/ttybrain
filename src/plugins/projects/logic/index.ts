// The projects plugin: the portfolio, and what you follow up per project (plugin reference §2). Part 1:
// projects, health, context and involvement. Part 2: milestones, deliverables, risks and decisions. Part 3:
// actions, projectStatus, the project-status and overview reports.
import { definePlugin } from "@ttybrain/api"
import { registerCommands } from "./commands"
import { registerActionCommands } from "./commands-actions"
import { registerItemCommands } from "./commands-items"
import { registerGuide } from "./guide"
import { makeItems, registerItemRecordTypes } from "./items"
import { registerActionOps } from "./ops-actions"
import { registerItemOps } from "./ops-items"
import { registerProjectOps } from "./ops-project"
import { makeStore, registerRecordTypes } from "./records"
import { registerReports } from "./report"
import { registerSchema } from "./schema"
import { registerStatusOps } from "./status"
import { registerViews } from "./views"

export const projects = definePlugin({
  id: "projects",
  name: "Projects",
  version: "1.0.0",
  apiVersion: 1,
  requires: { people: "^1" }, // person references (owners, involvement) are people's records
  reads: { people: "^1", meetings: "^1" }, // people.person (owners, involvement); meetings.meeting for meeting titles (optional)
  activate(ctx) {
    const store = makeStore(ctx)
    registerSchema(ctx)
    registerViews(ctx)
    registerRecordTypes(ctx, store)
    registerProjectOps(ctx, store)
    const items = makeItems(ctx, store)
    registerItemRecordTypes(ctx, items)
    registerItemOps(ctx, store, items)
    registerActionOps(ctx, store, items)
    registerStatusOps(ctx, store, items)
    registerCommands(ctx, store)
    registerItemCommands(ctx, store, items)
    registerActionCommands(ctx, store, items)
    registerReports(ctx, store, items)
    registerGuide(ctx)
  },
})

export default projects
