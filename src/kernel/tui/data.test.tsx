// The data layer: useQuery (load in context, live reload, keeps the last data), act (context, messages,
// BusyError retry), live refresh (data_version + record.changed) and the error boundary around plugin components.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { For } from "solid-js"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { builtinPlugins, builtinTuiParts } from "../../../tests/builtins"
import { fixedClock } from "../clock"
import { runWithContext } from "../context"
import { bootKernel, type Kernel } from "../host"
import { act, useQuery, useRuntime } from "./data"
import { setMessageTimeout } from "./messages"
import { defineTui, type TuiDef } from "./types"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A screen in the actions plugin listing its actions' titles through useQuery.
function ActionsList() {
  const rt = useRuntime()
  const q = useQuery(() => rt.data.selectFrom("action").select("title").orderBy("id").execute())
  return (
    <box flexDirection="column">
      <For each={q.data() ?? []}>{(r: { title: string }) => <text>{`row ${r.title}`}</text>}</For>
    </box>
  )
}

const screenPart = (component: () => any, plugin = "actions"): TuiDef =>
  defineTui({ plugin, activate: (ui) => ui.screen({ id: "t", title: "Test", slot: 2, component }) })

let kernel: TestKernel
let tui: RenderedTui | undefined
let others: Kernel[] = []
beforeEach(async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
})
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  setMessageTimeout()
  for (const k of others) await k.shutdown()
  others = []
  await kernel.cleanup()
})

async function second(): Promise<Kernel> {
  const k = await bootKernel({ env: { TTYBRAIN_HOME: kernel.home, TTYBRAIN_TEST: "1" }, plugins: builtinPlugins, clock: fixedClock("2026-11-13") })
  others.push(k)
  return k
}

const addAction = (k: Kernel, title: string) =>
  runWithContext(k.context(), () => k.runtime("actions")!.self().write.addAction!({ title }))

const actionCount = async () =>
  (await runWithContext(kernel.context(), () => kernel.runtime("actions")!.data.selectFrom("action").select("id").execute())).length

const statusLine = (frame: string) => frame.trimEnd().split("\n").at(-1)!

