import { createTestRenderer } from "@opentui/core/testing"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createSignal, onCleanup, onMount } from "solid-js"
import { isSelected } from "../../../tests/design"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { builtinPlugins, builtinTuiParts } from "../../../tests/builtins"
import { fitHints } from "./frame"
import { useKeys, useScreenKeys } from "./keys"
import { runTui } from "./run"
import { defineTui, type TuiDef } from "./types"

function PlainScreen() {
  return <text>test screen</text>
}

// Focuses an input and holds text focus while it is focused (and no overlay sits on top).
function InputScreen() {
  const keys = useKeys()
  onMount(() => keys.textFocus(true))
  onCleanup(() => keys.textFocus(false))
  return (
    <box flexDirection="column">
      <text>test screen</text>
      <input width={20} focused={keys.active()} />
    </box>
  )
}

const testPart = (component: () => any = PlainScreen): TuiDef =>
  defineTui({ plugin: "inbox", activate: (ui) => ui.screen({ id: "t", title: "Test", slot: 2, component }) })

let kernel: TestKernel
let tui: RenderedTui | undefined
beforeEach(async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
})
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel.cleanup()
})

describe("status bar", () => {
  test("fitHints keeps whole hints and the pinned ones", () => {
    const hints = [
      { key: "Enter", label: "open" },
      { key: "n", label: "new" },
      { key: "e", label: "edit" },
      { key: "?", label: "help" },
      { key: "q", label: "quit" },
    ]
    // Unpinned: padding 1 + "enter open" 10 + 3 + "n new" 5 + 3 + "e edit" 6 = 28; "? help" would need 9 more.
    expect(fitHints(hints, 28).map((h) => h.key)).toEqual(["Enter", "n", "e"])
    expect(fitHints(hints, 27).map((h) => h.key)).toEqual(["Enter", "n"])
    // Pinned: 1 + "enter open" 10 + 3 + "? help" 6 + 3 + "q quit" 6 = 29; "n new" needs 8 more.
    expect(fitHints(hints, 29, ["?", "q"]).map((h) => h.key)).toEqual(["Enter", "?", "q"])
    expect(fitHints(hints, 37, ["?", "q"]).map((h) => h.key)).toEqual(["Enter", "n", "?", "q"])
    expect(fitHints(hints, 200, ["?", "q"])).toEqual(hints)
  })
})

const firstLine = (frame: string) => frame.split("\n")[0]!

