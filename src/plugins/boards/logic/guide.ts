// The agent guide's section on boards: adding and keeping them, and the code namespace they share with projects.
import type { PluginContext } from "@ttybrain/api"

const MARKDOWN = `
A board such as \`#MB\` "Management board" is what board meetings are about: \`ttybrain board add MB "Management board"\` (a code of 2–16 letters or digits with at least one letter; \`--note\` for a note).

- Project and board codes share one namespace: \`#MB\` is either a project or a board, and adding or renaming either refuses a code the other has. Where a project is needed (\`--project\`, \`project show\`), a board's code is refused as "a board, not a project".
- \`ttybrain board list\` (\`--archived\` for the archived ones), \`board show #MB\` (its series, next meeting and open talk items), \`board edit #MB --name … --code … --note …\` (its meetings, series, talk items and links follow a new code), \`board archive|restore #MB\` (an archived board takes no new meetings, series, talk items or links; boards are never deleted, only archived). In the TUI, screen 7 Boards lists the boards with their next meeting and open talk items (\`n\` new, \`e\` edit, \`Del\` archive, \`r\` restore, \`a\` archived, \`/\` filter); the board view's Summary tab has \`e\` edit, \`Del\` archive and \`r\` restore.
- Boards used to be part of the meetings plugin; they moved to this one once, keeping their ids and codes. With projects off, boards (and meetings) are off.
- Board meetings that were about a project before boards existed were moved to a board with that project's name and the code \`<CODE>B\`; \`ttybrain plugin list\` names it until it is edited (\`ttybrain board edit #BOARDB --code MB\`).
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "Boards", markdown: MARKDOWN })
}
