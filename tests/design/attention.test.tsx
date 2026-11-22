// Screen 1, Attention, as the screen designs draw it (docs/superpowers/specs/2026-11-13-pm-screens.html,
// "Attention"): the design's six panels in paired grid rows (each pair starts on the same line and has the same
// height), fixed column widths, cyan project codes, magenta names, and the Inbox panel after them (R2). Seeded with
// the designs' example data, today Thu 12 Nov 2026, 118×36. Ids follow the seed (R5); "Due this week" lists the
// seed's three actions (the design's deliverable row is A12, a FEATURE).
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { fgAt, isSelected, line, seedDesign, seedLongRefs, seedMeetings } from "../design"
import { runWithContext } from "../../src/kernel/context"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"
import { theme } from "../../src/kernel/tui/theme"

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

// Waits (bounded) until `check` holds for the frame; returns the last frame.
async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 100 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

// A row of fixed-width cells, one cell apart (the Table's gap), as a panel draws it.
const cols = (widths: number[], texts: string[]) =>
  texts
    .map((s, i) => s.padEnd(widths[i]!))
    .join(" ")
    .trimEnd()
// The text inside the left or right panel on line `i` (between `│ ` and ` │`), without trailing spaces.
const inside = (frame: string, i: number, side: 0 | 1) => (line(frame, i).split("│")[1 + 2 * side] ?? "").slice(1).trimEnd()

// At 118 wide the left panel has 54 cells inside, the right one 53.
const ACTIONS_L = [5, 32, 7, 7]
const ACTIONS_R = [5, 31, 7, 7]
const PROJECTS = [2, 6, 30, 12]
const MILESTONES = [6, 38, 8]
const RISKS = [5, 6, 33, 6]
const STAKEHOLDERS = [17, 24, 10]

