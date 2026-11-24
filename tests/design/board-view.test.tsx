// A board's view (design §5.7, plan ruling B4). No mock draws it: it is laid out as a project's Meetings and Talk
// tabs (the 2026-11-20 `project` design), on screen 5 (`5 Meetings ▾`), the crumb `› BOARD Management board` with
// the code cyan as a project's, the tabs Summary · Meetings · Talk without counts (Summary is the boards plugin's,
// Meetings and Talk the meetings plugin's; Review Focus 4):
// - Summary: the "Summary" panel with the board's facts as a project's Overview has them (a 14-cell muted label
//   column): Code (cyan), Name, Note, Status (active, or archived since its date); its bar `e edit   Del archive`.
// - Meetings: "Board · monthly, last Fri" (Next, With, "To talk about · 2" and the board's talk-list), "Past
//   meetings" (`30 Oct    Board    —`), and, as there is no Prep for a board, "Your actions for BOARD · 1" on the
//   right; the project tab's bar. Enter on the series opens its next meeting under the board's crumb (`› BOARD
//   Management board › Board Fri 27 Nov`), Esc comes back; t, N and n open their forms with `#BOARD` filled in.
// - Talk: "To talk about · 2 open" (`next: Board Fri 27 Nov` on its border; no Project column: a board's items take
//   no project tag), Meetings (Next, Rhythm, Last) and Your actions for BOARD.
// Seeded with the meeting designs' data (seedMeetings: BOARD is a board, plan ruling B5), today Fri 20 Nov 2026,
// 118×36 and 80×24 (Review Focus 5: codes and names whole).
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { fgAt, isSelected, line, seedMeetings } from "../design"
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
const inside = (frame: string, i: number, side: 0 | 1) => {
  const parts = line(frame, i).split("│")
  return (side === 0 ? (parts[1] ?? "") : (parts[parts.length - 2] ?? "")).slice(1).trimEnd()
}

async function board(tab: "summary" | "meetings" | "talk", width = 118, height = 36): Promise<{ t: RenderedTui; frame: string }> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  tui = await renderTui(kernel, { width, height })
  await tui.nav.open("#BOARD", tab)
  const ready = (f: string) => (tab === "summary" ? f.includes("Status") && f.includes("active") : tab === "meetings" ? f.includes("Past meetings") && f.includes("A-5") : f.includes("To talk about · 2 open") && f.includes("A-5"))
  await until(tui, ready)
  await tui.settle()
  return { t: tui, frame: await until(tui, ready) }
}

// The facts' value column starts at 16 (a 14-cell label and 2 cells), inside the panel's border and padding.
const FACTS = ["Code            BOARD", "Name            Management board", "Note            —", "Status          active"]

test("Board · Summary: the board's facts, first of the three tabs", async () => {
  const { t, frame } = await board("summary")
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}5 Meetings ▾ {2}› BOARD Management board +● 2 new in inbox {2}Fri 20 Nov 2026$/)
  expect(line(frame, 1).trim()).toBe("")
  expect(line(frame, 2)).toBe("  Summary   Meetings   Talk")
  expect(line(frame, 3)).toMatch(/^ ╭─ Summary ─+╮$/)
  expect(line(frame, 3).length).toBe(117) // a one-cell gutter on both sides
  expect([4, 5, 6, 7].map((i) => inside(frame, i, 0))).toEqual(FACTS)
  expect(line(frame, 8)).toMatch(/^ ╰─+╯$/)
  expect(line(frame, 35)).toBe(" ←→ tabs   e edit   del archive   esc back   i capture")

  const spans = await t.spans()
  expect(fgAt(spans, "BOARD", 0)).toBe(theme.cyan)
  expect(fgAt(spans, "Summary", 2)).toBe(theme.accent)
  expect(fgAt(spans, "Meetings", 2)).toBe(theme.muted)
  expect(fgAt(spans, "Summary", 3)).toBe(theme.muted) // the panel takes no focus, as a project's Overview
  for (const [label, i] of [["Code", 4], ["Name", 5], ["Note", 6], ["Status", 7]] as const) expect(fgAt(spans, label, i)).toBe(theme.muted)
  expect(fgAt(spans, "BOARD", 4)).toBe(theme.cyan)
  expect(fgAt(spans, "Management board", 5)).toBe(theme.text)
})

