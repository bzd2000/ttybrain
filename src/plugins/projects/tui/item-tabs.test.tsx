// The project detail's item tabs and their forms against the built-in plugins, seeded through the write operations.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { defineTui, type TuiDef } from "../../../kernel/tui/api"
import { useOverlay, type Overlay } from "../../../kernel/tui/overlay"
import { builtinPlugins } from "../../../../tests/builtins"
import { actionsTui } from "../../actions/tui/index"
import { projectsTui } from "./index"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let overlay: Overlay | undefined
function Home() {
  overlay = useOverlay()
  return <text>home screen</text>
}
// The projects part plus a test screen that captures the overlay.
const part: TuiDef = defineTui({
  plugin: "projects",
  activate(ui) {
    projectsTui.activate(ui)
    ui.screen({ id: "home", title: "Home", slot: 3, component: Home })
  },
})

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  overlay = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const write = (plugin = "projects") => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const rows = <T,>(table: string, cols: string[]) =>
  inCtx(async () => (await (kernel!.runtime(table === "action" ? "actions" : "projects")!.data as any).selectFrom(table).select(cols).orderBy("id").execute()) as T[])

async function seed(extra?: () => Promise<void>) {
  await inCtx(async () => {
    await write("people").addPerson!({ name: "Peter Janssens", handle: "peter", is_stakeholder: true })
    const w = write()
    await w.addProject!({ code: "CRM", name: "CRM replatforming" })
    await w.addProject!({ code: "ERP", name: "ERP" })
    await extra?.()
  })
}

// Opens #CRM and moves `tabs` tabs right (Overview → Milestones is 1, … Actions is 5).
async function open(tabs: number, extra?: () => Promise<void>): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await seed(extra)
  tui = await renderTui(kernel, { width: 120, height: 32 })
  tui.input.pressKey("2")
  await tui.frame()
  await tui.nav.open("#CRM")
  await tui.frame()
  for (let i = 0; i < tabs; i++) tui.input.pressArrow("right")
  await tui.frame()
  return tui
}

const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""
async function until(t: RenderedTui, text: string): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 60 && !frame.includes(text); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}
// The frame once `ok(frame)` holds.
async function untilThat(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 60 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}
const type = async (t: RenderedTui, text: string) => {
  await t.input.typeText(text)
  await t.frame()
}

describe("milestones tab", () => {
  test("n adds milestone with project prefilled", async () => {
    const t = await open(1)
    t.input.pressKey("n")
    let frame = await t.frame()
    expect(frame).toContain("New milestone")
    expect(frame).not.toMatch(/\bProject\b/)
    await type(t, "Design approved")
    t.input.pressTab()
    await type(t, "2026-11-26")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, "Design approved 26 Nov")
    expect(lineWith(frame, "Design approved")).toContain("○ Design approved")
    expect(lineWith(frame, "Design approved")).toContain("26 Nov")
    expect(await rows("milestone", ["title", "due_date", "project_id"])).toEqual([{ title: "Design approved", due_date: "2026-11-26", project_id: 1 }])
  })

  test("x completes milestone", async () => {
    const t = await open(1, async () => void (await write().addMilestone!({ project: "CRM", title: "Kickoff", due: "2026-11-20" })))
    let frame = await until(t, "Kickoff")
    expect(lineWith(frame, "Kickoff")).toContain("○")
    t.input.pressKey("x")
    frame = await until(t, "✓")
    expect(lineWith(frame, "Kickoff")).toContain("✓")
    expect((await rows<any>("milestone", ["done_date"]))[0].done_date).toBe("2026-11-13")
    // The tab counts all milestones; the done one shows its date, not a countdown.
    expect(frame).toContain("Milestones 1")
    expect(lineWith(frame, "Kickoff")).toContain("20 Nov")
  })

  test("late milestone shows late", async () => {
    const t = await open(1, async () => void (await write().addMilestone!({ project: "CRM", title: "Old", due: "2026-11-07" })))
    const frame = await until(t, "Old")
    expect(lineWith(frame, "Old")).toContain("late")
  })

  test("e edits and sends only the changed field", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed(async () => void (await write().addMilestone!({ project: "CRM", title: "Kickoff", due: "2026-11-20" })))
    const ops = kernel.ops as any
    const call = ops.call.bind(ops)
    const edits: unknown[] = []
    ops.call = (plugin: string, name: string, kind: string, input: unknown) => {
      if (name === "editMilestone") edits.push(input)
      return call(plugin, name, kind, input)
    }
    tui = await renderTui(kernel, { width: 120, height: 32 })
    tui.input.pressKey("2")
    await tui.frame()
    await tui.nav.open("#CRM")
    await tui.frame()
    tui.input.pressArrow("right")
    const t = tui
    await t.frame()
    await until(t, "Kickoff")
    t.input.pressKey("e")
    expect(await t.frame()).toContain("Edit MS-1")
    await type(t, " x")
    t.input.pressKey("s", { ctrl: true })
    await until(t, "Kickoff x")
    expect(edits).toEqual([{ ref: "MS-1", title: "Kickoff x" }])
  })

  test("milestone add with an invalid Done date leaves no milestone behind", async () => {
    const t = await open(1)
    t.input.pressKey("n")
    await t.frame()
    await type(t, "Gate")
    t.input.pressTab()
    await type(t, "2026-11-26")
    t.input.pressTab()
    await type(t, "garbage")
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, "✗")
    expect(frame).toContain("New milestone")
    expect(await rows("milestone", ["id"])).toEqual([])
  })
})

