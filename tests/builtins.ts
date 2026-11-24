// The built-in plugins and their tui parts as static lists, for tests only (pm itself discovers them from their
// manifests). The host sorts plugins by `requires`; the tui parts are in the order the TUI tests expect. Their boots and
// seeds start from template databases (tests/helpers.ts).
import type { PluginDef } from "../src/kernel/api"
import type { TuiDef } from "../src/kernel/tui/api"
import actions from "../src/plugins/actions/logic/index"
import actionsTui from "../src/plugins/actions/tui/index"
import boards from "../src/plugins/boards/logic/index"
import boardsTui from "../src/plugins/boards/tui/index"
import inbox from "../src/plugins/inbox/logic/index"
import inboxTui from "../src/plugins/inbox/tui/index"
import meetings from "../src/plugins/meetings/logic/index"
import meetingsTui from "../src/plugins/meetings/tui/index"
import people from "../src/plugins/people/logic/index"
import peopleTui from "../src/plugins/people/tui/index"
import projects from "../src/plugins/projects/logic/index"
import projectsTui from "../src/plugins/projects/tui/index"
import { templatePlugins } from "./helpers"

export const builtinPlugins: PluginDef[] = [people, projects, boards, actions, meetings, inbox]
templatePlugins(builtinPlugins)
export const builtinTuiParts: TuiDef[] = [projectsTui, boardsTui, actionsTui, peopleTui, meetingsTui, inboxTui]
