// The CLI path never loads the UI: logic and the kernel (outside src/kernel/tui/) import no solid-js, no
// @opentui/* and nothing under src/kernel/tui/. The TUI entry loads them with a dynamic import() only.
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

const root = resolve(import.meta.dir, "..")
const src = join(root, "src")
const tuiDir = join(src, "kernel", "tui") + sep

// Static imports and re-exports (`import … from "x"`, `import "x"`, `export … from "x"`), not `import("x")`.
const STATIC = /^\s*(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?["']([^"']+)["']/gm

function specifiers(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(STATIC)].map((m) => m[1]!)
}

function resolveRelative(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec)
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return undefined
}

const isUi = (from: string, spec: string) => {
  if (spec === "@pm/api/tui" || spec === "solid-js" || spec.startsWith("solid-js/") || spec.startsWith("@opentui/")) return true
  if (!spec.startsWith(".")) return false
  const target = resolveRelative(from, spec) ?? resolve(dirname(from), spec)
  return target.startsWith(tuiDir)
}

const rel = (f: string) => relative(root, f).split(sep).join("/")

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe("logic/UI split", () => {
  test("nothing reachable from src/bin/pm.ts by static imports imports the UI", () => {
    const seen = new Set<string>()
    const offenders: string[] = []
    const queue = [join(src, "bin", "pm.ts")]
    while (queue.length > 0) {
      const file = queue.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      for (const spec of specifiers(file)) {
        if (isUi(file, spec)) offenders.push(`${rel(file)} → ${spec}`)
        if (!spec.startsWith(".")) continue
        const target = resolveRelative(file, spec)
        if (target === undefined) throw new Error(`${rel(file)}: cannot resolve "${spec}"`)
        queue.push(target)
      }
    }
    expect(offenders).toEqual([])
    // Plugins' logic entries are imported dynamically by the loader; the next test covers their files.
    expect([...seen].map(rel)).toContain("src/kernel/loader.ts")
    expect([...seen].map(rel)).toContain("src/kernel/host.ts")
  })

  test("no logic file and no kernel file outside src/kernel/tui/ imports the UI", () => {
    const pluginsDir = join(src, "plugins")
    const logic = readdirSync(pluginsDir)
      .map((p) => join(pluginsDir, p, "logic"))
      .filter((d) => existsSync(d))
      .flatMap((d) => walk(d))
    const kernel = walk(join(src, "kernel")).filter((f) => !f.startsWith(tuiDir))
    expect(logic.length).toBeGreaterThan(0)
    expect(kernel.map(rel)).toContain("src/kernel/plugin.ts")
    const offenders = [...logic, ...kernel].flatMap((f) => specifiers(f).filter((s) => isUi(f, s)).map((s) => `${rel(f)} → ${s}`))
    expect(offenders).toEqual([])
  })

  test("a plugin's tui/ part imports the kernel only through src/kernel/tui/api.ts and no other plugin's files", () => {
    const pluginsDir = join(src, "plugins")
    const api = join(tuiDir, "api.ts")
    const offenders: string[] = []
    let files = 0
    for (const plugin of readdirSync(pluginsDir)) {
      const dir = join(pluginsDir, plugin, "tui")
      if (!existsSync(dir)) continue
      const own = join(pluginsDir, plugin) + sep
      for (const f of walk(dir).filter((x) => !/\.test\.tsx?$/.test(x))) {
        files++
        for (const spec of specifiers(f)) {
          if (!spec.startsWith(".")) continue
          const target = resolveRelative(f, spec) ?? resolve(dirname(f), spec)
          if (target === api) continue
          if (target.startsWith(own) && !target.startsWith(join(src, "kernel"))) continue
          offenders.push(`${rel(f)} → ${spec}`)
        }
      }
    }
    expect(files).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
