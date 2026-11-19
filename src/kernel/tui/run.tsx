// The TUI entry: installs the shared UI modules, loads each loaded plugin's tui entry (load.ts), boots the parts
// (built-ins with their screen slots, the others after them), renders <TuiApp> and resolves once the renderer is
// destroyed (`q`, Ctrl+C, or the shutdown handler). SIGHUP/SIGTERM are left to the caller's shutdown handler,
// which destroys the renderer (restoring the terminal) before it closes the database.
import { createCliRenderer, type CliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import type { Kernel } from "../host"
import { TuiApp } from "./app"
import { bootTui } from "./boot"
import { installTuiModules, loadTuiParts } from "./load"

// OpenTUI's default exit signals minus SIGHUP and SIGTERM (ttybrain's shutdown handler owns those).
const EXIT_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGQUIT", "SIGABRT", "SIGPIPE", "SIGBUS"]

export async function runTui(
  kernel: Kernel,
  opts: { renderer?: CliRenderer; onRenderer?: (renderer: CliRenderer) => void } = {},
): Promise<void> {
  installTuiModules()
  const { builtin, external, errors } = await loadTuiParts(kernel)
  const registry = bootTui(kernel, builtin, { builtin: true, external })
  for (const e of errors) registry.recordError(e.plugin, e.error) // Help's "Plugin problems"
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
