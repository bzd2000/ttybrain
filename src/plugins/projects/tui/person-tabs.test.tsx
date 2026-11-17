// The projects plugin's person tabs (Projects & roles, Actions) in the person record view, against the built-in
// plugins, seeded through the write ops.
import { rgbToHex } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { theme } from "../../../kernel/tui/api"
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
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const rows = <T = any,>(table: string, cols: string[]) =>
  inCtx(async () => (await (kernel!.runtime("projects")!.data as any).selectFrom(table).select(cols).orderBy("id").execute()) as T[])

const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))
const tabLine = (frame: string) => lineWith(frame, "Summary")

async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}

// Projects CRM, WEB and ERP (archived); stakeholder marie (sponsor of CRM, key user of ERP), anna (team and
// stakeholder, architect on CRM) and bob (team). Marie's actions: A-1 for her, overdue; A-2 hers on CRM, due
// 20 Nov; A-3 hers, no date; A-4 for her, done 1 Nov; A-5 hers, done 12 Nov. A-6 is bob's.
async function seed() {
  await inCtx(async () => {
    const people = write("people")
    const w = write()
    await w.addProject!({ code: "CRM", name: "CRM replatforming" })
    await w.addProject!({ code: "WEB", name: "Website relaunch" })
    await w.addProject!({ code: "ERP", name: "ERP upgrade" })
    await people.addPerson!({ name: "Marie Dubois", handle: "marie", is_stakeholder: true })
    await people.addPerson!({ name: "Anna Smit", handle: "anna", is_team: true, is_stakeholder: true })
    await people.addPerson!({ name: "Bob Maes", handle: "bob", is_team: true })
    await w.addInvolvement!({ project: "ERP", person: "@marie", role: "key user" })
    await w.addInvolvement!({ project: "CRM", person: "@marie", role: "sponsor" })
    await w.addInvolvement!({ project: "CRM", person: "@anna", role: "architect" })
    await w.archiveProject!({ project: "ERP" })
    await w.addAction!({ title: "Send revised budget", due: "2026-11-10", forPerson: "@marie" })
    await w.addAction!({ title: "Review contract", due: "2026-11-20", owner: "@marie", project: "CRM" })
    await w.addAction!({ title: "Collect quotes", owner: "@marie" })
    await w.addAction!({ title: "Sign off scope", forPerson: "@marie" })
    await w.completeAction!({ ref: "A-4", date: "2026-11-01" })
    await w.addAction!({ title: "Book workshop", owner: "@marie", forPerson: "@marie" })
    await w.completeAction!({ ref: "A-5", date: "2026-11-12" })
    await w.addAction!({ title: "Bob's own", owner: "@bob" })
  })
}

// Opens `ref` and moves `tabs` tabs right.
async function open(ref: string, tabs = 0): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await seed()
  tui = await renderTui(kernel, { width: 120, height: 32 })
  await tui.nav.open(ref)
  await until(tui, (f) => f.includes(`› ${ref}`) && tabLine(f).includes("Actions"))
  for (let i = 0; i < tabs; i++) tui.input.pressArrow("right")
  await tui.frame()
  return tui
}

