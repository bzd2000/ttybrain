// Screen 5, Meetings, as the 2026-11-20 `meetings` design draws it (docs/superpowers/specs/2026-11-20-ttybrain-meeting-
// screens.html): Upcoming by week on the left (accent week rows, the week after dimmed, "Held, closes itself Sat · 1"
// after a blank line), Series · 7 on the right with their short rhythm, and the design's bar; and the `series` design's
// "New recurring meeting" form. Seeded with the meeting designs' data, today Fri 20 Nov 2026, 118×36 (and 80×24).
// The CRM steering's Act. is amber: its one action (the design's A-27) is overdue, as the Attention design's own
// Overdue panel shows.
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { bgAt, fgAt, isSelected, line, seedMeetings } from "../design"
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
  for (let i = 0; i < 150 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}
const cols = (widths: number[], texts: string[]) =>
  texts
    .map((s, i) => s.padEnd(widths[i]!))
    .join(" ")
    .trimEnd()
// The text inside the left or right panel on line `i`, without trailing spaces.
const inside = (frame: string, i: number, side: 0 | 1) => (line(frame, i).split("│")[1 + 2 * side] ?? "").slice(1).trimEnd()
const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""

// At 118 wide the Upcoming panel has 61 cells inside, Series 46.
const UPCOMING = [10, 27, 7, 7, 6]
const SERIES = [20, 7, 17]

async function screen5(width = 118, height = 36): Promise<{ t: RenderedTui; frame: string }> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  tui = await renderTui(kernel, { width, height })
  tui.input.pressKey("5")
  // Settled: both tables drawn (BOARD on each), the one-off marker in place where it fits.
  const ready = (f: string) => f.includes("Held, closes itself") && f.split("BOARD").length > 2 && (width < 100 || f.includes("call one-off"))
  await until(tui, ready)
  await tui.settle()
  return { t: tui, frame: await until(tui, ready) }
}

test("Meetings (screen 5) as designed", async () => {
  const { t, frame } = await screen5()
  expect(line(frame, 0)).toMatch(/^ ttybrain ·  5 Meetings ▾ +● 2 new in inbox +Fri 20 Nov 2026$/)
  expect(line(frame, 1)).toMatch(/^ ╭─ Upcoming ─+╮ ╭─ Series · 7 ─+╮$/)
  expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((i) => inside(frame, i, 0))).toEqual([
    cols(UPCOMING, ["Date", "Meeting", "About", "Talk", "Act."]),
    "Next week · 23–27 Nov",
    cols(UPCOMING, ["Mon 23", "1:1 Anna", "Anna", "4", "2"]),
    cols(UPCOMING, ["Tue 24", "CRM steering", "CRM", "3", "1"]),
    cols(UPCOMING, ["Wed 25", "1:1 Bob", "Bob", "1", "—"]),
    cols(UPCOMING, ["Thu 26", "ERP vendor call one-off", "ERP", "2", "—"]),
    cols(UPCOMING, ["Fri 27", "Board", "BOARD", "5", "1"]),
    "Week after · 30 Nov–4 Dec",
    cols(UPCOMING, ["Mon 30", "1:1 Sofie", "Sofie", "0", "—"]),
    cols(UPCOMING, ["Wed 2", "1:1 Karim", "Karim", "2", "—"]),
    "",
    "Held, closes itself Sat · 1",
    cols(UPCOMING, ["Wed 18", "1:1 Karim", "Karim", "notes", "—"]),
  ])
  expect([2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => inside(frame, i, 1))).toEqual([
    cols(SERIES, ["Series", "About", "Rhythm"]),
    cols(SERIES, ["1:1 Anna", "Anna", "every 2 wk Mon"]),
    cols(SERIES, ["1:1 Bob", "Bob", "every 2 wk Wed"]),
    cols(SERIES, ["1:1 Sofie", "Sofie", "every 2 wk Mon"]),
    cols(SERIES, ["1:1 Karim", "Karim", "every 2 wk Wed"]),
    cols(SERIES, ["CRM steering", "CRM", "monthly, 4th Tue"]),
    cols(SERIES, ["ERP steering", "ERP", "monthly, 1st Thu"]),
    cols(SERIES, ["Board", "BOARD", "monthly, last Fri"]),
    "",
  ])
  expect(line(frame, 35)).toBe(" tab panel   enter open   n one-off   N series   s skip date   m move date   i capture")

  const spans = await t.spans()
  expect(isSelected(spans, "1:1 Anna")).toBe(true)
  expect(fgAt(spans, "Upcoming", 1)).toBe(theme.accent)
  expect(fgAt(spans, "Series", 1)).toBe(theme.muted)
  expect(fgAt(spans, "Date", 2)).toBe(theme.muted)
  expect(fgAt(spans, "Next week", 3)).toBe(theme.accent)
  expect(fgAt(spans, "Week after", 9)).toBe(theme.accent)
  expect(fgAt(spans, "Held, closes itself", 13)).toBe(theme.muted)
  expect(fgAt(spans, "2      ", 4)).toBe(theme.amber) // Anna's Act.: one of them is late
  expect(fgAt(spans, "CRM     ", 5)).toBe(theme.cyan)
  expect(fgAt(spans, "—", 6)).toBe(theme.muted)
  expect(fgAt(spans, "one-off", 7)).toBe(theme.muted)
  expect(fgAt(spans, "ERP vendor call", 7)).toBe(theme.text)
  expect(fgAt(spans, "BOARD", 8)).toBe(theme.cyan)
  expect(fgAt(spans, "1:1 Sofie", 10)).toBe(theme.muted)
  expect(fgAt(spans, "Sofie", 10)).toBe(theme.muted) // the title; the About after it is plain
  expect(fgAt(spans, "Mon 30", 10)).toBe(theme.text)
  expect(fgAt(spans, "Sofie   0", 10)).toBe(theme.text)
  expect(fgAt(spans, "0      ", 10)).toBe(theme.muted)
  expect(fgAt(spans, "Wed 18", 14)).toBe(theme.amber)
  expect(fgAt(spans, "notes", 14)).toBe(theme.muted)
  expect(fgAt(spans, "1      │", 5)).toBe(theme.amber) // the CRM steering's Act.: its action is overdue
  expect(fgAt(spans, "1      │", 8)).toBe(theme.text) // the Board's
  expect(fgAt(spans, "CRM     monthly", 7)).toBe(theme.cyan) // Series: About
})