describe("deliverables tab", () => {
  test("x advances deliverable status", async () => {
    const t = await open(2, async () => void (await write().addDeliverable!({ project: "CRM", title: "Spec", status: "in_review", due: "2026-12-01" })))
    let frame = await until(t, "in_review")
    expect(lineWith(frame, "Spec")).toContain("in_review")
    t.input.pressKey("x")
    frame = await until(t, "delivered")
    expect(lineWith(frame, "Spec")).toContain("delivered")
    expect((await rows<any>("deliverable", ["status", "delivered_date"]))[0]).toEqual({ status: "delivered", delivered_date: "2026-11-13" })
  })

  test("a failing second operation leaves the first save undone", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed(async () => void (await write().addDeliverable!({ project: "CRM", title: "Spec" })))
    const ops = kernel.ops as any
    const call = ops.call.bind(ops)
    ops.call = (plugin: string, name: string, kind: string, input: unknown) =>
      name === "setDeliverableStatus" ? Promise.reject(new Error("status refused")) : call(plugin, name, kind, input)
    tui = await renderTui(kernel, { width: 120, height: 32 })
    tui.input.pressKey("2")
    await tui.frame()
    await tui.nav.open("#CRM")
    await tui.frame()
    tui.input.pressArrow("right")
    await tui.frame()
    tui.input.pressArrow("right")
    const t = tui
    await t.frame()
    await until(t, "Spec")
    t.input.pressKey("e")
    await t.frame()
    await type(t, " 2")
    t.input.pressTab()
    t.input.pressTab()
    t.input.pressTab()
    t.input.pressArrow("right")
    await t.frame()
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, "status refused")
    expect(frame).toContain("status refused")
    expect(await rows("deliverable", ["title", "status"])).toEqual([{ title: "Spec", status: "not_started" }])
  })

  test("validation error from op shows under field", async () => {
    const t = await open(2)
    t.input.pressKey("n")
    await t.frame()
    await type(t, "Spec")
    t.input.pressTab() // owner
    t.input.pressTab() // due
    await type(t, "garbage")
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, "✗")
    const lines = frame.split("\n")
    const at = lines.findIndex((l) => l.includes("Due"))
    expect(lines.slice(at, at + 3).join("\n")).toContain("✗")
    expect(await rows("deliverable", ["id"])).toEqual([])
  })
})

describe("risks tab", () => {
  const risks = async () => {
    const w = write()
    await w.addRisk!({ project: "CRM", title: "Low one", type: "risk", severity: "low" })
    await w.addRisk!({ project: "CRM", title: "High one", type: "issue", severity: "high" })
    await w.addRisk!({ project: "CRM", title: "Closed high", type: "risk", severity: "high" })
    await w.closeRisk!({ ref: "R-3" })
  }

  test("risks sorted open-high first", async () => {
    const t = await open(3, risks)
    const frame = await until(t, "Closed high")
    const at = (s: string) => frame.indexOf(s)
    expect(at("High one")).toBeLessThan(at("Low one"))
    expect(at("Low one")).toBeLessThan(at("Closed high"))
  })

  test("x closes risk", async () => {
    const t = await open(3, risks)
    await until(t, "High one")
    t.input.pressKey("x")
    const frame = await untilThat(t, (f) => lineWith(f, "High one").includes("closed"))
    expect(lineWith(frame, "High one")).toContain("closed")
    expect((await rows<any>("risk", ["status", "closed_date"]))[1]).toEqual({ status: "closed", closed_date: "2026-11-13" })
  })
})

describe("decisions tab", () => {
  test("newest first, x does nothing", async () => {
    const t = await open(4, async () => {
      await write().addDecision!({ project: "CRM", title: "Old call", date: "2026-10-01", decidedBy: "Board" })
      await write().addDecision!({ project: "CRM", title: "New call", date: "2026-11-01" })
    })
    const frame = await until(t, "Old call")
    expect(frame.indexOf("New call")).toBeLessThan(frame.indexOf("Old call"))
    expect(lineWith(frame, "Old call")).toContain("Board")
    expect(frame).toContain("Decisions 2")
    t.input.pressKey("x")
    await t.frame()
    expect((await rows("decision", ["id"])).length).toBe(2)
  })
})

