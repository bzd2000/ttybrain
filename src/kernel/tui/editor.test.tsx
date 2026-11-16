// The long-text editor overlay (useOverlay().openEditor) and editExternal ($EDITOR handoff).
import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { definePlugin, type PluginDef } from "../api"
import { editExternal } from "./external"
import { useOverlay, type Overlay } from "./overlay"
import { defineTui, type TuiDef } from "./types"

const todoPlugin: PluginDef = definePlugin({ id: "todo", name: "Todo", version: "1.0.0", apiVersion: 1, activate() {} })

let overlay: Overlay | undefined
function Home() {
  overlay = useOverlay()
  return <text>home screen</text>
}
const part: TuiDef = defineTui({
  plugin: "todo",
  activate: (ui) => ui.screen({ id: "home", title: "Home", slot: 2, component: Home }),
})

let kernel: TestKernel
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  overlay = undefined
  await kernel.cleanup()
})

let saved: string[] = []
async function open(save?: (t: string) => Promise<{ ok: true } | { ok: false; error: unknown }>): Promise<RenderedTui> {
  saved = []
  kernel = await makeTestKernel({ plugins: [todoPlugin] })
  tui = await renderTui(kernel, { parts: [part] })
  tui.input.pressKey("2")
  expect(await tui.frame()).toContain("home screen")
  overlay!.openEditor({
    title: "Context",
    initial: "# A",
    save: save ?? (async (t) => (saved.push(t), { ok: true })),
  })
  return tui
}
const typeAtEnd = async (t: RenderedTui, text: string) => {
  await t.frame()
  t.input.pressKey("END") // end of buffer
  for (const ch of text) {
    if (ch === "\n") t.input.pressEnter()
    else await t.input.typeText(ch)
  }
}

describe("editor overlay", () => {
  test("ctrl+s saves edited text", async () => {
    const t = await open()
    expect(await t.frame()).toContain("Context · ctrl+s save · esc s save · esc d discard")
    await typeAtEnd(t, "\nB")
    t.input.pressKey("s", { ctrl: true })
    const f = await t.frame()
    expect(saved).toEqual(["# A\nB"])
    expect(f).not.toContain("ctrl+s save")
  })

  test("esc s saves", async () => {
    const t = await open()
    await typeAtEnd(t, "!")
    t.input.pressEscape()
    t.input.pressKey("s")
    await t.frame()
    expect(saved).toEqual(["# A!"])
  })

  test("esc d discards", async () => {
    const t = await open()
    await typeAtEnd(t, "x")
    t.input.pressEscape()
    t.input.pressKey("d")
    const f = await t.frame()
    expect(saved).toEqual([])
    expect(f).not.toContain("ctrl+s save")
    expect(f).toContain("home screen")
  })

  test("esc then text continues editing", async () => {
    const t = await open()
    t.input.pressEscape()
    t.input.pressKey("x") // swallowed: neither saves, discards nor types
    expect(await t.frame()).toContain("ctrl+s save")
    await typeAtEnd(t, "Z")
    t.input.pressKey("s", { ctrl: true })
    await t.frame()
    expect(saved).toEqual(["# AZ"])
  })

  test("save error keeps editor open", async () => {
    const t = await open(async () => ({ ok: false, error: new Error("disk full") }))
    await typeAtEnd(t, "!")
    t.input.pressKey("s", { ctrl: true })
    const f = await t.frame()
    expect(f).toContain("✗ disk full")
    expect(f).toContain("# A!")
  })

  test("single-letter global keys are off while open", async () => {
    const t = await open()
    await t.frame()
    t.input.pressKey("END")
    await t.input.typeText("q")
    expect(await t.frame()).toContain("# Aq")
  })
})

describe("editExternal", () => {
  const fake = () => {
    const calls: string[] = []
    return { calls, suspend: async () => void calls.push("suspend"), resume: async () => void calls.push("resume") }
  }
  const tmpEntries = () => readdirSync(tmpdir()).filter((n) => n.startsWith("pm-edit-"))

  test("editExternal uses EDITOR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-test-ed-"))
    const script = join(dir, "ed.sh")
    writeFileSync(script, '#!/bin/sh\necho added >> "$1"\n')
    chmodSync(script, 0o755)
    const prev = { v: process.env.VISUAL, e: process.env.EDITOR }
    delete process.env.VISUAL
    process.env.EDITOR = script
    const before = tmpEntries().length
    try {
      const r = fake()
      expect(await editExternal("hello\n", { renderer: r })).toBe("hello\nadded\n")
      expect(r.calls).toEqual(["suspend", "resume"])
      expect(tmpEntries().length).toBe(before)
    } finally {
      if (prev.v !== undefined) process.env.VISUAL = prev.v
      if (prev.e !== undefined) process.env.EDITOR = prev.e
      else delete process.env.EDITOR
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("null when unchanged or editor fails; still resumes", async () => {
    const r1 = fake()
    expect(await editExternal("same", { renderer: r1, editor: "true" })).toBeNull()
    expect(r1.calls).toEqual(["suspend", "resume"])
    const r2 = fake()
    expect(await editExternal("same", { renderer: r2, editor: "sh -c 'echo x >> \"$1\"; exit 3' --" })).toBeNull()
    expect(r2.calls).toEqual(["suspend", "resume"])
  })

  test("not run in container mode", async () => {
    process.env.PM_MODE = "container"
    try {
      const r = fake()
      expect(await editExternal("x", { renderer: r, editor: "true" })).toBeNull()
      expect(r.calls).toEqual([])
    } finally {
      delete process.env.PM_MODE
    }
  })
})
