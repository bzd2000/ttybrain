import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { Config } from "./config"
import { builtinPluginDir, discoverPlugins, installApiModule, type PluginCandidate } from "./loader"
import * as api from "./api"
import { resolvePaths, type Paths } from "./paths"

const temps: string[] = []
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "pm-loader-")))
  temps.push(d)
  return d
}

function config(disabled: string[] = []): Config {
  return { exportDir: "/tmp", staleContactDays: 30, assistant: { provider: "copilot" }, plugins: { disabled, allow: [] } }
}

function setup(pluginsName = "plugins"): { root: string; paths: Paths; builtinDir: string } {
  const root = tmp()
  const builtinDir = join(root, "builtin")
  mkdirSync(builtinDir)
  const paths = resolvePaths({ TTYBRAIN_HOME: root, TTYBRAIN_PLUGINS: join(root, pluginsName) })
  mkdirSync(paths.plugins)
  return { root, paths, builtinDir }
}

type PluginOpts = { id?: string; manifestId?: string | null; version?: string; defVersion?: string; defId?: string; main?: string; pkg?: Record<string, unknown> }

// A tiny hand-written ESM plugin in `dir`.
function plugin(dir: string, o: PluginOpts = {}): void {
  const id = o.id ?? "x"
  mkdirSync(dir, { recursive: true })
  const ttybrain: Record<string, unknown> = { plugin: true }
  if (o.manifestId !== null) ttybrain.id = o.manifestId ?? id
  const pkg = { name: `ttybrain-plugin-${id}`, version: o.version ?? "1.0.0", type: "module", main: "index.js", ttybrain, ...o.pkg }
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg))
  const main =
    o.main ??
    `export default { id: ${JSON.stringify(o.defId ?? id)}, name: "X", version: ${JSON.stringify(o.defVersion ?? "1.0.0")}, apiVersion: 1, activate() {} }\n`
  writeFileSync(join(dir, "index.js"), main)
}

function npmDeps(paths: Paths, deps: Record<string, string>): void {
  writeFileSync(join(paths.plugins, "package.json"), JSON.stringify({ name: "pm-plugins", private: true, dependencies: deps }))
}

const byId = (cs: PluginCandidate[], id: string) => cs.find((c) => c.id === id)

