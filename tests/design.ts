// The look-and-feel conformance helpers: `seedDesign(kernel)` seeds the example data of the screen designs
// (docs/superpowers/specs/2026-11-13-pm-screens.html) through the plugins' write operations, and the span helpers
// read a rendered frame's colours. Use with `makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })`
// (the designs' today, Thu 12 Nov 2026). Ids follow the seed, not the mock (A-1 rather than A-27).
import { rgbToHex, TextAttributes, type CapturedFrame, type CapturedSpan } from "@opentui/core"
import { runWithContext, type Origin } from "../src/kernel/context"
import { addDays } from "../src/kernel/dates"
import type { Kernel } from "../src/kernel/host"
import { theme } from "../src/kernel/tui/theme"

// --- span helpers ---

// Which lines a lookup searches: every line (undefined), line `i` (a number), or the lines whose text contains the
// string or matches the regex. Scope a lookup when the same text can also show elsewhere (the header's date holds
// digits, a crumb repeats a code).
export type LineScope = number | string | RegExp | undefined

const inScope = (scope: LineScope, index: number, text: string) =>
  scope === undefined ? true : typeof scope === "number" ? index === scope : typeof scope === "string" ? text.includes(scope) : scope.test(text)

// The span under the first cell of the first occurrence of `text` (searched line by line, in `scope`), or undefined.
function spanAt(spans: CapturedFrame, text: string, scope?: LineScope): CapturedSpan | undefined {
  for (const [i, l] of spans.lines.entries()) {
    const whole = l.spans.map((s) => s.text).join("")
    if (!inScope(scope, i, whole)) continue
    const at = whole.indexOf(text)
    if (at < 0) continue
    let pos = 0
    for (const s of l.spans) {
      if (at < pos + s.text.length) return s
      pos += s.text.length
    }
  }
  return undefined
}

// The foreground colour (hex) of the first cell of `text` (in `scope`), or undefined when the frame does not show it.
export function fgAt(spans: CapturedFrame, text: string, scope?: LineScope): string | undefined {
  const s = spanAt(spans, text, scope)
  return s && rgbToHex(s.fg)
}

// The background colour (hex) of the first cell of `text` (in `scope`), or undefined when the frame does not show it.
export function bgAt(spans: CapturedFrame, text: string, scope?: LineScope): string | undefined {
  const s = spanAt(spans, text, scope)
  return s && rgbToHex(s.bg)
}

// Whether the first cell of `text` (in `scope`) is bold; undefined when the frame does not show it.
export function boldAt(spans: CapturedFrame, text: string, scope?: LineScope): boolean | undefined {
  const s = spanAt(spans, text, scope)
  return s && (s.attributes & TextAttributes.BOLD) !== 0
}

// Per line, the text drawn on the selected-row background (theme.selectedBg), trimmed; lines without it are left
// out. The selection has no marker, so this is how a test finds the selected row. An active tab and the header
// chip sit on that background too: match on a row's own text.
export function selectedText(spans: CapturedFrame): string[] {
  const out: string[] = []
  for (const l of spans.lines) {
    const text = l.spans
      .filter((s) => rgbToHex(s.bg) === theme.selectedBg)
      .map((s) => s.text)
      .join("")
      .trim()
    if (text !== "") out.push(text)
  }
  return out
}

// Whether a selected row (see selectedText) shows `text`.
export function isSelected(spans: CapturedFrame, text: string): boolean {
  return selectedText(spans).some((l) => l.includes(text))
}

// Line `i` of a frame (from frame() or peek()), without its trailing spaces.
export function line(frame: string, i: number): string {
  return (frame.split("\n")[i] ?? "").trimEnd()
}

// --- the designs' example data ---

type Write = Record<string, (input: any) => Promise<any>>
type Level = "high" | "low" | null

