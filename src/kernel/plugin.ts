// What a plugin is (PluginDef) and what it gets (PluginContext). The host (host.ts) builds one context per
// plugin over the kernel's registries; a plugin reaches data, other plugins and the CLI only through it.
import type { Kysely } from "kysely"
import type { CommandDef } from "./cli/commands"
import type { Clock } from "./clock"
import type { Config } from "./config"
import type { PluginApi, ReadOp, WriteOp } from "./operations"
import type { RecordTypeDef } from "./records"
import type { ReportDef, ReportSectionDef } from "./reports"
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
  publish(name: string, def: ViewDef): void
  expose(ops: { read?: Record<string, ReadOp>; write?: Record<string, WriteOp> }): void
  // Another plugin's exposed operations; undefined unless it is in `requires`.
  use(pluginId: string): PluginApi | undefined
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
    // Completions for a tag being typed (`#cr`, `@ma`); [] for an unknown prefix.
    suggest(partial: string, limit: number): Promise<Array<{ ref: string; label: string }>>
  }
  command(def: CommandDef): void
  report(def: ReportDef): void
  reportSection(reportId: string, def: ReportSectionDef): void
  guideSection(def: { title: string; markdown: string; order?: number }): void
  readonly provenance: {
    createdFrom(type: string, ref: string): Promise<Array<{ recordType: string; recordId: number; ref: string }>>
  }
  on(event: string, fn: (payload: any) => void): () => void
  emit(event: string, payload: unknown): void
}

// The read/write side of a context, without registrations: what a plugin's TUI part gets (`kernel.runtime(id)`).
export type PluginRuntime = Pick<PluginContext, "id" | "data" | "config" | "clock" | "use" | "self" | "records" | "tags" | "provenance">
