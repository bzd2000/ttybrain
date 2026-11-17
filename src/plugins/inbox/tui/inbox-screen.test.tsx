// The Inbox screen (slot 6): the New and Processed groups, unknown tags, process by hand (`p`), dismiss (`z`),
// reopen (`u`) and edit (`e`), against the built-in plugins seeded through their write operations.
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { rgbToHex } from "@opentui/core"
import { runWithContext, type Origin } from "../../../kernel/context"
import { theme } from "../../../kernel/tui/theme"
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

const write = (plugin: string) => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>, origin?: Origin) => runWithContext(kernel!.context(origin), fn)
// Runs `fn` as if the clock read `now` (YYYY-MM-DDTHH:MM:SS).
const at = <T,>(now: string, fn: () => Promise<T>) => runWithContext({ ...kernel!.context(), today: now.slice(0, 10), now }, fn)
const item = (ref: string) => inCtx(async () => (await (kernel!.runtime("inbox")!.data as any).selectFrom("item").selectAll().where("id", "=", Number(ref.slice(2))).executeTakeFirst()) as any)
const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))

async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}

async function seedBase() {
  await inCtx(async () => {
    await write("people").addPerson!({ name: "Anna Peeters", handle: "anna" })
    await write("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
  })
}

async function open(seed: () => Promise<void>): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await seedBase()
  await seed()
  tui = await renderTui(kernel, { width: 120, height: 32 })
  tui.input.pressKey("6")
  await until(tui, (f) => f.includes("New · "))
  return tui
}