// The 2026-11-13 designs' data, as of Thu 12 Nov 2026: 12 people (7 stakeholders, 5 team), 8 projects (BI2 on
// hold) with health, milestones, deliverables, risks and decisions, 46 open actions (3 overdue, 3 this week, 3 next
// week, 34 later, 3 undated), M-1 "SteerCo" (28 Oct, held) and M-2 "Steering committee Q4" (4 Dec, 8 attendees,
// 5 agenda items), the CRM context, and the inbox: 4 handled items (I-1 dismissed, I-2 … I-4 processed, with what
// was made from them; captured Mon 9 Nov and yesterday, as the Inbox design) and 3 new ones (I-5 … I-7, today at
// 09:42, 10:15 and 11:03). Only through the plugins' write operations; a failing write throws.
export async function seedDesign(kernel: Kernel): Promise<void> {
  const w = (plugin: string) => kernel.runtime(plugin)!.self().write as Write
  const inCtx = <T>(fn: () => Promise<T>, origin?: Origin) => runWithContext(kernel.context(origin), fn)
  // As if the clock read `now` (the inbox items' capture and processing times).
  const at = <T>(now: string, fn: () => Promise<T>) => runWithContext({ ...kernel.context(), today: now.slice(0, 10), now }, fn)
  const people = w("people")
  const projects = w("projects")
  const meetings = w("meetings")
  const inbox = w("inbox")

  await inCtx(async () => {
    const persons: Array<[name: string, handle: string, job: string, stakeholder: boolean, team: boolean, influence: Level, interest: Level]> = [
      ["Marie Dubois", "marie", "Head of Sales", true, false, "high", "high"],
      ["Luc Vermeulen", "luc", "Procurement lead", true, false, "high", "low"],
      ["Ingrid Claes", "ingrid", "CIO", true, false, "high", "low"],
      ["Tom Maes", "tom", "COO", true, false, "high", "high"],
      ["Peter Janssens", "peter", "CFO, Finance", true, false, "high", "high"],
      ["Nadia El Amrani", "nadia", "Legal counsel", true, false, "low", "low"],
      ["Jan De Smet", "jan", "Sales manager", true, false, "low", "high"],
      ["Anna Peeters", "anna", "Architect", false, true, null, null],
      ["Bob Willems", "bob", "Integration lead", false, true, null, null],
      ["Karim Haddad", "karim", "IAM engineer", false, true, null, null],
      ["Mathias Wouters", "mathias", "Developer", false, true, null, null],
      ["Sofie Lambert", "sofie", "Business analyst", false, true, null, null],
    ]
    for (const [name, handle, job_title, is_stakeholder, is_team, influence, interest] of persons) {
      const email = `${name.toLowerCase().replace(/ /g, ".")}@example.com`
      await people.addPerson!({ name, handle, job_title, is_stakeholder, is_team, influence, interest, email })
    }

    type Health = "red" | "amber" | "green"
    const list: Array<[code: string, name: string, effort: number, health: Health, comment: string, updated: string, milestone: string, due: string]> = [
      ["ERP", "ERP vendor selection", 60, "red", "Vendor B contract not signed", "2026-11-03", "Vendor selected", "2026-11-06"],
      ["CRM", "CRM replatforming", 220, "amber", "Design slipping 2 weeks, waiting on integration specs from Sales Ops.", "2026-11-10", "Design approved", "2026-11-26"],
      ["HRP", "HR self-service portal", 80, "amber", "Key user availability", "2026-11-07", "Pilot start", "2026-12-08"],
      ["DWH", "Data warehouse migration", 310, "green", "On track", "2026-11-09", "Test environment ready", "2026-11-11"],
      ["IAM", "Identity & access rollout", 140, "green", "Wave 1 live", "2026-10-12", "Wave 2 live", "2027-01-15"],
      ["SEC", "Security awareness 2027", 25, "green", "On track", "2026-11-05", "Content signed off", "2027-01-20"],
      ["WMS", "Warehouse scanners", 45, "green", "Hardware ordered", "2026-11-06", "Hardware delivered", "2027-02-03"],
    ]
    for (const [code, name, effortDays, health, comment, date, milestone, due] of list) {
      if (code === "CRM") {
        const description = "Replace the legacy CRM with a SaaS platform for Sales and Customer Service. Phase 1 covers accounts, contacts and opportunities."
        await projects.addProject!({ code, name, effortDays, effortNote: "incl. vendor", startDate: "2026-09-01", endDate: "2027-06-30", description })
        const outline = await projects.addMilestone!({ project: code, title: "Solution outline approved", due: "2026-10-14" })
        await projects.completeMilestone!({ ref: outline.ref, date: "2026-10-14" })
      } else await projects.addProject!({ code, name, effortDays })
      await projects.setHealth!({ project: code, health, comment, date })
      await projects.addMilestone!({ project: code, title: milestone, due })
    }
    await projects.addProject!({ code: "BI2", name: "Self-service BI phase 2", status: "on_hold", effortDays: 90 })
    for (const [title, due] of [["Build complete", "2027-03-31"], ["UAT complete", "2027-05-14"], ["Go-live", "2027-06-30"]])
      await projects.addMilestone!({ project: "CRM", title, due })

    const involvements: Array<[code: string, handle: string, role: string]> = [
      ["CRM", "peter", "sponsor"],
      ["ERP", "peter", "steerco"],
      ["CRM", "marie", "business owner"],
      ["HRP", "marie", "stakeholder"],
      ["ERP", "luc", "procurement"],
      ["IAM", "ingrid", "sponsor"],
      ["SEC", "ingrid", "sponsor"],
      ["ERP", "tom", "steerco"],
      ["DWH", "tom", "sponsor"],
      ["ERP", "nadia", "legal"],
      ["CRM", "jan", "key user"],
      ["CRM", "anna", "architect"],
      ["DWH", "anna", "architect"],
      ["CRM", "bob", "integration"],
      ["ERP", "bob", "integration"],
      ["HRP", "sofie", "analyst"],
      ["CRM", "sofie", "analyst"],
      ["IAM", "karim", "engineer"],
      ["CRM", "karim", "engineer"],
      ["DWH", "mathias", "developer"],
    ]
    for (const [project, person, role] of involvements) await projects.addInvolvement!({ project, person, role })

    const deliverables: Array<[title: string, owner: string, due: string, status: string]> = [
      ["Solution outline", "anna", "2026-10-10", "delivered"],
      ["Solution design", "anna", "2026-11-13", "in_review"],
      ["Integration specs", "bob", "2026-11-20", "in_progress"],
      ["Data migration plan", "bob", "2026-12-11", "not_started"],
      ["Test strategy", "anna", "2027-01-15", "not_started"],
      ["Training material", "sofie", "2027-04-30", "not_started"],
    ]
    for (const [title, owner, due, status] of deliverables) await projects.addDeliverable!({ project: "CRM", title, owner, due, status })

    // Three high risks and issues (ERP, CRM, DWH); CRM's medium risk comes from the inbox below, and it has two
    // closed ones.
    const risks: Array<[code: string, title: string, type: "risk" | "issue", severity: "high" | "medium" | "low"]> = [
      ["ERP", "Vendor B may miss go-live", "risk", "high"],
      ["ERP", "Licence cost above budget", "risk", "medium"],
      ["ERP", "Data conversion effort unclear", "risk", "medium"],
      ["CRM", "Budget overrun ~12%", "issue", "high"],
      ["HRP", "Key users not released for the pilot", "risk", "medium"],
      ["DWH", "Source data quality", "risk", "high"],
      ["DWH", "Nightly load window too short", "risk", "low"],
      ["WMS", "Scanner delivery delay", "risk", "low"],
    ]
    for (const [project, title, type, severity] of risks) await projects.addRisk!({ project, title, type, severity })
    for (const [title, type, severity] of [["Vendor lock-in", "risk", "low"], ["Sales Ops availability", "issue", "medium"]]) {
      const r = await projects.addRisk!({ project: "CRM", title, type, severity })
      await projects.closeRisk!({ ref: r.ref, date: "2026-10-20" })
    }

    const decisions: Array<[title: string, date: string]> = [
      ["SaaS platform over on-prem", "2026-09-02"],
      ["Sales and Service on one instance", "2026-09-10"],
      ["Account history archived, not migrated", "2026-09-17"],
      ["Single sign-on through the IAM rollout", "2026-09-24"],
      ["Weekly design reviews with Sales Ops", "2026-10-01"],
      ["Implementation partner selected", "2026-10-08"],
      ["Phase 1 excludes marketing automation", "2026-10-28"],
    ]
    for (const [title, date] of decisions) await projects.addDecision!({ project: "CRM", title, date })

    // M-1, the SteerCo of 28 Oct (held); M-2, the coming steering committee.
    const m1 = await meetings.addMeeting!({ title: "SteerCo", date: "2026-10-28", kind: "steering", projects: ["CRM"], attendees: ["peter", "marie", "tom"] })
    await meetings.closeMeeting!({ ref: m1.ref })
    const attendees = ["peter", "marie", "luc", "tom", "anna", "bob", "karim", "sofie"]
    const m2 = await meetings.addMeeting!({ title: "Steering committee Q4", date: "2026-12-04", kind: "steering", attendees })
    const ask = "Approve 2-week shift of design milestone and release of contingency budget."
    await meetings.addAgendaItem!({ meeting: m2.ref, text: "Minutes & open actions" })
    await meetings.addAgendaItem!({ meeting: m2.ref, text: "CRM status", project: "CRM", ask })
    await meetings.addAgendaItem!({ meeting: m2.ref, text: "ERP vendor decision", project: "ERP" })
    await meetings.addAgendaItem!({ meeting: m2.ref, text: "HR portal pilot go/no-go", project: "HRP" })
    await meetings.addAgendaItem!({ meeting: m2.ref, text: "AOB" })

    // The overdue actions and two due this week (the third comes from the inbox below).
    await projects.addAction!({ title: "Send revised budget to Peter", project: "CRM", forPerson: "peter", due: "2026-11-09" })
    await projects.addAction!({ title: "Book vendor demo slot", project: "ERP", owner: "bob", meeting: m1.ref, due: "2026-11-10" })
    await projects.addAction!({ title: "Review test strategy", project: "DWH", owner: "anna", due: "2026-11-11" })
    await projects.addAction!({ title: "Prepare SteerCo deck input", project: "CRM", meeting: m2.ref, due: "2026-11-13" })
    await projects.addAction!({ title: "Confirm licence count", project: "IAM", owner: "karim", due: "2026-11-13" })
  })

  // Inbox items already handled, and what was made from them (with the item as their origin).
  const handled = async (captured: string, processed: string, text: string, make: () => Promise<string>) => {
    const item = await at(captured, () => inbox.capture!({ text }))
    const summary = await inCtx(make, { type: "inbox", ref: item.ref })
    await at(processed, () => inbox.markProcessed!({ ref: item.ref, summary, by: "assistant" }))
  }
  const coffee = await at("2026-11-09T08:10:00", () => inbox.capture!({ text: "remember to buy coffee for the team" }))
  await at("2026-11-09T17:00:00", () => inbox.dismiss!({ ref: coffee.ref, by: "you" }))
  await handled("2026-11-09T14:20:00", "2026-11-10T08:30:00", "#CRM #DWH migration overlap, Bob to align with DWH team", async () => {
    const action = await projects.addAction!({ title: "Align migration scope with DWH team", project: "CRM", owner: "bob", due: "2026-11-16" })
    const risk = await projects.addRisk!({ project: "CRM", title: "Data migration volume unknown", type: "risk", severity: "medium" })
    return `action ${action.ref} (Bob, Mon) · risk ${risk.ref} "Data migration volume unknown"`
  })
  await handled("2026-11-11T15:30:00", "2026-11-11T18:00:00", "1:1 @sofie wants project mgmt training next year, follow up with options", async () => {
    await people.addNote!({ person: "sofie", kind: "one_on_one", text: "Wants project mgmt training next year", date: "2026-11-11" })
    await people.addGoal!({ person: "sofie", title: "PM training 2027" })
    const action = await projects.addAction!({ title: "Send training plan options", due: "2026-11-15" })
    return `1:1 note on Sofie · goal "PM training 2027" · action ${action.ref} (me, Sun)`
  })
  await handled("2026-11-11T16:45:00", "2026-11-11T18:05:00", "#ERP decision: go with vendor B, signed off by steering", async () => {
    const decision = await projects.addDecision!({ project: "ERP", title: "Select vendor B", date: "2026-11-11" })
    return `decision ${decision.ref} "Select vendor B" on ERP`
  })

  await inCtx(async () => {
    // Next week; then 34 later actions, which bring the projects' open actions to ERP 7, CRM 9, HRP 4, DWH 6,
    // IAM 3, SEC 2, WMS 1; and 3 without a date.
    await projects.addAction!({ title: "Invite Marie to design walkthrough", project: "CRM", forPerson: "marie", due: "2026-11-17" })
    await projects.addAction!({ title: "Pilot user list", project: "HRP", owner: "sofie", due: "2026-11-18" })
    const later: Array<[code: string | undefined, titles: string[]]> = [
      ["CRM", ["Draft cutover plan", "Agree data retention rules", "Schedule key user training", "Review vendor SOW change", "Plan UAT scenarios"]],
      ["ERP", ["Collect reference calls", "Check vendor B financials", "Draft contract annex", "Plan data conversion workshop", "Align with Finance on licences", "Prepare go-live checklist"]],
      ["DWH", ["Map source tables", "Agree load window with Ops", "Review data quality report", "Plan reconciliation tests", "Decommission old cubes"]],
      ["IAM", ["Plan wave 3 groups", "Review access recertification"]],
      ["HRP", ["Prepare pilot comms", "Collect pilot feedback form", "Book training room"]],
      ["SEC", ["Review phishing test results", "Draft awareness calendar"]],
      ["WMS", ["Confirm scanner models"]],
      [
        undefined,
        [
          "Quarterly portfolio review",
          "Update resource plan",
          "Prepare budget 2027 input",
          "Team offsite agenda",
          "Review contractor extensions",
          "Write Q4 status letter",
          "Plan holiday cover",
          "Update risk register template",
          "Clean up shared drive",
          "Book 1:1s for January",
        ],
      ],
    ]
    let n = 0
    for (const [project, titles] of later)
      for (const title of titles) await projects.addAction!({ title, due: addDays("2026-11-23", 3 * n++), ...(project && { project }) })
    for (const title of ["Read architecture guidelines", "Think about PMO tooling", "Sort old meeting notes"]) await projects.addAction!({ title })

    // Contact notes, giving the days since the last contact on 12 Nov (Sofie's 1:1 came from the inbox above).
    const notes: Array<[handle: string, kind: "interaction" | "one_on_one", text: string, date: string]> = [
      ["marie", "interaction", "Kick-off of the CRM key user group", "2026-10-02"],
      ["luc", "interaction", "ERP vendor shortlist", "2026-10-08"],
      ["ingrid", "interaction", "IAM wave 2 scope", "2026-10-31"],
      ["tom", "interaction", "Warehouse and DWH priorities", "2026-11-03"],
      ["peter", "interaction", "Coffee, ERP vendor shortlist", "2026-10-15"],
      ["peter", "interaction", "SteerCo: agreed phase 1 scope", "2026-10-28"],
      ["peter", "interaction", "Worried about CRM budget", "2026-11-10"],
      ["nadia", "interaction", "Vendor B contract clauses", "2026-09-13"],
      ["jan", "interaction", "Sales pipeline fields for CRM", "2026-10-23"],
      ["anna", "one_on_one", "Design review planning", "2026-11-11"],
      ["bob", "one_on_one", "Integration specs need 3 more days", "2026-11-09"],
      ["karim", "one_on_one", "IAM wave 2 readiness", "2026-11-06"],
      ["mathias", "one_on_one", "DWH test data", "2026-11-08"],
    ]
    for (const [person, kind, text, date] of notes) await people.addNote!({ person, kind, text, date })

    await projects.setContext!({ project: "CRM", markdown: CRM_CONTEXT })

  })
  // The 3 new inbox items (the last one has an unknown tag).
  await at("2026-11-12T09:42:00", () => inbox.capture!({ text: "Peter worried about budget overrun on #CRM, wants an update before the board @peter" }))
  await at("2026-11-12T10:15:00", () => inbox.capture!({ text: "@anna finished the solution outline #CRM, Bob needs 3 more days on specs @bob" }))
  await at("2026-11-12T11:03:00", () => inbox.capture!({ text: "#CMR ask Marie about key user dates" }))
}

const CRM_CONTEXT = `# Background

The legacy CRM (Siebel 8, on-prem) reaches end of support in Q3 2027. Sales and Customer Service run separate instances with duplicated accounts.

## Scope phase 1

- Accounts, contacts, opportunities
- Migration of 4.2M contact records, deduplicated
- **Out of scope:** marketing automation (decision 28 Oct)

## Integrations

| System | Direction | Notes |
|---|---|---|
| ERP (SAP) | both | customer master, orders |
| DWH | out | nightly extract |

## Links

[Solution outline v1.2](https://sharepoint/sites/projects/CRM/outline.docx)
`
