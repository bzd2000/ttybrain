// Screen 2, Projects, as the screen designs draw it (docs/superpowers/specs/2026-11-13-pm-screens.html, "Projects"):
// the mock's header row and column widths, cyan codes, muted effort, the on-hold row all muted with `◌`, the
// filter footer on the bottom border and the status bar. Seeded with the designs' example data, today Thu 12 Nov
// 2026, 118×36. The list's data follows the seed (R5: "Test environment ready", not the mock's "Test env ready";
// "On hold · 1" because only BI2 is on hold; no `… 17 more` line, R1). A project with an open high-severity risk
// or issue has a red Risk count (P3: ERP, CRM and DWH; the mock draws DWH plain, which is inconsistent).
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { fgAt, isSelected, line, seedDesign } from "../design"
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

async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 100 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

// The mock's fixed columns (dot 2, Code 5, Next milestone 21, Due 7, Act. 6, Risk 6, Effort 7) with Name growing:
// 118 − 2 (screen padding) − 2 (border) − 1 (panel padding) − 7 gaps − 54 fixed = 51 (the panel measures one cell narrower than the border minus padding).
const COLS = [2, 5, 51, 21, 7, 6, 6, 7]
const cols = (texts: string[], widths = COLS) =>
  texts
    .map((s, i) => s.padEnd(widths[i]!))
    .join(" ")
    .trimEnd()
// The text inside the panel on line `i` (between `│ ` and `│`), without trailing spaces.
const inside = (frame: string, i: number) => (line(frame, i).split("│")[1] ?? "").slice(1).trimEnd()

test("Projects as designed", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  tui = await renderTui(kernel, { width: 118, height: 36 })
  tui.input.pressKey("2")
  const frame = await until(tui, (f) => f.includes("HR self-service portal") && f.includes("BI2"))

  expect(line(frame, 1)).toMatch(/^ ╭─ Projects · 7 active ─+╮$/)
  expect([2, 3, 4, 5, 6, 7, 8, 9].map((i) => inside(frame, i))).toEqual([
    cols(["", "Code", "Name", "Next milestone", "Due", "Act.", "Risk", "Effort"]),
    cols(["●", "ERP", "ERP vendor selection", "Vendor selected", "-6d", "7", "3", "60pd"]),
    cols(["●", "CRM", "CRM replatforming", "Design approved", "26 Nov", "9", "2", "220pd"]),
    cols(["●", "HRP", "HR self-service portal", "Pilot start", "8 Dec", "4", "1", "80pd"]),
    cols(["●", "DWH", "Data warehouse migration", "Test environment rea…", "-1d", "6", "2", "310pd"]),
    cols(["●", "IAM", "Identity & access rollout", "Wave 2 live", "15 Jan", "3", "0", "140pd"]),
    cols(["●", "SEC", "Security awareness 2027", "Content signed off", "20 Jan", "2", "0", "25pd"]),
    cols(["●", "WMS", "Warehouse scanners", "Hardware delivered", "3 Feb", "1", "1", "45pd"]),
  ])
  expect(inside(frame, 10)).toBe("On hold · 1")
  expect(inside(frame, 11)).toBe(cols(["◌", "BI2", "Self-service BI phase 2", "—", "—", "0", "0", "90pd"]))
  // The footer on the bottom border; the status bar: the design's hints, then the kept ones (R2).
  expect(line(frame, 34)).toMatch(/^ ╰─+ filter: status=active ─╯$/)
  expect(line(frame, 35)).toBe(" ↑↓ select   enter open   n new   h health   / filter   i capture   ? help   e edit   a archived")

  const spans = await tui.spans()
  expect(isSelected(spans, "ERP vendor selection")).toBe(true)
  // Codes cyan, effort muted, the dot in its health colour, overdue dates red, Risk red with a high one open.
  for (const [code, at] of [["ERP", 3], ["CRM", 4], ["IAM", 7], ["WMS", 9]] as const) expect(fgAt(spans, code, at)).toBe(theme.cyan)
  for (const at of [3, 4, 5, 9]) expect(fgAt(spans, /\d+pd/.exec(line(frame, at))![0], at)).toBe(theme.muted)
  expect(fgAt(spans, "●", 3)).toBe(theme.red)
  expect(fgAt(spans, "●", 4)).toBe(theme.amber)
  expect(fgAt(spans, "●", 7)).toBe(theme.green)
  expect(fgAt(spans, "-6d", 3)).toBe(theme.red)
  expect(fgAt(spans, "-1d", 6)).toBe(theme.red)
  expect(fgAt(spans, "60pd", 3)).toBe(theme.muted)
  // Risk column: the character cell under the header "Risk".
  const riskAt = (i: number) => fgAt(spans, /\d {6}\d+pd/.exec(inside(frame, i))![0], i)
  expect([3, 4, 5, 6, 7, 8, 9].map(riskAt)).toEqual([theme.red, theme.red, theme.text, theme.red, theme.text, theme.text, theme.text])
  // The on-hold row: every cell muted, and the group header.
  for (const t of ["◌", "BI2", "Self-service BI phase 2", "—", "90pd"]) expect(fgAt(spans, t, 11)).toBe(theme.muted)
  expect(fgAt(spans, "On hold", 10)).toBe(theme.muted)
  // Column headers muted.
  for (const h of ["Code", "Name", "Next milestone", "Effort"]) expect(fgAt(spans, h, 2)).toBe(theme.muted)
})

test("a free-text filter extends the footer; a long code shows whole", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  const w = kernel.runtime("projects")!.self().write as Record<string, (i: any) => Promise<any>>
  await runWithContext(kernel.context(), () => w.addProject!({ code: "LONGCODE12345678", name: "Long one" }))
  tui = await renderTui(kernel, { width: 118, height: 36 })
  tui.input.pressKey("2")
  let frame = await until(tui, (f) => f.includes("Long one") && f.includes("HR self-service portal"))
  expect(frame).toContain("LONGCODE12345678 Long one")
  expect(inside(frame, 2)).toBe(cols(["", "Code", "Name", "Next milestone", "Due", "Act.", "Risk", "Effort"], [2, 16, 40, 21, 7, 6, 6, 7]))
  tui.input.pressKey("/")
  for (const ch of "crm") tui.input.pressKey(ch)
  tui.input.pressEnter()
  frame = await until(tui, (f) => f.includes("filter: status=active crm"))
  expect(line(frame, 34)).toMatch(/ filter: status=active crm ─╯$/)
})
