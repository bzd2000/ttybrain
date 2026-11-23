// The Actions screen (slot 4): due-date groups, the filter, x / d / n / e, the for/from column and live refresh,
// against the built-in plugins seeded through the write operations.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { fixedClock } from "../../../kernel/clock"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
import { bootKernel, type Kernel } from "../../../kernel/host"
import { builtinPlugins } from "../../../../tests/builtins"
import { isSelected } from "../../../../tests/design"

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

const write = (plugin = "actions") => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))
const rows = <T,>(cols: string[]) => inCtx(async () => (await (kernel!.runtime("actions")!.data as any).selectFrom("action").select(cols).orderBy("id").execute()) as T[])

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
    await write("projects").addProject!({ code: "CRM", name: "Customer platform" })
    await write("actions").addAction!({ title: "Reply to vendor", due: "2026-11-09", project: "CRM", forPerson: "peter" })
    await write("actions").addAction!({ title: "Prepare budget", due: "2026-11-13", owner: "anna" })
    await write("actions").addAction!({ title: "Review plan", due: "2026-11-15" })
    await write("actions").addAction!({ title: "Draft scope", due: "2026-11-16" })
    await write("actions").addAction!({ title: "Plan rollout", due: "2026-11-30" })
    await write("actions").addAction!({ title: "Someday maybe" })
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
    const at = ["Overdue", "This week", "Next week", "Later · 1", "No date · 1"].map((g) => indexOf(frame, g))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(frame).toContain("Actions · 6 open")
    const overdue = lineWith(frame, "Reply to vendor")
    expect(overdue).toContain("me")
    expect(overdue).toContain("CRM @peter")
    expect(overdue).toContain("CRM")
    expect(overdue).toContain("9 Nov")
    expect(lineWith(frame, "Prepare budget")).toContain("Anna")
    expect(lineWith(frame, "Draft scope")).toContain("Mon")
    expect(isSelected(await t.spans(), "Reply to vendor")).toBe(true) // the first row is selected
  })

  test("a new day reaches a long-running TUI: header date and groups update without a remount", async () => {
    let day = "2026-11-13"
    kernel = await makeTestKernel({ plugins: builtinPlugins, clock: { today: () => day, now: () => `${day}T09:00:00` } })
    await seed()
    tui = await renderTui(kernel, { width: 120, height: 32, refreshMs: 30 })
    tui.input.pressKey("4")
    let frame = await tui.frame()
    expect(frame).toContain("Fri 13 Nov 2026")
    expect(frame).toContain("Overdue")
    day = "2026-11-16" // Monday
    frame = await untilThat(tui, (f) => f.includes("Mon 16 Nov 2026") && lineWith(f, "Draft scope").includes("today"))
    expect(frame).toContain("Mon 16 Nov 2026")
    expect(frame).toContain("Overdue")
    expect(frame).toContain("This week")
    expect(frame).not.toContain("Next week")
    expect(frame).toContain("Later · 1")
    expect(lineWith(frame, "Draft scope")).toContain("today")
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
      await write("actions").completeAction!({ ref: "A-2", date: "2026-11-12" })
      await write("actions").completeAction!({ ref: "A-3", date: "2026-11-13" })
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
    expect(isSelected(await t.spans(), "Prepare budget")).toBe(true)
  })

  test("d changes due", async () => {
    const t = await open()
    for (let i = 0; i < 5; i++) t.input.pressArrow("down")
    expect(isSelected(await t.spans(), "Someday maybe")).toBe(true)
    t.input.pressKey("d")
    expect(await t.frame()).toContain("Due")
    await type(t, "+1w")
    t.input.pressKey("s", { ctrl: true })
    const frame = await untilThat(t, (f) => lineWith(f, "Someday maybe").includes("Fri"))
    expect(frame).not.toContain("No date")
    expect((await rows<any>(["due_date"]))[5].due_date).toBe("2026-11-20")
  })

  test("d on a dated action starts empty: +1w moves it to Next week; empty Ctrl+S writes nothing", async () => {
    const t = await open()
    t.input.pressArrow("down") // A-2, due 2026-11-13 (This week)
    t.input.pressArrow("down") // A-3, due 2026-11-15
    expect(isSelected(await t.spans(), "Review plan")).toBe(true)
    t.input.pressKey("d")
    const form = await t.frame()
    expect(form).toContain("now: Sun 15 Nov 2026")
    expect(form).not.toContain("2026-11-15")
    t.input.pressKey("s", { ctrl: true }) // empty: closes without a write
    await untilThat(t, (f) => !f.includes("now: Sun"))
    expect((await rows<any>(["due_date"]))[2].due_date).toBe("2026-11-15")
    t.input.pressKey("d")
    await t.frame()
    await type(t, "+1w")
    expect(await t.frame()).toContain("→ 2026-11-20")
    t.input.pressKey("s", { ctrl: true })
    const frame = await untilThat(t, (f) => lineWith(f, "Review plan").includes("Fri"))
    expect(frame).toContain("This week")
    expect((await rows<any>(["due_date"]))[2].due_date).toBe("2026-11-20")
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
    expect(isSelected(await t.spans(), "Fresh one")).toBe(true)
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
    expect(isSelected(await t.spans(), "Review plan")).toBe(true)
    other = await bootKernel({ env: { TTYBRAIN_HOME: kernel!.home, TTYBRAIN_TEST: "1" }, plugins: builtinPlugins, clock: fixedClock("2026-11-13") })
    let out = ""
    const io = { out: (s: string) => void (out += s), err: (s: string) => void (out += s), stdin: async () => "" }
    expect(await runCli(["action", "done", "A-3"], other, io)).toBe(0)
    const frame = await untilThat(t, (f) => !f.includes("Review plan"))
    expect(frame).toContain("This week")
    expect(isSelected(await t.spans(), "Draft scope")).toBe(true) // the row now at that index
  })

  // Linked to replaces the 2026-11-13 For / from column: an inbox origin is no link, so the action shows `—`.
  test("an action from the inbox without links shows —", async () => {
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
    expect(lineWith(frame, "From the inbox")).toMatch(/me\s+—\s+—/)
  })

  // The design's `@anna #CRM mine`: links by ref (a @handle also matches the owner), mine = owner:me.
  test("filter by links and mine", async () => {
    const t = await open()
    const filtered = async (text: string, footer = `status:open ${text}`) => {
      t.input.pressKey("/")
      await type(t, text)
      t.input.pressEnter()
      return untilThat(t, (f) => f.includes(footer))
    }
    let frame = await filtered("#CRM @peter")
    expect(frame).toContain("Reply to vendor")
    expect(frame).not.toContain("Prepare budget")
    t.input.pressEscape()
    await untilThat(t, (f) => f.includes(" status:open ─"))
    frame = await filtered("@anna") // Anna owns A-2
    expect(frame).toContain("Prepare budget")
    expect(frame).not.toContain("Reply to vendor")
    t.input.pressEscape()
    await untilThat(t, (f) => f.includes(" status:open ─"))
    frame = await filtered("mine", "status:open owner:me")
    expect(frame).toContain("Reply to vendor")
    expect(frame).not.toContain("Prepare budget")
  })

  test("an action from a meeting shows the meeting title", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    await inCtx(async () => {
      await write("meetings").addMeeting!({ about: "#CRM", title: "SteerCo Q4", date: "2026-12-04" }) // M-1
      await write("actions").addAction!({ title: "Send the minutes", meeting: "M-1" })
    })
    tui = await renderTui(kernel, { width: 120, height: 32 })
    tui.input.pressKey("4")
    const frame = await untilThat(tui, (f) => f.includes("Send the minutes"))
    expect(lineWith(frame, "Send the minutes")).toContain("SteerCo Q4")
    expect(lineWith(frame, "Prepare budget")).toContain("—")
  })

  test("a meeting title of wide characters gives way by display width; its date stays whole", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await seed()
    await inCtx(async () => {
      await write("meetings").addMeeting!({ about: "#CRM", title: "季度指导委员会会议", date: "2026-12-04" }) // 18 cells
      await write("actions").addAction!({ title: "Send the minutes", meeting: "M-1" })
    })
    tui = await renderTui(kernel, { width: 120, height: 32 })
    tui.input.pressKey("4")
    const frame = await untilThat(tui, (f) => f.includes("Send the minutes"))
    expect(lineWith(frame, "Send the minutes")).toContain(" 4 Dec")
  })

  test("a 16-character project code is shown whole at 80x24", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(async () => {
      await write("projects").addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
      await write("projects").addProject!({ code: "CRM", name: "Customer platform" })
      await write("actions").addAction!({ title: "Kickoff", due: "2026-11-16", project: "DATAPLATFORM2027" })
      await write("actions").addAction!({ title: "Reply to vendor", due: "2026-11-16", project: "CRM" })
    })
    tui = await renderTui(kernel, { width: 80, height: 24 })
    tui.input.pressKey("4")
    const frame = await untilThat(tui, (f) => f.includes("Kickoff"))
    const long = lineWith(frame, "Kickoff")
    expect(long).toContain(" DATAPLATFORM2027 ")
    expect(long).toContain("Mon")
    for (const l of lines(frame)) expect(l.length).toBeLessThanOrEqual(80)
    expect(lineWith(frame, "Reply to vendor").indexOf(" CRM ")).toBe(long.indexOf(" DATAPLATFORM2027 "))
  })

  test("a linked meeting, project or person that is gone: the action is still listed (Review Focus 4)", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(async () => {
      await write("people").addPerson!({ name: "Gone Person", handle: "gone", is_stakeholder: true })
      await write("projects").addProject!({ code: "TMP", name: "Short-lived" })
      await write("meetings").addMeeting!({ about: "#TMP", title: "SteerCo", date: "2026-11-10" })
      await write("actions").addAction!({ title: "Follow up the steerco", due: "2026-11-16", meeting: "M-1" })
      await write("actions").addAction!({ title: "Close the project", due: "2026-11-16", project: "TMP", forPerson: "gone" })
    })
    kernel.db.raw.exec("DELETE FROM meetings_meeting; DELETE FROM projects_project; DELETE FROM people_person")
    tui = await renderTui(kernel, { width: 120, height: 32 })
    tui.input.pressKey("4")
    const frame = await untilThat(tui, (f) => f.includes("Close the project"))
    expect(lineWith(frame, "Follow up the")).toContain("A-1")
    expect(lineWith(frame, "Close the project")).toContain("A-2")
  })
})
