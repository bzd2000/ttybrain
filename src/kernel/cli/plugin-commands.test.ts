// `pm plugin enable|disable <id>`: they edit `plugins.disabled` in the config file; the change applies on the
// next run. Boots discover the real built-in folder, on one TTYBRAIN_HOME per test, so a fresh boot sees the change.
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fixedClock } from "../clock"
import { bootKernel, type Kernel } from "../host"
import { runCli } from "./dispatch"

let home: string
let kernels: Kernel[] = []
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pm-plugin-cmd-"))
})
afterEach(async () => {
  for (const k of kernels) await k.shutdown()
  kernels = []
  rmSync(home, { recursive: true, force: true })
})

async function boot(): Promise<Kernel> {
  const k = await bootKernel({ env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1" }, discover: true, clock: fixedClock("2026-11-13") })
  kernels.push(k)
  return k
}

async function run(k: Kernel, ...argv: string[]) {
  const o = { out: "", err: "" }
  const code = await runCli(argv, k, { out: (s) => void (o.out += s), err: (s) => void (o.err += s), stdin: async () => "" })
  return { code, ...o }
}

const configFile = () => join(home, "config.json")
const config = () => JSON.parse(readFileSync(configFile(), "utf8"))

test("disable adds the id to plugins.disabled, keeping other config keys", async () => {
  writeFileSync(configFile(), '{"staleContactDays": 14}')
  const k = await boot()
  expect(await run(k, "plugin", "disable", "meetings")).toEqual({ code: 0, out: "disabled meetings\n", err: "" })
  expect(config()).toEqual({ staleContactDays: 14, plugins: { disabled: ["meetings"] } })
  expect(Object.keys(config())).toEqual(["staleContactDays", "plugins"])
})

test("disable names the plugins that will be skipped too", async () => {
  const k = await boot()
  expect(await run(k, "plugin", "disable", "projects")).toEqual({ code: 0, out: "disabled projects; also skipped: meetings (requires projects)\n", err: "" })
  writeFileSync(configFile(), "{}")
  const json = await run(k, "plugin", "disable", "projects", "--json")
  expect(json.code).toBe(0)
  expect(JSON.parse(json.out)).toEqual({ id: "projects", disabled: true, alsoSkipped: ["meetings"] })
  // Transitively: people → projects → meetings; meetings requires both.
  expect((await run(k, "plugin", "disable", "people")).out).toBe(
    "disabled people; also skipped: meetings (requires people, projects), projects (requires people)\n",
  )
  expect(config()).toEqual({ plugins: { disabled: ["projects", "people"] } })
})

test("enable removes it; enabling twice is fine", async () => {
  writeFileSync(configFile(), JSON.stringify({ plugins: { disabled: ["meetings", "inbox"], allow: ["x"] } }))
  const k = await boot()
  expect(await run(k, "plugin", "enable", "meetings")).toEqual({ code: 0, out: "enabled meetings\n", err: "" })
  const after = readFileSync(configFile(), "utf8")
  expect(JSON.parse(after)).toEqual({ plugins: { disabled: ["inbox"], allow: ["x"] } })
  expect(await run(k, "plugin", "enable", "meetings")).toEqual({ code: 0, out: "enabled meetings\n", err: "" })
  expect(readFileSync(configFile(), "utf8")).toBe(after)
  const json = await run(k, "plugin", "enable", "meetings", "--json")
  expect(JSON.parse(json.out)).toEqual({ id: "meetings", disabled: false })
  // Disabling twice does not repeat the id.
  await run(k, "plugin", "disable", "inbox")
  expect(config().plugins.disabled).toEqual(["inbox"])
})

test("enable of an id that is no longer installed still removes it", async () => {
  writeFileSync(configFile(), JSON.stringify({ plugins: { disabled: ["gone"] } }))
  const k = await boot()
  expect(await run(k, "plugin", "enable", "gone")).toEqual({ code: 0, out: "enabled gone\n", err: "" })
  expect(config()).toEqual({ plugins: { disabled: [] } })
})

test("enable notes that TTYBRAIN_CONFIG_JSON still disables the plugin", async () => {
  writeFileSync(configFile(), JSON.stringify({ plugins: { disabled: ["meetings"] } }))
  const envJson = '{"plugins":{"disabled":["meetings"]}}'
  // The command reads TTYBRAIN_CONFIG_JSON from the process environment, which pm's entry point boots with.
  const before = process.env.TTYBRAIN_CONFIG_JSON
  process.env.TTYBRAIN_CONFIG_JSON = envJson
  try {
    const k = await bootKernel({ env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1", TTYBRAIN_CONFIG_JSON: envJson }, discover: true, clock: fixedClock("2026-11-13") })
    kernels.push(k)
    expect(await run(k, "plugin", "enable", "meetings")).toEqual({ code: 0, out: "enabled meetings; note: TTYBRAIN_CONFIG_JSON still disables it\n", err: "" })
    expect(config()).toEqual({ plugins: { disabled: [] } })
    const json = await run(k, "plugin", "enable", "meetings", "--json")
    expect(JSON.parse(json.out)).toEqual({ id: "meetings", disabled: false, stillDisabledBy: "TTYBRAIN_CONFIG_JSON" })
    // TTYBRAIN_CONFIG_JSON that does not disable it: no note.
    process.env.TTYBRAIN_CONFIG_JSON = '{"staleContactDays": 3}'
    expect(await run(k, "plugin", "enable", "meetings")).toEqual({ code: 0, out: "enabled meetings\n", err: "" })
  } finally {
    if (before === undefined) delete process.env.TTYBRAIN_CONFIG_JSON
    else process.env.TTYBRAIN_CONFIG_JSON = before
  }
})

test("unknown id", async () => {
  const k = await boot()
  const r = await run(k, "plugin", "disable", "nope")
  expect(r).toEqual({ code: 2, out: "", err: 'error: no plugin "nope"\nhint: run "pm plugin list"\n' })
  const e = await run(k, "plugin", "enable", "nope")
  expect(e).toEqual({ code: 2, out: "", err: 'error: no plugin "nope"\nhint: run "pm plugin list"\n' })
})

test("data survives disable and enable", async () => {
  let k = await boot()
  expect((await run(k, "meeting", "add", "Board", "--date", "2026-12-04")).code).toBe(0)
  const shown = await run(k, "meeting", "show", "M-1")
  expect(shown.code).toBe(0)
  expect((await run(k, "plugin", "disable", "meetings")).code).toBe(0)

  k = await boot()
  expect(k.plugins.find((p) => p.id === "meetings")?.status).toBe("disabled")
  const absent = await run(k, "meeting", "show", "M-1")
  expect(absent.code).toBe(1)
  expect(absent.err).toContain('unknown command "meeting"')
  expect((await run(k, "plugin", "enable", "meetings")).out).toBe("enabled meetings\n")

  k = await boot()
  expect(await run(k, "meeting", "show", "M-1")).toEqual(shown)
  expect(shown.out).toContain("Board")
})
