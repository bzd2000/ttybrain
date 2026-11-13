// The built-in plugins, in no particular order (the host sorts them by `requires`).
import type { PluginDef } from "../kernel/api"
import { people } from "./people/logic/index"
import { projects } from "./projects/logic/index"

export const builtinPlugins: PluginDef[] = [people, projects]
