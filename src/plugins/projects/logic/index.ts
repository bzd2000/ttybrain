// The projects plugin: the portfolio, and what you follow up per project (plugin reference §2). Part 1:
// projects, health, context and involvement. Part 2: milestones, deliverables, risks and decisions.
import { definePlugin } from "../../../kernel/api"
import { registerCommands } from "./commands"
import { registerItemCommands } from "./commands-items"
import { registerGuide } from "./guide"
import { makeItems, registerItemRecordTypes } from "./items"
import { registerItemOps } from "./ops-items"
import { registerProjectOps } from "./ops-project"
import { makeStore, registerRecordTypes } from "./records"
import { registerSchema } from "./schema"
import { registerViews } from "./views"

export const projects = definePlugin({
  id: "projects",
  name: "Projects",
  version: "1.0.0",
  apiVersion: 1,
  requires: { people: "^1" }, // person references (owners, involvement) are people's records
  reads: { meetings: "^1" }, // meetings.meeting, for meeting titles on actions and decisions (optional)
  activate(ctx) {
    const store = makeStore(ctx)
    registerSchema(ctx)
    registerViews(ctx)
    registerRecordTypes(ctx, store)
    registerProjectOps(ctx, store)
    const items = makeItems(ctx, store)
    registerItemRecordTypes(ctx, items)
    registerItemOps(ctx, store, items)
    registerCommands(ctx, store)
    registerItemCommands(ctx, store, items)
    registerGuide(ctx)
  },
})
