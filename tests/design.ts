// The look-and-feel conformance helpers: `seedDesign(kernel)` seeds the example data of the screen designs
// (docs/superpowers/specs/2026-11-13-pm-screens.html) through the plugins' write operations, and the span helpers
// read a rendered frame's colours. Use with `makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12", seed: seedDesign })`
// (the designs' today, Thu 12 Nov 2026), which seeds once per test process and copies the database into each
// test's home (tests/helpers.ts). Ids follow the seed, not the mock (A-1 rather than A-27).
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

export function struckAt(spans: CapturedFrame, text: string, scope?: LineScope): boolean | undefined {
  const s = spanAt(spans, text, scope)
  return s && (s.attributes & TextAttributes.STRIKETHROUGH) !== 0
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
// week, 34 later, 3 undated), M-1 "SteerCo" (28 Oct, held) and M-2 "Steering committee Q4" (board SC, 4 Dec, 8 attendees,
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
  const actions = w("actions")
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

    // M-1, the SteerCo of 28 Oct (held), a project meeting about CRM; M-2, the coming steering committee, about the
    // board SC "Steering committee" and with an agenda naming other projects: a board meeting, so it keeps the
    // Agenda · Prep · Notes · Export tabs the 2026-11-13 meeting prep design draws (ruling M11).
    const m1 = await meetings.addMeeting!({ about: "#CRM", title: "SteerCo", date: "2026-10-28", projects: ["CRM"], attendees: ["peter", "marie", "tom"] })
    await meetings.closeMeeting!({ ref: m1.ref })
    const attendees = ["peter", "marie", "luc", "tom", "anna", "bob", "karim", "sofie"]
    await meetings.addBoard!({ code: "SC", name: "Steering committee" })
    const m2 = await meetings.addMeeting!({ about: "#SC", title: "Steering committee Q4", date: "2026-12-04", attendees })
    const ask = "Approve 2-week shift of design milestone and release of contingency budget."
    await meetings.addAgendaItem!({ meeting: m2.ref, text: "Minutes & open actions" })
    await meetings.addAgendaItem!({ meeting: m2.ref, text: "CRM status", project: "CRM", ask })
    await meetings.addAgendaItem!({ meeting: m2.ref, text: "ERP vendor decision", project: "ERP" })
    await meetings.addAgendaItem!({ meeting: m2.ref, text: "HR portal pilot go/no-go", project: "HRP" })
    await meetings.addAgendaItem!({ meeting: m2.ref, text: "AOB" })

    // The overdue actions and two due this week (the third comes from the inbox below).
    await actions.addAction!({ title: "Send revised budget to Peter", project: "CRM", forPerson: "peter", due: "2026-11-09" })
    await actions.addAction!({ title: "Book vendor demo slot", project: "ERP", owner: "bob", meeting: m1.ref, due: "2026-11-10" })
    await actions.addAction!({ title: "Review test strategy", project: "DWH", owner: "anna", due: "2026-11-11" })
    await actions.addAction!({ title: "Prepare SteerCo deck input", project: "CRM", meeting: m2.ref, due: "2026-11-13" })
    await actions.addAction!({ title: "Confirm licence count", project: "IAM", owner: "karim", due: "2026-11-13" })
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
    const action = await actions.addAction!({ title: "Align migration scope with DWH team", project: "CRM", owner: "bob", due: "2026-11-16" })
    const risk = await projects.addRisk!({ project: "CRM", title: "Data migration volume unknown", type: "risk", severity: "medium" })
    return `action ${action.ref} (Bob, Mon) · risk ${risk.ref} "Data migration volume unknown"`
  })
  await handled("2026-11-11T15:30:00", "2026-11-11T18:00:00", "1:1 @sofie wants project mgmt training next year, follow up with options", async () => {
    await people.addNote!({ person: "sofie", kind: "one_on_one", text: "Wants project mgmt training next year", date: "2026-11-11" })
    await people.addGoal!({ person: "sofie", title: "PM training 2027" })
    const action = await actions.addAction!({ title: "Send training plan options", due: "2026-11-15" })
    return `1:1 note on Sofie · goal "PM training 2027" · action ${action.ref} (me, Sun)`
  })
  await handled("2026-11-11T16:45:00", "2026-11-11T18:05:00", "#ERP decision: go with vendor B, signed off by steering", async () => {
    const decision = await projects.addDecision!({ project: "ERP", title: "Select vendor B", date: "2026-11-11" })
    return `decision ${decision.ref} "Select vendor B" on ERP`
  })

  await inCtx(async () => {
    // Next week; then 34 later actions, which bring the projects' open actions to ERP 7, CRM 9, HRP 4, DWH 6,
    // IAM 3, SEC 2, WMS 1; and 3 without a date.
    await actions.addAction!({ title: "Invite Marie to design walkthrough", project: "CRM", forPerson: "marie", due: "2026-11-17" })
    await actions.addAction!({ title: "Pilot user list", project: "HRP", owner: "sofie", due: "2026-11-18" })
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
      for (const title of titles) await actions.addAction!({ title, due: addDays("2026-11-23", 3 * n++), ...(project && { project }) })
    for (const title of ["Read architecture guidelines", "Think about PMO tooling", "Sort old meeting notes"]) await actions.addAction!({ title })

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

// Long refs for the Attention panels' column fitting, as of Thu 12 Nov 2026: project DATAPLATFORM2027 (a 16-character
// code, red health 2 days old, a milestone 3 days late), overdue action A-1000, action A-1001 due Fri, high risk
// R-1000, and the high-influence stakeholder "Alexandra Vandenberghe" (22 characters) on it, never contacted. The
// four-digit ids come from moving the first action and risk to id 1000 (the next ones follow on).
export async function seedLongRefs(kernel: Kernel): Promise<void> {
  const w = (plugin: string) => kernel.runtime(plugin)!.self().write as Write
  const projects = w("projects")
  const actions = w("actions")
  await runWithContext(kernel.context(), async () => {
    await w("people").addPerson!({ name: "Alexandra Vandenberghe", handle: "alexandra", is_stakeholder: true, influence: "high", interest: "high" })
    await projects.addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
    await projects.setHealth!({ project: "DATAPLATFORM2027", health: "red", comment: "Ingest blocked", date: "2026-11-10" })
    await projects.addMilestone!({ project: "DATAPLATFORM2027", title: "Ingest live", due: "2026-11-09" })
    await projects.addInvolvement!({ project: "DATAPLATFORM2027", person: "alexandra", role: "sponsor" })
    // Moved before it is linked (a link references the action's id).
    const first = await actions.addAction!({ title: "Unblock ingest", due: "2026-11-10" })
    kernel.db.raw.exec(`UPDATE actions_action SET id = 1000 WHERE id = ${Number(first.ref.slice(2))}`)
    await actions.editAction!({ ref: "A-1000", project: "DATAPLATFORM2027" })
    await actions.addAction!({ title: "Confirm cluster size", project: "DATAPLATFORM2027", due: "2026-11-13" })
    const risk = await projects.addRisk!({ project: "DATAPLATFORM2027", title: "Ingest vendor late", type: "risk", severity: "high" })
    kernel.db.raw.exec(`UPDATE projects_risk SET id = 1000 WHERE id = ${Number(risk.ref.slice(2))}`)
  })
}

// The 2026-11-20 meeting designs' data (docs/superpowers/specs/2026-11-20-ttybrain-meeting-screens.html), as of
// Fri 20 Nov 2026: use with `makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })`.
// - People: Anna Peeters, Bob Willems, Sofie Lambert, Karim Haddad, Mathias Wouters (team); Marie Dubois, Peter
//   Janssens (stakeholders; Marie last seen 2 Oct, 49 days ago). Projects CRM (amber), ERP (red), HRP; the
//   board BOARD "Management board" (plan ruling B5: a board, not a project).
// - Series S-1 … S-7 in the `meetings` mock's order: 1:1 Anna (every 2 weeks on Mon from 9 Nov), 1:1 Bob (Wed, from
//   11 Nov), 1:1 Sofie (Mon, from 16 Nov), 1:1 Karim (Wed, from 4 Nov), CRM steering (monthly, 4th Tue, from 22 Sep),
//   ERP steering (monthly, 1st Thu; its 3 Dec skipped), Board (the board BOARD, monthly, last Fri). Their past dates
//   are held (Karim's Wed 18 Nov is not: it has notes and closes itself on Sat 21); the CRM kick-off (14 Sep) and the
//   ERP vendor call (Thu 26 Nov) are one-off meetings. The Board of Fri 27 Nov has the `board` mock's five agenda items.
// - Talk-lists: Anna 4 open (Tue … today, two tagged ERP and CRM) and 1 carried over from her 1:1 of 9 Nov (where 3
//   were discussed); Bob 1, Karim 2, Sofie none; CRM 2 of its own (3 with Anna's CRM item), ERP 1 (2 with Anna's),
//   the board 2.
// - Actions as screen 4 draws them: Send revised budget to Peter (me, CRM @peter, CRM steering 27 Oct, 14 Nov),
//   Review her test strategy draft (me, @anna, 1:1 Anna 9 Nov, 16 Nov), Book vendor demo slot (Bob, ERP, 17 Nov), Ask
//   HR about the AWS training budget (me, @anna, Mon 23), Draft 2027 budget first view (me, BOARD, Board 27 Nov, Thu
//   26), Renew domain certificates (me, Fri 27), Solution design v1 (Anna, CRM, Fri 27). Ids follow the seed.
// - The inbox: 2 new items. Only through the plugins' write operations; a failing write throws.
export async function seedMeetings(kernel: Kernel): Promise<void> {
  const w = (plugin: string) => kernel.runtime(plugin)!.self().write as Write
  // As if the clock read `day` (a series made then has its occurrences from that day on).
  const on = <T>(day: string, fn: () => Promise<T>) => runWithContext({ ...kernel.context(), today: day, now: `${day}T09:00:00` }, fn)
  const people = w("people")
  const projects = w("projects")
  const actions = w("actions")
  const meetings = w("meetings")
  const data = kernel.runtime("meetings")!.data
  // The ref of the meeting titled `title` on `date`.
  const meeting = (title: string, date: string) =>
    runWithContext(kernel.context(), async () => {
      const row = await data.selectFrom("meeting").select("id").where("title", "=", title).where("date", "=", date).executeTakeFirstOrThrow()
      return `M-${Number(row.id)}`
    })
  const close = async (title: string, date: string) => {
    const ref = await meeting(title, date)
    await on(date, () => meetings.closeMeeting!({ ref }))
  }

  await on("2026-09-01", async () => {
    const persons: Array<[name: string, handle: string, job: string, stakeholder: boolean]> = [
      ["Anna Peeters", "anna", "Architect", false],
      ["Bob Willems", "bob", "Integration lead", false],
      ["Sofie Lambert", "sofie", "Business analyst", false],
      ["Karim Haddad", "karim", "IAM engineer", false],
      ["Mathias Wouters", "mathias", "Developer", false],
      ["Marie Dubois", "marie", "Head of Sales", true],
      ["Peter Janssens", "peter", "CFO, Finance", true],
    ]
    for (const [name, handle, job_title, stakeholder] of persons)
      await people.addPerson!({ name, handle, job_title, is_stakeholder: stakeholder, is_team: !stakeholder, ...(stakeholder ? { influence: "high", interest: "high" } : {}) })
    for (const [code, name] of [
      ["CRM", "CRM replatforming"],
      ["ERP", "ERP vendor selection"],
      ["HRP", "HR self-service portal"],
    ])
      await projects.addProject!({ code, name })
    await meetings.addBoard!({ code: "BOARD", name: "Management board" })
    for (const [project, person, role] of [
      ["CRM", "peter", "sponsor"],
      ["CRM", "marie", "business owner"],
      ["CRM", "anna", "architect"],
      ["CRM", "bob", "integration"],
      ["ERP", "bob", "integration"],
    ])
      await projects.addInvolvement!({ project, person, role })
  })

  // CRM: the kick-off (one-off) and the monthly steering, held in September and October.
  await on("2026-09-14", async () => {
    await meetings.addMeeting!({ about: "#CRM", title: "Kick-off", date: "2026-09-14", attendees: ["peter", "marie", "anna", "bob"] })
    await meetings.addSeries!({ about: "#CRM", title: "CRM steering", every: "monthly on the 4th tue", from: "2026-09-22", attendees: ["peter", "marie", "anna", "bob"] })
  })
  await close("Kick-off", "2026-09-14")
  await close("CRM steering", "2026-09-22")
  await close("CRM steering", "2026-10-27")
  await on("2026-10-02", () => people.addNote!({ person: "marie", kind: "interaction", text: "Kick-off of the CRM key user group", date: "2026-10-02" }))

  // The board: monthly, its October meeting held.
  await on("2026-10-26", () => meetings.addSeries!({ about: "#BOARD", title: "Board", every: "monthly on the last fri", from: "2026-10-30", attendees: ["peter", "marie"] }))
  await close("Board", "2026-10-30")

  // Anna: an item from before her 1:1 of 9 Nov stays (carried), three were discussed in it.
  await on("2026-11-02", async () => {
    await meetings.addSeries!({ about: "@anna", title: "1:1 Anna", every: "every 2 weeks on mon", from: "2026-11-09" })
    await meetings.addTalk!({ about: "@anna", text: "Workload: two projects at once" })
    for (const text of ["Design review planning", "Conference in March", "Mentoring Mathias"]) await meetings.addTalk!({ about: "@anna", text })
  })
  const anna9 = await meeting("1:1 Anna", "2026-11-09")
  await on("2026-11-09", async () => {
    for (const ref of ["T-2", "T-3", "T-4"]) await meetings.discussTalk!({ ref, meeting: anna9 })
  })
  await close("1:1 Anna", "2026-11-09")

  // Karim: held on 4 Nov; Wed 18 Nov has notes and is not closed yet. Bob and Sofie: their first 1:1s held.
  await on("2026-11-04", () => meetings.addSeries!({ about: "@karim", title: "1:1 Karim", every: "every 2 weeks on wed", from: "2026-11-04" }))
  await close("1:1 Karim", "2026-11-04")
  await on("2026-11-11", () => meetings.addSeries!({ about: "@bob", title: "1:1 Bob", every: "every 2 weeks on wed", from: "2026-11-11" }))
  await close("1:1 Bob", "2026-11-11")
  await on("2026-11-16", () => meetings.addSeries!({ about: "@sofie", title: "1:1 Sofie", every: "every 2 weeks on mon", from: "2026-11-16" }))
  await close("1:1 Sofie", "2026-11-16")
  const karim18 = await meeting("1:1 Karim", "2026-11-18")
  await on("2026-11-18", () => meetings.setNotes!({ meeting: karim18, markdown: "IAM wave 2 readiness: test accounts still missing." }))

  // CRM's prep since its last steering (the `project` design): the solution outline approved in October (before that
  // steering, so the prep leaves it out), the design milestone ahead, the solution design in review, the decision of
  // 28 Oct.
  await on("2026-10-14", async () => {
    const ms = await projects.addMilestone!({ project: "CRM", title: "Solution outline approved", due: "2026-10-14" })
    await projects.completeMilestone!({ ref: ms.ref, date: "2026-10-14" })
    await projects.addMilestone!({ project: "CRM", title: "Design approved", due: "2026-12-10" })
  })
  await on("2026-10-28", () => projects.addDecision!({ project: "CRM", title: "Phase 1 excludes marketing autom.", date: "2026-10-28" }))
  await on("2026-11-12", () => projects.addDeliverable!({ project: "CRM", title: "Solution design", owner: "anna", due: "2026-12-04", status: "in_review" }))

  // Health and the talk items of the week.
  await on("2026-11-16", async () => {
    await projects.setHealth!({ project: "HRP", health: "green", comment: "On track", date: "2026-11-16" })
    await people.addNote!({ person: "peter", kind: "interaction", text: "Worried about CRM budget", date: "2026-11-16" })
  })
  await on("2026-11-17", () => meetings.addTalk!({ about: "@anna", text: "AWS training budget for next year" }))
  await on("2026-11-18", async () => {
    await meetings.addTalk!({ about: "@anna", text: "Her view on Vendor B's architecture", project: "ERP" })
    await projects.setHealth!({ project: "ERP", health: "red", comment: "Vendor B contract not signed", date: "2026-11-18" })
    await projects.setHealth!({ project: "CRM", health: "amber", comment: "Design slipping 2 weeks", date: "2026-11-18" })
    await meetings.addTalk!({ about: "#CRM", text: "Shift design milestone by 2 weeks" })
    await meetings.addTalk!({ about: "#CRM", text: "Release contingency budget" })
  })
  await on("2026-11-19", async () => {
    await meetings.addTalk!({ about: "@anna", text: "Feedback from Marie on the design demo", project: "CRM" })
    await meetings.addTalk!({ about: "@bob", text: "Integration specs: three more days" })
    await meetings.addTalk!({ about: "@karim", text: "Test accounts for IAM wave 2" })
    await meetings.addTalk!({ about: "@karim", text: "On-call rota in December" })
    await meetings.addTalk!({ about: "#ERP", text: "Vendor B reference calls" })
    await meetings.addTalk!({ about: "#BOARD", text: "Hiring freeze impact on IAM wave 2" })
    await meetings.addTalk!({ about: "#BOARD", text: "Security awareness: board sponsor?" })
  })

  await on("2026-11-20", async () => {
    await meetings.addTalk!({ about: "@anna", text: "Holiday planning around go-live" })
    // ERP: the monthly steering (its 3 Dec skipped for the vendor call) and the one-off vendor call.
    await meetings.addSeries!({ about: "#ERP", title: "ERP steering", every: "monthly on the 1st thu", from: "2026-11-05", attendees: ["bob"] })
    await meetings.addMeeting!({ about: "#ERP", title: "ERP vendor call", date: "2026-11-26", attendees: ["bob"] })
    // The series made before today get their occurrences up to 8 weeks from today (an edit tops them up).
    for (let n = 1; n <= 7; n++) await meetings.editSeries!({ ref: `S-${n}` })
  })
  const board = await meeting("Board", "2026-11-27")
  const crm27 = await meeting("CRM steering", "2026-10-27")
  await on("2026-11-20", async () => {
    await meetings.skipMeeting!({ ref: await meeting("ERP steering", "2026-12-03") })
    const items: Array<[text: string, project?: string, ask?: string]> = [
      ["Minutes & open actions"],
      ["CRM status", "CRM", "approve 2-week shift"],
      ["ERP vendor decision", "ERP", "choose vendor B"],
      ["HR portal pilot go/no-go", "HRP", "go for pilot"],
      ["Budget 2027 first view"],
    ]
    for (const [text, project, ask] of items) await meetings.addAgendaItem!({ meeting: board, text, ...(project && { project }), ...(ask && { ask }) })

    await actions.addAction!({ title: "Send revised budget to Peter", due: "2026-11-14", links: ["#CRM", "@peter", crm27] })
    await actions.addAction!({ title: "Review her test strategy draft", due: "2026-11-16", links: ["@anna", anna9] })
    await actions.addAction!({ title: "Book vendor demo slot", owner: "bob", due: "2026-11-17", links: ["#ERP"] })
    await actions.addAction!({ title: "Ask HR about the AWS training budget", due: "2026-11-23", links: ["@anna"] })
    await actions.addAction!({ title: "Draft 2027 budget first view", due: "2026-11-26", links: ["#BOARD", board] })
    await actions.addAction!({ title: "Renew domain certificates", due: "2026-11-27" })
    await actions.addAction!({ title: "Solution design v1", owner: "anna", due: "2026-11-27", links: ["#CRM"] })
  })
  await runWithContext({ ...kernel.context(), now: "2026-11-20T08:30:00" }, () => w("inbox").capture!({ text: "@anna wants to swap the 1:1 to Tuesday" }))
  await runWithContext({ ...kernel.context(), now: "2026-11-20T08:45:00" }, () => w("inbox").capture!({ text: "#ERP vendor B sent the revised offer" }))
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