describe("projects' person tabs", () => {
  test("Projects & roles lists involvements; n adds one; Del removes it", async () => {
    // Marie: Summary, Notes, Projects & roles (no Goals: not a team member).
    const t = await open("@marie", 2)
    let frame = await until(t, (f) => f.includes("CRM replatforming"))
    expect(tabLine(frame)).toContain("Projects & roles 2")
    expect(lineWith(frame, "Status")).toMatch(/Project\s+Name\s+Role\s+Status/)
    expect(lineWith(frame, "CRM replatforming")).toMatch(/CRM\s+CRM replatforming\s+sponsor\s+active/)
    expect(lineWith(frame, "ERP upgrade")).toMatch(/ERP\s+ERP upgrade\s+key user\s+active/)
    expect(indexOf(frame, "CRM replatforming")).toBeLessThan(indexOf(frame, "ERP upgrade"))
    // The archived project's row is muted.
    const spans = await t.spans()
    const erp = spans.lines.find((l) => l.spans.map((s) => s.text).join("").includes("ERP upgrade"))!
    expect(rgbToHex(erp.spans.find((s) => s.text.includes("ERP upgrade"))!.fg).toLowerCase()).toBe(theme.muted)
    const crm = spans.lines.find((l) => l.spans.map((s) => s.text).join("").includes("CRM replatforming"))!
    expect(rgbToHex(crm.spans.find((s) => s.text.includes("CRM replatforming"))!.fg).toLowerCase()).not.toBe(theme.muted)
    expect(lines(frame.trimEnd()).at(-1)).toContain("n add  Del remove")

    // n: the involvement form with the person prefilled; it asks for the project.
    t.input.pressKey("n")
    frame = await until(t, (f) => f.includes("Add involvement"))
    expect(lineWith(frame, "Person")).toContain("@marie")
    await t.input.typeText("WE")
    await until(t, (f) => f.includes("#WEB"))
    t.input.pressTab() // accepts #WEB
    await t.frame()
    t.input.pressTab() // person (prefilled)
    t.input.pressTab() // role
    await t.input.typeText("advisor")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => f.includes("Website relaunch") && !f.includes("Add involvement"))
    expect(lineWith(frame, "Website relaunch")).toMatch(/WEB\s+Website relaunch\s+advisor\s+active/)
    expect(indexOf(frame, "ERP upgrade")).toBeLessThan(indexOf(frame, "Website relaunch"))
    expect((await rows("involvement", ["role"])).map((r) => r.role)).toEqual(["key user", "sponsor", "architect", "advisor"])
    expect(tabLine(frame)).toContain("Projects & roles 3")

    // Del on the first row (CRM sponsor): n keeps it, y removes it.
    expect(lineWith(frame, "CRM replatforming")).toContain("›")
    t.input.pressKey("DELETE")
    frame = await until(t, (f) => f.includes("Remove @marie"))
    expect(frame).toContain("Remove @marie as sponsor from CRM?")
    t.input.pressKey("n")
    await until(t, (f) => !f.includes("Remove @marie"))
    expect((await rows("involvement", ["role"])).length).toBe(4)
    t.input.pressKey("DELETE")
    await until(t, (f) => f.includes("Remove @marie as sponsor from CRM?"))
    t.input.pressKey("y")
    frame = await until(t, (f) => !f.includes("CRM replatforming"))
    expect((await rows("involvement", ["role"])).map((r) => r.role)).toEqual(["key user", "architect", "advisor"])
    expect(tabLine(frame)).toContain("Projects & roles 2")

    // Enter opens the selected project.
    expect(lineWith(frame, "ERP upgrade")).toContain("›")
    t.input.pressEnter()
    await until(t, () => t.nav.route().kind === "record")
    frame = await until(t, (f) => f.includes("› ERP"))
    expect(t.nav.route()).toMatchObject({ kind: "record", ref: "#ERP" })
  })

  test("Projects & roles empty text", async () => {
    const t = await open("@bob", 3)
    const frame = await until(t, (f) => f.includes("No projects yet"))
    expect(frame).toContain("No projects yet. Press n to add one.")
  })

  test("Actions lists owned and for, open first; x completes; n prefills for", async () => {
    const t = await open("@marie", 3)
    let frame = await until(t, (f) => f.includes("Send revised budget"))
    expect(tabLine(frame)).toContain("Actions 3")
    expect(lineWith(frame, "Ref")).toMatch(/Ref\s+Action\s+Proj\.\s+As\s+Due/)
    expect(frame).not.toContain("Bob's own")
    const order = ["A-1", "A-2", "A-3", "A-5", "A-4"].map((r) => indexOf(frame, `${r} `))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(lineWith(frame, "A-1 ")).toMatch(/A-1\s+Send revised budget\s+for\s+-3d/)
    expect(lineWith(frame, "A-2 ")).toMatch(/A-2\s+Review contract\s+CRM\s+owner\s+20 Nov/)
    expect(lineWith(frame, "A-3 ")).toMatch(/A-3\s+Collect quotes\s+owner\s+—/)
    expect(lineWith(frame, "A-5 ")).toMatch(/A-5\s+Book workshop\s+owner/) // owner and for: owner
    expect(lineWith(frame, "A-4 ")).toMatch(/A-4\s+Sign off scope\s+for/)
    const spans = await t.spans()
    const a1 = spans.lines.find((l) => l.spans.map((s) => s.text).join("").includes("Send revised budget"))!
    expect(rgbToHex(a1.spans.find((s) => s.text.includes("-3d"))!.fg).toLowerCase()).toBe(theme.red)
    expect(lines(frame.trimEnd()).at(-1)).toContain("n add  e edit  x done")

    // x on A-1: done today, so it moves first among the closed ones.
    expect(lineWith(frame, "A-1 ")).toContain("›")
    t.input.pressKey("x")
    frame = await until(t, (f) => tabLine(f).includes("Actions 2"))
    expect((await rows("action", ["status", "done_date"]))[0]).toEqual({ status: "done", done_date: "2026-11-13" })
    const after = ["A-2", "A-3", "A-1", "A-5", "A-4"].map((r) => indexOf(frame, `${r} `))
    expect(after).toEqual([...after].sort((a, b) => a - b))

    // Enter opens the action's project (A-2 is on CRM); an action without one stays.
    t.input.pressKey("k") // A-1 → A-3
    t.input.pressKey("k") // → A-2
    frame = await until(t, (f) => lineWith(f, "A-2 ").includes("›"))
    t.input.pressEnter()
    await until(t, () => t.nav.route().kind === "record" && (t.nav.route() as { ref: string }).ref === "#CRM")
    expect(t.nav.route()).toMatchObject({ kind: "record", ref: "#CRM" })
    t.input.pressEscape()
    await until(t, () => (t.nav.route() as { ref?: string }).ref === "@marie")
    for (let i = 0; i < 3; i++) t.input.pressArrow("right") // the record view opens on Summary again
    frame = await until(t, (f) => f.includes("Review contract") && f.includes("Actions ·"))

    // e edits the selected action.
    t.input.pressKey("e")
    frame = await until(t, (f) => f.includes("Edit A-2"))
    t.input.pressEscape()
    await until(t, (f) => !f.includes("Edit A-2"))

    // n: a stakeholder's new action is for them.
    t.input.pressKey("n")
    frame = await until(t, (f) => f.includes("New action"))
    expect(lineWith(frame, "For")).toContain("@marie")
    expect(lineWith(frame, "Owner")).not.toContain("@marie")
  })

  test("Actions: n prefills the owner for a team member; empty text", async () => {
    const t = await open("@bob", 4)
    let frame = await until(t, (f) => f.includes("Bob's own"))
    t.input.pressKey("n")
    frame = await until(t, (f) => f.includes("New action"))
    expect(lineWith(frame, "Owner")).toContain("@bob")
    expect(lineWith(frame, "For")).not.toContain("@bob")
    t.input.pressEscape()
    await until(t, (f) => !f.includes("New action"))

    await inCtx(() => write().deleteAction!({ ref: "A-6" }))
    frame = await until(t, (f) => f.includes("No actions yet"))
    expect(frame).toContain("No actions yet. Press n to add one.")
  })

  test("tab order on a team member who is also a stakeholder", async () => {
    const t = await open("@anna")
    const frame = await until(t, (f) => tabLine(f).includes("Projects & roles 1"))
    expect(tabLine(frame)).toMatch(/Summary\s+Notes( \d+)?\s+Goals( \d+)?\s+Projects & roles 1\s+Actions( \d+)?\s*$/)
  })
})
