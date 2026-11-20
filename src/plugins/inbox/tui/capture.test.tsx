// Quick capture (`i` on any screen) and the header badge, against the built-in plugins seeded through their
// write operations.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { builtinPlugins } from "../../../../tests/builtins"

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
const read = (plugin: string) => kernel!.runtime(plugin)!.self().read as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const items = () => inCtx(async () => (await (kernel!.runtime("inbox")!.data as any).selectFrom("item").select(["id", "text", "status"]).orderBy("id").execute()) as any[])

async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
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

async function open(): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await inCtx(async () => {
    await write("people").addPerson!({ name: "Anna Peeters", handle: "anna" })
    await write("people").addPerson!({ name: "Marie Dubois", handle: "marie" })
    await write("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
  })
  tui = await renderTui(kernel, { width: 120, height: 32 })
  await tui.frame()
  return tui
}

async function capture(t: RenderedTui): Promise<string> {
  t.input.pressKey("i")
  return until(t, (f) => f.includes("Capture to inbox"))
}

describe("quick capture", () => {
  test("i captures from any screen", async () => {
    const t = await open()
    t.input.pressKey("2")
    await t.frame()
    const frame = await capture(t)
    expect(frame).toContain("─ Capture to inbox ─")
    expect(frame).toContain(" ctrl+s save · esc cancel ─╯")
    await type(t, "call @anna about #CRM")
    t.input.pressKey("s", { ctrl: true })
    const after = await until(t, (f) => !f.includes("Capture to inbox"))
    expect(after).toContain("captured I-1")
    expect([t.nav.route().kind, t.nav.route().screen, t.nav.stack().length]).toEqual(["screen", "projects", 2])
    expect((await items()).map((i) => i.text)).toEqual(["call @anna about #CRM"])
    const item = await inCtx(() => read("inbox").getItem!({ ref: "I-1" }))
    expect(item.links.map((l: any) => l.ref)).toEqual(["@anna", "#CRM"])
    expect(item.unresolved).toEqual([])
  })

  test("prefill on project", async () => {
    const t = await open()
    t.input.pressKey("2")
    await t.frame()
    await t.nav.open("#CRM")
    await t.frame()
    const frame = await capture(t)
    expect(frame).toContain("#CRM added because you're on the CRM project")
    expect(frame.split("\n").find((l) => l.includes("#CRM") && !l.includes("added"))).toBeDefined()
    await type(t, "budget review")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("Capture to inbox"))
    expect((await items()).map((i) => i.text)).toEqual(["#CRM budget review"])
  })

  test("autocomplete @an + Tab", async () => {
    const t = await open()
    await capture(t)
    await type(t, "@an")
    const frame = await until(t, (f) => f.includes("@anna       Anna Peeters"))
    expect(frame).toContain("@anna       Anna Peeters")
    t.input.pressTab()
    await until(t, (f) => !f.includes("Anna Peeters"))
    await type(t, "x")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("Capture to inbox"))
    expect((await items()).map((i) => i.text)).toEqual(["@anna x"])
  })

  test("a long handle is cut with … in the 10-wide tag column", async () => {
    const t = await open()
    await inCtx(() => write("people").addPerson!({ name: "Anneliese Long", handle: "anneliese-long" }))
    await capture(t)
    await type(t, "@annel")
    const frame = await until(t, (f) => f.includes("Anneliese Long"))
    expect(frame).toContain("@annelies…  Anneliese Long")
  })

  test("typing q and 2 in capture inserts them", async () => {
    const t = await open()
    await capture(t)
    await type(t, "q2 i")
    expect(t.nav.route()).toEqual({ kind: "screen", screen: "overview" })
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("Capture to inbox"))
    expect((await items()).map((i) => i.text)).toEqual(["q2 i"])
    expect(t.nav.route()).toEqual({ kind: "screen", screen: "overview" })
  })

  test("Enter inserts a newline; Ctrl+S saves it", async () => {
    const t = await open()
    await capture(t)
    await type(t, "line one")
    t.input.pressEnter()
    await t.frame()
    await type(t, "line two")
    expect(await t.frame()).toContain("Capture to inbox")
    expect(await items()).toEqual([])
    t.input.pressKey("s", { ctrl: true })
    const after = await until(t, (f) => !f.includes("Capture to inbox"))
    expect(after).toContain("captured I-1")
    expect((await items()).map((i) => i.text)).toEqual(["line one\nline two"])
  })

  test("Esc then s saves", async () => {
    const t = await open()
    await capture(t)
    await type(t, "chord")
    t.input.pressEscape()
    await sleep(30)
    t.input.pressKey("s")
    await until(t, (f) => !f.includes("Capture to inbox"))
    expect((await items()).map((i) => i.text)).toEqual(["chord"])
  })

  test("Esc then another key cancels", async () => {
    const t = await open()
    await capture(t)
    await type(t, "nope")
    t.input.pressEscape()
    await sleep(30)
    t.input.pressKey("x")
    await until(t, (f) => !f.includes("Capture to inbox"))
    expect(await items()).toEqual([])
  })

  test("Esc cancels", async () => {
    const t = await open()
    await capture(t)
    await type(t, "never mind")
    t.input.pressEscape()
    await sleep(30)
    const frame = await until(t, (f) => !f.includes("Capture to inbox"))
    expect(frame).not.toContain("Capture to inbox")
    expect(await items()).toEqual([])
  })
})