// The 2026-11-20 designs put "Upcoming meetings · next 7 days" first: the 2026-11-13 design's panels follow it,
// paired in the same order (one place later each), and its bar has no `q quit`.
test("Attention as designed", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  tui = await renderTui(kernel, { width: 118, height: 36 })
  const frame = await until(tui, (f) => f.includes("Marie Dubois") && f.includes("Send revised budget to Peter") && f.includes("I-5"))

  // Row 1: Upcoming meetings (none in the next 7 days: no header, no note) and Overdue actions.
  expect(line(frame, 1)).toMatch(/^ ╭─ Upcoming meetings · next 7 days ─+╮ ╭─ Overdue actions · 3 ─+╮$/)
  expect([2, 3, 4].map((i) => inside(frame, i, 0))).toEqual(["No meetings in the next 7 days.", "", ""])
  expect([2, 3, 4].map((i) => inside(frame, i, 1))).toEqual([
    cols(ACTIONS_R, ["A-1", "Send revised budget to Peter", "CRM", "-3d"]),
    cols(ACTIONS_R, ["A-2", "Book vendor demo slot", "ERP", "-2d"]),
    cols(ACTIONS_R, ["A-3", "Review test strategy", "DWH", "-1d"]),
  ])
  expect(line(frame, 5)).toMatch(/^ ╰─+╯ ╰─+╯$/)

  // Row 2: Due this week and Projects needing attention (no count, no on-hold BI2); the pair starts on the same
  // line and closes on the same line.
  expect(line(frame, 6)).toMatch(/^ ╭─ Due this week · 3 ─+╮ ╭─ Projects needing attention ─+╮$/)
  expect([7, 8, 9, 10].map((i) => inside(frame, i, 0))).toEqual([
    cols(ACTIONS_L, ["A-4", "Prepare SteerCo deck input", "CRM", "Fri"]),
    cols(ACTIONS_L, ["A-5", "Confirm licence count", "IAM", "Fri"]),
    cols(ACTIONS_L, ["A-7", "Send training plan options", "—", "Sun"]),
    "",
  ])
  expect([7, 8, 9, 10].map((i) => inside(frame, i, 1))).toEqual([
    cols(PROJECTS, ["●", "ERP", "Vendor B contract not signed", "upd 9d ago"]),
    cols(PROJECTS, ["●", "CRM", "Design slipping 2 weeks, wait…", "upd 2d ago"]),
    cols(PROJECTS, ["●", "HRP", "Key user availability", "upd 5d ago"]),
    cols(PROJECTS, ["○", "IAM", "Health not updated", "31d ago"]),
  ])
  expect(line(frame, 11)).toMatch(/^ ╰─+╯ ╰─+╯$/)

  // Row 3: Late milestones with its sub-heading and High risks & issues.
  expect(line(frame, 12)).toMatch(/^ ╭─ Late milestones · 2 ─+╮ ╭─ High risks & issues · 3 ─+╮$/)
  expect([13, 14, 15, 16, 17].map((i) => inside(frame, i, 0))).toEqual([
    cols(MILESTONES, ["ERP", "Vendor selected", "-6d"]),
    cols(MILESTONES, ["DWH", "Test environment ready", "-1d"]),
    "",
    "Next 14 days",
    cols(MILESTONES, ["CRM", "Design approved", "26 Nov"]),
  ])
  expect([13, 14, 15, 16, 17].map((i) => inside(frame, i, 1))).toEqual([
    cols(RISKS, ["R-1", "ERP", "Vendor B may miss go-live", "risk"]),
    cols(RISKS, ["R-4", "CRM", "Budget overrun ~12%", "issue"]),
    cols(RISKS, ["R-6", "DWH", "Source data quality", "risk"]),
    "",
    "",
  ])
  expect(line(frame, 18)).toMatch(/^ ╰─+╯ ╰─+╯$/)

  // Row 4: Stakeholders to contact (no count, high influence only, the footer row) and the Inbox panel after the
  // design's panels.
  expect(line(frame, 19)).toMatch(/^ ╭─ Stakeholders to contact ─+╮ ╭─ Inbox · 3 ─+╮$/)
  expect([20, 21, 22].map((i) => inside(frame, i, 0))).toEqual([
    cols(STAKEHOLDERS, ["Marie Dubois", "41d"]),
    cols(STAKEHOLDERS, ["Luc Vermeulen", "35d"]),
    "last contact over 30 days, high influence first",
  ])
  expect(line(frame, 23)).toMatch(/^ ╰─+╯ ╰─+╯$/)
  expect(frame).not.toContain("BI2")
  expect(frame).not.toContain("Nadia")

  // The 2026-11-20 design's bar (no row keys: the focused meetings panel is empty).
  expect(line(frame, 35)).toBe(" tab panel   enter open   i capture   g or 1-6 screens   ? help")

  let spans = await tui.spans()
  // Project codes cyan, ids muted, overdue red.
  for (const [code, at] of [["CRM", 2], ["ERP", 7], ["IAM", 10], ["DWH", 14], ["ERP", 13], ["CRM", 14]] as const) expect(fgAt(spans, code, at)).toBe(theme.cyan)
  expect(fgAt(spans, "CRM", "Design approved")).toBe(theme.cyan)
  expect(fgAt(spans, "A-1", 2)).toBe(theme.muted)
  expect(fgAt(spans, "-3d", 2)).toBe(theme.red)
  expect(fgAt(spans, "—", 9)).toBe(theme.muted)
  expect(fgAt(spans, "○", 10)).toBe(theme.muted)
  expect(fgAt(spans, "31d ago", 10)).toBe(theme.amber)
  expect(fgAt(spans, "-6d", 13)).toBe(theme.red)
  expect(fgAt(spans, "Next 14 days", 16)).toBe(theme.muted)
  expect(fgAt(spans, "No meetings in the next 7 days.", 2)).toBe(theme.muted)
  // People names magenta, the age amber, the footer muted (no levels or codes in the rows).
  expect(fgAt(spans, "Marie Dubois", 20)).toBe(theme.magenta)
  expect(fgAt(spans, "Luc Vermeulen", 21)).toBe(theme.magenta)
  expect(frame).not.toContain("high/high")
  expect(fgAt(spans, "41d", 20)).toBe(theme.amber)
  expect(fgAt(spans, "last contact over", 22)).toBe(theme.muted)
  // The focused panel's title is accent, the others muted; Tab moves to Overdue actions, which selects its first row.
  expect(fgAt(spans, "Upcoming meetings", 1)).toBe(theme.accent)
  expect(fgAt(spans, "Overdue actions", 1)).toBe(theme.muted)
  expect(fgAt(spans, "Late milestones", 12)).toBe(theme.muted)
  tui.input.pressTab()
  await tui.settle()
  spans = await tui.spans()
  expect(fgAt(spans, "Overdue actions", 1)).toBe(theme.accent)
  expect(isSelected(spans, "Send revised budget to Peter")).toBe(true)
})

