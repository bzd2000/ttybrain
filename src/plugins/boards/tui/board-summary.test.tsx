// The board view's Summary tab (the boards plugin's tui part): the board's facts, `e` the board form (Code, Name,
// Note) and `A` archive / restore after a confirmation, writing only through the board operations. Seeded through
// the write ops; opened with nav.open("#MB").
import { afterEach, describe, expect, test } from "bun:test"
import { builtinPlugins } from "../../../../tests/builtins"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { setMessageTimeout } from "../../../kernel/tui/messages"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  setMessageTimeout()
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const write = () => kernel!.runtime("boards")!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const boards = () => inCtx(async () => (await kernel!.runtime("boards")!.data.selectFrom("board").select(["code", "name", "note", "archived_at"]).orderBy("id").execute()) as any[])
const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""

async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 100 && !check(frame); i++) {
    await sleep(20)
    frame = await t.frame()
  }
  return frame
}

async function open(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await inCtx(() => write().addBoard!({ code: "MB", name: "Management board", note: "Monthly, with the directors" }))
  tui = await renderTui(kernel, { width: 110, height: 30 })
  await tui.nav.open("#MB")
  await until(tui, (f) => f.includes("Monthly, with the directors"))
  return tui
}

describe("board view · Summary", () => {
  test("opens first: its facts, then the meetings plugin's Meetings and Talk tabs", async () => {
    const t = await open()
    const frame = await t.frame()
    expect(frame).toContain("  Summary   Meetings   Talk")
    expect(lineWith(frame, "Code")).toMatch(/│ Code {12}MB +│/)
    expect(lineWith(frame, "Note")).toMatch(/│ Note {12}Monthly, with the directors +│/)
    expect(lineWith(frame, "Status")).toMatch(/│ Status {10}active +│/)
  })

  test("e opens the board form; a new note and name are saved through editBoard", async () => {
    const t = await open()
    t.input.pressKey("e")
    let frame = await until(t, (f) => f.includes("Edit MB"))
    expect(frame).toMatch(/╭─ Edit MB ─+╮/)
    for (const label of ["Code", "Name", "Note"]) expect(frame).toMatch(new RegExp(`│ +${label} +`))
    expect(frame).toContain("tab field   ctrl+s save   esc cancel")
    await t.input.typeText(" (MB)") // the focus starts on the name
    t.input.pressTab()
    for (let i = 0; i < "Monthly, with the directors".length; i++) t.input.pressBackspace()
    await t.input.typeText("Quarterly")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => f.includes("Quarterly") && !f.includes("Edit MB"))
    expect(lineWith(frame, "Note")).toMatch(/Note {12}Quarterly/)
    expect(frame).toContain("› MB Management board (MB)")
    expect(await boards()).toEqual([{ code: "MB", name: "Management board (MB)", note: "Quarterly", archived_at: null }])
  })

  test("a code edit follows the rename", async () => {
    const t = await open()
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Edit MB"))
    t.input.pressTab({ shift: true }) // Name → Code
    await t.input.typeText("2")
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => f.includes("› MB2 Management board"))
    expect(lineWith(frame, "Code")).toMatch(/Code {12}MB2/)
    expect(t.nav.route()).toMatchObject({ kind: "record", ref: "#MB2" })
    expect((await boards()).map((b) => b.code)).toEqual(["MB2"])
  })

  test("A archives after a confirmation, and A again restores", async () => {
    setMessageTimeout(100) // the status bar's message gives the hints back soon
    const t = await open()
    expect(lineWith(await t.frame(), "esc back")).toContain("A archive")
    t.input.pressKey("A")
    let frame = await until(t, (f) => f.includes("Archive #MB?"))
    t.input.pressKey("n")
    frame = await until(t, (f) => !f.includes("Archive #MB?"))
    expect((await boards())[0].archived_at).toBeNull()

    t.input.pressKey("A")
    await until(t, (f) => f.includes("Archive #MB?"))
    t.input.pressKey("y")
    frame = await until(t, (f) => f.includes("archived since"))
    expect(frame).toContain("archived #MB") // the status bar's message, then the hints again
    frame = await until(t, (f) => f.includes("A restore"))
    expect(lineWith(frame, "Status")).toMatch(/Status {10}archived since 13 Nov 2026/)
    expect(lineWith(frame, "esc back")).toContain("A restore")
    expect((await boards())[0].archived_at).not.toBeNull()

    t.input.pressKey("A")
    await until(t, (f) => f.includes("Restore #MB?"))
    t.input.pressKey("y")
    frame = await until(t, (f) => lineWith(f, "Status").includes("active"))
    expect((await boards())[0].archived_at).toBeNull()
  })
})
