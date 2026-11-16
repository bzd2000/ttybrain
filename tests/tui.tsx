// renderTui: the TUI test helper. Boots `parts` (default: the built-in tui parts) as built-ins and `external`
// after them, renders <TuiApp> with OpenTUI's test renderer, and gives the test the frame, the mock input and
// the navigation store. Always call destroy() in `finally`.
import type { CliRenderer } from "@opentui/core"
import type { MockInput } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import type { Kernel } from "../src/kernel/host"
import { TuiApp, type TuiHandle } from "../src/kernel/tui/app"
import { bootTui } from "../src/kernel/tui/boot"
import type { Nav } from "../src/kernel/tui/nav"
import type { TuiDef } from "../src/kernel/tui/types"
import { builtinTuiParts } from "../src/plugins/tui"

export type RenderedTui = {
  frame(): Promise<string>
  input: MockInput
  settle(): Promise<void>
  nav: Nav
  renderer: CliRenderer
  destroy(): void
}

export async function renderTui(
  kernel: Kernel,
  opts: { width?: number; height?: number; parts?: TuiDef[]; external?: TuiDef[] } = {},
): Promise<RenderedTui> {
  const registry = bootTui(kernel, opts.parts ?? builtinTuiParts, { builtin: true, external: opts.external ?? [] })
  let handle: TuiHandle | undefined
  const setup = await testRender(() => <TuiApp kernel={kernel} registry={registry} expose={(h) => (handle = h)} />, {
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
    input: setup.mockInput,
    settle,
    nav: app.nav,
    renderer: setup.renderer,
    destroy: () => setup.renderer.destroy(),
  }
}
