// The agent guide's section on meetings: preparing one, turning its notes into actions and decisions, and talk-lists.
import type { PluginContext } from "@ttybrain/api"

const MARKDOWN = `
Meetings are referenced as \`M-<n>\`. \`ttybrain meeting list\` shows the planned ones and those held or cancelled in the last 30 days; \`ttybrain meeting show M-<n>\` shows one with its attendees, agenda and notes. An agenda item is addressed by its meeting and its position (\`ttybrain meeting agenda M-4 remove 2\`).

**Preparing a meeting**

- Add it with who or what it is about and the projects to discuss: \`ttybrain meeting add "Steering committee Q4" --about CRM --date 2026-12-04 --attendees peter,marie --projects CRM,ERP\`. Each project gets a status item on the agenda. A recurring one is a series: \`ttybrain meeting series add @karim "1:1 Karim" --every "2 weeks on wed" --from wed\`.
- Add other items with \`ttybrain meeting agenda M-4 add "Budget" --project CRM --ask "Release contingency"\`. The \`--ask\` is what the user wants from the room; set one wherever there is a decision to get. Change items with \`agenda … edit|move|remove\`.
- Run \`ttybrain report board M-4\` for the preparation: what changed on each project since it was last covered. \`ttybrain meeting edit M-4 --since <date>\` changes where that starts; \`--no-since\` goes back to the default.
- A cancelled meeting cannot be changed. Cancel with \`ttybrain meeting cancel M-<n>\`.

**After a meeting**

- Put the minutes in the notes: \`ttybrain meeting notes M-4 --file minutes.md\`, or \`-\` to read stdin.
- Turn each commitment into an action and each decision into a decision record, tied to the meeting: \`ttybrain action add "Send the roadmap" --owner marie --due fri --meeting M-4\` and \`ttybrain decision add "Select vendor B" --project CRM --meeting M-4\`.
- Then \`ttybrain meeting close M-4\`. It marks the meeting held, keeps its unticked talk items open for next time, stores a 1:1's notes on the person as a 1:1 note, and prints one line: \`1:1 Anna closed · 2 discussed, 3 kept for next time · 2 actions created · notes saved\` (\`--json\` also counts the decisions logged). A meeting with no actions created is worth a second look. A meeting not closed 3 days after its date closes itself the same way. It never closes itself without a subject, and unticked talk items stay open either way.
- Notes written after closing stay on the meeting; they are not copied to the person again.
- An action agreed in a meeting links to the meeting and to what it is about: \`ttybrain action add "Approve AWS training" --due fri --link M-4 --link @anna\`.

**Series**

- A recurring meeting is a series (\`S-<n>\`): \`ttybrain meeting series add @karim "1:1 Karim" --every "2 weeks on wed" --from wed\`. The rhythm is \`weekly on <day>\`, \`every <n> weeks on <day>\`, \`monthly on the <1st|2nd|3rd|4th|last> <day>\` or \`monthly on day <n>\` (dates only, no times). Its meetings are created for the next 8 weeks and again as time passes; they are ordinary meetings (\`M-<n>\`).
- \`ttybrain meeting series list\` shows them; \`series edit S-2 --every … --attendees … --until …\` changes what is still ahead (a changed \`--every\` still counts from the first date), and \`series end S-2 --on <date>\` stops it. Skip one date with \`ttybrain meeting skip M-9\` or change it with \`meeting move M-9 --to <date>\`; neither comes back.
- A meeting always has a subject (a person, a project or a board). Meetings from before this existed have none: \`ttybrain meeting subject M-4 #CRM\`, or \`--all-without #CRM\` for all.

**Boards**

- A board such as \`#MB\` "Management board" holds the board meetings: \`ttybrain board add MB "Management board"\`, then \`ttybrain meeting series add #MB "Board" --every "monthly on the last fri" --from fri\`. A meeting or series about a board is a board meeting (kind board); the board has its own talk-list (\`ttybrain talk add #MB "Budget 2027 first view"\`) and actions can link to it (\`--link #MB\`).
- Project and board codes share one namespace: \`#MB\` is either a project or a board, and adding or renaming either refuses a code the other has. Where a project is needed (\`--project\`, \`project show\`), a board's code is refused as "a board, not a project".
- \`ttybrain board list\`, \`board show #MB\` (its series, next meeting and open talk items), \`board edit #MB --name … --code … --note …\`, \`board archive|restore #MB\` (an archived board takes no new meetings, series or talk items).
- Board meetings that were about a project before boards existed were moved to a board with that project's name and the code \`<CODE>B\`; \`ttybrain plugin list\` names it until it is edited (\`ttybrain board edit #BOARDB --code MB\`).

**Talk-lists**

- Every person, project and board has a talk-list: things the user wants to raise at the next meeting with them, referenced as \`T-<n>\`. Add one with \`ttybrain talk add @anna "AWS training budget"\` (or \`#CRM\` for a project). \`--project ERP\` tags a person's item with a project, so it also shows at ERP's meetings until it is discussed in either place.
- \`ttybrain talk list @anna\` shows the open items numbered in order, with those added before the last held meeting under "carried over" (marked ↻); a project's list includes people's items tagged with it. \`ttybrain talk list\` shows every list.
- When an item has been discussed: \`ttybrain talk done T-3 --meeting M-4\` (the meeting must be about the item's person or project, or a project meeting for a tagged item); without \`--meeting\` when it came up elsewhere. \`ttybrain talk drop T-3\` takes it off the list without discussing it, and \`ttybrain talk reopen T-3\` puts it back. \`ttybrain talk move T-3 --to 1\` reorders within the item's group (the open items, or the carried ones). Only a person's item takes \`--project\`.
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "Meetings", markdown: MARKDOWN })
}
