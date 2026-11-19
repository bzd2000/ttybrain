// The agent guide's section on people: which note kind to use, and where stakeholder concerns go.
import type { PluginContext } from "@pm/api"

const MARKDOWN = `
People are referenced by handle (\`anna\` or \`@anna\`). \`pm person list --stakeholders\` shows stakeholders by influence, then oldest contact first; \`pm person show <handle>\` shows one person with their notes and goals.

- Use \`pm note add <person> "<text>" --1on1\` for a 1:1 with a member of the user's team.
- Use \`--interaction\` for any other contact: a stakeholder conversation, a call, a remark in a meeting.
- When a stakeholder raises a concern ("Peter is worried about the budget"), record it as an interaction note on that person, with the project: \`pm note add peter "Worried about budget" --interaction --project CRM\`. Notes keep the last-contact date up to date.
- Pass \`--date\` when the contact was not today.
- Add a person with \`pm person add "<full name>" [--team] [--stakeholder]\`. The handle defaults to the first name; read it from the output instead of guessing it. Check \`pm person list\` first so you don't add someone twice.
- People are archived, never deleted. An archived person must be restored (\`pm person restore <handle>\`) before anything is recorded on them.
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "People and stakeholders", markdown: MARKDOWN })
}
