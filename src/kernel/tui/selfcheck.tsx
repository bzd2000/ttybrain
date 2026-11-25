// The TUI self-check: renders <TuiApp> on the current runtime with OpenTUI's test renderer and checks the frame,
// and checks that a second boot on the same database writes nothing (read-only boot, also on node:sqlite), that a
// useQuery screen reloads after another connection's commit (data_version) and that an error boundary holds; then
// the loader path: the built-ins discovered from their manifests and their tui entries imported and booted, and
// quick capture (`i`) opened over them with a `#tag` typed, which must render in the project-code colour (the
// textarea's SyntaxStyle highlight).
// With `--expect-screen <title>` it then boots with discovery (the plugins folder from TTYBRAIN_PLUGINS in the
// environment), renders, presses `7` (the first external screen) and requires `7 <title>` in the header.
// Run: `bun src/kernel/tui/selfcheck.tsx` or, after the Node build,
// `node --experimental-ffi dist-node/kernel/tui/selfcheck.js`. Prints `tui ok` on success.
import { rgbToHex, SyntaxStyle } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { definePlugin, type PluginDef } from "../api"
import { fixedClock } from "../clock"
import { runWithContext } from "../context"
import { bootKernel } from "../host"
import { TuiApp, type TuiHandle } from "./app"
import { bootTui } from "./boot"
import { useQuery, useRuntime } from "./data"
import { installTuiModules, loadTuiParts } from "./load"
import { theme } from "./theme"
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

export async function runTuiSelfCheck(opts: { expectScreen?: string } = {}): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "pm-tui-selfcheck-"))
  const env = { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1" }
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
        check(header.includes("ttybrain ·  1 Attention") && header.includes("Fri 13 Nov 2026"), `unexpected header: "${header}"`)
        setup.mockInput.pressKey("2")
        let frame = await settled()
        header = frame.split("\n")[0] ?? ""
        check(header.includes("ttybrain ·  2 Fixture") && frame.includes("fixture screen: 0 things"), `key 2 did not open the Fixture screen: "${header}"`)

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
        check(frame.includes("⚠ Broken: boom") && (frame.split("\n")[0] ?? "").includes("ttybrain ·  3 Broken"), "the error boundary did not contain a throwing screen")
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
  await checkLoaderPath(clock)
  if (opts.expectScreen !== undefined) await checkExternalScreen(clock, opts.expectScreen)
}

// On Node this imports the compiled dist-node/plugins/*/tui/index.js through their package.json manifests.
async function checkLoaderPath(clock: ReturnType<typeof fixedClock>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "pm-tui-selfcheck-"))
  try {
    const kernel = await bootKernel({ env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1" }, clock, discover: true })
    try {
      installTuiModules()
      const parts = await loadTuiParts(kernel)
      check(parts.errors.length === 0, `tui entries failed to load: ${parts.errors.map((e) => e.error).join("; ")}`)
      const ids = parts.builtin.map((p) => p.plugin).sort().join(",")
      check(ids === "actions,boards,inbox,meetings,people,projects" && parts.external.length === 0, `unexpected tui parts: ${ids}`)
      const registry = bootTui(kernel, parts.builtin, { builtin: true, external: parts.external })
      check(registry.errors().length === 0, `tui parts failed to boot: ${registry.errors().map((e) => e.error).join("; ")}`)
      check(registry.screenBySlot(2)?.id !== undefined && registry.globalActions().some((a) => a.key === "i"), "the built-in tui parts registered nothing")
      await checkCapture(kernel, registry)
    } finally {
      await kernel.shutdown()
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// Quick capture over the built-ins: `i` opens it, a typed `#tag` renders, coloured as a project code.
async function checkCapture(kernel: Awaited<ReturnType<typeof bootKernel>>, registry: ReturnType<typeof bootTui>): Promise<void> {
  const write = kernel.runtime("projects")!.self().write as Record<string, (input: unknown) => Promise<unknown>>
  await runWithContext(kernel.context(), () => write.addProject!({ code: "CRM", name: "CRM replatforming" }))
  let handle: TuiHandle | undefined
  const setup = await testRender(() => <TuiApp kernel={kernel} registry={registry} refreshMs={20} expose={(h) => (handle = h)} />, { width: 100, height: 30 })
  const settled = async () => {
    await handle!.idle()
    await setup.renderOnce()
    return setup.captureCharFrame()
  }
  try {
    await settled()
    setup.mockInput.pressKey("i")
    let frame = await settled()
    check(frame.includes("Capture to inbox"), "i did not open quick capture")
    await setup.mockInput.typeText("#CRM call Marie")
    for (let i = 0; i < 50 && !frame.includes("#CRM call Marie"); i++) {
      await new Promise((r) => setTimeout(r, 20))
      frame = await settled()
    }
    check(frame.includes("#CRM call Marie"), `the typed text did not render in quick capture: "${frame}"`)
    const line = setup.captureSpans().lines.find((l) => l.spans.map((s) => s.text).join("").includes("#CRM call Marie"))
    let pos = 0
    let fg: string | undefined
    const at = line?.spans.map((s) => s.text).join("").indexOf("#CRM call") ?? -1
    for (const s of line?.spans ?? []) {
      if (fg === undefined && at < pos + s.text.length) fg = rgbToHex(s.fg)
      pos += s.text.length
    }
    check(fg === theme.cyan, `the #tag in quick capture is not coloured as a project code (${fg})`)
  } finally {
    setup.renderer.destroy()
  }
}

// An external plugin from TTYBRAIN_PLUGINS: its tui entry is loaded through the shared modules and its screen gets key 7.
async function checkExternalScreen(clock: ReturnType<typeof fixedClock>, title: string): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "pm-tui-selfcheck-"))
  const plugins = process.env.TTYBRAIN_PLUGINS
  try {
    const kernel = await bootKernel({ env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1", ...(plugins !== undefined && { TTYBRAIN_PLUGINS: plugins }) }, clock, discover: true })
    try {
      const failed = kernel.plugins.filter((p) => p.status !== "ok")
      check(failed.length === 0, `plugins failed to load: ${failed.map((p) => `${p.id}: ${p.error ?? p.status}`).join("; ")}`)
      installTuiModules()
      const parts = await loadTuiParts(kernel)
      check(parts.errors.length === 0, `tui entries failed to load: ${parts.errors.map((e) => e.error).join("; ")}`)
      const registry = bootTui(kernel, parts.builtin, { builtin: true, external: parts.external })
      check(registry.errors().length === 0, `tui parts failed to boot: ${registry.errors().map((e) => e.error).join("; ")}`)
      let handle: TuiHandle | undefined
      const setup = await testRender(() => <TuiApp kernel={kernel} registry={registry} refreshMs={20} expose={(h) => (handle = h)} />, { width: 100, height: 24 })
      try {
        await setup.renderOnce()
        setup.mockInput.pressKey("7")
        await handle!.idle()
        await setup.renderOnce()
        const header = setup.captureCharFrame().split("\n")[0] ?? ""
        check(header.includes(`ttybrain ·  7 ${title}`), `key 7 did not open the "${title}" screen: "${header}"`)
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
  const at = process.argv.indexOf("--expect-screen")
  const expectScreen = at === -1 ? undefined : process.argv[at + 1]
  if (at !== -1 && !expectScreen) {
    console.error("tui FAILED: --expect-screen needs a title")
    process.exit(1)
  }
  runTuiSelfCheck(expectScreen === undefined ? {} : { expectScreen }).then(
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
