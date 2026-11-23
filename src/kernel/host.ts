// The plugin host: boots the kernel services, orders the plugins by `requires`, activates each one with its
// own PluginContext, runs its migrations, then creates the published views. A plugin that fails anywhere on
// the way is isolated: everything it registered is removed, it is marked failed, and so are its dependants.
// Plugins come as PluginDefs (built-in) or as candidates from the loader (`discover`), which carry a source.
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { ChangeSetService } from "./changesets"
import { CommandRegistry } from "./cli/commands"
import { systemClock, type Clock } from "./clock"
import { loadConfig, type Config } from "./config"
import { runWithContext, type OpContext, type Origin } from "./context"
import { KernelDb } from "./db/kernel-db"
import type { TableAccess } from "./db/scope"
import { openRaw } from "./db/sqlite"
import { IsolationError, NotFoundError, PmError, ValidationError } from "./errors"
import { discoverPlugins, type PluginCandidate, type PluginSource } from "./loader"
import { EventBus } from "./events"
import { FieldRegistry } from "./fields"
import { GuideRegistry } from "./guide"
import { MigrationRunner, ownerOf, ownTablesOf, type DataStep, type Migration, type Upkeep } from "./migrations"
import { OperationRegistry } from "./operations"
import { resolvePaths, type Paths } from "./paths"
import { assertPluginId } from "./plugin-id"
import type { PluginContext, PluginDef, PluginRuntime } from "./plugin"
import { ProvenanceStore } from "./provenance"
import { RecordTypeRegistry } from "./records"
import { renderReport, ReportRegistry } from "./reports"
import { satisfies } from "./semver"
import { TagRegistry } from "./tags"
import { ViewRegistry } from "./views"

export const API_VERSION = 1

export type PluginStatus = {
  id: string
  version: string // "" when a failed candidate's version is unknown
  source: PluginSource
  status: "ok" | "failed" | "disabled"
  error?: string
  hint?: string // what to do about `error`, when a failed data step's error carried one (a PmError's hint)
  tui?: string // file URL of the plugin's tui entry (ttybrain.tui)
  dir?: string // the plugin's directory, for discovered plugins
}

export type UpkeepFailure = { plugin: string; text: string; hint?: string }

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
  fields: FieldRegistry
  changeSets: ChangeSetService
  commands: CommandRegistry
  events: EventBus
  context(origin?: Origin): OpContext
  // A loaded plugin's runtime (the same `data`, operations, records, tags as its context); undefined unless `ok`.
  runtime(pluginId: string): PluginRuntime | undefined
  // The ids a plugin's PluginDef requires ([] when its code was not imported: disabled, or failed before boot).
  requiresOf(pluginId: string): string[]
  // Refuses an origin that cannot be recorded: no plugin owns its ref's record type (ValidationError, exit 1),
  // or the type is registered but the record does not exist (NotFoundError, exit 2).
  checkOrigin(origin: Origin): Promise<void>
  // Runs the loaded plugins' upkeeps (ctx.upkeep) when they have not run yet today on this kernel: in load order,
  // each in its own write transaction, none at all while another process holds the write lock (skipped for the
  // day). Concurrent callers share one run. The kernel also calls it before the first write of a day; the TUI at its
  // start and when the day changes. Resolves to whether an upkeep changed any rows (a caller sharing a run, or one
  // made when nothing was due, gets false).
  upkeep(): Promise<boolean>
  // The upkeep failures of this process so far, oldest first (`text`: `upkeep "<plugin>/<id>" failed: <message>`). The CLI
  // prints those a command raised as warnings; they also stay on the plugin's status.
  upkeepFailures(): readonly UpkeepFailure[]
  shutdown(): Promise<void>
}

export type BootOptions = {
  env: Record<string, string | undefined>
  flags?: { db?: string }
  // A bare PluginDef is a built-in. With `discover`, the discovered candidates are appended after these.
  plugins?: Array<PluginDef | PluginCandidate>
  discover?: boolean | { builtinDir?: string; timeoutMs?: number }
  clock?: Clock
}

const DEFAULT_ACTIVATE_TIMEOUT_MS = 5000

type Slot = {
  id: string
  version: string
  source: PluginSource
  dir?: string
  tui?: string
  def?: PluginDef // missing for a candidate that failed before boot or is disabled
  status: "pending" | "ok" | "failed" | "disabled"
  error?: string
  hint?: string
  migrations: Migration[]
  steps: DataStep[] // ctx.upgrade, in registration order
  upkeeps: Upkeep[] // ctx.upkeep, in registration order
  off: Array<() => void> // event subscriptions
  ctx?: PluginContext
  runtime?: PluginRuntime
}

// The context keys a runtime carries: everything but the registrations (PluginRuntime).
const RUNTIME_KEYS: Array<keyof PluginRuntime> = ["id", "data", "config", "clock", "use", "read", "self", "records", "tags", "reports", "provenance"]

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

