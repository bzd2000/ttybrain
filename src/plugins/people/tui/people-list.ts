// Pure list logic for the People screen: rows, sorts, filter and groups. No solid-js or @opentui here.
import { daysBetween, type Tone } from "@ttybrain/api/tui"
import { isStale } from "../logic/stale"
import type { PersonRecord } from "../logic/schema"

export type PersonRow = PersonRecord & { projects: string[] }
export type PeopleTab = "all" | "stakeholders" | "team"
export type SortMode = "influence" | "contact" | "name"
type Group = "stakeholders" | "team" | "other"

export const SORTS: SortMode[] = ["influence", "contact", "name"]
export const SORT_LABELS: Record<SortMode, string> = {
  influence: "influence, then last contact",
  contact: "last contact",
  name: "name",
}

export const roleText = (p: Pick<PersonRecord, "job_title" | "organisation">): string => [p.job_title, p.organisation].filter(Boolean).join(", ")

export function lastText(p: PersonRow, today: string): string {
  return p.last_contact === null ? "never" : `${daysBetween(p.last_contact, today)}d`
}

export function lastTone(p: PersonRow, today: string, days: number): Tone {
  if (p.is_stakeholder && p.influence === "high" && isStale(p.last_contact, today, days)) return "amber"
  return p.last_contact === null ? "muted" : undefined
}

export function matchesFilter(p: PersonRow, filter: string): boolean {
  const terms = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const role = roleText(p).toLowerCase()
  return terms.every((t) => {
    const level = /^(infl|int):(high|low|none)$/.exec(t)
    if (level) return (level[1] === "infl" ? p.influence : p.interest) === (level[2] === "none" ? null : level[2])
    return [p.name.toLowerCase(), p.handle.toLowerCase(), role, ...p.projects.map((c) => c.toLowerCase())].some((s) => s.includes(t))
  })
}

const byName = (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
// Never first, then oldest.
const byContact = (a: PersonRow, b: PersonRow) => (a.last_contact ?? "").localeCompare(b.last_contact ?? "")
const rank = (p: PersonRow) => (p.influence === "high" ? 0 : p.influence === "low" ? 1 : 2)

export function sortPeople(rows: PersonRow[], mode: SortMode, group: Group): PersonRow[] {
  const cmp =
    mode === "name" || (mode === "influence" && group !== "stakeholders")
      ? byName
      : mode === "contact"
        ? (a: PersonRow, b: PersonRow) => byContact(a, b) || byName(a, b)
        : (a: PersonRow, b: PersonRow) => rank(a) - rank(b) || byContact(a, b) || byName(a, b)
  return [...rows].sort(cmp)
}

export function peopleGroups(
  rows: PersonRow[],
  tab: PeopleTab,
  mode: SortMode,
  archived: boolean,
): Array<{ title: string | undefined; rows: PersonRow[] }> {
  const live = rows.filter((p) => !p.archived)
  const out: Array<{ title: string | undefined; rows: PersonRow[] }> = []
  const add = (title: string | undefined, group: Group, list: PersonRow[]) => {
    if (list.length) out.push({ title, rows: sortPeople(list, mode, group) })
  }
  if (tab === "all") {
    add("Stakeholders", "stakeholders", live.filter((p) => p.is_stakeholder))
    add("Team", "team", live.filter((p) => p.is_team && !p.is_stakeholder))
    add("Other", "other", live.filter((p) => !p.is_team && !p.is_stakeholder))
  } else {
    add(undefined, tab, live.filter((p) => (tab === "team" ? p.is_team : p.is_stakeholder)))
  }
  if (archived) {
    const gone = rows.filter((p) => p.archived && (tab === "all" || (tab === "team" ? p.is_team : p.is_stakeholder)))
    if (gone.length) out.push({ title: "Archived", rows: [...gone].sort(byName) })
  }
  return out
}

export function tabCounts(rows: PersonRow[]): Record<PeopleTab, number> {
  const live = rows.filter((p) => !p.archived)
  return { all: live.length, stakeholders: live.filter((p) => p.is_stakeholder).length, team: live.filter((p) => p.is_team).length }
}
