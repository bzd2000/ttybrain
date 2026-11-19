// The Babel setup pm compiles with, shared by `pm plugin build` (build.ts) and pm's own Node build
// (scripts/build-node.mjs keeps a copy of these values; build.test.ts checks they match).
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

// babel-preset-solid for .jsx/.tsx files, as @opentui/solid's own transform runs it.
export const SOLID_OPTIONS = { moduleName: "@opentui/solid", generate: "universal" } as const

// What an extensionless relative import may name, in lookup order.
export const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"] as const

export const isSourceFile = (file: string) => /\.[jt]sx?$/.test(file) && !/\.test\.[jt]sx?$/.test(file)
export const isJsxFile = (file: string) => /x$/.test(file)
export const toJs = (file: string) => file.replace(/\.[cm]?[jt]sx?$/, ".js")

// Node ESM needs explicit extensions: "./App" -> "./App.js", "./dir" -> "./dir/index.js". Bare specifiers stay.
export function relativeJs(specifier: string, currentFile: string): string {
  if (!specifier.startsWith(".")) return specifier
  const base = resolve(dirname(currentFile), specifier)
  for (const ext of RESOLVE_EXTENSIONS) {
    if (existsSync(base + ext)) return specifier + ".js"
    if (existsSync(join(base, "index" + ext))) return specifier + "/index.js"
  }
  return toJs(specifier)
}