// The panels' columns are minimums that grow to their longest text: a 16-character code, four-digit ids and a long
// name stay whole in every panel (titles give way), at the design's size and at 80×24.
for (const [width, height] of [[118, 36], [80, 24]] as const)
  test(`Attention at ${width}x${height}: long codes, ids and names whole`, async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
    await seedLongRefs(kernel)
    tui = await renderTui(kernel, { width, height })
    // Settled: the long name and its age are in place (a frame before the columns are measured can cut them).
    let frame = await until(tui, (f) => f.includes("R-1000") && f.includes("Alexandra Vandenberghe") && /Alexandra Vandenberghe +never/.test(f))
    await tui.settle()
    frame = await tui.frame()
    // Each panel's row (found by its id or mark; paired panels share a line) holds the whole code next to it.
    const at = (re: RegExp) => frame.split("\n").filter((l) => re.test(l))
    expect(at(/ A-1000 .+ DATAPLATFORM2027 +-2d /).length).toBe(1) // overdue
    expect(at(/ A-1001 .+ DATAPLATFORM2027 +Fri /).length).toBe(1) // due this week
    expect(at(/ ● +DATAPLATFORM2027 .+ upd 2d ago /).length).toBe(1) // needing attention
    expect(at(/│ DATAPLATFORM2027 .+ -3d /).length).toBe(1) // the late milestone
    expect(at(/ R-1000 +DATAPLATFORM2027 .+ risk /).length).toBe(1) // the high risk
    expect(at(/ Alexandra Vandenberghe +never /).length).toBe(1) // the stakeholder: whole name and age
    expect(frame).not.toMatch(/DATAPLATFORM202?…|DATAPL\w*…|A-100…|R-100…|Alexandra Vande\w*…/)
  })

// The 2026-11-20 `home` design: "Upcoming meetings · next 7 days" first (top left, paired with Overdue actions), its
// header row, the meetings of Mon 23 … Fri 27 (series rows end with a muted `r`, the board shows its agenda length),
// "Your act." amber with `· n late`, the selected meeting's "Before <meeting> · your actions" block, `r recurring` on
// the bottom border, and the design's bar. Seeded with the meeting designs' data, today Fri 20 Nov 2026. Ids follow
// the seed (A-2 is the design's A-31, A-4 its A-44). The CRM steering's action (A-1, the design's A-27) is overdue,
// so its count reads `1 · 1 late` where the design, against its own Overdue panel, draws a plain `1`.
const MEETINGS = [10, 16, 7, 7, 10]
const BEFORE = [5, 40, 7]

