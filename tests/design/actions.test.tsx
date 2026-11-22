// Screen 4, Actions, as the 2026-11-20 screen design draws it (docs/superpowers/specs/2026-11-20-ttybrain-meeting-
// screens.html, "4 Actions"; it replaces the 2026-11-13 mock's Proj. and For / from columns): the columns ID / Action /
// Owner / Linked to / Due, group rows (Overdue red, This week / Next week accent, no counts), muted ids and `me`,
// "Linked to" with codes cyan, `@handles` magenta and meetings (title and date) muted, `—` muted when there are no
// links, next week's due dates as weekdays, the `status:open` footer and the status bar with `l links`. Seeded with
// the 2026-11-13 designs' example data (the 2026-11-20 mock's data is the meetings rework's), today Thu 12 Nov 2026,
// 118×36. Ids follow the seed (R5: A-1, not A-27); a meeting title gives way to the 30-wide column with its date
// kept; `Later · 34` / `No date · 3` stay scrolling groups (R1), not the mock's collapsed line. The frame's
// `i capture`, `? help` and the kept `enter open` follow the mock's hints, as on every screen.
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { fgAt, isSelected, line, seedDesign } from "../design"
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

async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 100 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

// The mock's fixed columns (ID 5, Owner 8, Linked to 30, Due 7) with Action growing to 112 − 54 = 58.
const COLS = [5, 58, 8, 30, 7]
const cols = (texts: string[], widths = COLS) =>
  texts
    .map((s, i) => s.padEnd(widths[i]!))
    .join(" ")
    .trimEnd()
const inside = (frame: string, i: number) => (line(frame, i).split("│")[1] ?? "").slice(1).trimEnd()

test("Actions as designed", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  tui = await renderTui(kernel, { width: 118, height: 36 })
  tui.input.pressKey("4")
  const frame = await until(tui, (f) => f.includes("Invite Marie to design walkthrough") && f.includes("Later · 34"))

  expect(line(frame, 1)).toMatch(/^ ╭─ Actions · 46 open ─+╮$/)
  expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => inside(frame, i))).toEqual([
    cols(["ID", "Action", "Owner", "Linked to", "Due"]),
    "Overdue",
    cols(["A-1", "Send revised budget to Peter", "me", "CRM @peter", "9 Nov"]),
    cols(["A-2", "Book vendor demo slot", "Bob", "ERP SteerCo 28 Oct", "10 Nov"]),
    cols(["A-3", "Review test strategy", "Anna", "DWH", "11 Nov"]),
    "This week",
    cols(["A-4", "Prepare SteerCo deck input", "me", "CRM Steering committee… 4 Dec", "Fri"]),
    cols(["A-5", "Confirm licence count", "Karim", "IAM", "Fri"]),
    cols(["A-7", "Send training plan options", "me", "—", "Sun"]),
    "Next week",
    cols(["A-6", "Align migration scope with DWH team", "Bob", "CRM", "Mon"]),
    cols(["A-8", "Invite Marie to design walkthrough", "me", "CRM @marie", "Tue"]),
    cols(["A-9", "Pilot user list", "Sofie", "HRP", "Wed"]),
    "Later · 34",
  ])
  expect(line(frame, 34)).toMatch(/^ ╰─+ status:open ─╯$/)
  expect(line(frame, 35)).toBe(" ↑↓ select   x done   d due   l links   e edit   / filter   n new   i capture   ? help   enter open")

  const spans = await tui.spans()
  expect(isSelected(spans, "Send revised budget to Peter")).toBe(true)
  // Group rows: Overdue red, This week / Next week accent, Later muted.
  expect(fgAt(spans, "Overdue", 3)).toBe(theme.red)
  expect(fgAt(spans, "This week", 7)).toBe(theme.accent)
  expect(fgAt(spans, "Next week", 11)).toBe(theme.accent)
  expect(fgAt(spans, "Later", 15)).toBe(theme.muted)
  // Headers and ids muted; `me` muted, owners plain; links: codes cyan, people magenta, meetings and `—` muted.
  for (const h of ["ID", "Action", "Owner", "Linked to", "Due"]) expect(fgAt(spans, h, 2)).toBe(theme.muted)
  for (const [id, at] of [["A-2", 5], ["A-5", 9], ["A-9", 14]] as const) expect(fgAt(spans, id, at)).toBe(theme.muted)
  expect(fgAt(spans, "me", 8)).toBe(theme.muted)
  expect(fgAt(spans, "me", 13)).toBe(theme.muted)
  expect(fgAt(spans, "Bob", 5)).toBe(theme.text)
  expect(fgAt(spans, "Karim", 9)).toBe(theme.text)
  for (const [code, at] of [["CRM @", 4], ["ERP", 5], ["DWH", 6], ["CRM S", 8], ["IAM", 9], ["HRP", 14]] as const) expect(fgAt(spans, code, at)).toBe(theme.cyan)
  expect(fgAt(spans, "@peter", 4)).toBe(theme.magenta)
  expect(fgAt(spans, "@marie", 13)).toBe(theme.magenta)
  expect(fgAt(spans, "SteerCo 28 Oct", 5)).toBe(theme.muted)
  expect(fgAt(spans, "Steering committee… 4 Dec", 8)).toBe(theme.muted)
  expect(fgAt(spans, "—", 10)).toBe(theme.muted)
  // Overdue dates red, weekdays plain.
  for (const [d, at] of [["9 Nov", 4], ["10 Nov", 5], ["11 Nov", 6]] as const) expect(fgAt(spans, d, at)).toBe(theme.red)
  expect(fgAt(spans, "Fri", 9)).toBe(theme.text)
  expect(fgAt(spans, "Mon", 12)).toBe(theme.text)
})

// At 80×24 Owner goes first, so Linked to stays with whole codes and names; the due column stays too.
test("Actions at 80x24 drops Owner, keeps Linked to whole", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  tui = await renderTui(kernel, { width: 80, height: 24 })
  tui.input.pressKey("4")
  const frame = await until(tui, (f) => f.includes("Book vendor demo slot") && f.includes("Pilot user list"))
  // ID 5, Action 74 − 45 = 29, Linked to 30, Due 7.
  const narrow = [5, 29, 30, 7]
  expect([2, 3, 4, 5, 6, 7, 8].map((i) => inside(frame, i))).toEqual([
    cols(["ID", "Action", "Linked to", "Due"], narrow),
    "Overdue",
    cols(["A-1", "Send revised budget to Peter", "CRM @peter", "9 Nov"], narrow),
    cols(["A-2", "Book vendor demo slot", "ERP SteerCo 28 Oct", "10 Nov"], narrow),
    cols(["A-3", "Review test strategy", "DWH", "11 Nov"], narrow),
    "This week",
    cols(["A-4", "Prepare SteerCo deck input", "CRM Steering committee… 4 Dec", "Fri"], narrow),
  ])
  for (const l of frame.split("\n")) expect(l.length).toBeLessThanOrEqual(80)
  // The 80-column status bar shows whole hints only.
  const bar = line(frame, 23)
  expect(bar).toMatch(/^ ↑↓ select {3}x done {3}d due {3}l links {3}e edit {3}\/ filter {3}n new/)
  const known = ["↑↓ select", "x done", "d due", "l links", "e edit", "/ filter", "n new", "i capture", "? help", "enter open"]
  for (const part of bar.trim().split("   ")) expect(known).toContain(part)
})
