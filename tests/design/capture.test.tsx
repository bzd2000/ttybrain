// Quick capture (`i`), as the screen designs draw it (docs/superpowers/specs/2026-11-13-pm-screens.html, "Quick
// capture"), on the CRM project: the overlay 76 wide, centred with its middle at about 44% of the height, the screen
// behind it dimmed; the title `Capture to inbox` and the footer `ctrl+s save · esc cancel` on the bottom border
// (Ctrl+S saves, design §3: Enter is a new line); the input in its own accent-bordered box with `#CRM` cyan and
// `@ma` magenta; the suggestions in a bordered 46-wide box, `@marie` magenta in 10 columns then the name and a
// muted role (`· team` for a team member); a blank line, then the prefill note with `#CRM` cyan; the status bar.
// Seeded with the designs' example data, 118×36. The people search matches inside names too, so `@ma` also lists
// Tom Maes after the design's two rows; the text wraps where OpenTUI's word wrap breaks it (after `go/`, where the
// mock's browser wrapped before it).
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { bgAt, fgAt, line, seedDesign, seedMeetings } from "../design"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"
import { theme } from "../../src/kernel/tui/theme"
import { runWithContext } from "../../src/kernel/context"

const WIDTH = 118
const HEIGHT = 36
const TEXT = "Marie wants a design walkthrough for the sales leads before go/no-go, invite @ma"

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

// The overlay's lines: what lies between its left and right border columns.
const box = (frame: string, left: number) => frame.split("\n").map((l) => l.slice(left, left + 76))

test("Quick capture as designed", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12", seed: seedDesign })
  tui = await renderTui(kernel, { width: WIDTH, height: HEIGHT })
  tui.input.pressKey("2")
  await until(tui, (f) => f.includes("CRM replatforming"))
  tui.input.pressKey("j")
  tui.input.pressEnter()
  await until(tui, (f) => f.includes("Overview") && f.includes("Milestones"))
  tui.input.pressKey("i")
  await until(tui, (f) => f.includes("added because"))
  await tui.input.typeText(TEXT)
  const frame = await until(tui, (f) => f.includes("Mathias Wouters"))

  const rows = frame.split("\n")
  const top = rows.findIndex((l) => l.includes("Capture to inbox"))
  const left = rows[top]!.indexOf("╭")
  expect(left).toBe((WIDTH - 76) / 2)
  const lines = box(frame, left).slice(top, top + 13)
  expect(lines[0]).toMatch(/^╭─ Capture to inbox ─+╮$/)
  expect(lines[1]).toMatch(/^│ ╭─+╮ │$/)
  expect(lines[2]).toBe(`│ │ ${"#CRM Marie wants a design walkthrough for the sales leads before go/".padEnd(68)} │ │`)
  expect(lines[3]).toBe(`│ │ ${"no-go, invite @ma".padEnd(68)} │ │`)
  expect(lines[4]).toMatch(/^│ ╰─+╯ │$/)
  expect(lines[5]).toBe(`│ ╭${"─".repeat(44)}╮${" ".repeat(26)} │`)
  expect(lines[6]).toBe(`│ │ ${"@marie".padEnd(10)}  ${"Marie Dubois · Head of Sales".padEnd(30)} │${" ".repeat(26)} │`)
  expect(lines[7]).toBe(`│ │ ${"@mathias".padEnd(10)}  ${"Mathias Wouters · team".padEnd(30)} │${" ".repeat(26)} │`)
  expect(lines[8]).toBe(`│ │ ${"@tom".padEnd(10)}  ${"Tom Maes · COO".padEnd(30)} │${" ".repeat(26)} │`)
  const end = 9
  expect(lines[end]).toBe(`│ ╰${"─".repeat(44)}╯${" ".repeat(26)} │`)
  expect(lines[end + 1]).toBe(`│${" ".repeat(74)}│`)
  expect(lines[end + 2]).toBe(`│ ${"#CRM added because you're on the CRM project".padEnd(72)} │`)
  expect(lines[end + 3]).toMatch(/^╰─+ ctrl\+s save · esc cancel ─╯$/)
  // Centred at about 44% of the height.
  const middle = top + (end + 3) / 2
  expect(top).toBeGreaterThan(1)
  expect(Math.abs(middle - 0.44 * HEIGHT)).toBeLessThanOrEqual(1.5)
  // The status bar: Ctrl+S saves (design §3).
  expect(line(frame, HEIGHT - 1)).toBe(" ctrl+s save   tab accept suggestion   esc cancel")

  const spans = await tui.spans()
  expect(fgAt(spans, "Capture to inbox")).toBe(theme.accent)
  expect(fgAt(spans, "ctrl+s save · esc cancel")).toBe(theme.muted)
  expect(fgAt(spans, "╭", top)).toBe(theme.borderFocused)
  // The input: its border accent, its tags coloured.
  expect(fgAt(spans, "╭", top + 1)).toBe(theme.borderFocused)
  expect(fgAt(spans, "#CRM Marie", top + 2)).toBe(theme.cyan)
  expect(fgAt(spans, "Marie wants", top + 2)).toBe(theme.text)
  expect(fgAt(spans, "@ma", top + 3)).toBe(theme.magenta)
  expect(fgAt(spans, "no-go", top + 3)).toBe(theme.text)
  // The suggestions: a muted border, the selected row on selectedBg, the tag magenta, the role muted.
  expect(fgAt(spans, "╭", top + 5)).toBe(theme.border)
  expect(bgAt(spans, "@marie", top + 6)).toBe(theme.selectedBg)
  expect(bgAt(spans, "@mathias", top + 7)).not.toBe(theme.selectedBg)
  expect(fgAt(spans, "@marie", top + 6)).toBe(theme.magenta)
  expect(fgAt(spans, "@mathias", top + 7)).toBe(theme.magenta)
  expect(fgAt(spans, "Marie Dubois", top + 6)).toBe(theme.text)
  expect(fgAt(spans, "· Head of Sales", top + 6)).toBe(theme.muted)
  expect(fgAt(spans, "· team", top + 7)).toBe(theme.muted)
  // The prefill note: the tag cyan, the rest muted.
  expect(fgAt(spans, "#CRM added", top + end + 2)).toBe(theme.cyan)
  expect(fgAt(spans, "added because", top + end + 2)).toBe(theme.muted)
  // The screen behind is dimmed.
  expect(fgAt(spans, "Thu 12 Nov 2026", 0)).not.toBe(theme.muted)
  expect(fgAt(spans, "ttybrain", 0)).not.toBe(theme.accent)
})

