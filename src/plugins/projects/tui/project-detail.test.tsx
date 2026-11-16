// The project detail record view (Summary, People, Context tabs) against the built-in plugins, seeded through the
// write operations. Opened with nav.open("#CRM").
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { builtinPlugins } from "../../index"

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
    expect(frame).toContain("People 2")
    expect(lineWith(frame, "Summary")).toContain("Context")
  })

  test("→ goes through tabs to Context", async () => {
    const t = await open()
    let frame = await right(t)
    expect(frame).toContain("Team/Stakeholder")
    frame = await right(t)
    expect(frame).toContain("Context · markdown")
  })

  test("empty context", async () => {
    const t = await open()
    const frame = await right(t, 2)
    expect(frame).toContain("No context yet. Press e to write it, or let your MCP integration fill it in.")
  })

  test("context renders markdown", async () => {
    const t = await open()
    await inCtx(() => write().setContext!({ project: "CRM", markdown: "# Background\nLegacy CRM" }))
    await right(t, 2)
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

  test("e edits context", async () => {
    const t = await open()
    await inCtx(() => write().setContext!({ project: "CRM", markdown: "# A" }))
    await right(t, 2)
    t.input.pressKey("e")
    await t.frame()
    t.input.pressKey("END")
    await t.input.typeText("!")
    t.input.pressKey("s", { ctrl: true })
    await t.frame()
    expect(await markdown()).toBe("# A!")
  })

  test("E without an external editor (container mode) leaves the context unchanged", async () => {
    const t = await open()
    await inCtx(() => write().setContext!({ project: "CRM", markdown: "# A" }))
    await right(t, 2)
    process.env.PM_MODE = "container"
    try {
      t.input.pressKey("E")
      const frame = await t.frame()
      expect(frame).toContain("no external editor in container mode")
    } finally {
      delete process.env.PM_MODE
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

  test("people tab adds and removes involvement", async () => {
    const t = await open()
    let frame = await right(t)
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
    t.input.pressEnter()
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
    await right(t)
    // Rows are sorted by name: Anna, Peter.
    t.input.pressKey("DELETE")
    expect(await t.frame()).toContain("Remove @anna as architect from CRM?")
  })

  test("Esc returns to Projects with CRM still selected", async () => {
    const t = await open()
    t.input.pressEscape()
    await sleep(30)
    const frame = await t.frame()
    expect(frame.split("\n")[0]).toContain("pm · 2 Projects")
    expect(frame).toContain("Projects · 1 active")
    expect(lineWith(frame, " CRM ")).toContain("Design approved")
  })
})
