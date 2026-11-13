// The agent guide's section on projects: codes, health updates and the project context.
import type { PluginContext } from "../../../kernel/api"

const MARKDOWN = `
Projects are referenced by code (\`CRM\` or \`#CRM\`): 2–8 upper-case letters or digits. \`pm project list\` shows every active project with its health, next milestone and open actions and risks; \`pm project show <code>\` shows one, with the people involved.

- Add a project with \`pm project add <CODE> "<name>" [--effort <days>] [--start <date>] [--end <date>]\`. Check \`pm project list\` first so you don't add it twice.
- Record a health signal ("the design is slipping", "budget overrun") as a health update: \`pm project edit CRM --health amber --health-comment "Design slipping 2 weeks"\`. Health is \`green\`, \`amber\` or \`red\`; every update is kept, and the latest one is the project's current health.
- The project context is long-form Markdown (background, scope, constraints). Read it with \`pm project context <code>\` before answering questions about a project; replace it with \`--set-file <path>\` or \`--stdin\`.
- Give someone a role on a project with \`pm involve add CRM marie --role sponsor\` (\`pm involve remove …\` takes it away). The person must exist: add them with \`pm person add\` first.
- Projects are archived, never deleted. An archived project must be restored (\`pm project restore <code>\`) before anything is recorded on it.
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "Projects", markdown: MARKDOWN })
}