// A long code stays whole in the suggestions: the tag column grows to the longest one shown (10 to 17 cells).
test("Quick capture suggests a 16-character code whole", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  const w = kernel.runtime("projects")!.self().write as Record<string, (i: any) => Promise<any>>
  await runWithContext(kernel.context(), () => w.addProject!({ code: "DATAPLATFORM2027", name: "Data platform" }))
  tui = await renderTui(kernel, { width: WIDTH, height: HEIGHT })
  await tui.settle()
  tui.input.pressKey("i")
  await until(tui, (f) => f.includes("Capture to inbox"))
  await tui.input.typeText("Ask about #DATA")
  const frame = await until(tui, (f) => f.includes("Data platform"))
  const row = frame.split("\n").find((l) => l.includes("Data platform"))!
  expect(row).toContain("#DATAPLATFORM2027  Data platform")
  const spans = await tui.spans()
  expect(fgAt(spans, "#DATAPLATFORM2027", "Data platform")).toBe(theme.cyan)
})

// Quick capture to a talk-list, as the 2026-11-20 `capture` design draws it (ruling M9), on the Actions screen with
// the meeting designs' data (today Fri 20 Nov 2026): a text that starts with `talk` and tags one person (and a
// project) is titled `Capture`, and under the input, after a blank line, says where it lands: `→ Anna Peeters'
// talk-list · next 1:1 Mon 23 Nov`, `linked to #CRM, so it also shows at CRM steering until discussed`, `without
// "talk" it goes to the inbox as before`. Ctrl+S puts it on Anna's talk-list (tagged #CRM), not in the inbox.
const talkItems = (about: string) =>
  runWithContext(kernel!.context(), async () => ((await (kernel!.runtime("meetings")!.self().read as any).talkList({ about })).open as Array<{ text: string; project: string | null }>))
const inboxItems = () => kernel!.db.raw.prepare("SELECT text FROM inbox_item ORDER BY id").all([]) as Array<{ text: string }>

async function captureOnActions(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-20", seed: seedMeetings })
  tui = await renderTui(kernel, { width: WIDTH, height: HEIGHT })
  tui.input.pressKey("4")
  await until(tui, (f) => f.includes("Actions · 7 open"))
  tui.input.pressKey("i")
  await until(tui, (f) => f.includes("Capture to inbox"))
  return tui
}

