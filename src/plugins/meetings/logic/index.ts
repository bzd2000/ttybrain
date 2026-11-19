// The meetings plugin: boards, steering committees and other meetings, with agenda and asks (plugin reference §3).
// Tables, the M- record type, views, the operations, the `pm meeting` commands, the board and minutes reports
// (with the prep and report reads) and the guide section.
import { definePlugin } from "@pm/api"
import { registerCommands } from "./commands"
import { registerGuide } from "./guide"
import { registerOps } from "./ops"
import { makeStore, registerRecordTypes } from "./records"
import { registerReports } from "./reports"
import { registerSchema } from "./schema"
import { registerViews } from "./views"

export const meetings = definePlugin({
  id: "meetings",
  name: "Meetings",
  version: "1.0.0",
  apiVersion: 1,
  requires: { projects: "^1", people: "^1" },
  reads: { projects: "^1", people: "^1" }, // projects.project (agenda codes), people.person (attendee names)
  activate(ctx) {
    const store = makeStore(ctx)
    registerSchema(ctx)
    registerViews(ctx)
    registerRecordTypes(ctx, store)
    registerOps(ctx, store)
    registerCommands(ctx, store)
    registerReports(ctx, store)
    registerGuide(ctx)
  },
})

export default meetings
