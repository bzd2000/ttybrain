// The projects plugin's person tabs (Projects & roles, Actions) in the person record view, against the built-in
// plugins, seeded through the write ops.
import { rgbToHex } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { theme } from "../../../kernel/tui/api"
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
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const rows = <T = any,>(table: string, cols: string[]) =>
  inCtx(async () => (await (kernel!.runtime(table === "action" ? "actions" : "projects")!.data as any).selectFrom(table).select(cols).orderBy("id").execute()) as T[])

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
    await write("actions").addAction!({ title: "Send revised budget", due: "2026-11-10", forPerson: "@marie" })
    await write("actions").addAction!({ title: "Review contract", due: "2026-11-20", owner: "@marie", project: "CRM" })
    await write("actions").addAction!({ title: "Collect quotes", owner: "@marie" })
    await write("actions").addAction!({ title: "Sign off scope", forPerson: "@marie" })
    await write("actions").completeAction!({ ref: "A-4", date: "2026-11-01" })
    await write("actions").addAction!({ title: "Book workshop", owner: "@marie", forPerson: "@marie" })
    await write("actions").completeAction!({ ref: "A-5", date: "2026-11-12" })
    await write("actions").addAction!({ title: "Bob's own", owner: "@bob" })
  })
}

// Opens `ref` and moves `tabs` tabs right, past the meetings plugin's Talk and Meetings (after Summary).
async function open(ref: string, tabs = 0): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await seed()
  tui = await renderTui(kernel, { width: 120, height: 32 })
  await tui.nav.open(ref)
  await until(tui, (f) => tabLine(f).includes("Actions"))
  for (let i = 0; i < (tabs > 0 ? tabs + 2 : 0); i++) tui.input.pressArrow("right")
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
    expect(lines(frame.trimEnd()).at(-1)).toContain("n add   del remove")

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
    expect(isSelected(await t.spans(), "CRM replatforming")).toBe(true)
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
    expect(isSelected(await t.spans(), "ERP upgrade")).toBe(true)
    t.input.pressEnter()
    await until(t, () => t.nav.route().kind === "record")
    frame = await until(t, (f) => f.includes("› ERP"))
    expect(t.nav.route()).toMatchObject({ kind: "record", ref: "#ERP" })
  })

  test("a 16-character code is shown whole in Projects & roles and Actions", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(async () => {
      await write("people").addPerson!({ name: "Marie Dubois", handle: "marie", is_stakeholder: true })
      await write().addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
      await write().addInvolvement!({ project: "DATAPLATFORM2027", person: "@marie", role: "sponsor" })
      await write("actions").addAction!({ title: "Review contract", owner: "@marie", project: "DATAPLATFORM2027" })
    })
    tui = await renderTui(kernel, { width: 80, height: 24 })
    await tui.nav.open("@marie")
    await until(tui, (f) => tabLine(f).includes("Actions"))
    for (let i = 0; i < 4; i++) tui.input.pressArrow("right") // past Talk, Meetings and Notes
    let frame = await until(tui, (f) => f.includes("Data platform"))
    expect(lineWith(frame, "Data platform")).toMatch(/DATAPLATFORM2027 Data platform\s+sponsor\s+active/)
    tui.input.pressArrow("right")
    frame = await until(tui, (f) => f.includes("Review contract"))
    // At 80 columns a person's tab lets Linked to go and keeps Owner (owned or linked must stay visible).
    expect(lineWith(frame, "Review contract")).toMatch(/A-1\s+Review contract\s+Marie\s+—/)
    expect(frame).not.toContain("Linked to")
    for (const l of lines(frame)) expect(l.length).toBeLessThanOrEqual(80)
  })

  test("Projects & roles empty text", async () => {
    const t = await open("@bob", 3)
    const frame = await until(t, (f) => f.includes("No projects yet"))
    expect(frame).toContain("No projects yet. Press n to add one.")
  })

  test("Actions lists owned and linked, open first; x completes; n links a stakeholder", async () => {
    const t = await open("@marie", 3)
    let frame = await until(t, (f) => f.includes("Send revised budget") && f.includes("Linked to"))
    expect(tabLine(frame)).toContain("Actions 3")
    expect(lineWith(frame, "Linked to")).toMatch(/ID\s+Action\s+Owner\s+Linked to\s+Due/)
    expect(frame).not.toContain("Bob's own")
    const order = ["A-1", "A-2", "A-3", "A-5", "A-4"].map((r) => indexOf(frame, `${r} `))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // Marie herself is left out of Linked to; closed actions say what became of them.
    expect(lineWith(frame, "A-1 ")).toMatch(/A-1\s+Send revised budget\s+@me\s+—\s+10 Nov/)
    expect(lineWith(frame, "A-2 ")).toMatch(/A-2\s+Review contract\s+Marie\s+CRM\s+20 Nov/)
    expect(lineWith(frame, "A-3 ")).toMatch(/A-3\s+Collect quotes\s+Marie\s+—\s+—/)
    expect(lineWith(frame, "A-5 ")).toMatch(/A-5\s+Book workshop\s+Marie\s+—\s+done/)
    expect(lineWith(frame, "A-4 ")).toMatch(/A-4\s+Sign off scope\s+@me\s+—\s+done/)
    const spans = await t.spans()
    const a1 = spans.lines.find((l) => l.spans.map((s) => s.text).join("").includes("Send revised budget"))!
    expect(rgbToHex(a1.spans.find((s) => s.text.includes("10 Nov"))!.fg).toLowerCase()).toBe(theme.red)
    expect(lines(frame.trimEnd()).at(-1)).toContain("n add   e edit   x done   d due   l links   del delete")

    // x on A-1: done today, so it moves first among the closed ones.
    expect(isSelected(await t.spans(), "A-1 ")).toBe(true)
    t.input.pressKey("x")
    frame = await until(t, (f) => tabLine(f).includes("Actions 2"))
    expect((await rows("action", ["status", "done_date"]))[0]).toEqual({ status: "done", done_date: "2026-11-13" })
    const after = ["A-2", "A-3", "A-1", "A-5", "A-4"].map((r) => indexOf(frame, `${r} `))
    expect(after).toEqual([...after].sort((a, b) => a - b))

    // Enter opens the selected action (its form), as on the Actions screen.
    t.input.pressKey("k") // A-1 → A-3
    t.input.pressKey("k") // → A-2
    for (let i = 0; i < 80 && !isSelected(await t.spans(), "A-2 "); i++) await sleep(25)
    expect(isSelected(await t.spans(), "A-2 ")).toBe(true)
    t.input.pressEnter()
    frame = await until(t, (f) => f.includes("Edit A-2"))
    expect(lineWith(frame, "Links")).toContain("#CRM")
    t.input.pressEscape()
    await until(t, (f) => !f.includes("Edit A-2"))

    // e edits the selected action.
    t.input.pressKey("e")
    frame = await until(t, (f) => f.includes("Edit A-2"))
    t.input.pressEscape()
    await until(t, (f) => !f.includes("Edit A-2"))

    // n: a stakeholder's new action is linked to them.
    t.input.pressKey("n")
    frame = await until(t, (f) => f.includes("New action"))
    expect(lineWith(frame, "Links")).toContain("@marie")
    expect(lineWith(frame, "Owner (empty")).not.toContain("@marie")
  })

  test("Actions: n prefills the owner for a team member; empty text", async () => {
    const t = await open("@bob", 4)
    let frame = await until(t, (f) => f.includes("Bob's own"))
    t.input.pressKey("n")
    frame = await until(t, (f) => f.includes("New action"))
    expect(lineWith(frame, "Owner (empty")).toContain("@bob")
    expect(lineWith(frame, "Links")).not.toContain("@bob")
    t.input.pressEscape()
    await until(t, (f) => !f.includes("New action"))

    await inCtx(() => write("actions").deleteAction!({ ref: "A-6" }))
    frame = await until(t, (f) => f.includes("No actions yet"))
    expect(frame).toContain("No actions yet. Press n to add one.")
  })

  test("tab order on a team member who is also a stakeholder", async () => {
    const t = await open("@anna")
    const frame = await until(t, (f) => tabLine(f).includes("Projects & roles 1"))
    expect(tabLine(frame)).toMatch(/Summary\s+Talk \d+\s+Meetings\s+Notes( \d+)?\s+Goals( \d+)?\s+Projects & roles 1\s+Actions( \d+)?\s*$/)
  })
})