describe("discoverPlugins", () => {
  test("built-ins come first, then folders by name, then npm deps by name", async () => {
    const { paths, builtinDir } = setup()
    plugin(join(builtinDir, "a"), { id: "a" })
    plugin(join(paths.plugins, "zeta"), { id: "zeta" })
    plugin(join(paths.plugins, "alpha"), { id: "alpha" })
    npmDeps(paths, { "ttybrain-plugin-b": "1.0.0" })
    plugin(join(paths.plugins, "node_modules", "ttybrain-plugin-b"), { id: "b" })
    const cs = await discoverPlugins(paths, config(), { builtinDir })
    expect(cs.map((c) => c.id)).toEqual(["a", "alpha", "zeta", "b"])
    expect(cs.map((c) => c.source)).toEqual(["built-in", "folder", "folder", "npm"])
    expect(cs.every((c) => c.error === undefined && c.def !== undefined)).toBe(true)
    expect(cs[0]!.dir).toBe(join(builtinDir, "a"))
    expect(cs[0]!.version).toBe("1.0.0")
    expect(cs[3]!.dir).toBe(join(paths.plugins, "node_modules", "ttybrain-plugin-b"))
  })

  test("the real built-in folder yields the six built-ins", async () => {
    const { paths } = setup()
    const cs = await discoverPlugins(paths, config())
    expect(cs.map((c) => c.id).sort()).toEqual(["actions", "boards", "inbox", "meetings", "people", "projects"])
    for (const c of cs) {
      expect(c.source).toBe("built-in")
      expect(c.error).toBeUndefined()
      expect(c.def?.id).toBe(c.id)
      // boards has no TUI part yet (its board view is still the meetings plugin's).
      expect(c.tui).toBe(c.id === "boards" ? undefined : pathToFileURL(join(builtinPluginDir(), c.id, "tui", "index.tsx")).href)
    }
    const modules = (globalThis as { __TTYBRAIN_MODULES__?: Record<string, Record<string, unknown>> }).__TTYBRAIN_MODULES__
    expect(typeof modules?.["@ttybrain/api"]?.definePlugin).toBe("function")
  })

  test("non-plugins are ignored", async () => {
    const { paths, builtinDir } = setup()
    writeFileSync(join(paths.plugins, "stray.txt"), "hi")
    mkdirSync(join(paths.plugins, "empty"))
    mkdirSync(join(paths.plugins, "notplugin"))
    writeFileSync(join(paths.plugins, "notplugin", "package.json"), JSON.stringify({ name: "notplugin", version: "1.0.0" }))
    mkdirSync(join(paths.plugins, ".hidden"))
    writeFileSync(join(paths.plugins, ".hidden", "package.json"), "{")
    npmDeps(paths, { lodash: "4.0.0" })
    mkdirSync(join(paths.plugins, "node_modules", "lodash"), { recursive: true })
    writeFileSync(join(paths.plugins, "node_modules", "lodash", "package.json"), JSON.stringify({ name: "lodash", version: "4.0.0" }))
    // node_modules itself is not a folder plugin, even with a plugin manifest in it.
    plugin(join(paths.plugins, "node_modules"), { id: "nm" })
    const cs = await discoverPlugins(paths, config(), { builtinDir })
    expect(cs).toEqual([])
  })

  test("broken candidates fail with a reason", async () => {
    const { paths, builtinDir } = setup()
    const p = paths.plugins
    mkdirSync(join(p, "badjson"))
    writeFileSync(join(p, "badjson", "package.json"), "{ not json")
    plugin(join(p, "noid"), { id: "noid", manifestId: null })
    plugin(join(p, "throws"), { id: "throws", main: `throw new Error("boom on import")\n` })
    plugin(join(p, "nodefault"), { id: "nodefault", main: `export const x = 1\n` })
    plugin(join(p, "mismatch"), { id: "x", defId: "y" })
    plugin(join(p, "version"), { id: "ver", version: "1.0.1", defVersion: "1.0.0" })
    npmDeps(paths, { "ttybrain-plugin-missing": "1.0.0" })
    const cs = await discoverPlugins(paths, config(), { builtinDir })
    expect(cs.map((c) => c.id)).toEqual(["badjson", "x", "nodefault", "noid", "throws", "ver", "ttybrain-plugin-missing"])
    expect(cs.every((c) => c.def === undefined)).toBe(true)
    expect(byId(cs, "badjson")!.error).toContain("invalid package.json")
    expect(byId(cs, "noid")!.error).toContain("package.json has no ttybrain.id")
    expect(byId(cs, "throws")!.error).toContain("boom on import")
    expect(byId(cs, "nodefault")!.error).toContain("main has no default export")
    expect(byId(cs, "x")!.error).toContain('ttybrain.id "x" does not match the plugin id "y"')
    expect(byId(cs, "ver")!.error).toContain("package.json version 1.0.1 does not match the plugin version 1.0.0")
    expect(byId(cs, "ttybrain-plugin-missing")!.error).toContain(`not installed; run npm install in ${p}`)
    expect(byId(cs, "ttybrain-plugin-missing")!.source).toBe("npm")
  })

  test("an external id taken by a built-in fails", async () => {
    const { paths, builtinDir } = setup()
    plugin(join(builtinDir, "a"), { id: "a" })
    plugin(join(paths.plugins, "copy"), { id: "a" })
    const cs = await discoverPlugins(paths, config(), { builtinDir })
    expect(cs.map((c) => [c.id, c.source])).toEqual([
      ["a", "built-in"],
      ["a", "folder"],
    ])
    expect(cs[0]!.error).toBeUndefined()
    expect(cs[1]!.error).toContain('plugin id "a" is taken by a built-in plugin')
    expect(cs[1]!.def).toBeUndefined()
  })

  test("disabled plugins are not imported", async () => {
    const { root, paths, builtinDir } = setup()
    const marker = join(root, "imported")
    plugin(join(paths.plugins, "x"), { id: "x", main: `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(marker)}, "x")\nexport default { id: "x", name: "X", version: "1.0.0", apiVersion: 1, activate() {} }\n` })
    const cs = await discoverPlugins(paths, config(["x"]), { builtinDir })
    expect(cs).toHaveLength(1)
    expect(cs[0]!.id).toBe("x")
    expect(cs[0]!.disabled).toBe(true)
    expect(cs[0]!.def).toBeUndefined()
    expect(cs[0]!.error).toBeUndefined()
    expect(existsSync(marker)).toBe(false)
  })

  test("a disabled npm dependency that is not installed is listed disabled, not failed", async () => {
    const { paths, builtinDir } = setup()
    npmDeps(paths, { "ttybrain-plugin-gone": "1.0.0" })
    const cs = await discoverPlugins(paths, config(["ttybrain-plugin-gone"]), { builtinDir })
    expect(cs).toEqual([{ id: "ttybrain-plugin-gone", source: "npm", dir: join(paths.plugins, "node_modules", "ttybrain-plugin-gone"), disabled: true }])
  })

  test("a hanging import times out", async () => {
    const { paths, builtinDir } = setup()
    plugin(join(paths.plugins, "x"), { id: "x", main: `await new Promise(() => {})\nexport default {}\n` })
    const cs = await discoverPlugins(paths, config(), { builtinDir, timeoutMs: 200 })
    expect(cs).toHaveLength(1)
    expect(cs[0]!.error).toBe("x: timed out after 200 ms while importing")
  })

  test("a plugin dir path with spaces loads", async () => {
    const { paths, builtinDir } = setup("my plugins")
    plugin(join(paths.plugins, "sp ace"), { id: "sp" })
    const cs = await discoverPlugins(paths, config(), { builtinDir })
    expect(cs.map((c) => [c.id, c.error, c.def?.id])).toEqual([["sp", undefined, "sp"]])
  })

  test("an npm symlinked dependency loads", async () => {
    const { root, paths, builtinDir } = setup()
    const real = join(root, "elsewhere", "s")
    plugin(real, { id: "s" })
    npmDeps(paths, { "ttybrain-plugin-s": "file:../elsewhere/s" })
    mkdirSync(join(paths.plugins, "node_modules"))
    symlinkSync(real, join(paths.plugins, "node_modules", "ttybrain-plugin-s"), "dir")
    const cs = await discoverPlugins(paths, config(), { builtinDir })
    expect(cs.map((c) => [c.id, c.source, c.error, c.def?.id])).toEqual([["s", "npm", undefined, "s"]])
    expect(cs[0]!.dir).toBe(real)
  })
})

test("installApiModule adds @ttybrain/api to the existing shared-module object in place", () => {
  const g = globalThis as { __TTYBRAIN_MODULES__?: Record<string, unknown> }
  const before = g.__TTYBRAIN_MODULES__
  const shared: Record<string, unknown> = { other: 1 }
  g.__TTYBRAIN_MODULES__ = shared
  try {
    installApiModule()
    expect(g.__TTYBRAIN_MODULES__).toBe(shared)
    expect(shared).toEqual({ other: 1, "@ttybrain/api": api })
  } finally {
    g.__TTYBRAIN_MODULES__ = before
  }
})
