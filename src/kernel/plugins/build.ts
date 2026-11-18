// `pm plugin build [dir]`: compiles an external plugin's src/ to dist/ with pm's Babel setup and points its imports
// of pm's shared modules at generated shims in dist/__pm/, which hand the plugin pm's own module instances from
// globalThis.__PM_MODULES__ at runtime (one Solid, one OpenTUI, one API). Design §3.4, plan ruling R4.
//
// Pass 1 compiles each file (TypeScript; Solid's JSX transform for .jsx/.tsx; `.js` on relative imports). Pass 2
// runs on pass 1's output, so the imports the JSX transform adds are seen too: it collects the names each file
// imports from a shared module, rewrites the specifier to the shim and records the relative imports, from which
// the build checks that the logic entry never reaches the UI modules. Babel is loaded only when a build runs.
import { existsSync, readFileSync, statSync } from "node:fs"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, posix, relative, resolve, sep } from "node:path"
import { ValidationError } from "../errors"
import { isJsxFile, isSourceFile, relativeJs, SOLID_OPTIONS, toJs } from "./babel-options"

// The modules pm shares with plugins (constraints: exactly these), in the order results list them.
export const SHARED_MODULES = ["@pm/api", "@pm/api/tui", "solid-js", "solid-js/store", "@opentui/solid", "@opentui/core"] as const
const SHARED: readonly string[] = SHARED_MODULES
// A deeper path into a shared package ("solid-js/web") is not shared: it would load a second instance.
const SHARED_PACKAGES = ["@pm/api", "solid-js", "@opentui/solid", "@opentui/core"]
const isUi = (spec: string) => spec === "@pm/api/tui" || spec === "solid-js" || spec.startsWith("solid-js/") || spec.startsWith("@opentui/")

// "@opentui/solid" -> "opentui-solid.js"
export const shimFileName = (name: string) => name.replace(/^@/, "").replaceAll("/", "-") + ".js"

const NAMESPACE = Symbol("namespace") // `import * as x` / `export *` / `export * as x` / `import()`

type Built = {
  src: string // relative to the plugin folder, with "/"
  out: string // relative to the plugin folder, with "/"
  code: string
  relative: string[] // the files it imports (static imports and re-exports), as `out` paths
  ui: string[] // the UI modules it imports
}

type Babel = {
  transformAsync(code: string, opts: Record<string, unknown>): Promise<{ code?: string | null } | null>
}
type BabelPath = { node: any }

// `import(name)` through a variable: the CLI path never loads Babel, and pm ships no Babel typings.
async function loadBabel() {
  const load = async (name: string) => ((await import(name)) as { default: any }).default
  const core = (await import("@babel/core" as string)) as Babel & { default?: Babel }
  return {
    babel: typeof core.transformAsync === "function" ? core : core.default!,
    ts: await load("@babel/preset-typescript"),
    moduleResolver: await load("babel-plugin-module-resolver"),
    solid: await load("babel-preset-solid"),
  }
}

const slash = (p: string) => p.split(sep).join("/")

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

