// An action's links as the forms edit them: one refs field (`#CRM @peter M-4`, space-separated). A link to a record
// that is gone shows as `<type>:<id>`, so it can still be removed. Saving writes the difference through
// unlinkAction (always allowed, also on an action whose projects are archived) and then linkAction (which refuses
// an archived project, an unknown ref or a duplicate), so a form's save is all-or-nothing inside its act.
import { GONE, type ActionRecord } from "../logic/records"

type Write = Record<string, ((input: any) => Promise<any>) | undefined>

// The refs of an action's links, in their order.
export const linkWords = (a: ActionRecord): string[] => a.links.map((l) => (l.ref === GONE ? `${l.type}:${l.id}` : l.ref))

// The refs typed in a refs field.
export const words = (value: string | null | undefined): string[] => (value ?? "").split(/\s+/).filter((w) => w !== "")

const has = (list: string[], w: string) => list.some((x) => x.toLowerCase() === w.toLowerCase())

// What changed between the refs a field opened with and the ones it holds now (by ref, case-insensitively): the
// links to remove, then the ones to add (each once, in the order typed).
export function linkChanges(before: string[], after: string[]): { removed: string[]; added: string[] } {
  const added: string[] = []
  for (const w of after) if (!has(before, w) && !has(added, w)) added.push(w)
  return { removed: before.filter((w) => !has(after, w)), added }
}

// Unlinks, then links (call inside an act).
export async function writeLinks(write: Write, ref: string, changes: { removed: string[]; added: string[] }): Promise<void> {
  for (const to of changes.removed) await write.unlinkAction!({ ref, to })
  for (const to of changes.added) await write.linkAction!({ ref, to })
}
