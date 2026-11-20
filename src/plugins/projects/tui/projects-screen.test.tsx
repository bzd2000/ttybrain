// The Projects screen (slot 2): health-sorted groups, the filter, the archived toggle, and the project and health
// forms, against the built-in plugins seeded through the projects write operations.
import { rgbToHex } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { displayWidth, theme } from "../../../kernel/tui/api"
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

const write = () => kernel!.runtime("projects")!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)

// CRM amber (milestone 26 Nov), ERP red (milestone 7 Nov), IAM no health, HRP green, BI2 on hold, OLD archived.
async function seed() {
  await inCtx(async () => {
    const w = write()
    await w.addProject!({ code: "CRM", name: "Customer platform" })
    await w.setHealth!({ project: "CRM", health: "amber" })
    await w.addMilestone!({ project: "CRM", title: "Design approved", due: "2026-11-26" })
    await w.addProject!({ code: "ERP", name: "Enterprise resources" })
    await w.setHealth!({ project: "ERP", health: "red" })
    await w.addMilestone!({ project: "ERP", title: "Vendor selected", due: "2026-11-07" })
    await w.addProject!({ code: "IAM", name: "Identity rollout" })
    await w.addProject!({ code: "HRP", name: "HR portal", effortDays: 220 })
    await w.setHealth!({ project: "HRP", health: "green" })
    await w.addProject!({ code: "BI2", name: "Self-service reporting", status: "on_hold" })
    await w.addProject!({ code: "OLD", name: "Legacy cleanup" })
    await w.archiveProject!({ project: "OLD" })
  })
}

async function open(opts: { width?: number; height?: number } = {}): Promise<RenderedTui> {
  kernel ??= await makeTestKernel({ plugins: builtinPlugins })
  tui = await renderTui(kernel, opts)
  tui.input.pressKey("2")
  await tui.frame()
  return tui
}

const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))

async function escape(t: RenderedTui) {
  t.input.pressEscape()
  await sleep(30) // a lone ESC is flushed by the input parser's timeout
}

const health = async (code: string) =>
  inCtx(async () => {
    const row = await kernel!.runtime("projects")!.data.selectFrom("projects.project").select("health").where("code", "=", code).executeTakeFirst()
    return row?.health ?? null
  })

const HINTS = ["enter open", "n new", "e edit", "h health", "/ filter", "a archived", "↑↓ select", "i capture", "g or 1-6 screens", "? help", "q quit"]

