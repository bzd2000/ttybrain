// The agent guide's section on actions: adding them from what people say, closing them, and checking what exists.
import type { PluginContext } from "@ttybrain/api"

const MARKDOWN = `
Actions are referenced as \`A-<n>\`. An action has an owner (leave out \`--owner\` when the user does it: an empty owner is the user), an optional due date, project, meeting and the stakeholder it is for.

- "X will do Y" or "I need to Y": add an action. \`ttybrain action add "Send the roadmap" --owner X --due fri [--project CRM] [--for peter]\`. Use \`--for\` for the stakeholder who is waiting on it. Pass \`--from-inbox I-<n>\` when it comes from an inbox item.
- "That's done": complete the action with \`ttybrain action done A-<n>\`; one that is no longer needed: \`ttybrain action cancel A-<n>\`.
- Check what exists before you add: \`ttybrain action list --open --project CRM\` (also \`--owner\`, \`--for\`, \`--meeting\`, \`--overdue\`). Don't add the same action twice.
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "Actions", markdown: MARKDOWN })
}
