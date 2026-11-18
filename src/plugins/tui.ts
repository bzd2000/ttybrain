// The built-in plugins' tui parts. Imported only by the TUI entry, never on the CLI path.
import type { TuiDef } from "../kernel/tui/types"
import { inboxTui } from "./inbox/tui/index"
import { meetingsTui } from "./meetings/tui/index"
import { peopleTui } from "./people/tui/index"
import { projectsTui } from "./projects/tui/index"

export const builtinTuiParts: TuiDef[] = [projectsTui, peopleTui, meetingsTui, inboxTui]
