// The person, note and goal record forms, opened through the overlay (as the people screen will), against the
// built-in plugins seeded through their write operations.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { defineTui, type TuiDef } from "../../../kernel/tui/api"
import { useOverlay, type Overlay } from "../../../kernel/tui/overlay"
import { builtinPlugins } from "../../index"
import { peopleTui } from "./index"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let overlay: Overlay | undefined
function Home() {
  overlay = useOverlay()
  return <text>home screen</text>
}
// The people part plus a test screen that captures the overlay.
const part: TuiDef = defineTui({
  plugin: "people",
  activate(ui) {
    peopleTui.activate(ui)
    ui.screen({ id: "home", title: "Home", slot: 2, component: Home })
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

const write = (plugin = "people") => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const rows = <T,>(table: string, cols: string[]) =>
  inCtx(async () => (await (kernel!.runtime("people")!.data as any).selectFrom(table).select(cols).orderBy("id").execute()) as T[])
const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""
const statusLine = (frame: string) => frame.trimEnd().split("\n").at(-1)!

async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}

async function open(seed?: () => Promise<void>): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await inCtx(async () => {
    await write("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
    await seed?.()
  })
  tui = await renderTui(kernel, { parts: [part], width: 100, height: 34 })
  tui.input.pressKey("2")
  expect(await tui.frame()).toContain("home screen")
  return tui
}

const peter = () => write().addPerson!({ name: "Peter Janssens", handle: "peter", is_stakeholder: true, influence: "high", interest: "low", job_title: "CFO" })
const PERSON_COLS = ["handle", "name", "is_team", "is_stakeholder", "influence", "interest", "job_title"]

describe("person form", () => {
  test("new person: handle made from name, type stakeholder, influence high", async () => {
    const t = await open()
    void overlay!.openForm("person", "person", {})
    expect(await t.frame()).toContain("New person")
    await t.input.typeText("Peter Janssens")
    t.input.pressTab() // handle: left empty
    t.input.pressTab() // type: stakeholder
    t.input.pressTab() // influence
    t.input.pressArrow("right") // none → low
    t.input.pressArrow("right") // low → high
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => statusLine(f).includes("added @peter"))
    expect(frame).not.toContain("New person")
    expect(await rows("person", PERSON_COLS)).toEqual([
      { handle: "peter", name: "Peter Janssens", is_team: 0, is_stakeholder: 1, influence: "high", interest: null, job_title: null },
    ])
  })

  test("edit person sends only the changed fields", async () => {
    const t = await open(async () => void (await peter()))
    const sent: unknown[] = []
    const ops = kernel!.ops as any
    const call = ops.call.bind(ops)
    ops.call = (plugin: string, name: string, kind: string, input: unknown) => {
      if (name === "editPerson") sent.push(input)
      return call(plugin, name, kind, input)
    }
    void overlay!.openForm("person", "person", { recordRef: "@peter" })
    let frame = await until(t, (f) => f.includes("Edit @peter"))
    expect(lineWith(frame, "Handle")).toContain("peter")
    for (let i = 0; i < 5; i++) t.input.pressTab() // name → job title
    await t.input.typeText(" Officer")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => statusLine(f).includes("saved @peter"))
    expect(sent).toEqual([{ ref: "@peter", job_title: "CFO Officer" }])
    expect(await rows("person", PERSON_COLS)).toEqual([
      { handle: "peter", name: "Peter Janssens", is_team: 0, is_stakeholder: 1, influence: "high", interest: "low", job_title: "CFO Officer" },
    ])
  })

  test("edit person with no change closes without a write", async () => {
    const t = await open(async () => void (await peter()))
    void overlay!.openForm("person", "person", { recordRef: "@peter" })
    await until(t, (f) => f.includes("Edit @peter"))
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => !f.includes("Edit @peter"))
    expect(statusLine(frame)).not.toContain("saved")
  })

  test("type change to team clears influence", async () => {
    const t = await open(async () => void (await peter()))
    void overlay!.openForm("person", "person", { recordRef: "@peter" })
    await until(t, (f) => f.includes("Edit @peter"))
    t.input.pressTab()
    t.input.pressTab() // type
    t.input.pressArrow("right") // stakeholder → team
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => statusLine(f).includes("saved @peter"))
    expect(await rows("person", PERSON_COLS)).toEqual([
      { handle: "peter", name: "Peter Janssens", is_team: 1, is_stakeholder: 0, influence: null, interest: null, job_title: "CFO" },
    ])
  })

  test("influence on a team member shows under the field", async () => {
    const t = await open()
    void overlay!.openForm("person", "person", {})
    await t.frame()
    await t.input.typeText("Tina Team")
    t.input.pressTab()
    t.input.pressTab() // type
    t.input.pressArrow("right") // team
    t.input.pressTab() // influence
    t.input.pressArrow("right")
    t.input.pressArrow("right") // high
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => f.includes("influence and interest are for stakeholders only"))
    const lines = frame.split("\n")
    const i = lines.findIndex((l) => l.includes("Influence"))
    expect(lines[i + 1]).toContain("influence and interest are for stakeholders only")
    expect(frame).toContain("New person")
    expect(await rows("person", PERSON_COLS)).toEqual([])
  })
})

