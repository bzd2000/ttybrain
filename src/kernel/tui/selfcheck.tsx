// The TUI self-check: renders <TuiApp> on the current runtime with OpenTUI's test renderer and checks the frame,
// and checks that a second boot on the same database writes nothing (read-only boot, also on node:sqlite).
// Run: `bun src/kernel/tui/selfcheck.tsx` or, after the Node build,
// `node --experimental-ffi dist-node/kernel/tui/selfcheck.js`. Prints `tui ok` on success.
import { testRender } from "@opentui/solid"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { definePlugin, type PluginDef } from "../api"
import { fixedClock } from "../clock"
import { bootKernel } from "../host"
import { TuiApp } from "./app"
import { bootTui } from "./boot"
import { defineTui } from "./types"

// A fixture plugin with a migration and a published view, so the second boot has something it could rewrite.
const fixture: PluginDef = definePlugin({
  id: "fixture",
  name: "Fixture",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.migration("001", async (db) => {
      await db.schema
        .createTable("thing")
        .addColumn("id", "integer", (c) => c.primaryKey())
        .addColumn("title", "text", (c) => c.notNull())
        .execute()
    })
    ctx.publish("thing", { version: 1, columns: { id: "integer", title: "text" }, query: (db) => db.selectFrom("thing").select(["id", "title"]) })
  },
})

const fixtureTui = defineTui({
  plugin: "fixture",
  activate: (ui) => ui.screen({ id: "fixture", title: "Fixture", slot: 2, component: () => <text>fixture screen</text> }),
})

function check(cond: boolean, what: string): void {
  if (!cond) throw new Error(what)
}

export async function runTuiSelfCheck(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "pm-tui-selfcheck-"))
  const env = { PM_HOME: home, PM_TEST: "1" }
  const clock = fixedClock("2026-11-13")
  try {
    const kernel = await bootKernel({ env, plugins: [fixture], clock })
    try {
      const before = kernel.db.dataVersion()
      const second = await bootKernel({ env, plugins: [fixture], clock })
      await second.shutdown()
      const after = kernel.db.dataVersion()
      check(after === before, `a second boot on the same database wrote to it (data_version ${before} → ${after})`)

      const registry = bootTui(kernel, [fixtureTui], { builtin: true })
      const setup = await testRender(() => <TuiApp kernel={kernel} registry={registry} />, { width: 80, height: 24 })
      try {
        await setup.renderOnce()
        let header = setup.captureCharFrame().split("\n")[0] ?? ""
        check(header.includes("pm · 1 Overview") && header.includes("Fri 13 Nov 2026"), `unexpected header: "${header}"`)
        setup.mockInput.pressKey("2")
        await setup.renderOnce()
        const frame = setup.captureCharFrame()
        header = frame.split("\n")[0] ?? ""
        check(header.includes("pm · 2 Fixture") && frame.includes("fixture screen"), `key 2 did not open the Fixture screen: "${header}"`)
      } finally {
        setup.renderer.destroy()
      }
    } finally {
      await kernel.shutdown()
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function isEntry(): boolean {
  const script = process.argv[1]
  if (!script) return false
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntry()) {
  runTuiSelfCheck().then(
    () => {
      console.log("tui ok")
      process.exit(0)
    },
    (e) => {
      console.error("tui FAILED:", e instanceof Error ? e.message : e)
      process.exit(1)
    },
  )
}