test("Meetings at 80×24: Talk and Act. give way, codes and names whole", async () => {
  const { frame } = await screen5(80, 24)
  expect(inside(frame, 2, 0)).toMatch(/^Date +Meeting +About$/)
  expect(lineWith(frame, "Mon 23")).toMatch(/Mon 23 +1:1 Anna +Anna +│/)
  expect(lineWith(frame, "Fri 27")).toMatch(/Fri 27 +Board +BOARD +│/)
  expect(frame).not.toMatch(/BOAR…|CR…|Kari…|Sofi…/)
  expect(inside(frame, 2, 1)).toMatch(/^Series +About$/)
  expect(line(frame, 23)).toBe(" tab panel   enter open   n one-off   N series   s skip date   m move date")
})

test("New recurring meeting as designed (from Karim's person view): rows, read-back, title, footer and bar", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  const t = tui
  // N on Karim's Meetings tab, as the design's form is opened.
  await t.nav.open("@karim", "meetings")
  await until(t, (f) => f.includes("Karim Haddad") && f.includes("Past meetings"))
  await t.settle()
  t.input.pressKey("N")
  // The form has the keys once its bar shows.
  await until(t, (f) => f.includes("Karim Haddad · person") && line(f, 35) === " tab field   ctrl+s save   esc cancel")
  // It starts on Rhythm, with About, Title, Kind and Attendees filled in.
  await t.input.typeText("every 2 weeks on wednesday")
  let frame = await until(t, (f) => f.includes("→ Wed 25 Nov, 9 Dec, 23 Dec, 6 Jan …") && f.includes("Wed 25 Nov "))
  const rows = frame.split("\n")
  const top = rows.findIndex((l) => l.includes("New recurring meeting"))
  // The overlay's columns (Karim's Meetings tab is behind it, dimmed).
  const from = rows[top]!.indexOf("╭")
  const to = rows[top]!.indexOf("╮", from)
  const body = rows.slice(top, top + 11).map((l) => l.slice(from, to + 1).trimEnd())
  // In the box: the text between `│ ` and ` │`, without trailing spaces; the borders as drawn.
  const insideBox = (l: string) => (l.startsWith("│") ? l.slice(2, l.lastIndexOf("│")).trimEnd() : l)
  expect(body[0]).toMatch(/^╭─ New recurring meeting ─+╮$/)
  expect(body.slice(1, 9).map(insideBox)).toEqual([
    "About           Karim Haddad · person",
    "Title           1:1 Karim",
    "Kind            1:1 (project · board)",
    "Rhythm          every 2 weeks on wednesday",
    "                → Wed 25 Nov, 9 Dec, 23 Dec, 6 Jan …",
    "First date      Wed 25 Nov",
    "Attendees       Karim Haddad",
    "Ends            never",
  ])
  expect(body[9]).toMatch(/^╰─+ ctrl\+s save · esc cancel ─╯$/)
  expect(rows.some((l) => /╰─+ ctrl\+s save · esc cancel ─╯/.test(l))).toBe(true)
  expect(line(frame, 35)).toBe(" tab field   ctrl+s save   esc cancel")
  const spans = await t.spans()
  expect(fgAt(spans, "New recurring meeting")).toBe(theme.accent)
  expect(fgAt(spans, "About ", "Karim Haddad · person")).toBe(theme.muted)
  expect(fgAt(spans, " · person", "Karim Haddad · person")).toBe(theme.muted)
  expect(fgAt(spans, "Karim Haddad", "Karim Haddad · person")).toBe(theme.text)
  expect(fgAt(spans, "(project · board)")).toBe(theme.muted)
  expect(fgAt(spans, "→ Wed 25 Nov")).toBe(theme.muted)
  expect(fgAt(spans, "never")).toBe(theme.muted)
  expect(fgAt(spans, "ctrl+s save · esc cancel")).toBe(theme.muted)
  expect(bgAt(spans, "every 2 weeks on wednesday")).toBe(theme.selectedBg) // the focused field is the input

  t.input.pressKey("s", { ctrl: true })
  frame = await until(t, (f) => !f.includes("New recurring meeting"))
  const made = kernel!.db.raw.prepare("SELECT date FROM meetings_meeting WHERE series_id = 8 ORDER BY date").all([]) as Array<{ date: string }>
  expect(made.map((m) => m.date)).toEqual(["2026-11-25", "2026-12-09", "2026-12-23", "2027-01-06"])
  expect(kernel!.db.raw.prepare("SELECT title, kind FROM meetings_series WHERE id = 8").all([])).toEqual([{ title: "1:1 Karim", kind: "one_on_one" }])
})

