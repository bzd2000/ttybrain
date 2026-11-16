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

// Node resolves bare "solid-js" to Solid's server (non-reactive) build, so point it at the client build.
const solidRuntime = {
  "solid-js": "solid-js/dist/solid.js",
  "solid-js/store": "solid-js/store/dist/store.js",
}

// Node ESM needs explicit extensions: "./App" -> "./App.js", "./dir" -> "./dir/index.js".
function resolvePath(specifier, currentFile) {
  if (solidRuntime[specifier]) return solidRuntime[specifier]
  if (!specifier.startsWith(".")) return specifier
  const base = path.resolve(path.dirname(currentFile), specifier)
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
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
      ...(/x$/.test(file) ? [[solid, { moduleName: "@opentui/solid", generate: "universal" }]] : []),
      [ts],
    ],
  })
  const out = path.join(outDir, path.relative(srcDir, file)).replace(/\.[jt]sx?$/, ".js")
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, result.code)
  count++
}
// The CLI entry is `bin.pm` in package.json: make it directly executable (`npm link` puts it on the PATH).
const bin = path.join(outDir, "bin", "pm.js")
await writeFile(bin, "#!/usr/bin/env -S node --experimental-ffi\n" + (await readFile(bin, "utf8")))
await chmod(bin, 0o755)
console.log(`Compiled ${count} files to ${path.relative(root, outDir)}/`)
