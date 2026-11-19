// pm works with any built-in switched off, and with all four off (design §3.6): the CLI lists only what is
// loaded, `pm plugin list` shows the disabled and skipped plugins, and the TUI renders Overview. Boots discover
// the real built-in folder; the config disables the plugins.
import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fixedClock } from "../src/kernel/clock"
import { runCli } from "../src/kernel/cli/dispatch"
import { bootKernel, type Kernel } from "../src/kernel/host"
import { loadTuiParts } from "../src/kernel/tui/load"
import { renderTui, type RenderedTui } from "./tui"

const BUILTINS = ["people", "projects", "meetings", "inbox"]
// The hard `requires` chain: disabling one skips these too.
const DEPENDANTS: Record<string, string[]> = { people: ["projects", "meetings"], projects: ["meetings"], meetings: [], inbox: [] }
const KERNEL_THINGS = ["help", "guide", "plugin", "report"]

let home: string | undefined
let kernel: Kernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.shutdown()
  kernel = undefined
  if (home) rmSync(home, { recursive: true, force: true })
  home = undefined
})

async function boot(disabled: string[]): Promise<Kernel> {
  home = mkdtempSync(join(tmpdir(), "pm-without-"))
  const env = { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1", TTYBRAIN_CONFIG_JSON: JSON.stringify({ plugins: { disabled } }) }
  kernel = await bootKernel({ env, discover: true, clock: fixedClock("2026-11-13") })
  return kernel
}

async function run(k: Kernel, ...argv: string[]) {
  const o = { out: "", err: "" }
  const code = await runCli(argv, k, { out: (s) => void (o.out += s), err: (s) => void (o.err += s), stdin: async () => "" })
  return { code, ...o }
}

// Which plugin registers which command things, from a boot with everything on.
async function thingsByPlugin(): Promise<Map<string, Set<string>>> {
  const k = await boot([])
  const map = new Map<string, Set<string>>()
  for (const c of k.commands.list()) {
    if (c.def.thing === "report") continue // reports are the kernel's thing, shared by every plugin
    if (!map.has(c.plugin)) map.set(c.plugin, new Set())
    map.get(c.plugin)!.add(c.def.thing)
  }
  await k.shutdown()
  kernel = undefined
  rmSync(home!, { recursive: true, force: true })
  home = undefined
  return map
}

const cases: Array<[string, string[]]> = [...BUILTINS.map((id): [string, string[]] => [id, [id]]), ["all four", BUILTINS]]

test.each(cases)("pm works with %s disabled", async (_name, disabled) => {
  const owners = await thingsByPlugin()
  const skipped = [...new Set(disabled.flatMap((id) => DEPENDANTS[id]!))].filter((id) => !disabled.includes(id))
  const off = new Set([...disabled, ...skipped])
  const k = await boot(disabled)

  // Help: exit 0, and exactly the loaded plugins' things plus the kernel's.
  const help = await run(k, "help", "--json")
  expect(help.code).toBe(0)
  const things = new Set((JSON.parse(help.out).commands as Array<{ command: string }>).map((c) => c.command.split(" ")[0]!))
  for (const [plugin, own] of owners) for (const t of own) expect(things.has(t)).toBe(!off.has(plugin))
  if (off.size === BUILTINS.length) expect([...things].every((t) => KERNEL_THINGS.includes(t))).toBe(true)
  expect((await run(k, "help")).code).toBe(0)
  expect((await run(k, "guide")).code).toBe(0)

  // plugin list: a disabled row per disabled plugin, a failed (skipped) row per dependant.
  const list = await run(k, "plugin", "list", "--json")
  expect(list.code).toBe(0)
  const rows = JSON.parse(list.out) as Array<{ id: string; status: string; error: string | null }>
  for (const id of BUILTINS) {
    const row = rows.find((r) => r.id === id)!
    if (disabled.includes(id)) expect(row).toMatchObject({ status: "disabled", error: null })
    else if (skipped.includes(id)) expect(row.status).toBe("failed")
    else expect(row).toMatchObject({ status: "ok", error: null })
  }
  if (_name === "people") {
    expect(rows.find((r) => r.id === "projects")?.error).toBe('requires "people", which is disabled')
    expect(rows.find((r) => r.id === "meetings")?.error).toBe('requires "projects" which failed')
  }
  if (_name === "projects") expect(rows.find((r) => r.id === "meetings")?.error).toBe('requires "projects", which is disabled')

  // The TUI renders Overview with the parts that load.
  const parts = await loadTuiParts(k)
  expect(parts.errors).toEqual([])
  expect(parts.builtin.map((p) => p.plugin).sort()).toEqual(BUILTINS.filter((id) => !off.has(id)).sort())
  tui = await renderTui(k, { parts: parts.builtin, external: parts.external })
  const frame = await tui.frame()
  expect(frame.split("\n")[0]).toContain("pm · 1 Overview")
  if (off.size === BUILTINS.length) expect(frame).toContain("No panels yet: plugins add them here.")
})

test("--from-inbox without the inbox plugin", async () => {
  const k = await boot(["inbox"])
  expect(await run(k, "project", "add", "CRM", "CRM system", "--from-inbox", "I-1")).toEqual({
    code: 1,
    out: "",
    err: 'error: --from-inbox needs the inbox plugin, which is not loaded\nhint: run "pm plugin list"\n',
  })
  const json = await run(k, "project", "add", "CRM", "CRM system", "--from-inbox", "I-1", "--json")
  expect(JSON.parse(json.out).error).toMatchObject({ code: "validation", message: "--from-inbox needs the inbox plugin, which is not loaded" })
  expect((await run(k, "project", "list", "--json")).out).toBe("[]\n")
})
