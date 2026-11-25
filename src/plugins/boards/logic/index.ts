// The boards plugin: a board such as `#MB` "Management board" (design §5.7), the subject of board meetings and series,
// with a talk-list and actions linked to it (those are the meetings and actions plugins'). Its table, the `board`
// record type and `#` tag (shared with projects: one namespace of codes), the boards.board view, the operations, the
// `ttybrain board` commands, the guide section, and the one-time handover of the boards the meetings plugin used to
// own.
import { definePlugin } from "@ttybrain/api"
import { registerCommands } from "./commands"
import { registerGuide } from "./guide"
import { registerHandover } from "./handover"
import { registerOps } from "./ops"
import { makeStore, registerRecordTypes } from "./records"
import { registerSchema } from "./schema"
import { registerViews } from "./views"

export const boards = definePlugin({
  id: "boards",
  name: "Boards",
  version: "1.0.0",
  apiVersion: 1,
  // Loaded after projects, so that of the shared `#` prefix the project type is registered first (a ref is asked of
  // a project first, and what an unknown `#X` may be names a project first), whatever order the plugins are found in.
  requires: { projects: "^2" },
  // projects.project (the code namespace, a board's project of origin); meetings' legacyBoards and legacyMaxId (the
  // handover) and boardActivity (`board show`), all optional.
  reads: { projects: "^2", meetings: "^3" },
  activate(ctx) {
    const store = makeStore(ctx)
    registerSchema(ctx)
    registerViews(ctx)
    registerRecordTypes(ctx, store)
    registerOps(ctx, store)
    registerCommands(ctx, store)
    registerGuide(ctx)
    registerHandover(ctx)
  },
})

export default boards
