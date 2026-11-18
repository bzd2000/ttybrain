// renderTui: the TUI test helper. Boots `parts` (default: the built-in tui parts) as built-ins and `external`
// after them, renders <TuiApp> with OpenTUI's test renderer, and gives the test the frame, the mock input and
// the navigation store. Always call destroy() in `finally`.
import type { CapturedFrame, CliRenderer } from "@opentui/core"
import type { MockInput } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import type { Kernel } from "../src/kernel/host"
import { TuiApp, type TuiHandle } from "../src/kernel/tui/app"
import { bootTui } from "../src/kernel/tui/boot"
import { clearMessages } from "../src/kernel/tui/messages"
import type { Nav } from "../src/kernel/tui/nav"
import type { TuiDef } from "../src/kernel/tui/types"
import { builtinTuiParts } from "./builtins"

export type RenderedTui = {
  frame(): Promise<string>
  // The frame with colours (each line's spans with fg/bg), after settling like frame().
  spans(): Promise<CapturedFrame>
  input: MockInput
  settle(): Promise<void>
  // The frame now, without waiting for in-flight loads (to look at a screen while a load or an act runs).
  peek(): Promise<string>
  nav: Nav
  renderer: CliRenderer
  destroy(): void
}

export async function renderTui(
  kernel: Kernel,
  // refreshMs: the live-refresh interval (default 50 here, 1000 in the app); draftMs: the draft debounce (default
  // 1000, as in the app).
  opts: { width?: number; height?: number; parts?: TuiDef[]; external?: TuiDef[]; refreshMs?: number; draftMs?: number } = {},
): Promise<RenderedTui> {
  clearMessages() // the message store is module-wide: start without another test's message
  const registry = bootTui(kernel, opts.parts ?? builtinTuiParts, { builtin: true, external: opts.external ?? [] })
  let handle: TuiHandle | undefined
  const setup = await testRender(() => <TuiApp kernel={kernel} registry={registry} refreshMs={opts.refreshMs ?? 50} draftMs={opts.draftMs} expose={(h) => (handle = h)} />, {
    width: opts.width ?? 100,
    height: opts.height ?? 30,
  })
  if (!handle) throw new Error("TuiApp did not expose its handle")
  const app = handle
  const settle = async () => {
    await app.idle()
    await setup.renderOnce()
  }
  return {
    async frame() {
      await settle()
      return setup.captureCharFrame()
    },
    async spans() {
      await settle()
      return setup.captureSpans()
    },
    async peek() {
      await setup.renderOnce()
      return setup.captureCharFrame()
    },
    input: setup.mockInput,
    settle,
    nav: app.nav,
    renderer: setup.renderer,
    destroy: () => {
      setup.renderer.destroy()
      clearMessages()
    },
  }
}
