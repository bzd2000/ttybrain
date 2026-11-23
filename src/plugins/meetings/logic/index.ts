// The meetings plugin: every meeting is about a person (1:1) or a project (project, board), one-off or an occurrence
// of a recurring series, with agenda and asks, and the talk-lists of people and projects (plugin reference §3,
// meetings design §5). Tables, the M-, S- and T- record types, views, the operations, the series and their
// `occurrences` upkeep, the talk-lists, closing (and the `auto-close` upkeep), the `ttybrain meeting` and `ttybrain talk` commands, the
// board and minutes reports (with the prep and report reads) and the guide section.
import { definePlugin } from "@ttybrain/api"
import { makeCloser, registerClose } from "./close"
import { registerCommands } from "./commands"
import { registerGuide } from "./guide"
import { registerOps } from "./ops"
import { makeStore, registerRecordTypes } from "./records"
import { registerReports } from "./reports"
import { registerSchema } from "./schema"
import { makeOccurrences, registerSeries } from "./series"
import { makeTalks, registerTalk } from "./talk"
import { registerViews } from "./views"

export const meetings = definePlugin({
  id: "meetings",
  name: "Meetings",
  version: "2.0.0",
  apiVersion: 1,
  requires: { projects: "^2", people: "^1", actions: "^2" },
  // projects.project (agenda codes, subjects), people.person (attendee names, subjects), actions.action and
  // actions.link (the actions linked to a meeting)
  reads: { projects: "^2", people: "^1", actions: "^2" },
  activate(ctx) {
    const store = makeStore(ctx)
    registerSchema(ctx)
    registerViews(ctx)
    registerRecordTypes(ctx, store)
    const talks = makeTalks(ctx, store)
    const closer = makeCloser(ctx, store, talks)
    registerOps(ctx, store, talks, closer)
    registerSeries(ctx, store, makeOccurrences(ctx, store))
    registerTalk(ctx, store, talks)
    registerClose(ctx, store, closer)
    registerCommands(ctx, store, talks)
    registerReports(ctx, store, talks)
    registerGuide(ctx)
  },
})

export default meetings
