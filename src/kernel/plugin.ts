// What a plugin is (PluginDef) and what it gets (PluginContext). The host (host.ts) builds one context per
// plugin over the kernel's registries; a plugin reaches data, other plugins and the CLI only through it.
import type { Kysely } from "kysely"
import type { CommandDef } from "./cli/commands"
import type { Clock } from "./clock"
import type { Origin } from "./context"
import type { Config } from "./config"
import type { FieldDef } from "./fields"
import type { PluginApi, PluginReadApi, ReadOp, WriteOp } from "./operations"
import type { RecordTypeDef } from "./records"
import type { ReportDef, ReportResult, ReportSectionDef } from "./reports"
import type { TagRegistry, TagTypeDef } from "./tags"
import type { ViewDef } from "./views"

export type PluginDef = {
  id: string // [a-z][a-z0-9-]*, also the table prefix
  name: string
  version: string
  apiVersion: 1
  requires?: Record<string, string> // plugin id → version range; loaded first, needed for `use`
  reads?: Record<string, string> // plugin id → version range of the publisher whose views it reads
  activate(ctx: PluginContext): void | Promise<void>
}

export function definePlugin(def: PluginDef): PluginDef {
  return def
}

export interface PluginContext {
  readonly id: string
  readonly data: Kysely<any> // scoped: own tables (short names) and published views (`<plugin>.<view>`)
  readonly config: Config
  readonly clock: Clock
  migration(id: string, up: (db: Kysely<any>) => Promise<void>): void
  // A one-time data step (docs/architecture.md, "Data steps"): run at boot once every plugin's migrations and views
  // are in place, in its own write transaction, with this context (data changes allowed, schema changes not).
  // "done" records it so it never runs again; "later" commits nothing and leaves it pending; a throw rolls it back,
  // keeps it pending and shows the error with the plugin, which stays loaded.
  upgrade(id: string, run: () => Promise<"done" | "later">): void
  publish(name: string, def: ViewDef): void
  expose(ops: { read?: Record<string, ReadOp>; write?: Record<string, WriteOp> }): void
  // Another plugin's exposed operations: read and write for a plugin in `requires`; only `read` (`write` is
  // undefined) for one only in `reads`, while it is loaded at a version in that range; undefined otherwise.
  use(pluginId: string): PluginApi | PluginReadApi | undefined
  self(): PluginApi
  recordType(def: Omit<RecordTypeDef, "plugin">): void
  readonly records: {
    resolve(ref: string): Promise<{ type: string; id: number } | null>
    label(ref: string): Promise<string>
    // The display ref of (record type, id); `<type>:<id>` when the type is not registered.
    refOf(type: string, id: number): Promise<string>
    // Whether a record type of this name is registered (its plugin is loaded): lets a plugin validate a soft
    // reference to an optional plugin's records only when that plugin is there.
    hasType(name: string): boolean
  }
  tagType(def: TagTypeDef): void
  readonly tags: {
    resolve(text: string): ReturnType<TagRegistry["resolve"]>
    // Completions for a tag being typed (`#cr`, `@ma`); [] for an unknown prefix. `detail`: what the record
    // type's search adds (a short description of the record).
    suggest(partial: string, limit: number): Promise<Array<{ ref: string; label: string; detail?: string }>>
    // The registered tag prefixes and the record type each names (`#` → project).
    types(): Array<{ prefix: string; recordType: string }>
  }
  command(def: CommandDef): void
  report(def: ReportDef): void
  reportSection(reportId: string, def: ReportSectionDef): void
  // Run any registered report (in the caller's operation context) and render a result, so a plugin can embed
  // another plugin's report in its own.
  readonly reports: {
    run(reportId: string, params: unknown): Promise<ReportResult>
    render(r: ReportResult, format: "md" | "text" | "json"): string
  }
  guideSection(def: { title: string; markdown: string; order?: number }): void
  // An extra field on another plugin's records (`recordType`), stored in this plugin's own table and read and
  // written through this plugin's own operations `def.get` (read) and `def.set` (write); boot checks both exist.
  field(recordType: string, def: FieldDef): void
  readonly provenance: {
    createdFrom(type: string, ref: string): Promise<Array<{ recordType: string; recordId: number; ref: string }>>
    // The origin one record was created from (read-only), undefined when it has none.
    originOf(recordType: string, recordId: number): Promise<Origin | undefined>
    // The origins of many records of one type in one query: record id -> origin (records without one are absent).
    originsOf(recordType: string, ids: number[]): Promise<Map<number, Origin>>
  }
  on(event: string, fn: (payload: any) => void): () => void
  emit(event: string, payload: unknown): void
}

// The read/write side of a context, without registrations: what a plugin's TUI part gets (`kernel.runtime(id)`).
export type PluginRuntime = Pick<PluginContext, "id" | "data" | "config" | "clock" | "use" | "self" | "records" | "tags" | "reports" | "provenance">
