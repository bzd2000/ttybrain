// The agent guide's sections on projects (codes, health updates, the project context) and on turning notes into
// records (the inbox rules of spec §6).
import type { PluginContext } from "../../../kernel/api"

const MARKDOWN = `
Projects are referenced by code (\`CRM\` or \`#CRM\`): 2–8 upper-case letters or digits. \`pm project list\` shows every active project with its health, next milestone and open actions and risks; \`pm project show <code>\` shows one, with the people involved.

- Add a project with \`pm project add <CODE> "<name>" [--effort <days>] [--start <date>] [--end <date>]\`. Check \`pm project list\` first so you don't add it twice.
- Record a health signal ("the design is slipping", "budget overrun") as a health update: \`pm project edit CRM --health amber --health-comment "Design slipping 2 weeks"\`. Health is \`green\`, \`amber\` or \`red\`; every update is kept, and the latest one is the project's current health.
- The project context is long-form Markdown (background, scope, constraints). Read it with \`pm project context <code>\` before answering questions about a project; replace it with \`--set-file <path>\` or \`--stdin\`.
- Give someone a role on a project with \`pm involve add CRM marie --role sponsor\` (\`pm involve remove …\` takes it away). The person must exist: add them with \`pm person add\` first.
- Projects are archived, never deleted. An archived project must be restored (\`pm project restore <code>\`) before anything is recorded on it.
`

const NOTES = `
When you process a note (an inbox item, meeting notes, something the user tells you), turn each statement into the matching record. Pass \`--from-inbox I-<n>\` when it comes from an inbox item.

- "X will do Y" or "I need to Y": add an action. \`pm action add "Send the roadmap" --owner X --due fri [--project CRM] [--for peter]\`. Leave out \`--owner\` when the user does it: an empty owner is the user. Use \`--for\` for the stakeholder who is waiting on it.
- "We decided …", "agreed to …": add a decision. \`pm decision add "Select vendor B" --project CRM [--decided-by "Steering committee"]\`.
- A worry about what might go wrong: add a risk; a problem that is already happening: add an issue. \`pm risk add CRM "Vendor delay" --type risk|issue --severity low|medium|high [--owner bob]\`. Close one that is resolved with \`pm risk close R-<n>\`.
- A signal about how the project is going ("on track", "slipping", "budget overrun"): record a health update. \`pm project edit CRM --health green|amber|red --health-comment "…"\`.
- "X is finished", "sent for review": update the deliverable's status. \`pm deliverable status D-<n> in_progress|in_review|delivered\`. Find the deliverable with \`pm deliverable list CRM\` first.
- "That's done": complete the action with \`pm action done A-<n>\`; one that is no longer needed: \`pm action cancel A-<n>\`.
- A concern or remark from a stakeholder: add a note on that person (see People).
- Check what exists before you add: \`pm action list --open --project CRM\`, \`pm risk list CRM\`. Don't add the same thing twice.
- If the project, the person or the meaning is unclear, ask the user instead of guessing.
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "Projects", markdown: MARKDOWN })
  ctx.guideSection({ title: "Turning notes into records", markdown: NOTES, order: 10 })
}