describe("actions tab", () => {
  test("n action with empty owner is me", async () => {
    const t = await open(5)
    t.input.pressKey("n")
    let frame = await t.frame()
    expect(frame).toContain("New action")
    expect(frame).not.toMatch(/\bProject\b/)
    await type(t, "Call vendor")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, "Call vendor")
    expect(lineWith(frame, "Call vendor")).toContain("me")
    expect(kernel!.db.raw.prepare("SELECT title, owner_id, (SELECT record_id FROM actions_link l WHERE l.action_id = a.id AND l.record_type = 'project') AS project_id FROM actions_action a ORDER BY id").all([])).toEqual([{ title: "Call vendor", owner_id: null, project_id: 1 }])
  })

  test("x on an action sets it to done; the tab counts all actions, so it stays", async () => {
    const t = await open(5, async () => {
      await write("actions").addAction!({ title: "One", project: "CRM" })
      await write("actions").addAction!({ title: "Two", project: "CRM", owner: "@peter" })
    })
    let frame = await until(t, "Actions 2")
    expect(lineWith(frame, "Two")).toContain("@peter")
    t.input.pressKey("x")
    frame = await until(t, "done ")
    expect(lineWith(frame, "One")).toContain("done")
    expect(frame).toContain("Actions 2")
    expect((await rows<any>("action", ["status"]))[0].status).toBe("done")
  })
})

describe("delete", () => {
  test("Del asks then deletes", async () => {
    const t = await open(1, async () => void (await write().addMilestone!({ project: "CRM", title: "Kickoff", due: "2026-11-20" })))
    await until(t, "Kickoff")
    t.input.pressKey("DELETE")
    const asked = await until(t, "Delete MS-1")
    expect(asked).toContain('Delete MS-1 "Kickoff"?')
    t.input.pressKey("n")
    await t.frame()
    expect((await rows("milestone", ["id"])).length).toBe(1)
    t.input.pressKey("DELETE")
    await until(t, "Delete MS-1")
    t.input.pressKey("y")
    const frame = await untilThat(t, (f) => !f.includes("Kickoff"))
    expect(frame).not.toContain("Kickoff")
    expect(await rows("milestone", ["id"])).toEqual([])
  })

  test("no action without a selected row", async () => {
    const t = await open(1)
    t.input.pressKey("DELETE")
    t.input.pressKey("x")
    const frame = await t.frame()
    expect(frame).toContain("No milestones yet. Press n to add one.")
    expect(frame).not.toContain("Delete")
  })
})

describe("meeting-linked forms", () => {
  test("action and decision forms carry a prefilled meeting", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed(async () => {
      await write("meetings").addMeeting!({ title: "SteerCo Q4", date: "2026-12-04", projects: ["CRM"] })
      await write("meetings").addMeeting!({ title: "Board", date: "2026-12-10", kind: "board" })
    })
    tui = await renderTui(kernel, { parts: [part, actionsTui], width: 120, height: 32 })
    tui.input.pressKey("3")
    expect(await tui.frame()).toContain("home screen")
    void overlay!.openForm("action", "action", { prefill: { meeting: "M-1", project: "#CRM" } })
    let frame = await until(tui, "New action")
    expect(frame).toContain("New action · M-1")
    expect(frame).not.toContain("Meeting")
    await type(tui, "Send the minutes")
    tui.input.pressKey("s", { ctrl: true })
    await untilThat(tui, (f) => !f.includes("New action"))
    expect(kernel!.db.raw.prepare("SELECT title, (SELECT record_id FROM actions_link l WHERE l.action_id = a.id AND l.record_type = 'meeting') AS meeting_id, (SELECT record_id FROM actions_link l WHERE l.action_id = a.id AND l.record_type = 'project') AS project_id FROM actions_action a ORDER BY id").all([])).toEqual([{ title: "Send the minutes", meeting_id: 1, project_id: 1 }])
    void overlay!.openForm("decision", "decision", { prefill: { meeting: "M-2", project: "#CRM" } })
    frame = await until(tui, "New decision")
    expect(frame).toContain("New decision · M-2")
    tui.input.pressTab() // title (date comes first)
    await type(tui, "Go with B")
    tui.input.pressKey("s", { ctrl: true })
    await untilThat(tui, (f) => !f.includes("New decision"))
    expect(await rows("decision", ["title", "meeting_id"])).toEqual([{ title: "Go with B", meeting_id: 2 }])
  })
})
