// The project detail record view (Summary, People, Context tabs) against the built-in plugins, seeded through the
// write operations. Opened with nav.open("#CRM").
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { builtinPlugins } from "../../../../tests/builtins"
import { isSelected } from "../../../../tests/design"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const write = (plugin = "projects") => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const read = () => kernel!.runtime("projects")!.self().read as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)

// CRM amber `Design slipping` on 2026-11-10, sponsor @peter, team member @anna (architect), one milestone, one open
// high issue R-1.
async function seed() {
  await inCtx(async () => {
    const people = write("people")
    await people.addPerson!({ name: "Peter Janssens", handle: "peter", is_stakeholder: true })
    await people.addPerson!({ name: "Anna Peeters", handle: "anna", is_team: true })
    await people.addPerson!({ name: "Bob Stone", handle: "bob" })
    const w = write()
    await w.addProject!({
      code: "CRM",
      name: "CRM replatforming",
      description: "Replace the legacy CRM with a SaaS platform.",
      startDate: "2026-09-01",
      endDate: "2027-06-30",
      effortDays: 220,
      effortNote: "incl. vendor",
    })
    await w.setHealth!({ project: "CRM", health: "amber", comment: "Design slipping", date: "2026-11-10" })
    await w.addInvolvement!({ project: "CRM", person: "@peter", role: "Sponsor" })
    await w.addInvolvement!({ project: "CRM", person: "@anna", role: "architect" })
    await w.addMilestone!({ project: "CRM", title: "Design approved", due: "2026-11-26" })
    await w.addRisk!({ project: "CRM", title: "Budget overrun", type: "issue", severity: "high" })
  })
}

async function open(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await seed()
  tui = await renderTui(kernel, { width: 110, height: 32 })
  tui.input.pressKey("2")
  await tui.frame()
  await tui.nav.open("#CRM")
  await tui.frame()
  return tui
}

const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""
// The frame once it contains `text` (a live reload or a late layout may take a few frames).
async function until(t: RenderedTui, text: string): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 60 && !frame.includes(text); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}
const right = async (t: RenderedTui, n = 1) => {
  for (let i = 0; i < n; i++) t.input.pressArrow("right")
  return t.frame()
}
const markdown = async () => (await inCtx(() => read().getContext!({ project: "CRM" }))).markdown as string | null
const involvements = () =>
  inCtx(async () =>
    (await kernel!.runtime("projects")!.data.selectFrom("involvement").select(["role"]).orderBy("id").execute()).map((r: any) => r.role),
  )

