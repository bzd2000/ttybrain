// The plugin host: boots the kernel services, orders the plugins by `requires`, activates each one with its
// own PluginContext, runs its migrations, then creates the published views. A plugin that fails anywhere on
// the way is isolated: everything it registered is removed, it is marked failed, and so are its dependants.
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { ChangeSetService } from "./changesets"
import { CommandRegistry } from "./cli/commands"
import { systemClock, type Clock } from "./clock"
import { loadConfig, type Config } from "./config"
import type { OpContext, Origin } from "./context"
import { KernelDb } from "./db/kernel-db"
import type { TableAccess } from "./db/scope"
import { openRaw } from "./db/sqlite"
import { IsolationError, PmError } from "./errors"
import { EventBus } from "./events"
import { GuideRegistry } from "./guide"
import { MigrationRunner, ownerOf, ownTablesOf, type Migration } from "./migrations"
import { OperationRegistry } from "./operations"
import { resolvePaths, type Paths } from "./paths"
import { assertPluginId } from "./plugin-id"
import type { PluginContext, PluginDef, PluginRuntime } from "./plugin"
import { ProvenanceStore } from "./provenance"
import { RecordTypeRegistry } from "./records"
import { ReportRegistry } from "./reports"
import { satisfies } from "./semver"
import { TagRegistry } from "./tags"
import { ViewRegistry } from "./views"

export const API_VERSION = 1

export type PluginStatus = {
  id: string
  version: string
  source: "built-in"
  status: "ok" | "failed" | "disabled"
  error?: string
}

export type Kernel = {
  paths: Paths
  config: Config
  clock: Clock
  db: KernelDb
  plugins: PluginStatus[] // in load order
  ops: OperationRegistry
  records: RecordTypeRegistry
  tags: TagRegistry
  reports: ReportRegistry
  guide: GuideRegistry
  changeSets: ChangeSetService
  commands: CommandRegistry
  events: EventBus
  context(origin?: Origin): OpContext
  // A loaded plugin's runtime (the same `data`, operations, records, tags as its context); undefined unless `ok`.
  runtime(pluginId: string): PluginRuntime | undefined
  shutdown(): Promise<void>
}

export type BootOptions = {
  env: Record<string, string | undefined>
  flags?: { db?: string }
  plugins: PluginDef[]
  clock?: Clock
}

type Slot = {
  def: PluginDef
  status: "pending" | "ok" | "failed" | "disabled"
  error?: string
  migrations: Migration[]
  off: Array<() => void> // event subscriptions
  ctx?: PluginContext
  runtime?: PluginRuntime
}

// The context keys a runtime carries: everything but the registrations (PluginRuntime).
const RUNTIME_KEYS: Array<keyof PluginRuntime> = ["id", "data", "config", "clock", "use", "self", "records", "tags", "provenance"]

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function bootKernel(opts: BootOptions): Promise<Kernel> {
  const paths = resolvePaths(opts.env, opts.flags)
  const config = loadConfig(paths, opts.env)
  const clock = opts.clock ?? systemClock
  mkdirSync(dirname(paths.db), { recursive: true })
  const db = new KernelDb(openRaw(paths.db))
  try {
    return await boot(opts, paths, config, clock, db)
  } catch (e) {
    await db.close()
    throw e
  }
}