describe("TUI data", () => {
  test("reloads after a write from another connection", async () => {
    tui = await renderTui(kernel, { parts: [screenPart(ActionsList)], refreshMs: 50 })
    tui.input.pressKey("2")
    expect(await tui.frame()).not.toContain("row From B")
    const b = await second()
    await addAction(b, "From B")
    await sleep(100)
    expect(await tui.frame()).toContain("row From B")
  })

  test("reloads after own write via record.changed", async () => {
    // A minute-long interval: only record.changed can trigger this reload.
    tui = await renderTui(kernel, { parts: [screenPart(ActionsList)], refreshMs: 60_000 })
    tui.input.pressKey("2")
    expect(await tui.frame()).not.toContain("row Mine")
    const res = await act(() => kernel.runtime("actions")!.self().write.addAction!({ title: "Mine" }), { ok: (r: any) => `added ${r.ref}` })
    expect(res).toMatchObject({ ok: true, value: { ref: "A-1" } })
    await sleep(20)
    const frame = await tui.frame()
    expect(frame).toContain("row Mine")
    expect(statusLine(frame)).toContain("added A-1")
  })

  test("data keeps its previous value while a reload is in flight", async () => {
    let release: () => void = () => {}
    let runs = 0
    let reload: () => void = () => {}
    function Gated() {
      const q = useQuery(async () => {
        runs++
        if (runs === 2) await new Promise<void>((r) => (release = r))
        return [`v${runs}`]
      })
      reload = q.reload
      return <text>{`${(q.data() ?? ["empty"]).join(",")} ${q.loading() ? "loading" : "idle"}`}</text>
    }
    tui = await renderTui(kernel, { parts: [screenPart(Gated)] })
    tui.input.pressKey("2")
    expect(await tui.frame()).toContain("v1 idle")
    reload()
    const during = await tui.peek()
    expect(during).toContain("v1 loading")
    expect(during).not.toContain("empty")
    release()
    expect(await tui.frame()).toContain("v2 idle")
  })

  test("query error keeps last data and shows message", async () => {
    setMessageTimeout(100)
    let runs = 0
    let reload: () => void = () => {}
    function Failing() {
      const q = useQuery(async () => {
        runs++
        if (runs === 2) throw new Error("load failed")
        return ["first row"]
      })
      reload = q.reload
      return <text>{`${(q.data() ?? []).join(",")} error=${q.error() instanceof Error ? (q.error() as Error).message : "none"}`}</text>
    }
    tui = await renderTui(kernel, { parts: [screenPart(Failing)] })
    tui.input.pressKey("2")
    expect(await tui.frame()).toContain("first row error=none")
    reload()
    const frame = await tui.frame()
    expect(frame).toContain("first row error=load failed")
    expect(statusLine(frame)).toContain("load failed")
    await sleep(150)
    const later = statusLine(await tui.frame())
    expect(later).not.toContain("load failed")
    expect(later).toContain("? help")
  })

  test(
    "busy then success",
    async () => {
      tui = await renderTui(kernel, { parts: [screenPart(ActionsList)] })
      await tui.settle() // the start's upkeep has written and let go of the write lock
      const b = await second()
      b.db.raw.exec("BEGIN IMMEDIATE")
      setTimeout(() => b.db.raw.exec("ROLLBACK"), 1500)
      const pending = act(() => kernel.runtime("actions")!.self().write.addAction!({ title: "Busy" }), { ok: (r: any) => `added ${r.ref}` })
      let seen = false
      for (let i = 0; i < 100 && !seen; i++) {
        await sleep(50)
        seen = statusLine(await tui.peek()).includes("database busy, retrying")
      }
      expect(seen).toBe(true)
      const res = await pending
      expect(res).toMatchObject({ ok: true, value: { ref: "A-1", title: "Busy" } })
      expect(await actionCount()).toBe(1)
      expect(statusLine(await tui.frame())).toContain("added A-1")
    },
    15_000,
  )

  test("ErrorBoundary contains a throwing tab", async () => {
    function Throwing(): any {
      throw new Error("boom")
    }
    tui = await renderTui(kernel, { parts: [screenPart(Throwing)] })
    tui.input.pressKey("2")
    const frame = await tui.frame()
    expect(frame.split("\n")[0]).toContain("ttybrain ·  2 Test ▾")
    expect(frame).toContain("⚠ Test: boom")
  })

  test("a global-action overlay runs in its plugin's scope", async () => {
    await addAction(kernel, "Seen in overlay")
    function Overlay(props: { close(): void }) {
      const rt = useRuntime()
      const q = useQuery(() => rt.data.selectFrom("action").select("title").execute())
      return <text>{`overlay rows: ${(q.data() ?? []).map((r: { title: string }) => r.title).join(",")}`}</text>
    }
    const part = defineTui({ plugin: "actions", activate: (ui) => ui.globalAction({ id: "peek", key: "z", label: "Peek", overlay: Overlay }) })
    tui = await renderTui(kernel, { parts: [part] })
    tui.input.pressKey("z")
    expect(await tui.frame()).toContain("overlay rows: Seen in overlay")
  })

  test("a throwing overlay shows its error in place and Esc closes it", async () => {
    function Broken(): any {
      throw new Error("boom")
    }
    const part = defineTui({ plugin: "actions", activate: (ui) => ui.globalAction({ id: "broken", key: "z", label: "Broken", overlay: Broken }) })
    tui = await renderTui(kernel, { parts: [part, screenPart(() => <text>test screen</text>, "inbox")] })
    tui.input.pressKey("z")
    expect(await tui.frame()).toContain("⚠ Broken: boom")
    tui.input.pressEscape()
    await sleep(30) // a lone ESC is flushed by the input parser's timeout
    expect(await tui.frame()).not.toContain("⚠ Broken: boom")
    tui.input.pressKey("2")
    const frame = await tui.frame()
    expect(frame.split("\n")[0]).toContain("ttybrain ·  2 Test ▾")
    expect(frame).toContain("test screen")
  })

  test("act outside a write reports the error and returns it", async () => {
    tui = await renderTui(kernel, { parts: builtinTuiParts })
    const res = await act(() => kernel.runtime("actions")!.self().write.addAction!({ title: "  " }))
    expect(res.ok).toBe(false)
    expect(statusLine(await tui.frame())).toContain("title")
    expect(await actionCount()).toBe(0)
  })

  test("act with two write ops where the second throws leaves no trace of the first", async () => {
    tui = await renderTui(kernel, { parts: builtinTuiParts })
    const w = kernel.runtime("actions")!.self().write as Record<string, (i: any) => Promise<any>>
    const res = await act(async () => {
      await w.addAction!({ title: "First" })
      return w.addAction!({ title: "  " })
    })
    expect(res.ok).toBe(false)
    expect(await actionCount()).toBe(0)
  })

  test("act with two write ops commits both once, and live refresh still fires", async () => {
    tui = await renderTui(kernel, { parts: [screenPart(ActionsList)], refreshMs: 60_000 })
    tui.input.pressKey("2")
    await tui.frame()
    const w = kernel.runtime("actions")!.self().write as Record<string, (i: any) => Promise<any>>
    const res = await act(async () => {
      await w.addAction!({ title: "One" })
      return w.addAction!({ title: "Two" })
    })
    expect(res.ok).toBe(true)
    await sleep(20)
    const frame = await tui.frame()
    expect(frame).toContain("row One")
    expect(frame).toContain("row Two")
    expect(await actionCount()).toBe(2)
  })

  test("act does not open R15: raw DML on rt.data inside act is rejected, and nothing is written", async () => {
    tui = await renderTui(kernel, { parts: builtinTuiParts })
    let changed = 0
    kernel.events.on("record.changed", () => void changed++)
    const rt = kernel.runtime("actions")!
    const res = await act(() => rt.data.insertInto("action").values({ title: "sneaky", created_at: "2026-11-13T09:00:00", updated_at: "2026-11-13T09:00:00" }).execute())
    expect(res.ok).toBe(false)
    expect(res.ok ? "" : (res.error as Error).message).toBe("data changes must run inside a write operation")
    expect(await actionCount()).toBe(0)
    expect(changed).toBe(0)
    // an operation inside act still writes
    expect((await act(() => rt.self().write.addAction!({ title: "Proper" }))).ok).toBe(true)
    expect(await actionCount()).toBe(1)
  })

  test("act checks its origin before it writes", async () => {
    tui = await renderTui(kernel, { parts: builtinTuiParts })
    const w = kernel.runtime("actions")!.self().write
    let ran = false
    const res = await act(async () => ((ran = true), w.addAction!({ title: "From nowhere" })), { origin: { type: "inbox", ref: "I-99" } })
    expect(res.ok).toBe(false)
    expect(res.ok ? "" : (res.error as Error).message).toBe('no record "I-99"')
    expect(ran).toBe(false)
    expect(statusLine(await tui.frame())).toContain('no record "I-99"')
    expect(await actionCount()).toBe(0)
  })
})
