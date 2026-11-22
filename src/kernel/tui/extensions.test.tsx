// The `listColumn` and `field` extension points in the TUI, proven with the `budget` fixture plugin: its column in
// the Projects table, its field in the project Summary (<RecordFields>) and in the project form (saved through its
// own set operation, in the same act as the project's own edit), and a fieldEditor overriding the default editor.
import { afterEach, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { budget, budgetTui } from "../../../tests/fixtures/tui-fixture"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { builtinPlugins, builtinTuiParts } from "../../../tests/builtins"
import { runWithContext } from "../context"
import { act, defineTui, Form, type FieldEditorProps, type TuiDef } from "./api"

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const ops = (plugin: string) => kernel!.runtime(plugin)!.self() as { read: Record<string, (i: any) => Promise<any>>; write: Record<string, (i: any) => Promise<any>> }
const getBudget = (ref: string) => inCtx(async () => (await ops("budget").read.getBudget!({ ref })).value)
const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""
// The form's Budget line (the table's header behind the form also says Budget, after Effort).
const budgetLine = (frame: string) => frame.split("\n").find((l) => /[ ›] Budget /.test(l) && !l.includes("Effort")) ?? ""

// CRM with a budget of 12000, ERP without one.
async function boot(external: TuiDef[] = [budgetTui]): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: [...builtinPlugins, budget()] })
  await inCtx(async () => {
    await ops("projects").write.addProject!({ code: "CRM", name: "Customer platform" })
    await ops("projects").write.addProject!({ code: "ERP", name: "Enterprise resources" })
    await ops("budget").write.setBudget!({ ref: "#CRM", value: 12000 })
  })
  tui = await renderTui(kernel, { width: 120, height: 32, parts: builtinTuiParts, external })
  return tui
}

async function projects(t: RenderedTui): Promise<string> {
  t.input.pressKey("2")
  return t.frame()
}

const projectName = async () =>
  (await inCtx(() => kernel!.runtime("projects")!.data.selectFrom("projects.project").select(["name"]).where("code", "=", "CRM").execute()))[0]?.name

// A record form that knows nothing of extra fields: it passes recordType and runs only its own operation in an act
// (renaming CRM through projects' editProject). `b` opens it.
const renameTui = defineTui({
  plugin: "budget",
  activate(ui) {
    budgetTui.activate(ui)
    ui.globalAction({
      id: "rename",
      key: "b",
      label: "rename CRM",
      overlay: (props) => (
        <Form
          title="Rename CRM"
          fields={[{ name: "name", label: "Name", kind: "text", initial: "Customer platform" }]}
          recordType="project"
          recordRef="#CRM"
          submit={async (v) => {
            const r = await act(() => ui.use("projects")!.write.editProject!({ project: "#CRM", name: v.name ?? "" }))
            return r.ok ? { ok: true, ref: (r.value as { ref: string }).ref } : r
          }}
          close={() => props.close()}
        />
      ),
    })
  },
})

async function until(t: RenderedTui, ok: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 40 && !ok(frame); i++) {
    await new Promise((r) => setTimeout(r, 25))
    frame = await t.frame()
  }
  return frame
}

