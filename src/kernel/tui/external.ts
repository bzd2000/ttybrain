// editExternal: hands a text to $VISUAL / $EDITOR (default `vi`) and returns the edited text. Local mode only:
// the TUI is suspended (raw mode off, screen restored), the editor gets the terminal, then the TUI resumes.
// In a container (TTYBRAIN_MODE=container) there is no editor to hand over to: it notifies and returns null, so
// callers need not check (they may still hide the key). Only node:* modules, so it runs on Bun and Node.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useRenderer } from "@opentui/solid"
import { notify } from "./messages"

export type Suspendable = { suspend(): Promise<void>; resume(): Promise<void> }

export async function editExternal(initial: string, opts: { editor?: string; renderer: Suspendable }): Promise<string | null> {
  if (process.env.TTYBRAIN_MODE === "container") {
    notify("no external editor in container mode", "error")
    return null
  }
  const editor = opts.editor ?? (process.env.VISUAL || process.env.EDITOR || "vi")
  const dir = mkdtempSync(join(tmpdir(), "pm-edit-"))
  const file = join(dir, "edit.md")
  try {
    writeFileSync(file, initial)
    await opts.renderer.suspend()
    let status: number | null
    try {
      // Through the shell so `EDITOR="code -w"` works; the file is passed as $1 (never interpolated).
      status = spawnSync("sh", ["-c", `${editor} "$1"`, "--", file], { stdio: "inherit" }).status
    } finally {
      await opts.renderer.resume()
    }
    if (status !== 0) return null
    const text = readFileSync(file, "utf8")
    return text === initial ? null : text
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// editExternal bound to the app's renderer; call during component setup.
export function useEditExternal(): (initial: string, opts?: { editor?: string }) => Promise<string | null> {
  const renderer = useRenderer()
  return (initial, opts) => editExternal(initial, { ...opts, renderer })
}