test("Board · Meetings: its series panel, past meetings and your actions", async () => {
  const { t, frame } = await board("meetings")
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}5 Meetings ▾ {2}› BOARD Management board +● 2 new in inbox {2}Fri 20 Nov 2026$/)
  expect(line(frame, 1).trim()).toBe("")
  expect(line(frame, 2)).toBe("  Summary   Meetings   Talk")
  expect(line(frame, 3)).toMatch(/^ ╭─ Board · monthly, last Fri ─+╮ ╭─ Your actions for BOARD · 1 ─+╮$/)
  expect([4, 5, 6, 7, 8, 9].map((i) => inside(frame, i, 0))).toEqual([
    "Next       Fri 27 Nov",
    "With       Marie D., Peter J.",
    "",
    "To talk about · 2",
    cols([3], ["1.", "Hiring freeze impact on IAM wave 2"]),
    cols([3], ["2.", "Security awareness: board sponsor?"]),
  ])
  expect(inside(frame, 4, 1)).toMatch(/^A-5 {3}Draft 2027 budget first view +Thu$/)
  expect(line(frame, 10)).toMatch(/^ ╰─+╯ │/)
  expect(line(frame, 11)).toMatch(/^ ╭─ Past meetings ─+╮ │/)
  expect(inside(frame, 12, 0)).toBe(cols([9, 25], ["30 Oct", "Board", "—"]))
  // Both columns end on the same line; no Prep for a board.
  expect(line(frame, 13)).toMatch(/^ ╰─+╯ ╰─+╯$/)
  expect(frame).not.toContain("Prep")
  expect(line(frame, 35)).toBe(" ←→ tabs   tab panel   t to talk   enter open   N series   n one-off   esc back")

  const spans = await t.spans()
  expect(fgAt(spans, "BOARD", 0)).toBe(theme.cyan)
  expect(fgAt(spans, "Management board", 0)).toBe(theme.text)
  expect(fgAt(spans, "Meetings", 2)).toBe(theme.accent)
  expect(fgAt(spans, "Talk", 2)).toBe(theme.muted)
  expect(fgAt(spans, "Board · monthly, last Fri", 3)).toBe(theme.accent)
  expect(fgAt(spans, "Your actions for BOARD", 3)).toBe(theme.muted)
  expect(fgAt(spans, "Next", 4)).toBe(theme.muted)
  expect(fgAt(spans, "Marie D.", 5)).toBe(theme.magenta)
  expect(fgAt(spans, "To talk about · 2", 7)).toBe(theme.muted)
  expect(isSelected(spans, "Hiring freeze impact on IAM wave 2")).toBe(true)
  expect(fgAt(spans, "30 Oct", 12)).toBe(theme.muted)
  expect(fgAt(spans, "A-5", 4)).toBe(theme.muted)
})

test("Board · Meetings: Enter opens the next board meeting under the board's crumb; t, N and n fill in #BOARD", async () => {
  const { t } = await board("meetings")
  t.input.pressEnter()
  let frame = await until(t, (f) => f.includes("Board talk-list · 2"))
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}5 Meetings ▾ {2}› BOARD Management board › Board Fri 27 Nov +● 2 new in inbox {2}Fri 20 Nov 2026$/)
  expect(fgAt(await t.spans(), "BOARD", 0)).toBe(theme.cyan)
  t.input.pressEscape()
  frame = await until(t, (f) => f.includes("Past meetings"))
  expect(line(frame, 0)).toMatch(/› BOARD Management board +●/)
  for (const [key, title] of [
    ["t", "New talk item"],
    ["N", "New recurring meeting"],
  ] as const) {
    t.input.pressKey(key)
    frame = await until(t, (f) => f.includes(title))
    expect(frame).toContain("Management board · board")
    if (key === "N") expect(frame).toMatch(/Kind +board/)
    t.input.pressEscape()
    await until(t, (f) => !f.includes(title))
  }
  t.input.pressKey("n")
  frame = await until(t, (f) => f.includes("About") && f.includes("#BOARD"))
  expect(frame).toContain("#BOARD")
})

