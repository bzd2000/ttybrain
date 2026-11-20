// The project record view's Context tab as the screen designs draw it
// (docs/superpowers/specs/2026-11-13-pm-screens.html, "Project context"): a focused bordered panel
// `Context · markdown` with `updated <d> · <n>%` on its bottom border (the mock's `via mcp` is a FEATURE, gap C2),
// the Markdown with its heading markers, muted bullets, a borderless table with a muted header, the link text cyan
// and its url muted, and the status bar. Seeded with the designs' example data, today Thu 12 Nov 2026, 118×36.
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { boldAt, fgAt, line, seedDesign } from "../design"
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
  for (let i = 0; i < 200 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

// The text inside the panel on line `i` (between `│ ` and `│`), without trailing spaces.
const inside = (frame: string, i: number) => (line(frame, i).split("│")[1] ?? "").slice(1).trimEnd()

async function openContext(width: number, height: number): Promise<{ t: RenderedTui; frame: string }> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  tui = await renderTui(kernel, { width, height })
  tui.input.pressKey("2")
  await until(tui, (f) => f.includes("CRM replatforming"))
  await tui.nav.open("#CRM")
  await until(tui, (f) => f.includes("Milestones 5"))
  for (let i = 0; i < 7; i++) tui.input.pressArrow("right")
  const frame = await until(tui, (f) => f.includes("Solution outline v1.2") && f.includes("Background") && f.includes("nightly extract") && f.includes("100%"))
  return { t: tui, frame }
}

test("Project context as designed", async () => {
  const { t, frame } = await openContext(118, 36)

  expect(line(frame, 0)).toContain(" 2 Projects ▾  › CRM CRM replatforming")
  expect(line(frame, 1)).toBe("")
  expect(line(frame, 2)).toBe("  Overview   Milestones 5   Deliverables 6   Risks & issues 4   Decisions 7   Actions 9   People 7   Context")
  // A focused panel filling the tab, the footer on its bottom border.
  expect(line(frame, 3)).toMatch(/^ ╭─ Context · markdown ─+╮$/)
  expect(line(frame, 34)).toMatch(/^ ╰─+ updated 12 Nov · 100% ─╯$/)

  const body = Array.from({ length: 30 }, (_, k) => inside(frame, 4 + k))
  const at = (text: string) => body.findIndex((l) => l.startsWith(text))
  // Heading markers stay; bullets are `•`; the table is plain columns; the link shows its text, then the url.
  expect(body[0]).toBe("# Background")
  expect(body[1]).toMatch(/^The legacy CRM \(Siebel 8, on-prem\) reaches end of support in Q3 2027\./)
  for (const l of ["## Scope phase 1", "• Accounts, contacts, opportunities", "• Migration of 4.2M contact records, deduplicated", "• Out of scope: marketing automation (decision 28 Oct)", "## Integrations", "## Links"])
    expect(at(l)).toBeGreaterThan(0)
  expect(body[at("• Accounts")]).toBe("• Accounts, contacts, opportunities")
  expect(at("• Accounts")).toBe(at("## Scope phase 1") + 1)
  const table = at("System")
  expect(table).toBeGreaterThan(at("## Integrations"))
  expect(body[table]).toMatch(/^System +Direction +Notes$/)
  expect(body[table + 1]).toMatch(/^ERP \(SAP\) +both +customer master, orders$/)
  expect(body[table + 2]).toMatch(/^DWH +out +nightly extract$/)
  expect(body[at("Solution outline v1.2")]).toBe("Solution outline v1.2 · https://sharepoint/sites/projects/CRM/outline.docx")
  expect(frame).not.toMatch(/[┌┬┐├┼┤└┴┘]/)

  expect(line(frame, 35)).toBe(" ↑↓ scroll   e edit   ←→ tabs   esc back   i capture   E edit in $EDITOR")

  const spans = await t.spans()
  expect(fgAt(spans, "Context · markdown", 3)).toBe(theme.accent)
  expect(fgAt(spans, "╭", 3)).toBe(theme.borderFocused)
  expect(fgAt(spans, "updated 12 Nov", 34)).toBe(theme.muted)
  // Headings accent and bold, markers included; body text plain.
  for (const h of ["# Background", "## Scope phase 1", "## Integrations", "## Links"]) {
    expect(fgAt(spans, h)).toBe(theme.accent)
    expect(boldAt(spans, h)).toBe(true)
  }
  expect(fgAt(spans, "The legacy CRM")).toBe(theme.text)
  // Bullets muted; bold in the text colour.
  expect(fgAt(spans, "•", "Accounts, contacts")).toBe(theme.muted)
  expect(fgAt(spans, "Accounts, contacts")).toBe(theme.text)
  expect(fgAt(spans, "Out of scope:")).toBe(theme.text)
  expect(boldAt(spans, "Out of scope:")).toBe(true)
  // The table's header muted, its cells plain.
  expect(fgAt(spans, "System")).toBe(theme.muted)
  expect(fgAt(spans, "Direction")).toBe(theme.muted)
  expect(fgAt(spans, "ERP (SAP)")).toBe(theme.text)
  // The link text cyan, ` · url` muted.
  expect(fgAt(spans, "Solution outline v1.2")).toBe(theme.cyan)
  expect(fgAt(spans, "· https://sharepoint")).toBe(theme.muted)
})