describe("Projects screen", () => {
  test("sorted by health then next milestone", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const t = await open()
    const frame = await t.frame()
    expect(lines(frame)[0]).toContain("ttybrain ·  2 Projects ▾")
    expect(frame).toContain("Projects · 4 active")
    const order = ["ERP", "CRM", "HRP", "IAM"].map((c) => indexOf(frame, ` ${c} `))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(lineWith(frame, " ERP ")).toContain("Vendor selected")
    expect(lineWith(frame, " ERP ")).toContain("-6d")
    expect(lineWith(frame, " CRM ")).toContain("26 Nov")
    expect(lineWith(frame, " HRP ")).toContain("220pd")
    const onHold = indexOf(frame, "On hold · 1")
    expect(onHold).toBeGreaterThan(order[3]!)
    expect(indexOf(frame, " BI2 ")).toBeGreaterThan(onHold)
    expect(frame).not.toContain("OLD")
    expect(frame).not.toContain("Archived")
    expect(lines(frame.trimEnd()).at(-1)).toContain("↑↓ select   enter open   n new   h health   / filter   i capture   ? help   e edit   a archived")
  })

  test("a shows archived", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const t = await open()
    t.input.pressKey("a")
    let frame = await t.frame()
    expect(frame).toContain("Projects · 4 active · archived shown")
    const archived = indexOf(frame, "Archived · 1")
    expect(archived).toBeGreaterThan(indexOf(frame, " BI2 "))
    expect(indexOf(frame, " OLD ")).toBeGreaterThan(archived)
    t.input.pressKey("a")
    frame = await t.frame()
    expect(frame).not.toContain("OLD")
    expect(frame).not.toContain("archived shown")
  })

  test("filter health:red", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const t = await open()
    t.input.pressKey("/")
    await t.input.typeText("health:red")
    t.input.pressEnter()
    let frame = await t.frame()
    expect(frame).toContain(" ERP ")
    for (const code of ["CRM", "HRP", "IAM", "BI2"]) expect(frame).not.toContain(` ${code} `)
    expect(frame).toContain("filter: status=active health:red")
    await escape(t)
    frame = await t.frame()
    expect(lines(frame)[0]).toContain("ttybrain ·  2 Projects ▾") // Esc cleared the filter; it did not go back
    for (const code of ["ERP", "CRM", "HRP", "IAM", "BI2"]) expect(frame).toContain(` ${code} `)
    expect(frame).not.toContain("health:red")
  })

  test("filter by text and status", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const t = await open()
    t.input.pressKey("/")
    await t.input.typeText("portal")
    t.input.pressEnter()
    let frame = await t.frame()
    expect(frame).toContain(" HRP ")
    for (const code of ["ERP", "CRM", "IAM", "BI2"]) expect(frame).not.toContain(` ${code} `)
    t.input.pressKey("/") // edits the applied filter
    expect(lineWith(await t.frame(), "/ ")).toContain("portal")
    await escape(t) // clears it
    t.input.pressKey("/")
    await t.input.typeText("status:on_hold")
    t.input.pressEnter()
    frame = await t.frame()
    expect(frame).toContain(" BI2 ")
    expect(frame).not.toContain(" HRP ")
  })

  test("n creates a project", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const t = await open()
    t.input.pressKey("n")
    expect(await t.frame()).toContain("New project")
    await t.input.typeText("NEW")
    t.input.pressTab()
    await t.input.typeText("New thing")
    t.input.pressKey("s", { ctrl: true })
    const frame = await t.frame()
    expect(frame).not.toContain("New project")
    expect(lineWith(frame, " NEW ")).toContain("New thing")
    expect(isSelected(await t.spans(), " NEW ")).toBe(true)
    expect(frame).toContain("Projects · 5 active")
    const row = await inCtx(() => kernel!.runtime("projects")!.data.selectFrom("project").select(["name", "status"]).where("code", "=", "NEW").executeTakeFirst())
    expect(row).toEqual({ name: "New thing", status: "active" })
  })

  test("n shows a validation error under the code field", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    const t = await open()
    t.input.pressKey("n")
    await t.frame()
    await t.input.typeText("x")
    t.input.pressTab()
    await t.input.typeText("Bad code")
    t.input.pressKey("s", { ctrl: true })
    const frame = await t.frame()
    expect(lines(frame)[indexOf(frame, "Code") + 1]).toContain('✗ invalid project code "x"')
  })

  test("a number field takes decimals only: 0x10 is an error, not effort 16", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    const t = await open()
    t.input.pressKey("n")
    await t.frame()
    await t.input.typeText("HEX")
    t.input.pressTab()
    await t.input.typeText("Hex effort")
    for (let i = 0; i < 5; i++) t.input.pressTab()
    await t.frame()
    await t.input.typeText("0x10")
    t.input.pressKey("s", { ctrl: true })
    const frame = await t.frame()
    expect(frame).toContain("New project")
    expect(lines(frame)[indexOf(frame, "Effort days") + 1]).toContain("✗")
    const row = await inCtx(() => kernel!.runtime("projects")!.data.selectFrom("project").select("effort_estimate_days").where("code", "=", "HEX").executeTakeFirst())
    expect(row).toBeUndefined()
  })

  test("e edits the selected project", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const t = await open()
    t.input.pressKey("e") // ERP is selected first
    let frame = await t.frame()
    expect(frame).toContain("Edit ERP")
    expect(lineWith(frame, "Name*")).toContain("Enterprise resources")
    await t.input.typeText(" 2")
    t.input.pressKey("s", { ctrl: true })
    frame = await t.frame()
    expect(lineWith(frame, " ERP ")).toContain("Enterprise resources 2")
  })

  test("h updates health", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const t = await open()
    t.input.pressKey("j") // ERP → CRM
    t.input.pressKey("h")
    let frame = await t.frame()
    expect(frame).toContain("Health update · CRM")
    expect(lineWith(frame, "Health*")).toContain("‹ amber ›")
    expect(lineWith(frame, "Date")).toContain("2026-11-13")
    t.input.pressArrow("right")
    t.input.pressTab()
    await t.input.typeText("Budget")
    t.input.pressKey("s", { ctrl: true })
    frame = await t.frame()
    expect(frame).not.toContain("Health update")
    expect(await health("CRM")).toBe("red")
    const spans = await t.spans()
    const row = spans.lines.find((l) => l.spans.map((s) => s.text).join("").includes(" CRM "))!
    const dot = row.spans.find((s) => s.text.includes("●"))!
    expect(rgbToHex(dot.fg).toLowerCase()).toBe(theme.red)
  })

  test("e and h do nothing while the filter shows no rows", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(() => write().addProject!({ code: "ERP", name: "Enterprise resources" }))
    const t = await open()
    t.input.pressKey("/")
    await t.input.typeText("zzz")
    t.input.pressEnter()
    expect(await t.frame()).toContain("No projects match the filter.")
    t.input.pressKey("e")
    let frame = await t.frame()
    expect(frame).not.toContain("Edit ERP")
    t.input.pressKey("h")
    frame = await t.frame()
    expect(frame).not.toContain("Health update")
    expect(frame).toContain("No projects match the filter.")
  })

  test("e and h do nothing once a reload removed every row", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(() => write().addProject!({ code: "ERP", name: "Enterprise resources" }))
    const t = await open()
    await inCtx(() => write().archiveProject!({ project: "ERP" }))
    await sleep(120) // live refresh
    expect(await t.frame()).not.toContain(" ERP ")
    t.input.pressKey("e")
    t.input.pressKey("h")
    const frame = await t.frame()
    expect(frame).not.toContain("Edit ERP")
    expect(frame).not.toContain("Health update")
  })

  test("an edit of the name sends only the name", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const ops = kernel.ops as any
    const call = ops.call.bind(ops)
    const edits: unknown[] = []
    ops.call = (plugin: string, name: string, kind: string, input: unknown) => {
      if (name === "editProject") edits.push(input)
      return call(plugin, name, kind, input)
    }
    const t = await open()
    t.input.pressKey("e") // ERP
    await t.frame()
    await t.input.typeText(" 2")
    t.input.pressKey("s", { ctrl: true })
    expect(lineWith(await t.frame(), " ERP ")).toContain("Enterprise resources 2")
    expect(edits).toEqual([{ project: "#ERP", name: "Enterprise resources 2" }])
    expect(await inCtx(() => kernel!.ops.describe("projects", "editProject", edits[0]))).toBe("~ ERP name")
  })

  test("a new project's selection is not taken back later", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const t = await open()
    t.input.pressKey("n")
    await t.frame()
    await t.input.typeText("NEW")
    t.input.pressTab()
    await t.input.typeText("New thing")
    t.input.pressKey("s", { ctrl: true })
    expect(isSelected(await t.spans(), " NEW ")).toBe(true)
    t.input.pressKey("k")
    let frame = await t.frame()
    expect(isSelected(await t.spans(), " NEW ")).toBe(false)
    t.input.pressKey("/")
    await t.input.typeText("health:red") // hides NEW
    t.input.pressEnter()
    await t.frame()
    await escape(t)
    frame = await t.frame()
    expect(isSelected(await t.spans(), " ERP ")).toBe(true) // the row the filter left stays selected
    expect(isSelected(await t.spans(), " NEW ")).toBe(false)
  })

  test("the status bar shows only whole hints at 80x24", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const t = await open({ width: 80, height: 24 })
    const status = lines((await t.frame()).trimEnd()).at(-1)!.trim()
    const shown = status.split(/\s{2,}/)
    expect(shown.length).toBeGreaterThan(2)
    for (const h of shown) expect(HINTS).toContain(h)
    expect(shown.slice(-2)).toEqual(["i capture", "? help"]) // the design's hints win over the kept ones when they do not fit
  })

  test("empty projects", async () => {
    const t = await open()
    expect(await t.frame()).toContain("No projects yet. Press n to add one.")
  })

  test("Projects renders at 80x24 with a long CJK name", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    const name = "顧客管理".repeat(7) + "刷新" // 30 CJK characters
    await inCtx(() => write().addProject!({ code: "CJK", name }))
    const t = await open({ width: 80, height: 24 })
    const frame = await t.frame()
    const line = lineWith(frame, " CJK ")
    expect(line).toContain("顧客管理")
    expect(line).toContain("…")
    expect(line).not.toContain(name)
    for (const l of lines(frame)) expect(displayWidth(l)).toBeLessThanOrEqual(80)
  })

  test("a 16-character code is shown whole at 80x24, and its row does not wrap", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(async () => {
      await write().addProject!({ code: "DATAPLATFORM2027", name: "Data platform", effortDays: 40 })
      await write().addMilestone!({ project: "DATAPLATFORM2027", title: "Ingest live", due: "2026-11-26" })
      await write().addProject!({ code: "CRM", name: "Customer platform" })
    })
    const t = await open({ width: 80, height: 24 })
    const frame = await t.frame()
    const long = lineWith(frame, "DATAPLATFORM2027")
    expect(long).toContain(" DATAPLATFORM2027 Data platform") // columns drop from the right, never the code or the name
    expect(frame).not.toContain("DATAPLATFORM20…")
    for (const l of lines(frame)) expect(displayWidth(l)).toBeLessThanOrEqual(80)
    // The column is as wide as the longest code: the names line up.
    expect(lineWith(frame, " CRM ").indexOf("Custome")).toBe(long.indexOf("Data pl"))
    expect(lineWith(frame, "Code").indexOf("Name")).toBe(long.indexOf("Data pl"))
  })

  test("count is the active, non-archived projects", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    const t = await open()
    t.input.pressKey("g")
    const frame = await t.frame()
    expect(lines(frame).find((l) => l.includes("2  Projects"))).toMatch(/2  Projects\s+4\b/)
  })
})
