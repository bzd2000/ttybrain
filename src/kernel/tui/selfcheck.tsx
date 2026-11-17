// The TUI self-check: renders <TuiApp> on the current runtime with OpenTUI's test renderer and checks the frame,
// and checks that a second boot on the same database writes nothing (read-only boot, also on node:sqlite), that a
// useQuery screen reloads after another connection's commit (data_version) and that an error boundary holds.
// Run: `bun src/kernel/tui/selfcheck.tsx` or, after the Node build,
// `node --experimental-ffi dist-node/kernel/tui/selfcheck.js`. Prints `tui ok` on success.
import { SyntaxStyle } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { definePlugin, type PluginDef } from "../api"
import { fixedClock } from "../clock"
import { bootKernel } from "../host"
import { TuiApp, type TuiHandle } from "./app"
import { bootTui } from "./boot"
import { useQuery, useRuntime } from "./data"
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

function FixtureScreen() {
  const rt = useRuntime()
  const q = useQuery(() => rt.data.selectFrom("thing").select("title").execute())
  return <text>{`fixture screen: ${q.data()?.length ?? "-"} things`}</text>
}

function Broken(): any {
  throw new Error("boom")
}

const fixtureTui = defineTui({
  plugin: "fixture",
  activate: (ui) => {
    ui.screen({ id: "fixture", title: "Fixture", slot: 2, component: FixtureScreen })
    ui.screen({ id: "broken", title: "Broken", slot: 3, component: Broken })
  },
})

// <markdown> inside a scrollbox, as the project Context tab uses it.
function MarkdownProbe() {
  const style = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, useRenderer().nativeScene)
  return (
    <scrollbox flexGrow={1}>
      <markdown content={"# Background\nLegacy CRM"} syntaxStyle={style} />
    </scrollbox>
  )
}

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
      let handle: TuiHandle | undefined
      const setup = await testRender(() => <TuiApp kernel={kernel} registry={registry} refreshMs={20} expose={(h) => (handle = h)} />, {
        width: 80,
        height: 24,
      })
      const settled = async () => {
        await handle!.idle()
        await setup.renderOnce()
        return setup.captureCharFrame()
      }
      try {
        await setup.renderOnce()
        let header = setup.captureCharFrame().split("\n")[0] ?? ""
        check(header.includes("pm · 1 Overview") && header.includes("Fri 13 Nov 2026"), `unexpected header: "${header}"`)
        setup.mockInput.pressKey("2")
        let frame = await settled()
        header = frame.split("\n")[0] ?? ""
        check(header.includes("pm · 2 Fixture") && frame.includes("fixture screen: 0 things"), `key 2 did not open the Fixture screen: "${header}"`)

        // Another connection commits: live refresh sees data_version change and the query reloads.
        const other = await bootKernel({ env, plugins: [fixture], clock })
        other.db.raw.exec("INSERT INTO fixture_thing (title) VALUES ('x')")
        await other.shutdown()
        for (let i = 0; i < 50 && !frame.includes("fixture screen: 1 things"); i++) {
          await new Promise((r) => setTimeout(r, 20))
          frame = await settled()
        }
        check(frame.includes("fixture screen: 1 things"), "the screen did not reload after another connection's write")

        setup.mockInput.pressKey("3")
        frame = await settled()
        check(frame.includes("⚠ Broken: boom") && (frame.split("\n")[0] ?? "").includes("pm · 3 Broken"), "the error boundary did not contain a throwing screen")
      } finally {
        setup.renderer.destroy()
      }

      const md = await testRender(() => <MarkdownProbe />, { width: 40, height: 6 })
      try {
        let text = ""
        for (let i = 0; i < 40 && !text.includes("Legacy CRM"); i++) {
          await new Promise((r) => setTimeout(r, 25))
          await md.renderOnce()
          text = md.captureCharFrame()
        }
        check(text.includes("Background") && !text.includes("# Background") && text.includes("Legacy CRM"), `<markdown> did not render: "${text.trim()}"`)
      } finally {
        md.renderer.destroy()
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
