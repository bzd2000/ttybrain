// The meetings plugin: boards, steering committees and other meetings, with agenda and asks (plugin reference §3).
// This is the skeleton (tables, the M- record type, views); operations, commands and reports are added on top.
import { definePlugin } from "../../../kernel/api"
import { makeStore, registerRecordTypes } from "./records"
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
  },
})
