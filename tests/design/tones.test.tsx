// The colour rules on the screens and tabs the designs do not draw (docs/architecture.md "Look and feel"): project
// codes cyan, people names magenta, ids and refs muted. A meeting's Agenda and Notes tabs, a person's Notes, Goals,
// Projects & roles and Actions tabs, and a project's People tab. (Screen 5, Meetings, is a designed screen since the
// 2026-11-20 designs: its tones are asserted in meetings.test.tsx.) Seeded with the designs' example data (plus one
// note on CRM), today Thu 12 Nov 2026, 118×36.
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { fgAt, line, seedDesign } from "../design"
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

// Opens `ref`, moves right to the tab (on line 2, under the header's blank line) whose label starts with `name` and waits until the frame shows `text`.
async function tab(t: RenderedTui, ref: string, name: string, text: string): Promise<void> {
  await t.nav.open(ref)
  const frame = await until(t, (f) => line(f, 2).includes(name))
  const tabs = line(frame, 2).trim().split(/ {3,}/)
  const at = tabs.findIndex((s) => s.startsWith(name))
  for (let i = 0; i < at; i++) t.input.pressArrow("right")
  await until(t, (f) => f.includes(text))
}

async function start(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  const people = kernel.runtime("people")!.self().write as Record<string, (i: any) => Promise<any>>
  await runWithContext(kernel.context(), () => people.addNote!({ person: "marie", kind: "interaction", project: "CRM", text: "Walkthrough agreed", date: "2026-11-10" }))
  tui = await renderTui(kernel, { width: 118, height: 36 })
  await tui.settle()
  return tui
}

test("a meeting's Agenda tab: codes cyan", async () => {
  const t = await start()
  await tab(t, "M-2", "Agenda", "Ask")
  const spans = await t.spans()
  // The item text names the project too: the code is the one followed by its column's padding.
  expect(fgAt(spans, "CRM    ", "CRM status")).toBe(theme.cyan)
  expect(fgAt(spans, "ERP    ", "ERP vendor decision")).toBe(theme.cyan)
  expect(fgAt(spans, "CRM status")).toBe(theme.text)
})

test("a meeting's Notes tab: logged refs muted, owners magenta", async () => {
  const t = await start()
  await tab(t, "M-1", "Notes", "Book vendor demo slot")
  const spans = await t.spans()
  expect(fgAt(spans, "A-2", "Book vendor demo slot")).toBe(theme.muted)
  expect(fgAt(spans, "Book vendor", "Book vendor demo slot")).toBe(theme.text)
  expect(fgAt(spans, "@bob", "Book vendor demo slot")).toBe(theme.magenta)
})

test("a person's Notes tab: refs muted, codes cyan", async () => {
  const t = await start()
  await tab(t, "@marie", "Notes", "Kind")
  const spans = await t.spans()
  expect(fgAt(spans, "N-", "Walkthrough agreed")).toBe(theme.muted)
  expect(fgAt(spans, "CRM", "Walkthrough agreed")).toBe(theme.cyan)
})

test("a person's Goals tab: refs muted", async () => {
  const t = await start()
  await tab(t, "@sofie", "Goals", "Target")
  const spans = await t.spans()
  expect(fgAt(spans, "G-1", "PM training 2027")).toBe(theme.muted)
})

test("a person's Projects & roles tab: codes cyan", async () => {
  const t = await start()
  await tab(t, "@marie", "Projects & roles", "Role")
  const spans = await t.spans()
  expect(fgAt(spans, "CRM", "business owner")).toBe(theme.cyan)
  expect(fgAt(spans, "HRP", "HR self-service portal")).toBe(theme.cyan)
})

test("a person's Actions tab: refs muted, codes cyan", async () => {
  const t = await start()
  await tab(t, "@peter", "Actions", "Proj.")
  const spans = await t.spans()
  expect(fgAt(spans, "A-1", "Send revised budget to Peter")).toBe(theme.muted)
  expect(fgAt(spans, "CRM", "Send revised budget to Peter")).toBe(theme.cyan)
})

test("a project's People tab: names magenta, handles muted", async () => {
  const t = await start()
  await tab(t, "#CRM", "People", "Team/Stakeholder")
  const spans = await t.spans()
  expect(fgAt(spans, "Marie Dubois", "business owner")).toBe(theme.magenta)
  expect(fgAt(spans, "@marie", "business owner")).toBe(theme.muted)
})
