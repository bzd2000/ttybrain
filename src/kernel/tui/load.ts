// Loading the plugins' tui parts: installs the UI modules pm shares with external plugins (their built shims read
// them from globalThis.__PM_MODULES__), then imports the `pm.tui` entry of each plugin whose logic is `ok`, in
// load order. A tui entry that fails to import (or times out, for a non-built-in) is reported; its plugin's logic
// stays loaded.
import * as opentuiCore from "@opentui/core"
import * as opentuiSolid from "@opentui/solid"
import * as solid from "solid-js"
import * as solidStore from "solid-js/store"
import type { Kernel } from "../host"
import { DEFAULT_TIMEOUT_MS, installApiModule, withTimeout } from "../loader"
import * as tuiApi from "./api"
import type { TuiDef } from "./types"

export function installTuiModules(): void {
  installApiModule()
  const modules = (globalThis as { __PM_MODULES__?: Record<string, unknown> }).__PM_MODULES__!
  modules["@pm/api/tui"] = tuiApi
  modules["solid-js"] = solid
  modules["solid-js/store"] = solidStore
  modules["@opentui/solid"] = opentuiSolid
  modules["@opentui/core"] = opentuiCore
}

export type LoadedTuiParts = { builtin: TuiDef[]; external: TuiDef[]; errors: Array<{ plugin: string; error: string }> }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

// The tui part a module default-exports, or why it isn't one. The part must be for the entry's own plugin: it is
// activated with that plugin's runtime.
function partOf(id: string, mod: Record<string, unknown>): TuiDef | string {
  const def = mod.default
  if (def === undefined) return "the tui entry has no default export"
  if (!isObj(def) || typeof def.plugin !== "string" || typeof def.activate !== "function") return "the tui entry's default export is not a tui part"
  if (def.plugin !== id) return `the tui entry is a part for plugin "${def.plugin}"`
  return def as unknown as TuiDef
}

export async function loadTuiParts(kernel: Kernel, opts: { timeoutMs?: number } = {}): Promise<LoadedTuiParts> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const out: LoadedTuiParts = { builtin: [], external: [], errors: [] }
  for (const p of kernel.plugins) {
    if (p.status !== "ok" || p.tui === undefined) continue
    const builtin = p.source === "built-in"
    let part: TuiDef | string
    try {
      const loading = import(p.tui) as Promise<Record<string, unknown>>
      part = partOf(p.id, builtin ? await loading : await withTimeout(loading, timeoutMs, `timed out after ${timeoutMs} ms while importing`))
    } catch (e) {
      part = message(e)
    }
    if (typeof part === "string") out.errors.push({ plugin: p.id, error: `${p.id}: ${part}` })
    else (builtin ? out.builtin : out.external).push(part)
  }
  return out
}