describe("listColumn and field extension points", () => {
  test("projects table shows the extra column", async () => {
    const t = await boot()
    await projects(t)
    const frame = await until(t, (f) => lineWith(f, " CRM ").includes("12000"))
    expect(lineWith(frame, " Code ")).toContain("Budget")
    expect(lineWith(frame, " CRM ")).toContain("12000")
    expect(lineWith(frame, " ERP ")).not.toContain("12000")
  })

  test("actions table takes columns registered for the actions list", async () => {
    const owner = defineTui({
      plugin: "budget",
      activate(ui) {
        ui.listColumn("actions", { id: "flag", title: "Flag", width: 5, value: async (ref) => `F${ref}` })
      },
    })
    const t = await boot([owner])
    await inCtx(() => ops("actions").write.addAction!({ title: "Call vendor", project: "CRM" }))
    t.input.pressKey("4")
    const frame = await until(t, (f) => f.includes("FA-1"))
    expect(lineWith(frame, "Call vendor")).toContain("FA-1")
  })

  test("overview shows extra field, its value lined up with the facts (labelWidth)", async () => {
    const t = await boot()
    await projects(t)
    await t.nav.open("#CRM")
    const frame = await until(t, (f) => f.includes("12000"))
    expect(lineWith(frame, "Budget")).toContain("Budget          12000")
    expect(lineWith(frame, "Budget").indexOf("12000")).toBe(lineWith(frame, "Status").indexOf("active"))
  })

  test("project form edits extra field", async () => {
    const t = await boot()
    await projects(t)
    t.input.pressKey("e") // CRM is selected first (by code: no health set)
    let frame = await until(t, (f) => f.includes("Edit CRM") && budgetLine(f) !== "")
    expect(frame).toContain("Edit CRM")
    expect(budgetLine(frame)).toContain("12000")
    for (let i = 0; i < 8; i++) t.input.pressTab() // past the project's own fields to Budget
    frame = await t.frame()
    expect(budgetLine(frame)).toContain("›")
    for (let i = 0; i < 5; i++) t.input.pressBackspace()
    await t.input.typeText("15000")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("Edit CRM"))
    expect(await getBudget("#CRM")).toBe(15000)
    // Only the budget changed: the project's own edit was not sent.
    const rows = await inCtx(() => kernel!.runtime("projects")!.data.selectFrom("projects.project").select(["name"]).where("code", "=", "CRM").execute())
    expect(rows).toEqual([{ name: "Customer platform" }])
  })

  test("a new project saves its extra field in the same act", async () => {
    const t = await boot()
    await projects(t)
    t.input.pressKey("n")
    await until(t, (f) => f.includes("New project") && budgetLine(f) !== "")
    await t.input.typeText("NEW")
    t.input.pressTab()
    await t.input.typeText("New thing")
    for (let i = 0; i < 7; i++) t.input.pressTab()
    await t.input.typeText("500")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("New project"))
    expect(await getBudget("#NEW")).toBe(500)
  })

  test("a failing extra field rolls back the project's own edit", async () => {
    const t = await boot()
    await projects(t)
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Edit CRM") && budgetLine(f) !== "")
    await t.input.typeText(" 2") // Name has focus
    for (let i = 0; i < 8; i++) t.input.pressTab()
    await t.input.typeText("x") // 12000x: no number
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => f.includes("✗"))
    expect(frame).toContain("Edit CRM")
    expect(lineWith(frame, "Name*")).toContain("Customer platform 2")
    expect(lineWith(frame, "✗")).toContain("value must be number") // under the Budget field
    const rows = await inCtx(() => kernel!.runtime("projects")!.data.selectFrom("projects.project").select(["name"]).where("code", "=", "CRM").execute())
    expect(rows).toEqual([{ name: "Customer platform" }])
    expect(await getBudget("#CRM")).toBe(12000)
  })

  test("a fieldEditor overrides the default editor of its field", async () => {
    let change: ((v: string | null) => void) | undefined
    function Capture(props: FieldEditorProps) {
      change = (v) => props.onChange(v)
      return <text>{`[budget editor ${props.value ?? "none"}${props.focused ? " *" : ""}]`}</text>
    }
    const part = defineTui({
      plugin: "budget",
      activate(ui) {
        budgetTui.activate(ui)
        ui.fieldEditor("project", "budget", Capture)
      },
    })
    const t = await boot([part])
    await projects(t)
    t.input.pressKey("e")
    let frame = await until(t, (f) => f.includes("[budget editor"))
    expect(frame).toContain("[budget editor 12000]")
    for (let i = 0; i < 8; i++) t.input.pressTab()
    frame = await t.frame()
    expect(frame).toContain("[budget editor 12000 *]")
    change!("20000")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("Edit CRM"))
    expect(await getBudget("#CRM")).toBe(20000)
  })

  test("a form that only runs its own operation still saves its extra fields, in the same act", async () => {
    const t = await boot([renameTui])
    await projects(t)
    t.input.pressKey("b")
    await until(t, (f) => f.includes("Rename CRM") && budgetLine(f).includes("12000"))
    await t.input.typeText(" 2")
    t.input.pressTab()
    for (let i = 0; i < 5; i++) t.input.pressBackspace()
    await t.input.typeText("900")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("Rename CRM"))
    expect(await getBudget("#CRM")).toBe(900)
    expect(await projectName()).toBe("Customer platform 2")
  })

  test("a cancelled form leaves no extra fields for a later act", async () => {
    const t = await boot([renameTui])
    await projects(t)
    t.input.pressKey("b")
    await until(t, (f) => f.includes("Rename CRM") && budgetLine(f).includes("12000"))
    t.input.pressTab()
    await t.input.typeText("5")
    t.input.pressEscape()
    await new Promise((r) => setTimeout(r, 30))
    t.input.pressKey("x") // confirms the cancel
    await until(t, (f) => !f.includes("Rename CRM"))
    // A later act outside any form, and a project form saved without a budget change.
    const r = await act(() => ops("projects").write.setHealth!({ project: "CRM", health: "green" }))
    expect(r.ok).toBe(true)
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Edit CRM") && budgetLine(f).includes("12000"))
    await t.input.typeText(" 3")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("Edit CRM"))
    expect(await projectName()).toBe("Customer platform 3")
    expect(await getBudget("#CRM")).toBe(12000)
  })

  test("a form's draft holds its extra fields too, and restores them", async () => {
    const t = await boot()
    await projects(t)
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Edit CRM") && budgetLine(f).includes("12000"))
    for (let i = 0; i < 8; i++) t.input.pressTab()
    for (let i = 0; i < 5; i++) t.input.pressBackspace()
    await t.input.typeText("15000")
    t.input.pressEscape()
    await new Promise((r) => setTimeout(r, 30))
    t.input.pressKey("z") // confirms the cancel
    let frame = await until(t, (f) => !f.includes("Edit CRM"))
    expect(frame.trimEnd().split("\n").at(-1)).toContain("draft kept")
    const dir = join(kernel!.home, "drafts")
    const files = readdirSync(dir)
    expect(files.map(decodeURIComponent)).toEqual(["projects:project:#CRM.json"])
    const values = JSON.parse(readFileSync(join(dir, files[0]!), "utf8")).values
    expect(values["budget:budget"]).toBe("15000")
    expect(values.name).toBe("Customer platform")

    t.input.pressKey("e")
    frame = await until(t, (f) => f.includes("Unsaved draft"))
    expect(budgetLine(frame)).toContain("12000")
    t.input.pressKey("r")
    frame = await until(t, (f) => budgetLine(f).includes("15000"))
    expect(budgetLine(frame)).toContain("15000")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("Edit CRM"))
    expect(await getBudget("#CRM")).toBe(15000)
    expect(readdirSync(dir)).toEqual([])
  })

  test("a blank number clears the extra field", async () => {
    const t = await boot()
    await projects(t)
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Edit CRM") && budgetLine(f).includes("12000"))
    for (let i = 0; i < 8; i++) t.input.pressTab()
    for (let i = 0; i < 5; i++) t.input.pressBackspace()
    await t.input.typeText("  ")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("Edit CRM"))
    expect(await getBudget("#CRM")).toBeNull()
  })

  test("a non-decimal number is refused under the field", async () => {
    const t = await boot()
    await projects(t)
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Edit CRM") && budgetLine(f).includes("12000"))
    for (let i = 0; i < 8; i++) t.input.pressTab()
    for (let i = 0; i < 5; i++) t.input.pressBackspace()
    await t.input.typeText("0x10")
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => f.includes("✗"))
    expect(frame).toContain("Edit CRM")
    expect(lineWith(frame, "✗")).toContain("value must be number")
    expect(await getBudget("#CRM")).toBe(12000)
  })
})
