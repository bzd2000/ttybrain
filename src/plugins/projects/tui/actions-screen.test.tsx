// The Actions screen (slot 4): due-date groups, the filter, x / d / n / e, the for/from column and live refresh,
// against the built-in plugins seeded through the write operations.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { fixedClock } from "../../../kernel/clock"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
import { bootKernel, type Kernel } from "../../../kernel/host"
import { builtinPlugins } from "../../index"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let kernel: TestKernel | undefined
let other: Kernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await other?.shutdown()
  other = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const write = (plugin = "projects") => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))
const rows = <T,>(cols: string[]) => inCtx(async () => (await (kernel!.runtime("projects")!.data as any).selectFrom("action").select(cols).orderBy("id").execute()) as T[])

async function untilThat(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}
const type = async (t: RenderedTui, text: string) => {
  await t.input.typeText(text)
  await t.frame()
}

// A-1 overdue (me, CRM, for Peter), A-2 and A-3 this week (A-2 is Anna's), A-4 next week, A-5 later, A-6 no date.
async function seed() {
  await inCtx(async () => {
    await write("people").addPerson!({ name: "Peter Janssens", handle: "peter", is_stakeholder: true })
    await write("people").addPerson!({ name: "Anna Smits", handle: "anna" })
    const w = write()
    await w.addProject!({ code: "CRM", name: "Customer platform" })
    await w.addAction!({ title: "Reply to vendor", due: "2026-11-09", project: "CRM", forPerson: "peter" })
    await w.addAction!({ title: "Prepare budget", due: "2026-11-13", owner: "anna" })
    await w.addAction!({ title: "Review plan", due: "2026-11-15" })
    await w.addAction!({ title: "Draft scope", due: "2026-11-16" })
    await w.addAction!({ title: "Plan rollout", due: "2026-11-30" })
    await w.addAction!({ title: "Someday maybe" })
  })
}

async function open(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await seed()
  tui = await renderTui(kernel, { width: 120, height: 32 })
  tui.input.pressKey("4")
  await tui.frame()
  return tui
}

describe("actions screen", () => {
  test("groups by due date", async () => {
    const t = await open()
    const frame = await t.frame()
    const at = ["Overdue · 1", "This week · 2", "Next week · 1", "Later · 1", "No date · 1"].map((g) => indexOf(frame, g))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(frame).toContain("Actions · 6 open")
    const overdue = lineWith(frame, "Reply to vendor")
    expect(overdue).toContain("me")
    expect(overdue).toContain("Peter")
    expect(overdue).toContain("CRM")
    expect(overdue).toContain("9 Nov")
    expect(lineWith(frame, "Prepare budget")).toContain("Anna")
    expect(lineWith(frame, "Draft scope")).toContain("16 Nov")
    expect(lineWith(frame, "Reply to vendor")).toContain("›") // the first row is selected
  })

  test("filter owner:anna", async () => {
    const t = await open()
    t.input.pressKey("/")
    await type(t, "owner:anna")
    t.input.pressEnter()
    const frame = await t.frame()
    expect(frame).toContain("Prepare budget")
    expect(frame).not.toContain("Reply to vendor")
    expect(frame).not.toContain("Review plan")
    expect(frame).toContain("owner:anna")
    t.input.pressKey("/")
    t.input.pressEscape()
    await sleep(30)
    expect(await t.frame()).toContain("Reply to vendor")
  })

  test("status:done lists done actions in one group, newest first", async () => {
    const t = await open()
    await inCtx(async () => {
      await write().completeAction!({ ref: "A-2", date: "2026-11-12" })
      await write().completeAction!({ ref: "A-3", date: "2026-11-13" })
    })
    t.input.pressKey("/")
    await type(t, "status:done")
    t.input.pressEnter()
    const frame = await untilThat(t, (f) => f.includes("Actions · 2"))
    expect(frame).not.toContain("Overdue")
    expect(indexOf(frame, "Review plan")).toBeLessThan(indexOf(frame, "Prepare budget"))
    expect(indexOf(frame, "Review plan")).toBeGreaterThan(-1)
  })

  test("x completes and row leaves", async () => {
    const t = await open()
    t.input.pressKey("x")
    const frame = await untilThat(t, (f) => !f.includes("Reply to vendor"))
    expect(frame).not.toContain("Overdue")
    expect(frame).toContain("Actions · 5 open")
    expect((await rows<any>(["status", "done_date"]))[0]).toEqual({ status: "done", done_date: "2026-11-13" })
    expect(lineWith(frame, "›")).toContain("Prepare budget")
  })

  test("d changes due", async () => {
    const t = await open()
    for (let i = 0; i < 5; i++) t.input.pressArrow("down")
    expect(lineWith(await t.frame(), "›")).toContain("Someday maybe")
    t.input.pressKey("d")
    expect(await t.frame()).toContain("Due")
    await type(t, "+1w")
    t.input.pressKey("s", { ctrl: true })
    const frame = await untilThat(t, (f) => f.includes("Next week · 2"))
    expect(frame).not.toContain("No date")
    expect((await rows<any>(["due_date"]))[5].due_date).toBe("2026-11-20")
  })

  test("e edits only the changed fields, n adds", async () => {
    const t = await open()
    t.input.pressKey("e")
    expect(await t.frame()).toContain("Edit A-1")
    await type(t, " now")
    t.input.pressKey("s", { ctrl: true })
    await untilThat(t, (f) => f.includes("Reply to vendor now"))
    t.input.pressKey("n")
    expect(await t.frame()).toContain("New action")
    await type(t, "Fresh one")
    t.input.pressKey("s", { ctrl: true })
    const frame = await untilThat(t, (f) => f.includes("Fresh one"))
    expect(frame).toContain("No date · 2")
    expect(lineWith(frame, "›")).toContain("Fresh one")
  })

  test("Enter opens the action's form", async () => {
    const t = await open()
    t.input.pressEnter()
    expect(await t.frame()).toContain("Edit A-1")
  })

  test("CLI done removes the row and selection moves to the next", async () => {
    const t = await open()
    t.input.pressArrow("down")
    t.input.pressArrow("down")
    expect(lineWith(await t.frame(), "›")).toContain("Review plan")
    other = await bootKernel({ env: { PM_HOME: kernel!.home, PM_TEST: "1" }, plugins: builtinPlugins, clock: fixedClock("2026-11-13") })
    let out = ""
    const io = { out: (s: string) => void (out += s), err: (s: string) => void (out += s), stdin: async () => "" }
    expect(await runCli(["action", "done", "A-3"], other, io)).toBe(0)
    const frame = await untilThat(t, (f) => !f.includes("Review plan"))
    expect(frame).toContain("This week · 1")
    expect(lineWith(frame, "›")).toContain("Draft scope") // the row now at that index
  })

  test("for/from shows inbox origin", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    await inCtx(async () => void (await write("inbox").capture!({ text: "call the vendor" })))
    other = kernel
    let out = ""
    const io = { out: (s: string) => void (out += s), err: (s: string) => void (out += s), stdin: async () => "" }
    expect(await runCli(["action", "add", "From the inbox", "--from-inbox", "I-1"], kernel, io)).toBe(0)
    other = undefined
    tui = await renderTui(kernel, { width: 120, height: 32 })
    tui.input.pressKey("4")
    const frame = await untilThat(tui, (f) => f.includes("From the inbox"))
    expect(lineWith(frame, "From the inbox")).toContain("inbox I-1")
    expect(lineWith(frame, "Prepare budget")).toContain("—")
  })
})