// A candidate (from the loader) always carries `source`; a bare PluginDef never does.
const isDef = (p: PluginDef | PluginCandidate): p is PluginDef => !Object.hasOwn(p, "source")

// Races an external plugin's activate against the timeout (R2).
function withTimeout<T>(p: Promise<T>, ms: number, text: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(text)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

// An origin whose ref belongs to a registered record type must name an existing record, or provenance would
// attach to a record created later under that ref. The hint names the owning plugin's list command when there is
// one ("ttybrain inbox list"); the kernel knows nothing of what the record is. An inbox origin whose ref no record
// type owns means the inbox plugin is not loaded. Other origins (a change set's `CS-<id>`) are no records.
// Every path that writes with an origin awaits it first: the CLI dispatcher, change sets and the TUI's act.
async function checkOrigin(records: RecordTypeRegistry, commands: CommandRegistry, context: () => OpContext, origin: Origin): Promise<void> {
  const type = records.typeOfRef(origin.ref)
  if (!type) {
    if (origin.type !== "inbox") return
    throw new ValidationError("--from-inbox needs the inbox plugin, which is not loaded", { field: "from-inbox", hint: 'run "ttybrain plugin list"' })
  }
  if (await runWithContext(context(), () => records.resolveAny(origin.ref))) return
  const lists = commands.list().filter((c) => c.plugin === type.plugin && c.def.verb === "list")
  const list = lists.find((c) => c.def.thing === type.plugin || type.name.split("_").includes(c.def.thing)) ?? (lists.length === 1 ? lists[0] : undefined)
  throw new NotFoundError(`no record "${origin.ref}"`, { hint: list ? `run "ttybrain ${list.def.thing} list"` : 'run "ttybrain help"' })
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

export async function bootKernel(opts: BootOptions): Promise<Kernel> {
  const paths = resolvePaths(opts.env, opts.flags)
  // Frozen all the way down: every plugin gets this same object as ctx.config, so one must not change another's.
  const config = deepFreeze(loadConfig(paths, opts.env))
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
  const ops = new OperationRegistry({ db, events, records, provenance, validateOutputs: opts.env.TTYBRAIN_TEST === "1" })
  const tags = new TagRegistry(records)
  const reports = new ReportRegistry()
  const guide = new GuideRegistry()
  const fields = new FieldRegistry()
  const commands = new CommandRegistry()
  const views = new ViewRegistry()
  const originCheck = (origin: Origin) => checkOrigin(records, commands, context, origin)
  const changeSets = new ChangeSetService({ db, ops, records, provenance, checkOrigin: originCheck })
  const runner = new MigrationRunner(db, paths, clock)
  await runner.ensureKernelTables()

  let sealed = false // set once boot is done: from then on a context registers nothing

  // 1. Structural checks: candidates that failed before boot or are disabled, id, duplicates, apiVersion, disabled.
  const disabled = new Set<string>(Array.isArray(config.plugins?.disabled) ? config.plugins.disabled : [])
  const discover = opts.discover === true ? {} : opts.discover || undefined
  const given = opts.plugins ?? []
  const all = discover ? [...given, ...(await discoverPlugins(paths, config, discover))] : given
  const activateTimeoutMs = discover?.timeoutMs ?? DEFAULT_ACTIVATE_TIMEOUT_MS
  const slots: Slot[] = all.map((p): Slot => {
    const base = { status: "pending" as Slot["status"], migrations: [], steps: [], upkeeps: [], off: [] }
    if (isDef(p)) return { ...base, id: p.id, version: p.version, source: "built-in", def: p }
    const slot: Slot = { ...base, id: p.def?.id ?? p.id, version: p.def?.version ?? p.version ?? "", source: p.source, dir: p.dir }
    if (p.tui !== undefined) slot.tui = p.tui
    if (p.def !== undefined) slot.def = p.def
    if (p.error !== undefined) {
      slot.status = "failed"
      slot.error = p.error
    } else if (p.disabled) slot.status = "disabled"
    return slot
  })
  const byId = new Map<string, Slot>()
  const fail = (s: Slot, error: string) => {
    s.status = "failed"
    s.error = error
  }
  for (const s of slots) {
    if (s.status !== "pending" || !s.def) {
      // Failed before boot (keeps its error) or disabled: listed, and known to its dependants by id.
      if (s.status === "pending") fail(s, "the plugin was not loaded")
      if (!byId.has(s.id)) byId.set(s.id, s)
      continue
    }
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
    if (apiVersion !== API_VERSION) fail(s, `apiVersion ${apiVersion} is not supported (this ttybrain supports ${API_VERSION})`)
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
      const text = `requires cycle: ${[...cycle, s].map((c) => c.id).join(" → ")}`
      for (const c of cycle) if (c.status === "pending") fail(c, text)
      return
    }
    visiting.add(s)
    for (const dep of Object.keys(s.def?.requires ?? {})) {
      const d = byId.get(dep)
      if (d) visit(d, [...path, s])
    }
    visiting.delete(s)
    done.add(s)
    order.push(s)
  }
  for (const s of slots) {
    if (byId.get(s.id) === s) visit(s, [])
    else order.push(s) // invalid or duplicate: already failed, kept in place for the listing
  }

  // Removes everything a plugin registered, marks it failed, and fails the plugins that require it.
  const isolate = (s: Slot, error: string) => {
    const id = s.id
    fail(s, error)
    for (const off of s.off.splice(0)) off()
    ops.remove(id)
    records.remove(id)
    tags.remove(id)
    reports.remove(id)
    guide.remove(id)
    fields.remove(id)
    views.remove(id)
    commands.remove(id)
    for (const t of byId.values()) {
      if ((t.status === "ok" || t.status === "pending") && Object.hasOwn(t.def?.requires ?? {}, id)) isolate(t, `requires "${id}" which failed`)
    }
  }

  const requirementProblem = (s: Slot): string | undefined => {
    for (const [dep, range] of Object.entries(s.def?.requires ?? {})) {
      const d = byId.get(dep)
      if (!d) return `requires "${dep}" ${range}, which is not installed`
      if (d.status === "disabled") return `requires "${dep}", which is disabled`
      if (d.status !== "ok") return `requires "${dep}" which failed`
      if (!satisfies(d.version, range)) return `requires "${dep}" ${range}, but ${dep} is ${d.version}`
    }
    return undefined
  }

  const contextFor = (s: Slot, def: PluginDef): PluginContext => {
    const id = s.id
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
    const required = new Set(Object.keys(def.requires ?? {}))
    const reads = def.reads ?? {}
    // The read operations of a plugin in `reads` or `requires`, while it is loaded (and, for `reads`, in range).
    const readOps = (other: string) => {
      const d = byId.get(other)
      if (!(required.has(other) || Object.hasOwn(reads, other)) || d?.status !== "ok") return undefined
      if (Object.hasOwn(reads, other) && !satisfies(d.version, reads[other]!)) return undefined
      return ops.api(other)?.read
    }
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
      upgrade: (sid, run) => {
        live()
        if (!sid || s.steps.some((t) => t.id === sid)) throw new ValidationError(`data step id "${sid}" is empty or duplicated`)
        s.steps.push({ id: sid, run })
      },
      upkeep: (uid, run) => {
        live()
        if (!uid || s.upkeeps.some((u) => u.id === uid)) throw new ValidationError(`upkeep id "${uid}" is empty or duplicated`)
        s.upkeeps.push({ id: uid, run })
      },
      use: (other) => (required.has(other) ? ops.api(other) : undefined),
      read: readOps,
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
      tags: { resolve: (text) => tags.resolve(text), suggest: (partial, limit) => tags.suggest(partial, limit), types: () => tags.types() },
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
      reports: { run: (reportId, params) => reports.run(reportId, params), render: renderReport },
      guideSection: (def) => {
        live()
        guide.section(id, def)
      },
      field: (recordType, def) => {
        live()
        fields.register(id, recordType, def)
      },
      provenance: {
        createdFrom: (type, ref) => provenance.createdFrom(type, ref),
        originOf: (type, id) => provenance.originOf(type, id),
        originsOf: (type, ids) => provenance.originsOf(type, ids),
      },
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
    if (s.status !== "pending" || !s.def) continue
    const problem = requirementProblem(s)
    if (problem) {
      fail(s, problem)
      continue
    }
    const external = s.source !== "built-in"
    try {
      s.ctx = contextFor(s, s.def)
      const activating = Promise.resolve(s.def.activate(s.ctx))
      await (external ? withTimeout(activating, activateTimeoutMs, `${s.id}: timed out after ${activateTimeoutMs} ms while activating`) : activating)
      fields.check(s.id, ops)
      await runner.run(s.id, s.migrations, external)
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
    const reads = s.def?.reads ?? {}
    const unavailable = Object.entries(reads)
      .filter(([p, range]) => {
        const d = byId.get(p)
        return d?.status === "ok" && !satisfies(d.version, range)
      })
      .map(([p]) => p)
    views.declareReads(s.id, Object.keys(reads), unavailable)
  }

  // Registrations made later (a timer left by activate) would be half-applied: a view would never be created.
  sealed = true

  const context = (origin?: Origin): OpContext => ({ actor: "me", today: clock.today(), now: clock.now(), ...(origin ? { origin } : {}) })

  // 6. Data steps (ctx.upgrade), now that every plugin's tables, views and reads are in place: the pending steps of
  // the loaded plugins in load order, each in its own write transaction; then once more those that said "later", so
  // two plugins can hand data over whichever loads first. A step that throws is rolled back and stays pending; its
  // plugin stays loaded and its error is listed with it. Nothing pending: no write lock is taken. Another process
  // holding the write lock: the steps are left for the next boot rather than waited for (a read-only command must
  // not wait on a write it did not ask for).
  let busy = false
  const runSteps = async (todo: Array<{ s: Slot; step: DataStep }>) => {
    const later: typeof todo = []
    for (const t of todo) {
      if (busy) break
      if (t.s.status !== "ok") continue
      try {
        const outcome = await runWithContext(context(), () => runner.runStep(t.s.id, t.step))
        if (outcome === "busy") busy = true
        else if (outcome === "later") later.push(t)
      } catch (e) {
        const text = `data step "${t.step.id}" failed: ${message(e)}`
        t.s.error = t.s.error === undefined ? text : `${t.s.error}; ${text}`
        if (e instanceof PmError && e.hint) t.s.hint = t.s.hint === undefined ? e.hint : `${t.s.hint}; ${e.hint}`
      }
    }
    return later
  }
  const pendingSteps = order.flatMap((s) => (s.status === "ok" ? runner.pendingSteps(s.id, s.steps).map((step) => ({ s, step })) : []))
  if (pendingSteps.length > 0) await runSteps(await runSteps(pendingSteps))

  const plugins: PluginStatus[] = order.map((s): PluginStatus => ({
    id: s.id,
    version: s.version,
    source: s.source,
    status: s.status === "pending" ? "failed" : s.status,
    ...(s.error !== undefined ? { error: s.error } : {}),
    ...(s.hint !== undefined ? { hint: s.hint } : {}),
    ...(s.tui !== undefined ? { tui: s.tui } : {}),
    ...(s.dir !== undefined ? { dir: s.dir } : {}),
  }))

  // 7. Upkeep (ctx.upkeep): not at boot, so a read-only command never takes the write lock for it. It runs before
  // the first write (any outermost kernel write but its own) and when the TUI asks, at most once a day per kernel.
  // Its errors are added to the plugin's listed error, like a data step's.
  const statusOf = new Map(plugins.map((p) => [p.id, p]))
  const noteError = (id: string, text: string, hint?: string) => {
    const p = statusOf.get(id)
    if (!p) return
    if (p.error === undefined) p.error = text
    else if (!p.error.split("; ").includes(text)) p.error = `${p.error}; ${text}`
    if (hint && !(p.hint ?? "").split("; ").includes(hint)) p.hint = p.hint === undefined ? hint : `${p.hint}; ${hint}`
  }
  const upkeepFailures: UpkeepFailure[] = [] // every failure of this process, in order
  let upkeptOn: string | undefined
  let upkeeping: Promise<boolean> | undefined
  const runUpkeeps = async (): Promise<boolean> => {
    let changed = false
    for (const s of order) {
      if (s.status !== "ok") continue
      for (const u of s.upkeeps) {
        try {
          const outcome = await runWithContext(context(), () => runner.runUpkeep(u))
          if (outcome === "busy") return changed // skipped for the day
          if (outcome === "changed") changed = true
        } catch (e) {
          const text = `upkeep "${u.id}" failed: ${message(e)}`
          const hint = e instanceof PmError ? e.hint : undefined
          noteError(s.id, text, hint)
          upkeepFailures.push({ plugin: s.id, text: `upkeep "${s.id}/${u.id}" failed: ${message(e)}`, ...(hint ? { hint } : {}) })
        }
      }
    }
    return changed
  }
  const upkeep = (): Promise<boolean> => {
    if (upkeeping) return upkeeping
    const day = clock.today()
    if (upkeptOn === day) return Promise.resolve(false)
    upkeptOn = day
    upkeeping = runUpkeeps().finally(() => {
      upkeeping = undefined
    })
    return upkeeping
  }
  // The write goes on whatever the upkeep did (its errors are kept with the plugins).
  if (order.some((s) => s.status === "ok" && s.upkeeps.length > 0)) db.setBeforeWrite(() => upkeep().catch(() => false))

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
    fields,
    changeSets,
    commands,
    events,
    context,
    runtime: (pluginId) => {
      const s = byId.get(pluginId)
      if (s?.status !== "ok" || !s.ctx) return undefined
      if (!s.runtime) {
        const ctx = s.ctx
        s.runtime = Object.fromEntries(RUNTIME_KEYS.map((key) => [key, ctx[key]])) as PluginRuntime
      }
      return s.runtime
    },
    requiresOf: (pluginId) => Object.keys(byId.get(pluginId)?.def?.requires ?? {}),
    checkOrigin: originCheck,
    upkeep,
    upkeepFailures: () => [...upkeepFailures],
    shutdown: () => db.close(),
  }
}