const captureDraft = () => {
  const file = join(kernel!.home, "drafts", `${encodeURIComponent("inbox:capture")}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined
}
const PROMPT = "Unsaved draft from 09:00 · r restore · x discard"

describe("quick capture drafts", () => {
  test("Esc keeps a draft; i offers it, r restores it, Ctrl+S captures and deletes it", async () => {
    const t = await open()
    await capture(t)
    await type(t, "half a thought")
    t.input.pressEscape()
    await sleep(30)
    t.input.pressKey("z")
    let frame = await until(t, (f) => !f.includes("Capture to inbox"))
    expect(frame.trimEnd().split("\n").at(-1)).toContain("draft kept")
    expect(captureDraft()).toEqual({ key: "inbox:capture", savedAt: "2026-11-13T09:00:00", values: { text: "half a thought" } })

    frame = await capture(t)
    expect(frame).toContain(PROMPT)
    await t.input.typeText("zz")
    expect(await t.frame()).not.toContain("zz")
    t.input.pressKey("r")
    frame = await until(t, (f) => !f.includes(PROMPT))
    expect(frame).toContain("half a thought")
    await type(t, " done")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => !f.includes("Capture to inbox"))
    expect(frame).toContain("captured I-1")
    expect((await items()).map((i) => i.text)).toEqual(["half a thought done"])
    expect(captureDraft()).toBeUndefined()
  })

  test("x discards the draft; on a project the tag prefill follows", async () => {
    const t = await open()
    await capture(t)
    await type(t, "drop me")
    t.input.pressEscape()
    await sleep(30)
    t.input.pressKey("z")
    await until(t, (f) => !f.includes("Capture to inbox"))
    t.input.pressKey("2")
    await t.frame()
    await t.nav.open("#CRM")
    await t.frame()
    expect(await capture(t)).toContain(PROMPT)
    t.input.pressKey("x")
    const frame = await until(t, (f) => f.includes("added because"))
    expect(frame).not.toContain(PROMPT)
    expect(frame).not.toContain("drop me")
    expect(captureDraft()).toBeUndefined()
    // The prefilled tag alone is no draft.
    t.input.pressEscape()
    await sleep(30)
    t.input.pressKey("z")
    await until(t, (f) => !f.includes("Capture to inbox"))
    expect(captureDraft()).toBeUndefined()
  })
})

describe("inbox badge", () => {
  test("badge counts new items", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(async () => {
      await write("inbox").capture!({ text: "one" })
      await write("inbox").capture!({ text: "two" })
    })
    tui = await renderTui(kernel, { width: 120, height: 32 })
    let frame = await until(tui, (f) => f.includes("new in inbox"))
    expect(frame.split("\n")[0]).toContain("● 2 new in inbox")
    await inCtx(async () => {
      await write("inbox").dismiss!({ ref: "I-1" })
      await write("inbox").dismiss!({ ref: "I-2" })
    })
    frame = await until(tui, (f) => !f.includes("new in inbox"))
    expect(frame.split("\n")[0]).not.toContain("new in inbox")
  })
})
