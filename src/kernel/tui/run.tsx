// The TUI entry: boots the tui parts (as built-ins), renders <TuiApp> and resolves once the renderer is
// destroyed (`q`, Ctrl+C, or the shutdown handler). SIGHUP/SIGTERM are left to the caller's shutdown handler,
// which destroys the renderer (restoring the terminal) before it closes the database.
import { createCliRenderer, type CliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import type { Kernel } from "../host"
import { TuiApp } from "./app"
import { bootTui } from "./boot"
import type { TuiDef } from "./types"

// OpenTUI's default exit signals minus SIGHUP and SIGTERM (pm's shutdown handler owns those).
const EXIT_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGQUIT", "SIGABRT", "SIGPIPE", "SIGBUS"]

export async function runTui(
  kernel: Kernel,
  parts: TuiDef[],
  opts: { renderer?: CliRenderer; onRenderer?: (renderer: CliRenderer) => void } = {},
): Promise<void> {
  const registry = bootTui(kernel, parts, { builtin: true })
  const renderer = opts.renderer ?? (await createCliRenderer({ exitOnCtrlC: true, exitSignals: EXIT_SIGNALS }))
  opts.onRenderer?.(renderer)
  const destroyed = new Promise<void>((resolve) => {
    if (renderer.isDestroyed) resolve()
    else renderer.once("destroy", () => resolve())
  })
  await render(() => <TuiApp kernel={kernel} registry={registry} />, renderer)
  await destroyed
  await renderer.closed
}
