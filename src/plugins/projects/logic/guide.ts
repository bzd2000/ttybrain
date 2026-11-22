// The agent guide's sections on projects (codes, health updates, the project context) and on turning notes into
// records (the inbox rules of spec §6).
import type { PluginContext } from "@ttybrain/api"

const MARKDOWN = `
Projects are referenced by code (\`CRM\` or \`#CRM\`): 2–16 upper-case letters or digits. \`ttybrain project list\` shows every active project with its health, next milestone and open actions and risks; \`ttybrain project show <code>\` shows one, with the people involved. A code can be changed with \`ttybrain project edit <code> --code <new>\`; text that mentioned the old code (notes, inbox items, meeting notes, exports) is not rewritten.

- Add a project with \`ttybrain project add <CODE> "<name>" [--effort <days>] [--start <date>] [--end <date>]\`. Check \`ttybrain project list\` first so you don't add it twice.
- Record a health signal ("the design is slipping", "budget overrun") as a health update: \`ttybrain project edit CRM --health amber --health-comment "Design slipping 2 weeks"\`. Health is \`green\`, \`amber\` or \`red\`; every update is kept, and the latest one is the project's current health.
- The project context is long-form Markdown (background, scope, constraints). Read it with \`ttybrain project context <code>\` before answering questions about a project; replace it with \`--set-file <path>\` or \`--stdin\` (empty input is refused), and remove it with \`--clear\`.
- Give someone a role on a project with \`ttybrain involve add CRM marie --role sponsor\` (\`ttybrain involve remove …\` takes it away). The person must exist: add them with \`ttybrain person add\` first.
- Projects are archived, never deleted. An archived project must be restored (\`ttybrain project restore <code>\`) before anything is recorded on it.
`

const NOTES = `
When you process a note (an inbox item, meeting notes, something the user tells you), turn each statement into the matching record. Pass \`--from-inbox I-<n>\` when it comes from an inbox item.

- "X will do Y" or "I need to Y": add an action (see Actions).
- "We decided …", "agreed to …": add a decision. \`ttybrain decision add "Select vendor B" --project CRM [--decided-by "Steering committee"]\`.
- A worry about what might go wrong: add a risk; a problem that is already happening: add an issue. \`ttybrain risk add CRM "Vendor delay" --type risk|issue --severity low|medium|high [--owner bob]\`. Close one that is resolved with \`ttybrain risk close R-<n>\`.
- A signal about how the project is going ("on track", "slipping", "budget overrun"): record a health update. \`ttybrain project edit CRM --health green|amber|red --health-comment "…"\`.
- "X is finished", "sent for review": update the deliverable's status. \`ttybrain deliverable status D-<n> in_progress|in_review|delivered\`. Find the deliverable with \`ttybrain deliverable list CRM\` first.
- A concern or remark from a stakeholder: add a note on that person (see People).
- Check what exists before you add: \`ttybrain risk list CRM\`, \`ttybrain decision list CRM\`. Don't add the same thing twice.
- If the project, the person or the meaning is unclear, ask the user instead of guessing.
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "Projects", markdown: MARKDOWN })
  ctx.guideSection({ title: "Turning notes into records", markdown: NOTES, order: 10 })
}