export async function buildPlugin(dir: string): Promise<{ files: number; shims: string[] }> {
  const root = resolve(dir)
  if (!existsSync(join(root, "package.json"))) throw new ValidationError(`no package.json in ${root}`)
  const srcDir = join(root, "src")
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) throw new ValidationError(`no src/ in ${root}`)
  let pkg: { main?: unknown }
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  } catch (e) {
    throw new ValidationError(`invalid package.json in ${root}: ${(e as Error).message}`)
  }
  if (typeof pkg.main !== "string") throw new ValidationError(`package.json in ${root} has no "main"`)

  const { babel, ts, moduleResolver, solid } = await loadBabel()
  const imported = new Map<string, string[]>() // shared module -> the names the plugin imports from it
  const built: Built[] = []
  for await (const file of walk(srcDir)) {
    if (!isSourceFile(file) || file.endsWith(".d.ts")) continue // declarations compile to nothing
    const src = slash(relative(root, file))
    const out = "dist/" + toJs(slash(relative(srcDir, file)))
    const fail = (e: unknown): never => {
      throw new ValidationError((e as Error).message)
    }
    // Pass 1.
    const first = await babel
      .transformAsync(await readFile(file, "utf8"), {
        filename: file,
        configFile: false,
        babelrc: false,
        plugins: [[moduleResolver, { resolvePath: relativeJs }]],
        presets: [...(isJsxFile(file) ? [[solid, { ...SOLID_OPTIONS }]] : []), [ts]],
      })
      .catch(fail)
    // Pass 2.
    const entry: Built = { src, out, code: "", relative: [], ui: [] }
    const errors: string[] = []
    const use = (source: { value: string }, names: Array<string | typeof NAMESPACE>) => {
      const spec = source.value
      if (spec.startsWith(".")) {
        entry.relative.push(posix.normalize(posix.join(posix.dirname(out), spec)))
        return
      }
      if (isUi(spec)) entry.ui.push(spec)
      if (SHARED.includes(spec)) {
        if (names.includes(NAMESPACE)) return void errors.push(`${src}: use named imports from "${spec}"`)
        const list = imported.get(spec) ?? []
        for (const n of names as string[]) if (!list.includes(n)) list.push(n)
        imported.set(spec, list)
        const shim = posix.relative(posix.dirname(out), `dist/__pm/${shimFileName(spec)}`)
        source.value = shim.startsWith(".") ? shim : "./" + shim
      } else if (SHARED_PACKAGES.some((p) => spec.startsWith(p + "/"))) {
        errors.push(`${src}: "${spec}" is not shared by pm; use ${SHARED.slice(0, -1).join(", ")} or ${SHARED.at(-1)}`)
      }
    }
    const nameOf = (n: { type: string; name?: string; value?: string }) => (n.type === "Identifier" ? n.name! : n.value!)
    const shims = () => ({
      visitor: {
        ImportDeclaration(p: BabelPath) {
          use(
            p.node.source,
            p.node.specifiers.map((s: any) => (s.type === "ImportNamespaceSpecifier" ? NAMESPACE : s.type === "ImportDefaultSpecifier" ? "default" : nameOf(s.imported))),
          )
        },
        ExportNamedDeclaration(p: BabelPath) {
          if (!p.node.source) return
          use(p.node.source, p.node.specifiers.map((s: any) => (s.type === "ExportSpecifier" ? nameOf(s.local) : NAMESPACE)))
        },
        ExportAllDeclaration(p: BabelPath) {
          use(p.node.source, [NAMESPACE])
        },
        CallExpression(p: BabelPath) {
          const [arg] = p.node.arguments
          if (p.node.callee.type !== "Import" || arg?.type !== "StringLiteral" || arg.value.startsWith(".")) return
          use({ value: arg.value }, [NAMESPACE]) // a dynamic import only gets the whole module: a namespace
        },
      },
    })
    const second = await babel
      .transformAsync(first?.code ?? "", { filename: file, configFile: false, babelrc: false, plugins: [shims] })
      .catch(fail)
    if (errors.length > 0) throw new ValidationError(errors[0]!)
    entry.code = second?.code ?? ""
    built.push(entry)
  }

  // The logic entry, through its own files, must not import the UI (spec §3.1).
  const main = slash(relative(root, resolve(root, pkg.main)))
  const byOut = new Map(built.map((b) => [b.out, b]))
  if (!byOut.has(main)) throw new ValidationError(`"main" (${pkg.main}) is not built from src/: expected a source file for ${main.replace(/^dist\//, "src/")}`)
  const seen = new Set<string>()
  const queue = [main]
  while (queue.length > 0) {
    const b = byOut.get(queue.shift()!)
    if (!b || seen.has(b.out)) continue
    seen.add(b.out)
    if (b.ui.length > 0) throw new ValidationError(`logic entry imports "${b.ui[0]}" (via ${b.src})`)
    queue.push(...b.relative)
  }

  const distDir = join(root, "dist")
  await rm(distDir, { recursive: true, force: true })
  for (const b of built) {
    await mkdir(dirname(join(root, b.out)), { recursive: true })
    await writeFile(join(root, b.out), b.code + "\n")
  }
  const shims = SHARED_MODULES.filter((m) => imported.has(m))
  if (shims.length > 0) await mkdir(join(distDir, "__pm"), { recursive: true })
  for (const name of shims) await writeFile(join(distDir, "__pm", shimFileName(name)), shimSource(name, imported.get(name)!))
  return { files: built.length, shims }
}

const RESERVED = new Set(
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(" "),
)
const plainName = (n: string) => /^[A-Za-z_$][\w$]*$/.test(n) && !RESERVED.has(n)

// A shim: the host's module from globalThis.__PM_MODULES__, checked at load for every name the plugin imports.
export function shimSource(name: string, names: string[]): string {
  const lines = [
    `const m = globalThis.__PM_MODULES__?.[${JSON.stringify(name)}]`,
    `if (!m) throw new Error('"${name}" is provided by pm; load this plugin from pm')`,
  ]
  if (names.length > 0) {
    lines.push(
      `for (const n of [${names.map((n) => JSON.stringify(n)).join(", ")}]) if (!(n in m)) throw new Error(\`rebuild the plugin with this pm (missing export "\${n}" from "${name}")\`)`,
    )
  }
  const plain = names.filter(plainName)
  if (plain.length > 0) lines.push(`export const ${plain.map((n) => `${n} = m.${n}`).join(", ")}`)
  // `default` and names that aren't plain identifiers ("a-b", reserved words) go through a local binding.
  names.filter((n) => !plainName(n)).forEach((n, i) => lines.push(`const __pm${i} = m[${JSON.stringify(n)}]`, `export { __pm${i} as ${n === "default" ? "default" : JSON.stringify(n)} }`))
  return lines.join("\n") + "\n"
}
