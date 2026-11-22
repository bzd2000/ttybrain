// The Actions screen's filter line: `owner:anna`, `owner:me` (or `mine`), `project:CRM`, `status:done|cancelled|all`,
// linked records by their refs (`@anna`, `#CRM`, `M-4`, as the design's `@anna #CRM mine`) and free words (matched in
// the title). The default status is `open`.
export type ActionFilter = { owner?: string; project?: string; status: "open" | "done" | "cancelled" | "all"; links: string[]; text: string[] }

const STATUSES = ["open", "done", "cancelled", "all"] as const
const LINK = /^(?:[#@][A-Za-z0-9][A-Za-z0-9-]*|M-\d+)$/i

export function parseActionFilter(text: string): ActionFilter {
  const out: ActionFilter = { status: "open", links: [], text: [] }
  for (const t of text.split(/\s+/).filter((w) => w !== "")) {
    const i = t.indexOf(":")
    const key = i < 0 ? "" : t.slice(0, i).toLowerCase()
    const value = i < 0 ? "" : t.slice(i + 1)
    if (key === "owner" && value !== "") out.owner = value
    else if (key === "project" && value !== "") out.project = value
    else if (key === "status" && (STATUSES as readonly string[]).includes(value.toLowerCase())) out.status = value.toLowerCase() as ActionFilter["status"]
    else if (t.toLowerCase() === "mine") out.owner = "me"
    else if (LINK.test(t)) out.links.push(t)
    else out.text.push(t)
  }
  return out
}
