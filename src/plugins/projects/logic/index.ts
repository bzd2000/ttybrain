// The projects plugin: the portfolio, and what you follow up per project (plugin reference §2). Part 1:
// projects, health, context and involvement.
import { definePlugin } from "../../../kernel/api"
import { registerCommands } from "./commands"
import { registerGuide } from "./guide"
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
    registerCommands(ctx, store)
    registerGuide(ctx)
  },
})