test("Quick capture to a talk-list as designed", async () => {
  const t = await captureOnActions()
  // A space after the tag: the suggestions have gone, as the mock's caret.
  await t.input.typeText("talk @anna holiday planning around the CRM go-live #CRM ")
  const frame = await until(t, (f) => f.includes('without "talk"'))
  const rows = frame.split("\n")
  const top = rows.findIndex((l) => l.includes("╭─ Capture"))
  const left = rows[top]!.indexOf("╭")
  expect(left).toBe((WIDTH - 76) / 2)
  const lines = box(frame, left).slice(top, top + 9)
  expect(lines[0]).toMatch(/^╭─ Capture ─+╮$/)
  expect(lines[1]).toMatch(/^│ ╭─+╮ │$/)
  expect(lines[2]).toBe(`│ │ ${"talk @anna holiday planning around the CRM go-live #CRM".padEnd(68)} │ │`)
  expect(lines[3]).toMatch(/^│ ╰─+╯ │$/)
  expect(lines[4]).toBe(`│${" ".repeat(74)}│`)
  expect(lines[5]).toBe(`│ ${"→ Anna Peeters' talk-list · next 1:1 Mon 23 Nov".padEnd(72)} │`)
  expect(lines[6]).toBe(`│ ${"  linked to #CRM, so it also shows at CRM steering until discussed".padEnd(72)} │`)
  expect(lines[7]).toBe(`│ ${'  without "talk" it goes to the inbox as before'.padEnd(72)} │`)
  expect(lines[8]).toMatch(/^╰─+ ctrl\+s save · esc cancel ─╯$/)
  expect(line(frame, HEIGHT - 1)).toBe(" ctrl+s save   tab accept suggestion   esc cancel")
  const spans = await t.spans()
  expect(fgAt(spans, "Capture", top)).toBe(theme.accent)
  expect(fgAt(spans, "@anna", top + 2)).toBe(theme.magenta)
  expect(fgAt(spans, "#CRM", top + 2)).toBe(theme.cyan)
  expect(fgAt(spans, "→", top + 5)).toBe(theme.green)
  expect(fgAt(spans, "Anna Peeters' talk-list", top + 5)).toBe(theme.text)
  expect(fgAt(spans, " · next 1:1 Mon 23 Nov", top + 5)).toBe(theme.muted)
  expect(fgAt(spans, "  linked to", top + 6)).toBe(theme.muted)
  expect(fgAt(spans, "#CRM", top + 6)).toBe(theme.cyan)
  expect(fgAt(spans, ", so it also shows", top + 6)).toBe(theme.muted)
  expect(fgAt(spans, "without", top + 7)).toBe(theme.muted)

  t.input.pressKey("s", { ctrl: true })
  const after = await until(t, (f) => f.includes("to Anna Peeters' talk-list") && !f.includes('without "talk"'))
  expect(line(after, HEIGHT - 1)).toMatch(/^ added T-\d+ to Anna Peeters' talk-list/)
  expect((await talkItems("@anna")).at(-1)).toEqual(expect.objectContaining({ text: "Holiday planning around the CRM go-live", project: "#CRM" }))
  expect(inboxItems()).toHaveLength(2)
})

// Review Focus 5: almost a talk item (no tag, two people, a tag that does not resolve) goes to the inbox, and the line
// under the input says so before saving; text without `talk` shows no line, as before.
test("Quick capture that is almost a talk item goes to the inbox, and says so first", async () => {
  const t = await captureOnActions()
  const cases: Array<[text: string, why: string]> = [
    ["talk about lunch", "→ goes to the inbox · no person or project tagged"],
    ["talk @anna @bob budget for the offsite", "→ goes to the inbox · 2 people tagged"],
    ["talk @nobody about the offsite", "→ goes to the inbox · @nobody is not a person"],
  ]
  const before = (await talkItems("@anna")).length
  for (const [n, [text, why]] of cases.entries()) {
    if (n > 0) {
      t.input.pressKey("i")
      await until(t, (f) => f.includes("Capture to inbox"))
    }
    await t.input.typeText(text)
    const frame = await until(t, (f) => f.includes(why))
    expect(frame).toContain("Capture to inbox")
    expect(frame).toContain("a talk item needs one person or project tag: talk @anna …")
    const spans = await t.spans()
    expect(fgAt(spans, "→", why)).toBe(theme.green)
    expect(fgAt(spans, why.slice(why.indexOf(" · ")), why)).toBe(theme.muted)
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => line(f, HEIGHT - 1).includes(`captured I-${3 + n}`))
    expect(inboxItems().at(-1)!.text).toBe(text)
  }
  expect((await talkItems("@anna")).length).toBe(before)

  // Without `talk`: no line under the input.
  t.input.pressKey("i")
  await until(t, (f) => f.includes("Capture to inbox"))
  await t.input.typeText("lunch with @anna ")
  const frame = await until(t, (f) => f.includes("lunch with @anna"))
  expect(frame).not.toContain("→")
  expect(frame).not.toContain("talk-list")
})