describe("TUI shell", () => {
  test("header shows screen chip and date", async () => {
    tui = await renderTui(kernel, { parts: builtinTuiParts })
    const line = firstLine(await tui.frame())
    expect(line).toContain("ttybrain ·  1 Attention ▾")
    expect(line).toContain("Fri 13 Nov 2026")
  })

  test("number keys switch screens", async () => {
    tui = await renderTui(kernel, { parts: [testPart()] })
    tui.input.pressKey("2")
    let frame = await tui.frame()
    expect(firstLine(frame)).toContain("ttybrain ·  2 Test ▾")
    expect(frame).toContain("test screen")
    tui.input.pressKey("3")
    frame = await tui.frame()
    expect(firstLine(frame)).toContain("ttybrain ·  2 Test ▾")
    expect(frame).toContain("test screen")
    expect(tui.nav.route()).toEqual({ kind: "screen", screen: "t" })
  })

  test("g opens switcher", async () => {
    tui = await renderTui(kernel, { parts: [testPart()] })
    tui.input.pressKey("g")
    const frame = await tui.frame()
    expect(frame).toContain("1  Attention")
    expect(frame).toContain("2  Test")
    tui.input.pressKey("j")
    await tui.settle()
    tui.input.pressEnter()
    const after = await tui.frame()
    expect(firstLine(after)).toContain("ttybrain ·  2 Test ▾")
    expect(after).toContain("test screen")
  })

  test("Esc goes back", async () => {
    tui = await renderTui(kernel, { parts: [testPart()] })
    tui.input.pressKey("2")
    expect(firstLine(await tui.frame())).toContain("ttybrain ·  2 Test ▾")
    tui.input.pressEscape()
    await Bun.sleep(30) // a lone ESC is flushed by the input parser's timeout
    const frame = await tui.frame()
    expect(firstLine(frame)).toContain("ttybrain ·  1 Attention ▾")
    expect(frame).not.toContain("test screen")
  })

  test("? lists plugin problems", async () => {
    const ghost = defineTui({ plugin: "ghost", activate: () => {} })
    tui = await renderTui(kernel, { parts: [ghost] })
    tui.input.pressKey("?")
    const frame = await tui.frame()
    expect(frame).toContain("Plugin problems")
    expect(frame).toContain('tui part for "ghost": plugin is not loaded')
  })

  test("text field disables single-letter keys", async () => {
    tui = await renderTui(kernel, { parts: [testPart(InputScreen)] })
    tui.input.pressKey("2")
    expect(await tui.frame()).toContain("test screen")
    await tui.input.typeText("q2g?")
    const frame = await tui.frame()
    expect(frame).toContain("q2g?")
    expect(firstLine(frame)).toContain("ttybrain ·  2 Test ▾")
    expect(frame).not.toContain("Plugin problems")
    expect(frame).not.toContain("1 Attention")
    expect(tui.renderer.isDestroyed).toBe(false)
  })

  test("an open overlay takes keys before the screen below it", async () => {
    function CountingScreen() {
      const [n, setN] = createSignal(0)
      useScreenKeys((key) => {
        if (key.name === "j") {
          key.preventDefault()
          setN((x) => x + 1)
        }
      })
      return <text>{`j presses: ${n()}`}</text>
    }
    tui = await renderTui(kernel, { parts: [testPart(CountingScreen)] })
    tui.input.pressKey("2")
    tui.input.pressKey("j")
    expect(await tui.frame()).toContain("j presses: 1")
    tui.input.pressKey("g")
    expect(isSelected(await tui.spans(), "2  Test")).toBe(true)
    tui.input.pressKey("k")
    tui.input.pressKey("k")
    await tui.settle()
    tui.input.pressKey("j")
    const spans = await tui.spans()
    expect(isSelected(spans, "2  Test")).toBe(true)
    expect(isSelected(spans, "1  Attention")).toBe(false)
    // (The switcher hangs over the count; close it to read it.)
    tui.input.pressEscape()
    await Bun.sleep(30) // a lone ESC is flushed by the input parser's timeout
    expect(await tui.frame()).toContain("j presses: 1")
  })

  test("while typing, useScreenKeys drops printable keys and Enter unless the handler opts in with whileTyping", async () => {
    function TypingScreen() {
      const keys = useKeys()
      const [seen, setSeen] = createSignal<string[]>([])
      const [owner, setOwner] = createSignal<string[]>([])
      useScreenKeys((key) => setSeen((s) => [...s, key.name]))
      useScreenKeys((key) => setOwner((s) => [...s, key.name]), { whileTyping: true })
      onMount(() => keys.textFocus(true))
      onCleanup(() => keys.textFocus(false))
      return (
        <box flexDirection="column">
          <text>{`plain: ${seen().join(",")}`}</text>
          <text>{`owner: ${owner().join(",")}`}</text>
          <input width={20} focused={keys.active()} />
        </box>
      )
    }
    tui = await renderTui(kernel, { parts: [testPart(TypingScreen)] })
    tui.input.pressKey("2")
    await tui.frame()
    tui.input.pressKey("x")
    tui.input.pressEnter()
    tui.input.pressArrow("down")
    const frame = await tui.frame()
    expect(frame).toContain("plain: down")
    expect(frame).toContain("owner: x,return,down")
  })

  test("q quits", async () => {
    const setup = await createTestRenderer({ width: 100, height: 30 })
    try {
      let resolved = false
      const done = runTui(kernel, { renderer: setup.renderer }).then(() => (resolved = true))
      // runTui loads the tui entries before it renders.
      // Up to 400 rounds of 25 ms (about 10 s).
      let first = ""
      for (let i = 0; i < 400; i++) {
        await setup.renderOnce()
        first = firstLine(setup.captureCharFrame())
        if (first.includes("ttybrain ·  1 Attention")) break
        await new Promise((r) => setTimeout(r, 25))
      }
      if (!first.includes("ttybrain ·  1 Attention")) throw new Error(`timed out after about 10 s waiting for "ttybrain ·  1 Attention"; first line: ${first}`)
      expect(first).toContain("ttybrain ·  1 Attention ▾")
      expect(resolved).toBe(false)
      setup.mockInput.pressKey("q")
      await done
      expect(resolved).toBe(true)
      expect(setup.renderer.isDestroyed).toBe(true)
    } finally {
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    }
  }, 15_000)

  test("too small message", async () => {
    tui = await renderTui(kernel, { parts: [testPart()], width: 50, height: 12 })
    const frame = await tui.frame()
    expect(frame).toContain("Terminal too small (need 60×15)")
    expect(frame).not.toContain("No panels")
  })
})
