// The agent guide's section on processing the inbox (design §6).
import type { PluginContext } from "../../../kernel/api"

const MARKDOWN = `
The user captures quick notes in the inbox, with \`#project\` and \`@person\` tags. Process them like this:

1. \`pm inbox list --new --json\` lists the new items. \`pm inbox show I-n --json\` shows one with the records its tags link to and any unresolved tags.
2. Create the records the note calls for, passing \`--from-inbox I-n\` on the commands that create or change records for that item (not on \`pm inbox done\`), so pm records what the item became.
3. \`pm inbox done I-n --summary "…"\` closes the item with a one-line summary of what you did. Use \`pm inbox dismiss I-n\` for an item that needs nothing, and \`pm inbox reopen I-n\` to undo.

What a note becomes:

- a concern → a stakeholder note (an interaction note on that person)
- "X will do Y" → an action
- "decided" → a decision
- "finished" → a deliverable status
- health signals → a health update
- ask the user when something is ambiguous instead of guessing
`

export function registerGuide(ctx: PluginContext): void {
  ctx.guideSection({ title: "Processing the inbox", markdown: MARKDOWN })
}
