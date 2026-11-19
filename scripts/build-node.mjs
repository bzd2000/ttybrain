// Compiles src/ to dist-node/ so the app can run on Node.js (26.4+ with --experimental-ffi).
// Bun doesn't need this: bunfig.toml's preload compiles the TSX at runtime.
// Babel settings match @opentui/solid's own transform (scripts/solid-transform.js in that package).
import { transformAsync } from "@babel/core"
import ts from "@babel/preset-typescript"
import moduleResolver from "babel-plugin-module-resolver"
import solid from "babel-preset-solid"
import { existsSync } from "node:fs"
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const srcDir = path.join(root, "src")
const outDir = path.join(root, "dist-node")

// The same values as src/kernel/plugins/babel-options.ts (`ttybrain plugin build`); a test checks they match. They are
// written as JSON so the test can read them from this file.
const solidOptions = { "moduleName": "@opentui/solid", "generate": "universal" }
const resolveExtensions = [".tsx", ".ts", ".jsx", ".js"]

// Node resolves bare "solid-js" to Solid's server (non-reactive) build, so point it at the client build.
const solidRuntime = {
  "solid-js": "solid-js/dist/solid.js",
  "solid-js/store": "solid-js/store/dist/store.js",
}

// The plugin API names (tsconfig `paths`) map to the kernel files; the output mirrors src/.
const hostModules = { "@pm/api": "kernel/api", "@pm/api/tui": "kernel/tui/api" }

// Node ESM needs explicit extensions: "./App" -> "./App.js", "./dir" -> "./dir/index.js".
function resolvePath(specifier, currentFile) {
  if (solidRuntime[specifier]) return solidRuntime[specifier]
  if (hostModules[specifier]) {
    const rel = path.relative(path.dirname(path.resolve(currentFile)), path.join(srcDir, hostModules[specifier])).split(path.sep).join("/")
    return (rel.startsWith(".") ? rel : "./" + rel) + ".js"
  }
  if (!specifier.startsWith(".")) return specifier
  const base = path.resolve(path.dirname(currentFile), specifier)
  for (const ext of resolveExtensions) {
    if (existsSync(base + ext)) return specifier + ".js"
    if (existsSync(path.join(base, "index" + ext))) return specifier + "/index.js"
  }
  return specifier.replace(/\.[cm]?[jt]sx?$/, ".js")
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

await rm(outDir, { recursive: true, force: true })
let count = 0
for await (const file of walk(srcDir)) {
  if (!/\.[jt]sx?$/.test(file) || /\.test\.[jt]sx?$/.test(file)) continue
  const result = await transformAsync(await readFile(file, "utf8"), {
    filename: file,
    configFile: false,
    babelrc: false,
    plugins: [[moduleResolver, { resolvePath }]],
    presets: [
      ...(/x$/.test(file) ? [[solid, solidOptions]] : []),
      [ts],
    ],
  })
  const out = path.join(outDir, path.relative(srcDir, file)).replace(/\.[jt]sx?$/, ".js")
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, result.code)
  count++
}
// The built-in plugins' manifests, with their entries pointing at the compiled .js files (the loader reads them).
const toJs = (entry) => entry.replace(/\.[jt]sx?$/, ".js")
for (const entry of await readdir(path.join(srcDir, "plugins"), { withFileTypes: true })) {
  const manifest = path.join(srcDir, "plugins", entry.name, "package.json")
  if (!entry.isDirectory() || !existsSync(manifest)) continue
  const pkg = JSON.parse(await readFile(manifest, "utf8"))
  if (typeof pkg.main === "string") pkg.main = toJs(pkg.main)
  if (typeof pkg.pm?.tui === "string") pkg.pm.tui = toJs(pkg.pm.tui)
  await mkdir(path.join(outDir, "plugins", entry.name), { recursive: true })
  await writeFile(path.join(outDir, "plugins", entry.name, "package.json"), JSON.stringify(pkg, null, 2) + "\n")
}
// The CLI entry is `bin.ttybrain` in package.json: make it directly executable (`npm link` puts it on the PATH).
const bin = path.join(outDir, "bin", "pm.js")
await writeFile(bin, "#!/usr/bin/env -S node --experimental-ffi\n" + (await readFile(bin, "utf8")))
await chmod(bin, 0o755)
console.log(`Compiled ${count} files to ${path.relative(root, outDir)}/`)