test("Attention: Upcoming meetings as designed (2026-11-20 home)", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20" })
  await seedMeetings(kernel)
  tui = await renderTui(kernel, { width: 118, height: 36 })
  const frame = await until(tui, (f) => f.includes("Before 1:1 Anna") && f.includes("Ask HR about the AWS training budget") && f.includes("5 items"))

  expect(line(frame, 0)).toMatch(/^ ttybrain ·  1 Attention ▾ +● 2 new in inbox +Fri 20 Nov 2026$/)
  expect(line(frame, 1)).toMatch(/^ ╭─ Upcoming meetings · next 7 days ─+╮ ╭─ Overdue actions · 3 ─+╮$/)
  expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => inside(frame, i, 0))).toEqual([
    cols(MEETINGS, ["Date", "Meeting", "About", "To talk", "Your act."]),
    cols(MEETINGS, ["Mon 23", "1:1 Anna r", "Anna", "4", "2 · 1 late"]),
    cols(MEETINGS, ["Tue 24", "CRM steering r", "CRM", "3", "1 · 1 late"]),
    cols(MEETINGS, ["Wed 25", "1:1 Bob r", "Bob", "1", "—"]),
    cols(MEETINGS, ["Thu 26", "ERP vendor call", "ERP", "2", "—"]),
    cols(MEETINGS, ["Fri 27", "Board r", "BOARD", "5 items", "1"]),
    "",
    "Before 1:1 Anna · your actions",
    cols(BEFORE, ["A-2", "Review her test strategy draft", "-4d"]),
    cols(BEFORE, ["A-4", "Ask HR about the AWS training budget", "Mon"]),
  ])
  expect(line(frame, 12)).toMatch(/^ ╰─+ r recurring ─╯ (│|╰)/)
  expect(line(frame, 35)).toBe(" tab panel   enter open   x done   t to talk   i capture   g or 1-6 screens   ? help")

  const spans = await tui.spans()
  expect(isSelected(spans, "1:1 Anna r")).toBe(true)
  expect(fgAt(spans, "Upcoming meetings", 1)).toBe(theme.accent)
  expect(fgAt(spans, "Date", 2)).toBe(theme.muted)
  expect(fgAt(spans, "r ", "1:1 Bob")).toBe(theme.muted)
  expect(fgAt(spans, "1:1 Bob", 5)).toBe(theme.text)
  expect(fgAt(spans, "CRM     3", 4)).toBe(theme.cyan)
  expect(fgAt(spans, "BOARD", 7)).toBe(theme.cyan)
  expect(fgAt(spans, "Anna", 3)).toBe(theme.text)
  expect(fgAt(spans, "2 · 1 late", 3)).toBe(theme.amber)
  expect(fgAt(spans, "—", 5)).toBe(theme.muted)
  expect(fgAt(spans, "1", /Board r/)).toBe(theme.text)
  expect(fgAt(spans, "Before 1:1 Anna", 9)).toBe(theme.muted)
  expect(fgAt(spans, "A-2", 10)).toBe(theme.muted)
  expect(fgAt(spans, "-4d", 10)).toBe(theme.red)
  expect(fgAt(spans, "Mon", 11)).toBe(theme.text)
  expect(fgAt(spans, "r recurring", 12)).toBe(theme.muted)
})

test("Attention's Upcoming meetings: Enter opens the meeting, t adds to its talk-list, x in the action block marks it done", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20" })
  await seedMeetings(kernel)
  tui = await renderTui(kernel, { width: 118, height: 36 })
  await until(tui, (f) => f.includes("Before 1:1 Anna"))
  const talks = async (about: string) =>
    runWithContext(kernel!.context(), async () => ((await (kernel!.runtime("meetings")!.self().read as any).talkList({ about })).open as any[]).map((t) => t.text))

  // t: the talk-item form with the meeting's subject filled in.
  tui.input.pressKey("t")
  let frame = await until(tui, (f) => f.includes("New talk item"))
  expect(frame).toMatch(/  About\*  @anna/)
  expect(frame).toContain("› Text*")
  await tui.input.typeText("Conference budget")
  tui.input.pressKey("s", { ctrl: true })
  await until(tui, (f) => !f.includes("New talk item") && f.includes("1:1 Anna r"))
  expect((await talks("@anna")).at(-1)).toBe("Conference budget")
  frame = await until(tui, (f) => inside(f, 3, 0).includes(cols([10, 16, 7, 7], ["Mon 23", "1:1 Anna r", "Anna", "5"])))

  // Down to the Board, then into its block: x marks the Board's action done.
  for (let i = 0; i < 4; i++) tui.input.pressArrow("down")
  await until(tui, (f) => f.includes("Before Board · your actions"))
  tui.input.pressArrow("down")
  await tui.settle()
  expect(isSelected(await tui.spans(), "Draft 2027 budget first view")).toBe(true)
  tui.input.pressKey("x")
  frame = await until(tui, (f) => !f.includes("Before Board"))
  expect(inside(frame, 7, 0)).toBe(cols(MEETINGS, ["Fri 27", "Board r", "BOARD", "5 items", "—"]))
  expect(kernel.db.raw.prepare("SELECT status FROM actions_action WHERE id = 5").all([])).toEqual([{ status: "done" }])

  // Enter on a meeting opens it.
  for (let i = 0; i < 4; i++) tui.input.pressArrow("up")
  await tui.settle()
  tui.input.pressEnter()
  frame = await until(tui, (f) => f.includes("› M-7"))
  expect(line(frame, 0)).toContain("› M-7 1:1 Anna")
})
