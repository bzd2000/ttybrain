// Built-in plugins reach the kernel only through the shared names `@pm/api` and `@pm/api/tui`, as external
// plugins do. Tests (*.test.ts[x]) may still import kernel internals and test helpers.
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

const root = resolve(import.meta.dir, "..")
const pluginsDir = join(root, "src", "plugins")
const kernelDir = join(root, "src", "kernel")
const STATIC = /^\s*(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?["']([^"']+)["']/gm
const specifiers = (file: string) => [...readFileSync(file, "utf8").matchAll(STATIC)].map((m) => m[1]!)
const rel = (f: string) => relative(root, f).split(sep).join("/")

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(pluginsDir)

describe("plugin imports", () => {
  test("plugins reach the kernel only through @pm/api and @pm/api/tui", () => {
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.flatMap((f) =>
      specifiers(f)
        .filter((s) => {
          if (!s.startsWith(".")) return false
          const target = resolve(dirname(f), s)
          return target === kernelDir || target.startsWith(kernelDir + sep)
        })
        .map((s) => `${rel(f)} → ${s}`),
    )
    expect(offenders).toEqual([])
  })

  test("plugin logic never imports @pm/api/tui", () => {
    const offenders = files
      .filter((f) => f.split(sep).includes("logic"))
      .flatMap((f) => specifiers(f).filter((s) => s === "@pm/api/tui").map((s) => `${rel(f)} → ${s}`))
    expect(offenders).toEqual([])
  })

  test("each built-in has default exports for its entries", async () => {
    for (const id of ["people", "projects", "meetings", "inbox"]) {
      expect(existsSync(join(pluginsDir, id))).toBe(true)
      expect((await import(`../src/plugins/${id}/logic/index`)).default.id).toBe(id)
      expect((await import(`../src/plugins/${id}/tui/index`)).default.plugin).toBe(id)
    }
  })
})