describe("note form", () => {
  test("new note for a prefilled person defaults kind by type", async () => {
    const t = await open(async () => {
      await peter()
      await write().addPerson!({ name: "Tina Team", handle: "tina", is_team: true })
    })
    void overlay!.openForm("note", "note", { prefill: { person: "@tina" } })
    let frame = await until(t, (f) => f.includes("New note"))
    expect(frame).toContain("New note · @tina")
    expect(lineWith(frame, "Kind")).toContain("one_on_one")
    expect(frame).not.toContain("Person*")
    expect(lineWith(frame, "Date")).toContain("2026-11-13")
    t.input.pressKey("escape")
    await until(t, (f) => !f.includes("New note"))
    void overlay!.openForm("note", "note", { prefill: { person: "@peter" } })
    frame = await until(t, (f) => f.includes("New note · @peter"))
    expect(lineWith(frame, "Kind")).toContain("interaction")
    t.input.pressTab() // date
    t.input.pressTab() // project
    t.input.pressTab() // text
    await t.input.typeText("line one")
    t.input.pressEnter()
    await t.input.typeText("line two")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => statusLine(f).includes("added N-1"))
    expect(await rows("note", ["person_id", "kind", "date", "project_id", "text"])).toEqual([
      { person_id: 1, kind: "interaction", date: "2026-11-13", project_id: null, text: "line one\nline two" },
    ])
  })

  test("new note without a prefilled person asks for one", async () => {
    const t = await open(async () => void (await peter()))
    void overlay!.openForm("note", "note", {})
    const frame = await until(t, (f) => f.includes("New note"))
    expect(frame).toMatch(/Person\*/)
  })

  test("edit note clears its project", async () => {
    const t = await open(async () => {
      await peter()
      await write().addNote!({ person: "@peter", kind: "interaction", text: "Budget talk", project: "CRM" })
    })
    void overlay!.openForm("note", "note", { recordRef: "N-1" })
    let frame = await until(t, (f) => f.includes("Edit N-1"))
    expect(lineWith(frame, "Project")).toContain("#CRM")
    expect(frame).not.toMatch(/Person\*/)
    t.input.pressTab()
    t.input.pressTab() // project
    for (let i = 0; i < 4; i++) t.input.pressBackspace()
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => statusLine(f).includes("saved N-1"))
    expect(await rows("note", ["project_id", "text", "kind"])).toEqual([{ project_id: null, text: "Budget talk", kind: "interaction" }])
  })
})

describe("goal form", () => {
  test("new goal and edit goal", async () => {
    const t = await open(async () => void (await peter()))
    void overlay!.openForm("goal", "goal", { prefill: { person: "@peter" } })
    let frame = await until(t, (f) => f.includes("New goal · @peter"))
    expect(frame).not.toMatch(/Person\*/)
    await t.input.typeText("Sponsor the rollout")
    t.input.pressTab()
    await t.input.typeText("2026-12-01")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => statusLine(f).includes("added G-1"))
    expect(await rows("goal", ["title", "target_date", "notes", "status"])).toEqual([
      { title: "Sponsor the rollout", target_date: "2026-12-01", notes: null, status: "open" },
    ])
    void overlay!.openForm("goal", "goal", { recordRef: "G-1" })
    frame = await until(t, (f) => f.includes("Edit G-1"))
    t.input.pressTab() // target date
    for (let i = 0; i < 10; i++) t.input.pressBackspace()
    t.input.pressTab() // notes
    await t.input.typeText("Needs the CFO")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => statusLine(f).includes("saved G-1"))
    expect(await rows("goal", ["title", "target_date", "notes"])).toEqual([{ title: "Sponsor the rollout", target_date: null, notes: "Needs the CFO" }])
  })
})
