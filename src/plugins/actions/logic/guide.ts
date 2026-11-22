// The agent guide's section on actions: adding them from what people say, linking them, closing them, and checking
// what exists.
import type { PluginContext } from "@ttybrain/api"

const MARKDOWN = `
Actions are referenced as \`A-<n>\`. An action has an owner (leave out \`--owner\` when the user does it: an empty owner is the user), an optional due date, and links to the records it concerns: projects (\`#CRM\`), people (\`@peter\`, such as the stakeholder waiting on it) and meetings (\`M-4\`).

- "X will do Y" or "I need to Y": add an action. \`ttybrain action add "Send the roadmap" --owner X --due fri [--project CRM] [--for peter]\`. \`--project\`, \`--for\` (the stakeholder who is waiting on it) and \`--meeting\` are shorthand for links; \`--link <ref>\` links any record and can be repeated. Pass \`--from-inbox I-<n>\` when it comes from an inbox item.
- Link or unlink later: \`ttybrain action link A-<n> #ERP\`, \`ttybrain action unlink A-<n> @peter\`. \`ttybrain action show A-<n>\` shows an action with its links.
- "That's done": complete the action with \`ttybrain action done A-<n>\`; one that is no longer needed: \`ttybrain action cancel A-<n>\`.
- Check what exists before you add: \`ttybrain action list --open --project CRM\` (also \`--owner\`, \`--for\`, \`--meeting\`, \`--link <ref>\`, \`--overdue\`). Don't add the same action twice.
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "Actions", markdown: MARKDOWN })
}
