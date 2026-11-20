import { describe, expect, test } from "bun:test"
import { lastText, lastTone, matchesFilter, peopleGroups, roleText, sortPeople, tabCounts, type PersonRow } from "./people-list"

let n = 0
const person = (o: Partial<PersonRow> & { handle: string }): PersonRow => ({
  ref: `@${o.handle}`,
  id: ++n,
  name: o.handle[0]!.toUpperCase() + o.handle.slice(1),
  organisation: null,
  job_title: null,
  email: null,
  phone: null,
  is_team: false,
  is_stakeholder: false,
  influence: null,
  interest: null,
  last_contact: null,
  archived: false,
  projects: [],
  ...o,
})
const handles = (rows: PersonRow[]) => rows.map((r) => r.handle)
const stake = (handle: string, influence: "high" | "low" | null, last_contact: string | null) =>
  person({ handle, is_stakeholder: true, influence, last_contact })
const five = () => [
  stake("marie", "high", "2026-10-03"),
  stake("luc", "high", null),
  stake("peter", "high", "2026-11-11"),
  stake("nadia", "low", "2026-09-14"),
  stake("ingrid", null, "2026-11-01"),
]

describe("sorts", () => {
  test("sort influence: high before low before unset, then oldest contact, never first", () => {
    expect(handles(sortPeople(five(), "influence", "stakeholders"))).toEqual(["luc", "marie", "peter", "nadia", "ingrid"])
  })
  test("sort contact and sort name", () => {
    expect(handles(sortPeople(five(), "contact", "stakeholders"))).toEqual(["luc", "nadia", "marie", "ingrid", "peter"])
    expect(handles(sortPeople(five(), "name", "stakeholders"))).toEqual(["ingrid", "luc", "marie", "nadia", "peter"])
  })
  test("team group sorts by name under influence", () => {
    const rows = [person({ handle: "zoe", is_team: true, last_contact: null }), person({ handle: "abe", is_team: true, last_contact: "2026-11-01" })]
    expect(handles(sortPeople(rows, "influence", "team"))).toEqual(["abe", "zoe"])
    expect(handles(sortPeople(rows, "influence", "other"))).toEqual(["abe", "zoe"])
  })
})

describe("groups", () => {
  const anna = person({ handle: "anna", is_team: true, is_stakeholder: true })
  const bob = person({ handle: "bob", is_team: true })
  const g = (groups: ReturnType<typeof peopleGroups>) => groups.map((x) => [x.title, handles(x.rows)])

  test("a person who is both shows once in All and in both other tabs", () => {
    const rows = [bob, anna]
    expect(g(peopleGroups(rows, "all", "influence", false))).toEqual([["Stakeholders", ["anna"]], ["Team", ["bob"]]])
    expect(g(peopleGroups(rows, "team", "influence", false))).toEqual([[undefined, ["anna", "bob"]]])
    expect(g(peopleGroups(rows, "stakeholders", "influence", false))).toEqual([[undefined, ["anna"]]])
    expect(tabCounts(rows)).toEqual({ all: 2, stakeholders: 1, team: 2 })
  })

  test("archived only with the flag, in a last Archived group", () => {
    const old = person({ handle: "old", is_team: true, archived: true })
    const gone = person({ handle: "gone", archived: true })
    const rows = [bob, old, gone, anna]
    expect(g(peopleGroups(rows, "all", "influence", false))).toEqual([["Stakeholders", ["anna"]], ["Team", ["bob"]]])
    expect(g(peopleGroups(rows, "all", "influence", true))).toEqual([
      ["Stakeholders", ["anna"]],
      ["Team", ["bob"]],
      ["Archived", ["gone", "old"]],
    ])
    expect(g(peopleGroups(rows, "team", "influence", true))).toEqual([[undefined, ["anna", "bob"]], ["Archived", ["old"]]])
    expect(tabCounts(rows)).toEqual({ all: 2, stakeholders: 1, team: 2 })
  })

  test("Other group and empty groups", () => {
    const x = person({ handle: "x" })
    expect(g(peopleGroups([x], "all", "name", false))).toEqual([["Other", ["x"]]])
    expect(peopleGroups([], "all", "name", false)).toEqual([])
  })
})

describe("filter", () => {
  const rows = [
    person({ handle: "a", is_stakeholder: true, influence: "high", interest: "low", projects: ["CRM"], job_title: "CFO" }),
    person({ handle: "b", is_stakeholder: true, influence: "low" }),
    person({ handle: "c", is_stakeholder: true }),
  ]
  const f = (q: string) => handles(rows.filter((r) => matchesFilter(r, q)))
  test("filter", () => {
    expect(f("infl:high")).toEqual(["a"])
    expect(f("int:none")).toEqual(["b", "c"])
    expect(f("infl:none")).toEqual(["c"])
    expect(f("crm")).toEqual(["a"])
    expect(f("cfo")).toEqual(["a"])
    expect(f("infl:high crm")).toEqual(["a"])
    expect(f("infl:low crm")).toEqual([])
    expect(f("")).toEqual(["a", "b", "c"])
  })
})

describe("text", () => {
  const today = "2026-11-13"
  test("lastText and lastTone", () => {
    const hi = (last_contact: string | null) => stake("h", "high", last_contact)
    expect([lastText(hi("2026-10-14"), today), lastTone(hi("2026-10-14"), today, 30)]).toEqual(["30d", "amber"])
    expect([lastText(hi("2026-10-15"), today), lastTone(hi("2026-10-15"), today, 30)]).toEqual(["29d", undefined])
    expect([lastText(hi(null), today), lastTone(hi(null), today, 30)]).toEqual(["never", "amber"])
    const team = person({ handle: "t", is_team: true })
    expect([lastText(team, today), lastTone(team, today, 30)]).toEqual(["never", "muted"])
    // A low-influence stakeholder's days are muted, stale or not (the design: `60d`, `20d`); a team member's are text.
    expect(lastTone(stake("l", "low", "2026-09-14"), today, 30)).toBe("muted")
    expect(lastTone(stake("l", "low", "2026-11-03"), today, 30)).toBe("muted")
    expect(lastTone(person({ handle: "t", is_team: true, last_contact: "2026-09-14" }), today, 30)).toBeUndefined()
  })
  test("roleText", () => {
    expect(roleText(person({ handle: "a", job_title: "CFO", organisation: "Finance" }))).toBe("CFO, Finance")
    expect(roleText(person({ handle: "a", job_title: "CFO" }))).toBe("CFO")
    expect(roleText(person({ handle: "a" }))).toBe("")
  })
})
