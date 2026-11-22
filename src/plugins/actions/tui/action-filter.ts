// The Actions screen's filter line: `owner:anna`, `owner:me`, `project:CRM`, `status:done|cancelled|all` and free
// words (matched in the title). The default status is `open`.
export type ActionFilter = { owner?: string; project?: string; status: "open" | "done" | "cancelled" | "all"; text: string[] }

const STATUSES = ["open", "done", "cancelled", "all"] as const

export function parseActionFilter(text: string): ActionFilter {
  const out: ActionFilter = { status: "open", text: [] }
  for (const t of text.split(/\s+/).filter((w) => w !== "")) {
    const i = t.indexOf(":")
    const key = i < 0 ? "" : t.slice(0, i).toLowerCase()
    const value = i < 0 ? "" : t.slice(i + 1)
    if (key === "owner" && value !== "") out.owner = value
    else if (key === "project" && value !== "") out.project = value
    else if (key === "status" && (STATUSES as readonly string[]).includes(value.toLowerCase())) out.status = value.toLowerCase() as ActionFilter["status"]
    else out.text.push(t)
  }
  return out
}
