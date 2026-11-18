// Export and clipboard helpers for plugins' tui parts. Both need the app (the plugin's config, the renderer), so
// plugins use them as hooks: call useWriteExport() / useCopyText() during component setup.
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { useRenderer } from "@opentui/solid"
import { ValidationError } from "../errors"
import { useRuntime } from "./data"

// Writes `text` to `<dir>/<fileName>` (creating `dir`, overwriting) and returns the absolute path.
export async function writeExport(dir: string, fileName: string, text: string): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName) || /^\.+$/.test(fileName)) throw new ValidationError("invalid export file name")
  await mkdir(dir, { recursive: true })
  const path = resolve(join(dir, fileName))
  await writeFile(path, text, "utf8")
  return path
}

// writeExport into the configured export folder (`config.exportDir`).
export function useWriteExport(): (fileName: string, text: string) => Promise<string> {
  const rt = useRuntime()
  return (fileName, text) => writeExport(rt.config.exportDir, fileName, text)
}

// Copies `text` to the terminal's clipboard with OSC 52; false when the terminal does not support it.
export function useCopyText(): (text: string) => boolean {
  const renderer = useRenderer()
  return (text) => renderer.copyToClipboardOSC52(text)
}
