// The Overview's seven panels (projects x5, people, inbox) against the built-in plugins seeded through their
// write operations. Today is Fri 2026-11-13.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { builtinPlugins } from "../../index"
import { theme } from "../../../kernel/tui/theme"
import { rgbToHex } from "@opentui/core"

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const write = (plugin = "projects") => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
// Table measures its grow column after the first layout: read the frame twice.
const shot = async (t: RenderedTui) => (await t.frame(), await t.frame())
const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""

async function open(seed?: () => Promise<void>): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  if (seed) await inCtx(seed)
  tui = await renderTui(kernel, { width: 140, height: 40 })
  return tui
}

describe("overview panels", () => {
  test("empty overview", async () => {
    const t = await open()
    const frame = await shot(t)
    for (const s of [
      "No overdue actions.",
      "Nothing due this week.",
      "No project needs attention.",
      "No late milestones and none in the next 14 days.",
      "No open high-severity risks or issues.",
      "No stakeholders to contact.",
      "Inbox is empty",
    ])
      expect(frame).toContain(s)
    expect(frame).toContain("Late milestones · next 14 days")
    expect(frame).toContain("last contact over 30 days, high influence first")
  })

  test("overdue panel", async () => {
    const t = await open(async () => {
      await write().addProject!({ code: "CRM", name: "Customer platform" })
      await write().addAction!({ title: "Send revised budget to Peter", due: "2026-11-10", project: "CRM" })
      await write().addAction!({ title: "Prepare deck", due: "2026-11-13", project: "CRM" })
    })
    const frame = await shot(t)
    const line = lineWith(frame, "Send revised budget")
    expect(line).toContain("A-1")
    expect(line).toContain("CRM")
    expect(line).toContain("-3d")
    expect(frame).toContain("Overdue actions · 1")
    expect(frame).toContain("Due this week · 1")
    expect(lineWith(frame, "Prepare deck")).toContain("today")
  })

  test("due this week shows the weekday and leaves out later actions", async () => {
    const t = await open(async () => {
      await write().addAction!({ title: "Sunday thing", due: "2026-11-15" })
      await write().addAction!({ title: "Next week thing", due: "2026-11-17" })
    })
    const frame = await shot(t)
    expect(lineWith(frame, "Sunday thing")).toContain("Sun")
    expect(frame).not.toContain("Next week thing")
  })

  test("attention panel", async () => {
    const t = await open(async () => {
      await write().addProject!({ code: "IAM", name: "Identity" })
      await write().addProject!({ code: "ERP", name: "ERP rollout" })
      await write().setHealth!({ project: "ERP", health: "red", comment: "Vendor B contract not signed", date: "2026-11-04" })
    })
    const frame = await shot(t)
    expect(lineWith(frame, "IAM")).toContain("Health not updated")
    expect(lineWith(frame, "IAM")).toContain("never")
    const erp = lineWith(frame, "ERP")
    expect(erp).toContain("Vendor B contract not signed")
    expect(erp).toContain("upd 9d ago")
    expect(frame.indexOf("ERP")).toBeLessThan(frame.indexOf("IAM"))
    const spans = await t.spans()
    const dotLine = spans.lines.find((l) => l.spans.some((s) => s.text.includes("●")))!
    expect(rgbToHex(dotLine.spans.find((s) => s.text.includes("●"))!.fg).toLowerCase()).toBe(theme.red)
  })

  test("milestones and risks panels", async () => {
    const t = await open(async () => {
      await write().addProject!({ code: "ERP", name: "ERP rollout" })
      await write().addMilestone!({ project: "ERP", title: "Vendor selected", due: "2026-11-07" })
      await write().addMilestone!({ project: "ERP", title: "Design approved", due: "2026-11-26" })
      await write().addMilestone!({ project: "ERP", title: "Far away", due: "2026-12-30" })
      await write().addRisk!({ project: "ERP", title: "Vendor B may miss go-live", type: "risk", severity: "high" })
      await write().addRisk!({ project: "ERP", title: "Minor thing", type: "risk", severity: "low" })
    })
    const frame = await shot(t)
    expect(lineWith(frame, "Vendor selected")).toContain("-6d")
    expect(lineWith(frame, "Design approved")).toContain("26 Nov")
    expect(frame.indexOf("Vendor selected")).toBeLessThan(frame.indexOf("Design approved"))
    expect(frame).not.toContain("Far away")
    const risk = lineWith(frame, "Vendor B may miss")
    expect(risk).toContain("R-1")
    expect(risk).toContain("ERP")
    expect(risk).toContain("risk")
    expect(frame).not.toContain("Minor thing")
  })

  test("stakeholders panel", async () => {
    const t = await open(async () => {
      await write("projects").addProject!({ code: "CRM", name: "Customer platform" })
      await write("people").addPerson!({ name: "Marie Dubois", handle: "marie", is_stakeholder: true, influence: "high", interest: "high" })
      await write("projects").addInvolvement!({ project: "CRM", person: "marie", role: "sponsor" })
      await write("people").addNote!({ person: "marie", kind: "interaction", text: "Coffee", date: "2026-10-03" })
    })
    const frame = await shot(t)
    const line = lineWith(frame, "Marie Dubois")
    expect(line).toContain("high/high · CRM")
    expect(line).toContain("41d")
  })

  test("inbox panel lists new items oldest first", async () => {
    const t = await open(async () => {
      await write("inbox").capture!({ text: "call the vendor" })
      await write("inbox").capture!({ text: "book the room" })
    })
    const frame = await shot(t)
    expect(frame).toContain("Inbox · 2")
    expect(lineWith(frame, "call the vendor")).toContain("I-1")
    expect(frame.indexOf("call the vendor")).toBeLessThan(frame.indexOf("book the room"))
  })

  test("Enter on overdue row opens the action form", async () => {
    const t = await open(async () => {
      await write().addAction!({ title: "Send revised budget", due: "2026-11-10" })
    })
    expect(await shot(t)).toContain("Send revised budget")
    t.input.pressEnter()
    const frame = await shot(t)
    expect(frame).toContain("Edit A-1")
  })
})
