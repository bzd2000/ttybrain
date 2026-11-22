// The projects plugin: the portfolio, and what you follow up per project (plugin reference §2). Part 1:
// projects, health, context and involvement. Part 2: milestones, deliverables, risks and decisions. Part 3:
// projectStatus, the project-status and overview reports. Actions are the actions plugin's; handover.ts hands it
// the actions this plugin used to own.
import { definePlugin } from "@ttybrain/api"
import { registerCommands } from "./commands"
import { registerItemCommands } from "./commands-items"
import { registerGuide } from "./guide"
import { registerHandover } from "./handover"
import { makeItems, registerItemRecordTypes } from "./items"
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
  version: "2.0.0", // 2: the projects.project view has no open_actions (actions are the actions plugin's)
  apiVersion: 1,
  requires: { people: "^1" }, // person references (owners, involvement) are people's records
  reads: { people: "^1", meetings: "^2", actions: "^2" }, // people.person (owners, involvement); meetings.meeting for meeting titles, actions.action and actions.link for open-action counts (both optional)
  activate(ctx) {
    const store = makeStore(ctx)
    registerSchema(ctx)
    registerViews(ctx)
    registerRecordTypes(ctx, store)
    registerProjectOps(ctx, store)
    const items = makeItems(ctx, store)
    registerItemRecordTypes(ctx, items)
    registerItemOps(ctx, store, items)
    registerStatusOps(ctx, store, items)
    registerCommands(ctx, store)
    registerItemCommands(ctx, store, items)
    registerReports(ctx, store, items)
    registerGuide(ctx)
    registerHandover(ctx)
  },
})

export default projects
