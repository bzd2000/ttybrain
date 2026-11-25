// Screen 7, Boards (the boards plugin's own screen; no mock draws it, so it is laid out as the Projects screen): one
// panel "Boards · n" with the active boards by code: Code (cyan, whole) · Name · Next meeting (its day date and name,
// a muted `—` without one) · Talk (the open talk items, a muted `0`), from meetings' read boardActivity; a Status
// column only while archived boards are shown (`a`). Keys as on Projects: Enter opens the board (on its Summary
// tab), n new, e edit, Del archive (after a confirmation), r restore an archived row, a archived, / filter.
// Seeded with the meeting designs' data (BOARD "Management board": Board Fri 27 Nov, 2 open talk items), plus
// PROGRAMME2027 (no meetings, no talk) and OLD (archived); today Fri 20 Nov 2026, 118×36 and 80×24.
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { fgAt, isSelected, line, seedMeetings } from "../design"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"
import { theme } from "../../src/kernel/tui/theme"
import { runWithContext } from "../../src/kernel/context"
import { setMessageTimeout } from "../../src/kernel/tui/messages"

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  setMessageTimeout()
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
// The text inside the panel on line `i`, without trailing spaces.
const inside = (frame: string, i: number) => (line(frame, i).split("│")[1] ?? "").slice(1).trimEnd()
const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""

const write = () => kernel!.runtime("boards")!.self().write as Record<string, (i: unknown) => Promise<unknown>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const boards = () => kernel!.db.raw.prepare("SELECT code, name, note, archived_at FROM boards_board ORDER BY id").all([]) as Array<Record<string, unknown>>

async function screen7(width = 118, height = 36): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  await inCtx(async () => {
    await write().addBoard!({ code: "PROGRAMME2027", name: "Programme board" })
    await write().addBoard!({ code: "OLD", name: "Old board" })
    await write().archiveBoard!({ board: "#OLD" })
  })
  tui = await renderTui(kernel, { width, height })
  tui.input.pressKey("7")
  const ready = (f: string) => f.includes("Fri 27 Nov Board") && f.includes("Programme board")
  await until(tui, ready)
  await tui.settle()
  await until(tui, ready)
  return tui
}

// At 118 wide the panel has 112 cells inside: Code as wide as the longest code, Name grows.
const WIDE = [13, 68, 22, 6]

test("Boards (screen 7): the active boards with their next meeting and open talk items", async () => {
  const t = await screen7()
  const frame = await t.frame()
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}7 Boards ▾ +● 2 new in inbox {2}Fri 20 Nov 2026$/)
  expect(line(frame, 1)).toMatch(/^ ╭─ Boards · 2 ─+╮$/)
  expect([2, 3, 4, 5].map((i) => inside(frame, i))).toEqual([
    cols(WIDE, ["Code", "Name", "Next meeting", "Talk"]),
    cols(WIDE, ["BOARD", "Management board", "Fri 27 Nov Board", "2"]),
    cols(WIDE, ["PROGRAMME2027", "Programme board", "—", "0"]),
    "",
  ])
  expect(frame).not.toContain("Old board")
  expect(frame).not.toContain("Status")
  expect(line(frame, 34)).toMatch(/^ ╰─+╯$/)
  expect(line(frame, 35)).toBe(" enter open   n new   e edit   del archive   / filter   a archived   i capture   g or 1-7 screens   ? help   q quit")
  const spans = await t.spans()
  expect(fgAt(spans, "Boards", 1)).toBe(theme.accent)
  expect(fgAt(spans, "Code", 2)).toBe(theme.muted)
  expect(fgAt(spans, "BOARD", 3)).toBe(theme.cyan)
  expect(fgAt(spans, "PROGRAMME2027", 4)).toBe(theme.cyan)
  expect(fgAt(spans, "Programme board", 4)).toBe(theme.text)
  expect(fgAt(spans, "Fri 27 Nov Board", 3)).toBe(theme.text)
  expect(fgAt(spans, "—", 4)).toBe(theme.muted)
  expect(fgAt(spans, "0 ", 4)).toBe(theme.muted)
  expect(fgAt(spans, "2 ", 3)).toBe(theme.text)
  expect(isSelected(spans, "Management board")).toBe(true)
})

test("Boards at 80×24: codes and names whole, Next meeting and Talk give way from the right", async () => {
  const t = await screen7(80, 24)
  const frame = await t.frame()
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}7 Boards ▾ .*Fri 20 Nov 2026$/)
  expect(lineWith(frame, "Management board")).toMatch(/│ BOARD {9}Management board +Fri 27 Nov Board +2 +│/)
  expect(lineWith(frame, "Programme board")).toMatch(/│ PROGRAMME2027 Programme board +— +0 +│/)
  expect(frame).not.toMatch(/BOAR…|PROGRAMME20…/)
  expect(line(frame, 22)).toMatch(/^ ╰─+╯$/)
  for (const l of frame.split("\n")) expect(l.length).toBeLessThanOrEqual(80)
})