describe("project detail", () => {
  test("summary shows health, sponsor, team", async () => {
    const t = await open()
    const frame = await t.frame()
    expect(frame).toContain("› CRM CRM replatforming")
    expect(frame).toContain("● amber · 10 Nov")
    expect(frame).toContain("Design slipping")
    expect(lineWith(frame, "Sponsor")).toContain("Peter")
    expect(lineWith(frame, "Team")).toContain("Anna")
    expect(lineWith(frame, "Team")).not.toContain("Peter")
    expect(lineWith(frame, "Dates")).toContain("1 Sep 2026 → 30 Jun 2027")
    expect(lineWith(frame, "Effort")).toContain("220 person-days (incl. vendor)")
    expect(frame).toContain("Replace the legacy CRM")
    // The short lists on the right.
    expect(frame).toContain("Design approved")
    expect(lineWith(frame, "Budget overrun")).toContain("R-1")
    expect(lineWith(frame, "Budget overrun")).toContain("high")
    expect(lineWith(frame, "Budget overrun")).toContain("issue")
  })

  test("tab titles carry counts", async () => {
    const t = await open()
    const frame = await t.frame()
    expect(frame).toContain("Milestones 1")
    expect(frame).toContain("Risks & issues 1")
    expect(frame).toContain("People 2")
    expect(lineWith(frame, "Summary")).toContain("Context")
  })

  test("at 80 columns the tabs drop zero counts, then window around the active tab with ‹ › instead of cutting words", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    await inCtx(() => write().addAction!({ title: "Call", project: "CRM" }))
    tui = await renderTui(kernel, { width: 80, height: 24 })
    tui.input.pressKey("2")
    await tui.frame()
    await tui.nav.open("#CRM")
    const tabLine = async () => (await tui!.frame()).split("\n")[1]!
    const words = ["Summary", "Milestones", "Deliverables", "Risks & issues", "Decisions", "Actions", "People", "Context"]
    const check = (line: string) => {
      // every word on the tab line is a whole tab title or count, or a marker
      for (const piece of line.replace(/[‹›]/g, " ").trim().split(/\s{2,}/)) {
        expect(words.some((w) => piece === w || new RegExp(`^${w.replace(/[&]/g, "\\$&")} \\d+$`).test(piece))).toBe(true)
      }
    }
    let line = await tabLine()
    expect(line).toContain("Summary")
    expect(line).not.toContain(" 0") // zero counts are dropped first
    expect(line).toContain("›") // more tabs to the right
    check(line)
    tui.input.pressArrow("right")
    line = (await tui.frame()).split("\n")[1]!
    expect(line).toContain("Milestones 1")
    check(line)
    for (let i = 0; i < 6; i++) tui.input.pressArrow("right")
    line = (await tui.frame()).split("\n")[1]!
    expect(line).toContain("Context")
    expect(line).toContain("‹")
    expect(line).not.toMatch(/›\s*$/)
    check(line)
  })

  test("→ goes through tabs to Context", async () => {
    const t = await open()
    let frame = await right(t, 6)
    expect(frame).toContain("Team/Stakeholder")
    frame = await right(t)
    expect(frame).toContain("Context · markdown")
  })

  test("empty context", async () => {
    const t = await open()
    const frame = await right(t, 7)
    expect(frame).toContain("No context yet. Press e to write it, or let your MCP integration fill it in.")
  })

  test("context renders markdown", async () => {
    const t = await open()
    await inCtx(() => write().setContext!({ project: "CRM", markdown: "# Background\nLegacy CRM" }))
    await right(t, 7)
    // <markdown> lays out its blocks a moment after the first frame.
    let frame = await t.frame()
    for (let i = 0; i < 40 && !frame.includes("Legacy CRM"); i++) {
      await sleep(25)
      frame = await t.frame()
    }
    expect(frame).toContain("Background")
    expect(frame).not.toContain("# Background")
    expect(frame).toContain("Legacy CRM")
    expect(lineWith(frame, "Context · markdown")).toContain("updated 13 Nov")
    expect(lineWith(frame, "Context · markdown")).toContain("100%") // it fits: scrolled to the end
  })

  test("a long context at 80x24 scrolls inside the tab and keeps the breadcrumb", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}`).join("\n\n")
    await inCtx(() => write().setContext!({ project: "CRM", markdown: long }))
    tui = await renderTui(kernel, { width: 80, height: 24 })
    tui.input.pressKey("2")
    await tui.frame()
    await tui.nav.open("#CRM")
    await tui.frame()
    await right(tui, 7)
    const frame = await until(tui, "Paragraph 1")
    expect(frame).toContain("Context · markdown")
    expect(frame).toContain("Paragraph 1")
    expect(frame).toContain("› CRM CRM replatforming")
  })

  test("e edits context", async () => {
    const t = await open()
    await inCtx(() => write().setContext!({ project: "CRM", markdown: "# A" }))
    await right(t, 7)
    t.input.pressKey("e")
    await t.frame()
    t.input.pressKey("END")
    await t.input.typeText("!")
    t.input.pressKey("s", { ctrl: true })
    await t.frame()
    expect(await markdown()).toBe("# A!")
  })

  test("the context editor keeps a draft per project: a quit keeps it, reopening offers it, a save deletes it", async () => {
    let t = await open()
    await inCtx(() => write().setContext!({ project: "CRM", markdown: "# A" }))
    await right(t, 7)
    t.input.pressKey("e")
    await until(t, "ctrl+s save")
    t.input.pressKey("END")
    await t.input.typeText(" draft")
    t.destroy() // quit without saving
    t = tui = await renderTui(kernel!, { width: 110, height: 32 })
    t.input.pressKey("2")
    await t.frame()
    await t.nav.open("#CRM")
    await t.frame()
    await right(t, 7)
    const dir = join(kernel!.home, "drafts")
    expect(readdirSync(dir)).toEqual([`${encodeURIComponent("projects:context:#CRM")}.json`])
    expect(JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]!), "utf8")).values).toEqual({ text: "# A draft" })
    expect(await markdown()).toBe("# A")

    t.input.pressKey("e")
    let frame = await until(t, "Unsaved draft")
    expect(frame).toContain("Unsaved draft from 09:00 · r restore · x discard")
    t.input.pressKey("r")
    frame = await t.frame()
    expect(frame).not.toContain("Unsaved draft")
    expect(frame).toContain("# A draft")
    t.input.pressKey("s", { ctrl: true })
    await t.frame()
    expect(await markdown()).toBe("# A draft")
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([])
  })

  test("E without an external editor (container mode) leaves the context unchanged", async () => {
    const t = await open()
    await inCtx(() => write().setContext!({ project: "CRM", markdown: "# A" }))
    await right(t, 7)
    process.env.TTYBRAIN_MODE = "container"
    try {
      t.input.pressKey("E")
      const frame = await t.frame()
      expect(frame).toContain("no external editor in container mode")
    } finally {
      delete process.env.TTYBRAIN_MODE
    }
    expect(await markdown()).toBe("# A")
  })

  test("h opens the health form and e the project form", async () => {
    const t = await open()
    t.input.pressKey("h")
    expect(await t.frame()).toContain("Health update · CRM")
    t.input.pressEscape()
    await sleep(1100) // past the form's Esc window
    t.input.pressKey("e")
    expect(await t.frame()).toContain("Edit CRM")
  })

  test("a code edit from Summary follows the rename, and Esc selects the renamed project", async () => {
    const t = await open()
    await until(t, "› CRM CRM replatforming")
    t.input.pressKey("e")
    await until(t, "Edit CRM")
    t.input.pressTab() // Name → Code (prefilled)
    await t.input.typeText("2027")
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, "› CRM2027 CRM replatforming")
    expect(frame).toContain("› CRM2027 CRM replatforming")
    expect(frame).toContain("Design slipping") // the Summary of the same project, not "not found"
    expect(t.nav.stack().length).toBe(3) // Overview, Projects, #CRM2027: the old route was replaced, not stacked on
    const codes = await inCtx(async () => (await kernel!.runtime("projects")!.data.selectFrom("project").select("code").execute()).map((r: any) => r.code))
    expect(codes).toEqual(["CRM2027"])

    t.input.pressEscape()
    let list = await t.frame()
    for (let i = 0; i < 60 && !(t.nav.route().kind === "screen" && list.includes(" CRM2027 ")); i++) {
      await sleep(25)
      list = await t.frame()
    }
    expect(t.nav.route()).toEqual({ kind: "screen", screen: "projects", params: { selected: "#CRM2027" } })
    expect(isSelected(await t.spans(), " CRM2027 ")).toBe(true)
  })

  test("people tab adds and removes involvement", async () => {
    const t = await open()
    let frame = await right(t, 6)
    expect(lineWith(frame, "Anna")).toContain("architect")
    expect(lineWith(frame, "Anna")).toContain("Team")
    expect(lineWith(frame, "Peter")).toContain("Stakeholder")
    t.input.pressKey("n")
    expect(await t.frame()).toContain("Add involvement")
    await t.input.typeText("bo")
    expect(await t.frame()).toContain("@bob Bob Stone")
    t.input.pressTab() // accepts @bob
    await t.frame()
    t.input.pressTab()
    await t.input.typeText("reviewer")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, "reviewer")
    expect(await involvements()).toEqual(["Sponsor", "architect", "reviewer"])
    expect(lineWith(frame, "Bob")).toContain("reviewer")

    // Del confirms, n keeps it.
    t.input.pressKey("DELETE")
    frame = await until(t, "Remove @")
    expect(frame).toMatch(/Remove @(peter|anna|bob) as \w+ from CRM\?/)
    t.input.pressKey("n")
    await t.frame()
    expect((await involvements()).length).toBe(3)
    t.input.pressKey("DELETE")
    const asked = await until(t, "Remove @")
    const m = /Remove (@\w+) as (\w+) from CRM\?/.exec(asked)!
    t.input.pressKey("y")
    await t.frame()
    const left = await involvements()
    expect(left.length).toBe(2)
    expect(left).not.toContain(m[2]!)
  })

  test("Del confirmation names the selected person and role", async () => {
    const t = await open()
    await right(t, 6)
    // Rows are sorted by name: Anna, Peter.
    t.input.pressKey("DELETE")
    expect(await t.frame()).toContain("Remove @anna as architect from CRM?")
  })

  test("Esc returns to Projects with CRM still selected", async () => {
    const t = await open()
    // AAA (red) sorts above CRM (amber): it would be row 0 if the selection had been reset.
    await inCtx(() => write().addProject!({ code: "AAA", name: "Alpha" }))
    await inCtx(() => write().setHealth!({ project: "AAA", health: "red" }))
    t.input.pressEscape()
    let frame = await until(t, "Projects · 2 active")
    expect(frame.split("\n")[0]).toContain("ttybrain ·  2 Projects")
    expect(isSelected(await t.spans(), " AAA ")).toBe(false)
    for (let i = 0; i < 40 && !isSelected(await t.spans(), " CRM "); i++) {
      await sleep(25)
      frame = await t.frame()
    }
    expect(isSelected(await t.spans(), " CRM ")).toBe(true)
    expect(lineWith(frame, " CRM ")).toContain("Design approved")
  })
})
