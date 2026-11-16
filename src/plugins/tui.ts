// The built-in plugins' tui parts. Imported only by the TUI entry, never on the CLI path.
import type { TuiDef } from "../kernel/tui/types"
import { projectsTui } from "./projects/tui/index"

export const builtinTuiParts: TuiDef[] = [projectsTui]