test("New recurring meeting from screen 5: Kind and Attendees follow About as it is typed, until changed", async () => {
  const { t } = await screen5()
  t.input.pressKey("N")
  let frame = await until(t, (f) => f.includes("New recurring meeting"))
  expect(lineWith(frame, "Kind")).toMatch(/Kind +— \(1:1 · project · board\)/)
  expect(lineWith(frame, "Ends")).toContain("never")
  await t.input.typeText("#CRM")
  frame = await until(t, (f) => /Kind +project \(1:1 · board\)/.test(f))
  for (let i = 0; i < 4; i++) t.input.pressBackspace()
  await t.input.typeText("@anna ") // a space after the ref: no suggestion to accept
  frame = await until(t, (f) => /Kind +1:1 \(project · board\)/.test(f))
  t.input.pressTab()
  t.input.pressTab() // Kind: changed by hand, it stops following
  t.input.pressArrow("right")
  frame = await until(t, (f) => /Kind +project \(1:1 · board\)/.test(f))
  t.input.pressTab({ shift: true })
  t.input.pressTab({ shift: true }) // back to About
  for (let i = 0; i < 6; i++) t.input.pressBackspace() // "@anna "
  await t.input.typeText("@bob")
  frame = await until(t, (f) => f.includes("Bob Willems"))
  expect(lineWith(frame, "Kind")).toMatch(/Kind +project \(1:1 · board\)/)
  expect(lineWith(frame, "Attendees")).toContain("Bob Willems")
})