test("Boards: the switcher and the header chip count the active boards", async () => {
  const t = await screen7()
  t.input.pressKey("g")
  const frame = await until(t, (f) => f.includes("7  Boards") && f.includes("5  Meetings"))
  // The switcher drops down under the chip: its last row is `7  Boards  2`.
  expect(lineWith(frame, "7  Boards")).toMatch(/│ 7  Boards +2 │/)
})

test("Boards: a shows the archived ones with a Status column; r restores, Del archives after a confirmation", async () => {
  setMessageTimeout(100)
  const t = await screen7()
  t.input.pressKey("a")
  let frame = await until(t, (f) => f.includes("Old board"))
  expect(inside(frame, 2)).toMatch(/^Code +Name +Next meeting +Talk +Status$/)
  expect(lineWith(frame, "Management board")).toMatch(/Fri 27 Nov Board +2 +active +│/)
  expect(lineWith(frame, "Old board")).toMatch(/│ OLD +Old board +— +0 +archived +│/)
  // Archived rows come after the active ones.
  const rows = frame.split("\n")
  expect(rows.findIndex((l) => l.includes("Old board"))).toBeGreaterThan(rows.findIndex((l) => l.includes("Programme board")))
  expect(fgAt(await t.spans(), "archived", lineWith(frame, "Old board"))).toBe(theme.muted)

  // Down to OLD: its bar offers r restore instead of del archive; Del does nothing there.
  t.input.pressArrow("down")
  t.input.pressArrow("down")
  frame = await until(t, (f) => f.includes("r restore"))
  expect(isSelected(await t.spans(), "Old board")).toBe(true)
  t.input.pressKey("DELETE")
  await t.settle()
  expect(await t.frame()).not.toContain("Archive #OLD?")
  t.input.pressKey("r")
  frame = await until(t, (f) => /OLD +Old board +— +0 +active/.test(f))
  expect(boards().find((b) => b.code === "OLD")!.archived_at).toBeNull()

  // Restored, OLD sorts among the active ones (BOARD, OLD, PROGRAMME2027). Del on PROGRAMME2027: n keeps it, y
  // archives it.
  t.input.pressArrow("down")
  await t.settle()
  expect(isSelected(await t.spans(), "Programme board")).toBe(true)
  t.input.pressKey("DELETE")
  await until(t, (f) => f.includes("Archive #PROGRAMME2027?"))
  t.input.pressKey("n")
  await until(t, (f) => !f.includes("Archive #PROGRAMME2027?"))
  expect(boards().find((b) => b.code === "PROGRAMME2027")!.archived_at).toBeNull()
  t.input.pressKey("DELETE")
  await until(t, (f) => f.includes("Archive #PROGRAMME2027?"))
  t.input.pressKey("y")
  frame = await until(t, (f) => /PROGRAMME2027 +Programme board +— +0 +archived/.test(f))
  expect(boards().find((b) => b.code === "PROGRAMME2027")!.archived_at).not.toBeNull()

  // a again: only the active ones (BOARD and the restored OLD), no Status.
  t.input.pressKey("a")
  frame = await until(t, (f) => !f.includes("Programme board"))
  expect(frame).not.toContain("Status")
  expect(lineWith(frame, "Old board")).toMatch(/│ OLD +Old board +— +0 +│/)
  expect(line(frame, 1)).toMatch(/Boards · 2/)
})

test("Boards: n adds a board through the form, e edits the selected one", async () => {
  const t = await screen7()
  t.input.pressKey("n")
  await until(t, (f) => f.includes("New board"))
  await t.input.typeText("IAB")
  t.input.pressTab()
  await t.input.typeText("Architecture board")
  t.input.pressKey("s", { ctrl: true })
  let frame = await until(t, (f) => f.includes("Architecture board") && !f.includes("New board"))
  expect(lineWith(frame, "Architecture board")).toMatch(/│ IAB +Architecture board +— +0 +│/)
  expect(boards().find((b) => b.code === "IAB")).toEqual({ code: "IAB", name: "Architecture board", note: null, archived_at: null })
  await t.settle()
  expect(isSelected(await t.spans(), "Architecture board")).toBe(true)
  expect(line(frame, 1)).toMatch(/Boards · 3/)

  t.input.pressKey("e")
  await until(t, (f) => f.includes("Edit IAB"))
  await t.input.typeText(" (IAB)") // the focus starts on the name
  t.input.pressKey("s", { ctrl: true })
  frame = await until(t, (f) => f.includes("Architecture board (IAB)") && !f.includes("Edit IAB"))
  expect(boards().find((b) => b.code === "IAB")!.name).toBe("Architecture board (IAB)")
})

