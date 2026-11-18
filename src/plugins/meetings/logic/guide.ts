// The agent guide's section on meetings: preparing one, and turning its notes into actions and decisions.
import type { PluginContext } from "../../../kernel/api"

const MARKDOWN = `
Meetings are referenced as \`M-<n>\`. \`pm meeting list\` shows the planned ones and those held or cancelled in the last 30 days; \`pm meeting show M-<n>\` shows one with its attendees, agenda and notes. An agenda item is addressed by its meeting and its position (\`pm meeting agenda M-4 remove 2\`).

**Preparing a meeting**

- Add it with the projects to discuss: \`pm meeting add "Steering committee Q4" --date 2026-12-04 --kind steering --attendees peter,marie --projects CRM,ERP\`. Each project gets a status item on the agenda.
- Add other items with \`pm meeting agenda M-4 add "Budget" --project CRM --ask "Release contingency"\`. The \`--ask\` is what the user wants from the room; set one wherever there is a decision to get. Change items with \`agenda … edit|move|remove\`.
- Run \`pm report board\` for the preparation: what changed on each project since it was last covered. \`pm meeting edit M-4 --since <date>\` changes where that starts; \`--no-since\` goes back to the default.
- A cancelled meeting cannot be changed. Cancel with \`pm meeting cancel M-<n>\`.

**After a meeting**

- Put the minutes in the notes: \`pm meeting notes M-4 --file minutes.md\`, or \`-\` to read stdin.
- Turn each commitment into an action and each decision into a decision record, tied to the meeting: \`pm action add "Send the roadmap" --owner marie --due fri --meeting M-4\` and \`pm decision add "Select vendor B" --project CRM --meeting M-4\`.
- Then \`pm meeting close M-4\`. It marks the meeting held and prints how many actions and decisions were logged from it; a meeting with none logged is worth a second look.
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "Meetings", markdown: MARKDOWN })
}
