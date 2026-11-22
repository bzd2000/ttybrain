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
- Then \`ttybrain meeting close M-4\`. It marks the meeting held and prints how many actions and decisions were logged from it; a meeting with none logged is worth a second look.

**Talk-lists**

- Every person and project has a talk-list: things the user wants to raise at the next meeting with them, referenced as \`T-<n>\`. Add one with \`ttybrain talk add @anna "AWS training budget"\` (or \`#CRM\` for a project). \`--project ERP\` tags a person's item with a project, so it also shows at ERP's meetings until it is discussed in either place.
- \`ttybrain talk list @anna\` shows the open items in order, with those added before the last held meeting under "carried over"; a project's list includes people's items tagged with it. \`ttybrain talk list\` shows every list.
- When an item has been discussed: \`ttybrain talk done T-3 --meeting M-4\` (the meeting must be about the item's person or project, or a project meeting for a tagged item); without \`--meeting\` when it came up elsewhere. \`ttybrain talk drop T-3\` takes it off the list without discussing it; \`ttybrain talk move T-3 --to 1\` reorders.
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "Meetings", markdown: MARKDOWN })
}