describe("inbox screen", () => {
  test("inbox groups new and processed", async () => {
    const t = await open(async () => {
      await at("2026-11-13T09:42:00", () => write("inbox").capture!({ text: "call @anna about #CRM" })) // I-1
      await at("2026-11-12T16:00:00", () => write("inbox").capture!({ text: "yesterday thought" })) // I-2
      await at("2026-11-09T08:00:00", () => write("inbox").capture!({ text: "buy coffee" })) // I-3
      await at("2026-11-12T10:00:00", () => write("inbox").dismiss!({ ref: "I-3", by: "you" }))
      await at("2026-10-30T08:00:00", () => write("inbox").capture!({ text: "old processed" })) // I-4
      await at("2026-11-01T10:00:00", () => write("inbox").markProcessed!({ ref: "I-4", summary: "long ago", by: "cli" }))
      await at("2026-11-11T08:00:00", () => write("inbox").capture!({ text: "send the plan" })) // I-5
      await inCtx(() => write("projects").addAction!({ title: "Send the plan" }), { type: "inbox", ref: "I-5" })
      await at("2026-11-13T08:30:00", () => write("inbox").markProcessed!({ ref: "I-5", summary: "Action A-1", by: "you" }))
    })
    const frame = await t.frame()
    expect(frame).toContain("New · 2")
    expect(frame).toContain("Processed · last 7 days")
    expect(lineWith(frame, "Processed · last 7 days")).not.toContain("days ·")
    expect(lineWith(frame, "I-1")).toContain("today 09:42")
    expect(lineWith(frame, "I-1")).toContain("call @anna about #CRM")
    expect(lineWith(frame, "I-2")).toContain("yesterday")
    expect(lineWith(frame, "I-3")).toContain("Mon 9 Nov")
    expect(frame).not.toContain("I-4")
    expect(frame).not.toContain("old processed")
    // new oldest first; processed newest first, each with its second line
    const order = ["New · 2", "I-2", "I-1", "Processed · last 7 days", "I-5", "✓ you → Action A-1", "I-3", "✗ dismissed by you"].map((s) => indexOf(frame, s))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(indexOf(frame, "✓ you → Action A-1")).toBe(indexOf(frame, "I-5") + 1)
    expect(lineWith(frame, "✓ you → Action A-1")).toContain("→ A-1")
    expect(indexOf(frame, "✗ dismissed by you")).toBe(indexOf(frame, "I-3") + 1)
  })

  test("unknown tag flagged", async () => {
    const t = await open(async () => void (await inCtx(() => write("inbox").capture!({ text: "#CMR ask Marie about key user dates" }))))
    const frame = await t.frame()
    expect(lineWith(frame, "I-1")).toContain("#CMR ⚠ ask Marie")
    const spans = await t.spans()
    const row = spans.lines.find((l) => l.spans.map((s) => s.text).join("").includes("#CMR ⚠"))!
    const cell = row.spans.find((s) => s.text.includes("#CMR"))!
    expect(rgbToHex(cell.fg).toLowerCase()).toBe(theme.amber)
  })

  test("p → Action creates action with provenance and marks processed", async () => {
    const t = await open(async () => void (await inCtx(() => write("inbox").capture!({ text: "call @anna about #CRM" }))))
    t.input.pressKey("p")
    let frame = await until(t, (f) => f.includes("Action"))
    expect(frame).toContain("Health update")
    expect(frame).toContain("Decision")
    expect(frame).toContain("Risk / issue")
    expect(frame).not.toContain("Due date")
    t.input.pressKey("a")
    frame = await until(t, (f) => f.includes("New action"))
    expect(frame).toContain("call about")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => f.includes("→ A-1") && !f.includes("New action"))
    const action = await inCtx(async () => (await (kernel!.runtime("projects")!.data as any).selectFrom("action").select(["title", "project_id"]).executeTakeFirst()) as any)
    expect(action).toEqual({ title: "call about", project_id: 1 })
    const it = await item("I-1")
    expect([it.status, it.summary, it.processed_by]).toEqual(["processed", "Action A-1", "you"])
    expect(await inCtx(() => kernel!.runtime("projects")!.provenance.originOf("action", 1))).toEqual({ type: "inbox", ref: "I-1" })
    expect(frame).toContain("✓ you → Action A-1")
    expect(frame).toContain("New · 0")
  })

  test("process an item into a note prefills person and text", async () => {
    const t = await open(async () => {
      await inCtx(async () => {
        await write("people").addPerson!({ name: "Peter Janssens", handle: "peter" })
        await write("inbox").capture!({ text: "@peter worried about #CRM budget" })
      })
    })
    t.input.pressKey("p")
    await until(t, (f) => f.includes("Note"))
    t.input.pressKey("n")
    let frame = await until(t, (f) => f.includes("New note"))
    expect(frame).toContain("New note · @peter")
    expect(frame).toContain("worried about budget")
    expect(frame).not.toMatch(/Person\*/)
    expect(lineWith(frame, "Project")).toContain("#CRM")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => f.includes("→ N-1") && !f.includes("New note"))
    const note = await inCtx(async () => (await (kernel!.runtime("people")!.data as any).selectFrom("note").select(["person_id", "project_id", "text"]).executeTakeFirst()) as any)
    expect(note).toEqual({ person_id: 2, project_id: 1, text: "worried about budget" })
    const it = await item("I-1")
    expect([it.status, it.summary]).toEqual(["processed", "Note N-1"])
  })

  test("p then Esc in the form leaves the item new", async () => {
    const t = await open(async () => void (await inCtx(() => write("inbox").capture!({ text: "think about it" }))))
    t.input.pressKey("p")
    await until(t, (f) => f.includes("Decision"))
    t.input.pressKey("d")
    await until(t, (f) => f.includes("New decision"))
    t.input.pressEscape()
    await sleep(600)
    await until(t, (f) => !f.includes("New decision"))
    expect((await item("I-1")).status).toBe("new")
  })

  test("z dismisses, u reopens", async () => {
    const t = await open(async () => void (await inCtx(() => write("inbox").capture!({ text: "maybe later" }))))
    t.input.pressKey("z")
    let frame = await until(t, (f) => f.includes("✗ dismissed by you"))
    expect(frame).toContain("New · 0")
    expect(lineWith(frame, "I-1")).toContain("maybe later")
    let it = await item("I-1")
    expect([it.status, it.processed_by]).toEqual(["dismissed", "you"])
    t.input.pressKey("j") // the selection follows I-1 into the Processed group already; j keeps it there
    t.input.pressKey("u")
    frame = await until(t, (f) => f.includes("New · 1"))
    expect(frame).not.toContain("✗ dismissed")
    it = await item("I-1")
    expect([it.status, it.processed_by]).toEqual(["new", null])
  })

  test("p → Risk on an untagged item asks for the project", async () => {
    const t = await open(async () => void (await inCtx(() => write("inbox").capture!({ text: "vendor may be late" }))))
    t.input.pressKey("p")
    await until(t, (f) => f.includes("Risk / issue"))
    t.input.pressKey("r")
    let frame = await until(t, (f) => f.includes("New risk / issue"))
    expect(frame).toMatch(/Project\*/)
    t.input.pressTab() // type → title
    t.input.pressTab() // title → project
    await t.input.typeText("CR")
    await until(t, (f) => f.includes("#CRM CRM replatforming"))
    t.input.pressTab() // accept the suggestion
    await t.frame()
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => f.includes("→ R-1") && !f.includes("New risk"))
    const risk = await inCtx(async () => (await (kernel!.runtime("projects")!.data as any).selectFrom("risk").select(["title", "project_id"]).executeTakeFirst()) as any)
    expect(risk).toEqual({ title: "vendor may be late", project_id: 1 })
    const it = await item("I-1")
    expect([it.status, it.summary]).toEqual(["processed", "Risk / issue R-1"])
  })

  test("e keeps the newlines of a multi-line item", async () => {
    const t = await open(async () => void (await inCtx(() => write("inbox").capture!({ text: "line one\nline two" }))))
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Edit I-1"))
    await t.input.typeText("X")
    await t.frame()
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("Edit I-1"))
    expect((await item("I-1")).text).toBe("line one\nline twoX")
  })

  test("e edits the text and re-resolves its tags", async () => {
    const t = await open(async () => void (await inCtx(() => write("inbox").capture!({ text: "ask about #CMR" }))))
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Edit I-1"))
    for (let i = 0; i < 3; i++) t.input.pressBackspace()
    await t.input.typeText("CRM")
    await t.frame()
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => !f.includes("Edit I-1") && f.includes("ask about #CRM"))
    expect(frame).not.toContain("⚠")
    expect((await item("I-1")).text).toBe("ask about #CRM")
  })
})