test("Board view: quick capture starts with the board's tag", async () => {
  const { t } = await board("talk")
  t.input.pressKey("i")
  const frame = await until(t, (f) => f.includes("added because"))
  expect(frame).toContain("#BOARD added because you're on the Management board")
  expect(frame).toMatch(/│ │ #BOARD +│ │/)
})

test("Board · Talk: the board's talk-list, without a Project column", async () => {
  const { t, frame } = await board("talk")
  expect(line(frame, 2)).toBe("  Summary   Meetings   Talk")
  expect(line(frame, 3)).toMatch(/^ ╭─ To talk about · 2 open ─+╮ ╭─ Meetings ─+╮$/)
  const ITEMS = [3, 50]
  expect([4, 5, 6].map((i) => inside(frame, i, 0))).toEqual([
    cols(ITEMS, ["", "Item", "Added"]),
    cols(ITEMS, ["1.", "Hiring freeze impact on IAM wave 2", "Thu"]),
    cols(ITEMS, ["2.", "Security awareness: board sponsor?", "Thu"]),
  ])
  expect(frame).not.toContain("Project")
  expect([4, 5, 6].map((i) => inside(frame, i, 1))).toEqual(["Next      Fri 27 Nov · Board", "Rhythm    monthly, last Fri", "Last      Fri 30 Oct"])
  expect(line(frame, 8)).toMatch(/╭─ Your actions for BOARD · 1 ─+╮$/)
  expect(inside(frame, 9, 1)).toMatch(/^A-5 {3}Draft 2027 budget first view +Thu$/)
  expect(line(frame, 10)).toMatch(/^ ╰─+ next: Board Fri 27 Nov ─╯ ╰─+╯$/)
  expect(line(frame, 35)).toBe(" ←→ tabs   n add   e edit   J/K reorder   del drop   enter next meeting   esc back")

  const spans = await t.spans()
  expect(fgAt(spans, "Talk", 2)).toBe(theme.accent)
  expect(fgAt(spans, "To talk about · 2 open", 3)).toBe(theme.accent)
  expect(fgAt(spans, "next: Board Fri 27 Nov", 10)).toBe(theme.muted)
  expect(fgAt(spans, "Thu", 5)).toBe(theme.muted)
})

test("Board view at 80×24: the code, the names and the panels whole", async () => {
  for (const tab of ["summary", "meetings", "talk"] as const) {
    const { frame } = await board(tab, 80, 24)
    const rows = frame.replace(/\n$/, "").split("\n")
    expect(rows.length).toBe(24)
    for (const l of rows) expect(l.length).toBeLessThanOrEqual(80)
    expect(line(frame, 0)).toMatch(/^ ttybrain · {2}5 Meetings ▾ {2}› BOARD /)
    expect(frame).not.toMatch(/BOAR…|Marie D…|Peter J…/)
    expect([...frame.matchAll(/╭/g)].length).toBe([...frame.matchAll(/╰/g)].length)
    expect(line(frame, 2)).toBe("  Summary   Meetings   Talk")
    if (tab === "summary") {
      expect(line(frame, 3)).toMatch(/^ ╭─ Summary ─+╮$/)
      expect([4, 5, 6, 7].map((i) => inside(frame, i, 0))).toEqual(FACTS)
      expect(line(frame, 8)).toMatch(/^ ╰─+╯$/)
      expect(line(frame, 23)).toBe(" ←→ tabs   e edit   del archive   esc back   i capture")
    } else if (tab === "meetings") {
      expect(line(frame, 3)).toMatch(/^ ╭─ Board · monthly, last Fri ─+╮ ╭─ Your actions for BOARD · 1 ─+╮$/)
      expect(inside(frame, 5, 0)).toBe("With       Marie D., Peter J.")
      expect(inside(frame, 12, 0)).toBe("30 Oct    Board")
      expect(line(frame, 23)).toBe(" ←→ tabs   tab panel   t to talk   enter open   N series   n one-off   esc back")
    } else {
      expect(line(frame, 3)).toMatch(/^ ╭─ To talk about · 2 open ─+╮ ╭─ Meetings ─+╮$/)
      expect(line(frame, 8)).toMatch(/╭─ Your actions for BOARD · 1 ─╮$/)
    }
    tui?.destroy()
    tui = undefined
    await kernel?.cleanup()
    kernel = undefined
  }
})
