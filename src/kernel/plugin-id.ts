// Plugin ids name the physical namespace `<id>_*`. No `_`, so one plugin's namespace never contains another's,
// and the kernel's own namespaces (`kernel_*`, `sqlite_*`) can never be claimed by a plugin.
import { IsolationError } from "./errors"

export const PLUGIN_ID = /^[a-z][a-z0-9-]*$/
export const RESERVED_PLUGIN_IDS: ReadonlySet<string> = new Set(["kernel", "sqlite"])

export function assertPluginId(id: string): void {
  if (!PLUGIN_ID.test(id)) throw new IsolationError(`plugin id "${id}" must match [a-z][a-z0-9-]*`)
  if (RESERVED_PLUGIN_IDS.has(id)) throw new IsolationError(`plugin id "${id}" is reserved`)
}

// True for physical names in a namespace no plugin may own, whatever its id.
export function isReservedName(name: string): boolean {
  const n = name.toLowerCase()
  for (const id of RESERVED_PLUGIN_IDS) if (n.startsWith(`${id}_`)) return true
  return false
}