test("Boards: / filters on code or name, Esc clears it; Enter opens the board on its Summary tab", async () => {
  const t = await screen7()
  t.input.pressKey("/")
  await t.input.typeText("programme")
  t.input.pressEnter()
  let frame = await until(t, (f) => !f.includes("Management board"))
  expect(frame).toContain("Programme board")
  expect(line(frame, 1)).toMatch(/Boards · 1/)
  expect(frame).toContain("filter: programme")
  t.input.pressEscape()
  frame = await until(t, (f) => f.includes("Management board"))
  expect(line(frame, 0)).toContain("7 Boards ▾") // Esc cleared the filter; it did not go back
  await t.settle()

  t.input.pressKey("/")
  await t.input.typeText("zzz")
  t.input.pressEnter()
  frame = await until(t, (f) => f.includes("No boards match the filter."))
  t.input.pressEscape()
  await until(t, (f) => f.includes("Management board"))
  await t.settle()

  // The filtered row stays selected; Enter opens it on its Summary tab.
  expect(isSelected(await t.spans(), "Programme board")).toBe(true)
  t.input.pressEnter()
  frame = await until(t, (f) => f.includes("Status") && f.includes("active") && f.includes("Summary"))
  expect(line(frame, 0)).toMatch(/^ ttybrain · {2}7 Boards ▾ {2}› PROGRAMME2027 Programme board +●/)
  expect(line(frame, 2)).toBe("  Summary   Meetings   Talk")
  // Esc goes back to screen 7 with it still selected.
  t.input.pressEscape()
  frame = await until(t, (f) => f.includes("Management board"))
  await t.settle()
  expect(isSelected(await t.spans(), "Programme board")).toBe(true)
})

test("Boards: empty state", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  tui.input.pressKey("7")
  const frame = await until(tui, (f) => f.includes("No boards yet. Press n to add one."))
  expect(frame).toContain("No boards yet. Press n to add one.")
  expect(line(frame, 1)).toMatch(/Boards · 0/)
})

test("Boards: a long meeting name is cut with `…`, its date stays whole", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  await inCtx(async () => {
    await write().addBoard!({ code: "IAB", name: "Architecture board" })
    const meetings = kernel!.runtime("meetings")!.self().write as Record<string, (i: unknown) => Promise<unknown>>
    await meetings.addSeries!({ about: "#IAB", title: "Quarterly architecture review", every: "monthly on the last fri", from: "2026-11-27" })
  })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  tui.input.pressKey("7")
  const frame = await until(tui, (f) => f.includes("Architecture board") && f.includes("Fri 27 Nov Quarterly"))
  // Next meeting is 22 cells: the date (11) whole, the name cut to the rest (no space before the `…`).
  expect(lineWith(frame, "Architecture board")).toMatch(/│ IAB +Architecture board +Fri 27 Nov Quarterly… +0 +│/)
  expect(fgAt(await tui.spans(), "Fri 27 Nov", "Architecture board")).toBe(theme.text)
})

test("Boards without the meetings plugin: Next meeting `—`, Talk `0`", async () => {
  const { default: people } = await import("../../src/plugins/people/logic/index")
  const { default: projects } = await import("../../src/plugins/projects/logic/index")
  const { default: boardsPlugin } = await import("../../src/plugins/boards/logic/index")
  const { default: projectsTui } = await import("../../src/plugins/projects/tui/index")
  const { default: peopleTui } = await import("../../src/plugins/people/tui/index")
  const { default: boardsTui } = await import("../../src/plugins/boards/tui/index")
  kernel = await makeTestKernel({ plugins: [people, projects, boardsPlugin] })
  expect(kernel.plugins.map((p) => p.id).sort()).toEqual(["boards", "people", "projects"])
  await inCtx(() => write().addBoard!({ code: "MB", name: "Management board" }))
  tui = await renderTui(kernel, { width: 118, height: 36, parts: [projectsTui, boardsTui, peopleTui] })
  tui.input.pressKey("7")
  const frame = await until(tui, (f) => f.includes("Management board"))
  expect(line(frame, 0)).toContain("7 Boards ▾")
  expect(lineWith(frame, "Management board")).toMatch(/│ MB +Management board +— +0 +│/)
  const spans = await tui.spans()
  expect(fgAt(spans, "—", "Management board")).toBe(theme.muted)
  expect(fgAt(spans, "0 ", "Management board")).toBe(theme.muted)
})
