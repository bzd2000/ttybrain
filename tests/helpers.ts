// A kernel on a temporary TTYBRAIN_HOME with a fixed clock (default 2026-11-13, a Friday) and TTYBRAIN_TEST=1. `clock`
// replaces it (a test that moves the date). `seed` writes a test's data set (tests/design.ts' seedDesign,
// seedMeetings) before the kernel is handed over.
//
// Template databases: booting the built-in plugins on a new database runs all their migrations (most of a boot's
// time), and seeding the design data through the write operations takes most of a design test. Both give the same
// database every time for the same plugins, date and seed, so each is made once per test process, in a throwaway
// home, and the test's home starts from a copy of that file (provenance and change sets come along: they are in it).
// Only for plugin lists made of the built-in plugins (tests/builtins.ts marks them) without `env`, `discover` or
// `clock`; anything else boots and seeds as before. A seeded copy is used only when the upkeeps (which a fresh
// seed has already run, on the empty database, and a copy runs on its first write or TUI start) change nothing in
// it; otherwise that seed runs through the operations for every test.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginDef } from "../src/kernel/api"
import { fixedClock, type Clock } from "../src/kernel/clock"
import { bootKernel, type BootOptions, type Kernel } from "../src/kernel/host"

export type TestKernel = Kernel & { home: string; cleanup(): Promise<void> }

export type Seed = (kernel: Kernel) => Promise<void>

type Opts = {
  plugins?: BootOptions["plugins"]
  discover?: BootOptions["discover"]
  today?: string
  clock?: Clock
  env?: Record<string, string>
  seed?: Seed
}

// Kept on globalThis so every test file of the process shares one set of templates.
type Templates = { plugins: WeakSet<object>; ids: WeakMap<object, number>; next: number; files: Map<string, Promise<Uint8Array | undefined>> }
const templates: Templates = ((globalThis as { __ttybrainTestTemplates?: Templates }).__ttybrainTestTemplates ??= {
  plugins: new WeakSet(),
  ids: new WeakMap(),
  next: 0,
  files: new Map(),
})

// Marks plugin definitions whose boot (and seeds) may start from a template database: the built-ins.
export function templatePlugins(defs: PluginDef[]): void {
  for (const d of defs) templates.plugins.add(d)
}

const idOf = (o: object) => {
  let id = templates.ids.get(o)
  if (id === undefined) templates.ids.set(o, (id = templates.next++))
  return id
}

// The template key of a boot, or undefined when it must boot (and seed) from scratch.
function bootKey(opts: Opts): string | undefined {
  if (opts.env !== undefined || opts.discover !== undefined || opts.clock !== undefined) return undefined
  const plugins = opts.plugins ?? []
  if (!plugins.every((p) => templates.plugins.has(p))) return undefined
  return `${plugins.map(idOf).join(",")}@${opts.today ?? DEFAULT_TODAY}`
}

const DEFAULT_TODAY = "2026-11-13"
const DB = "ttybrain.db"

// Boots in a throwaway home (from the template `from`, when given), runs `fn`, shuts down and returns the database file.
async function snapshot(opts: Opts, from: Uint8Array | undefined, fn: (k: Kernel) => Promise<void>): Promise<Uint8Array> {
  const home = mkdtempSync(join(tmpdir(), "pm-template-"))
  try {
    if (from) writeFileSync(join(home, DB), from)
    const k = await boot(opts, home)
    try {
      await fn(k)
    } finally {
      await k.shutdown()
    }
    return readFileSync(join(home, DB))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function template(key: string, make: () => Promise<Uint8Array | undefined>): Promise<Uint8Array | undefined> {
  let file = templates.files.get(key)
  if (!file) {
    file = make()
    templates.files.set(key, file)
    // A failed build isn't kept: the next test with this key tries again and reports its own error.
    file.catch(() => templates.files.delete(key))
  }
  return file
}

const bootTemplate = (opts: Opts, key: string) => template(key, () => snapshot(opts, undefined, async () => {}))

const seedTemplate = (opts: Opts, key: string, seed: Seed) =>
  template(`${key}+${idOf(seed)}`, async () => {
    const seeded = await snapshot(opts, await bootTemplate(opts, key), seed)
    // A copy is like the fresh seed only when the upkeeps leave it as it is.
    let same = false
    await snapshot(opts, seeded, async (k) => {
      same = !(await k.upkeep()) && k.upkeepFailures().length === 0
    })
    return same ? seeded : undefined
  })

function boot(opts: Opts, home: string): Promise<Kernel> {
  return bootKernel({
    env: { TTYBRAIN_HOME: home, TTYBRAIN_TEST: "1", ...opts.env },
    plugins: opts.plugins ?? [],
    ...(opts.discover !== undefined && { discover: opts.discover }),
    clock: opts.clock ?? fixedClock(opts.today ?? DEFAULT_TODAY),
  })
}

export async function makeTestKernel(opts: Opts = {}): Promise<TestKernel> {
  const key = bootKey(opts)
  const seeded = key !== undefined && opts.seed ? await seedTemplate(opts, key, opts.seed) : undefined
  const file = seeded ?? (key !== undefined ? await bootTemplate(opts, key) : undefined)
  const home = mkdtempSync(join(tmpdir(), "pm-test-"))
  let kernel: Kernel
  try {
    if (file) writeFileSync(join(home, DB), file)
    kernel = await boot(opts, home)
  } catch (e) {
    rmSync(home, { recursive: true, force: true })
    throw e
  }
  const test = Object.assign(kernel, {
    home,
    async cleanup() {
      await kernel.shutdown()
      rmSync(home, { recursive: true, force: true })
    },
  })
  if (opts.seed && !seeded) {
    try {
      await opts.seed(test)
    } catch (e) {
      await test.cleanup()
      throw e
    }
  }
  return test
}