async function boot(opts: BootOptions, paths: Paths, config: Config, clock: Clock, db: KernelDb): Promise<Kernel> {
  const events = new EventBus()
  const records = new RecordTypeRegistry()
  const provenance = new ProvenanceStore(db, records)
  const ops = new OperationRegistry({ db, events, records, provenance, validateOutputs: opts.env.PM_TEST === "1" })
  const tags = new TagRegistry(records)
  const reports = new ReportRegistry()
  const guide = new GuideRegistry()
  const commands = new CommandRegistry()
  const views = new ViewRegistry()
  const changeSets = new ChangeSetService({ db, ops, records, provenance })
  const runner = new MigrationRunner(db, paths, clock)
  await runner.ensureKernelTables()

  let sealed = false // set once boot is done: from then on a context registers nothing

  // 1. Structural checks: id, duplicates, apiVersion, disabled.
  const disabled = new Set<string>(Array.isArray(config.plugins?.disabled) ? config.plugins.disabled : [])
  const slots: Slot[] = opts.plugins.map((def) => ({ def, status: "pending", migrations: [], off: [] }))
  const byId = new Map<string, Slot>()
  const fail = (s: Slot, error: string) => {
    s.status = "failed"
    s.error = error
  }
  for (const s of slots) {
    const { id, apiVersion } = s.def
    try {
      assertPluginId(id)
    } catch (e) {
      fail(s, message(e))
      continue
    }
    if (byId.has(id)) {
      fail(s, `duplicate plugin id "${id}"`)
      continue
    }
    byId.set(id, s)
    if (apiVersion !== API_VERSION) fail(s, `apiVersion ${apiVersion} is not supported (this pm supports ${API_VERSION})`)
    else if (disabled.has(id)) s.status = "disabled"
  }

  // 2. Load order: depth-first over `requires`, in the given order; a plugin on a cycle fails.
  const order: Slot[] = []
  const visiting = new Set<Slot>()
  const done = new Set<Slot>()
  const visit = (s: Slot, path: Slot[]) => {
    if (done.has(s)) return
    if (visiting.has(s)) {
      const cycle = path.slice(path.indexOf(s))
      const text = `requires cycle: ${[...cycle, s].map((c) => c.def.id).join(" → ")}`
      for (const c of cycle) if (c.status === "pending") fail(c, text)
      return
    }
    visiting.add(s)
    for (const dep of Object.keys(s.def.requires ?? {})) {
      const d = byId.get(dep)
      if (d) visit(d, [...path, s])
    }
    visiting.delete(s)
    done.add(s)
    order.push(s)
  }
  for (const s of slots) {
    if (byId.get(s.def.id) === s) visit(s, [])
    else order.push(s) // invalid or duplicate: already failed, kept in place for the listing
  }

  // Removes everything a plugin registered, marks it failed, and fails the plugins that require it.
  const isolate = (s: Slot, error: string) => {
    const id = s.def.id
    fail(s, error)
    for (const off of s.off.splice(0)) off()
    ops.remove(id)
    records.remove(id)
    tags.remove(id)
    reports.remove(id)
    guide.remove(id)
    views.remove(id)
    commands.remove(id)
    for (const t of byId.values()) {
      if ((t.status === "ok" || t.status === "pending") && Object.hasOwn(t.def.requires ?? {}, id)) isolate(t, `requires "${id}" which failed`)
    }
  }

  const requirementProblem = (s: Slot): string | undefined => {
    for (const [dep, range] of Object.entries(s.def.requires ?? {})) {
      const d = byId.get(dep)
      if (!d) return `requires "${dep}" ${range}, which is not installed`
      if (d.status === "disabled") return `requires "${dep}", which is disabled`
      if (d.status !== "ok") return `requires "${dep}" which failed`
      if (!satisfies(d.def.version, range)) return `requires "${dep}" ${range}, but ${dep} is ${d.def.version}`
    }
    return undefined
  }

  const contextFor = (s: Slot): PluginContext => {
    const id = s.def.id
    // A plugin that failed (say, a registration left running after activate threw) can register nothing more.
    const live = () => {
      if (s.status === "failed") throw new Error(`plugin "${id}" failed and can no longer register anything`)
      if (sealed) throw new IsolationError("plugins can only register during activate")
    }
    const access: TableAccess = {
      ownTables: () => ownTablesOf(db, id),
      views: () => views.forReader(id),
      reads: () => views.readsOf(id),
      migrating: () => false,
      ownerOf: (name) => ownerOf(db, name),
    }
    const required = new Set(Object.keys(s.def.requires ?? {}))
    return {
      id,
      data: db.pluginDb(id, access),
      config,
      clock,
      migration: (mid, up) => {
        live()
        s.migrations.push({ id: mid, up })
      },
      publish: (name, def) => {
        live()
        views.publish(id, name, def)
      },
      expose: (o) => {
        live()
        ops.expose(id, o)
      },
      use: (other) => (required.has(other) ? ops.api(other) : undefined),
      self: () => ops.api(id) ?? { read: {}, write: {} },
      recordType: (def) => {
        live()
        records.register({ ...def, plugin: id })
      },
      records: { resolve: (ref) => records.resolveAny(ref), label: (ref) => records.label(ref), refOf: (type, id) => records.refOf(type, id), hasType: (name) => records.byName(name) !== undefined },
      tagType: (def) => {
        live()
        tags.register(def, id)
      },
      tags: { resolve: (text) => tags.resolve(text), suggest: (partial, limit) => tags.suggest(partial, limit) },
      command: (def) => {
        live()
        commands.register(id, def)
      },
      report: (def) => {
        live()
        reports.report(def, id)
      },
      reportSection: (reportId, def) => {
        live()
        reports.section(reportId, id, def)
      },
      guideSection: (def) => {
        live()
        guide.section(id, def)
      },
      provenance: { createdFrom: (type, ref) => provenance.createdFrom(type, ref) },
      on: (event, fn) => {
        live()
        const off = events.on(event, fn)
        s.off.push(off)
        return off
      },
      // Inside a write, listeners hear the event only once it commits (and never if it rolls back).
      emit: (event, payload) => {
        if (db.inWrite()) db.afterCommit(() => events.emit(event, payload))
        else events.emit(event, payload)
      },
    }
  }

  // 3. Activate, then migrate (MigrationRunner.run backs up the database first when something is pending).
  for (const s of order) {
    if (s.status !== "pending") continue
    const problem = requirementProblem(s)
    if (problem) {
      fail(s, problem)
      continue
    }
    try {
      s.ctx = contextFor(s)
      await s.def.activate(s.ctx)
      await runner.run(s.def.id, s.migrations, false)
      s.status = "ok"
    } catch (e) {
      isolate(s, message(e))
    }
  }

  // 4. Published views: createAll is all-or-nothing and names the failing plugin (R13); isolate it and retry.
  for (;;) {
    try {
      await views.createAll(db)
      break
    } catch (e) {
      const details = e instanceof PmError && typeof e.details === "object" && e.details !== null ? (e.details as { plugin?: unknown }) : {}
      const s = typeof details.plugin === "string" ? byId.get(details.plugin) : undefined
      if (!s || s.status !== "ok") throw e
      isolate(s, message(e))
    }
  }

  // 5. Reads: a publisher outside the reader's range is unavailable to it, like one that is not loaded.
  for (const s of byId.values()) {
    if (s.status !== "ok") continue
    const reads = s.def.reads ?? {}
    const unavailable = Object.entries(reads)
      .filter(([p, range]) => {
        const d = byId.get(p)
        return d?.status === "ok" && !satisfies(d.def.version, range)
      })
      .map(([p]) => p)
    views.declareReads(s.def.id, Object.keys(reads), unavailable)
  }

  // Registrations made later (a timer left by activate) would be half-applied: a view would never be created.
  sealed = true

  const plugins: PluginStatus[] = order.map((s) => ({
    id: s.def.id,
    version: s.def.version,
    source: "built-in",
    status: s.status === "pending" ? "failed" : s.status,
    ...(s.error !== undefined ? { error: s.error } : {}),
  }))

  return {
    paths,
    config,
    clock,
    db,
    plugins,
    ops,
    records,
    tags,
    reports,
    guide,
    changeSets,
    commands,
    events,
    context: (origin) => ({ actor: "me", today: clock.today(), now: clock.now(), ...(origin ? { origin } : {}) }),
    runtime: (pluginId) => {
      const s = byId.get(pluginId)
      if (s?.status !== "ok" || !s.ctx) return undefined
      if (!s.runtime) {
        const ctx = s.ctx
        s.runtime = Object.fromEntries(RUNTIME_KEYS.map((key) => [key, ctx[key]])) as PluginRuntime
      }
      return s.runtime
    },
    shutdown: () => db.close(),
  }
}
