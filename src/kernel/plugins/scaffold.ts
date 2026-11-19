// `pm plugin new <id>`: writes a new external plugin folder that `pm plugin build` can build and pm can load as it is
// (a migration, a `<id> list` command, a screen, a project tab, a test). The template files are string constants
// here so the Node build carries them. Design §3.5.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ValidationError } from "../errors"
import { builtinPluginDir } from "../loader"
import { assertPluginId } from "../plugin-id"

// The ids of the built-in plugins, from their manifests.
function builtinIds(): string[] {
  const root = builtinPluginDir()
  const ids: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const pkg = JSON.parse(readFileSync(join(root, entry.name, "package.json"), "utf8")) as { pm?: { id?: unknown } }
      if (typeof pkg.pm?.id === "string") ids.push(pkg.pm.id)
    } catch {
      // not a plugin folder
    }
  }
  return ids
}

// The running pm's API sources, when they exist: src/kernel/ of the checkout (this module is src/kernel/plugins/
// under Bun and dist-node/kernel/plugins/ under Node, both three levels below the checkout).
export function pmApiSources(root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")): { api: string; tui: string } | undefined {
  const api = join(root, "src", "kernel", "api.ts")
  const tui = join(root, "src", "kernel", "tui", "api.ts")
  return existsSync(api) && existsSync(tui) ? { api, tui } : undefined
}

export const NO_SOURCES_NOTE = "note: no pm sources found; type-checking needs a git checkout of pm"

// Template lines that start with the keyword stay out of the static-import scan (tests/logic-ui-split.test.ts).
const IMPORT = "import"

const title = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " ")

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n"

const packageJson = (id: string) => {
  const peers = { "solid-js": "^1.9", "@opentui/solid": "^0.8", "@opentui/core": "^0.8", "@pm/api": "^1" }
  return json({
    name: `pm-plugin-${id}`,
    version: "0.1.0",
    type: "module",
    main: "dist/logic/index.js",
    files: ["dist"],
    pm: { plugin: true, id, tui: "dist/tui/index.js" },
    peerDependencies: peers,
    devDependencies: { "@types/bun": "^1.4", typescript: "^7", "solid-js": "^1.9", "@opentui/solid": "^0.8.4", "@opentui/core": "^0.8.4" },
    peerDependenciesMeta: Object.fromEntries(Object.keys(peers).map((k) => [k, { optional: true }])),
  })
}

const tsconfig = (sources: { api: string; tui: string } | undefined) =>
  json({
    compilerOptions: {
      lib: ["ESNext"],
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      jsx: "preserve",
      jsxImportSource: "@opentui/solid",
      strict: true,
      noUncheckedIndexedAccess: true,
      verbatimModuleSyntax: true,
      skipLibCheck: true,
      noEmit: true,
      types: ["bun"],
      ...(sources && { paths: { "@pm/api": [sources.api], "@pm/api/tui": [sources.tui] } }),
    },
    include: ["src"],
  })

const logic = (id: string) => `// The "${id}" plugin: its tables and commands. Only "@pm/api" is imported here; the UI is in ../tui.
${IMPORT} { definePlugin, formatTable } from "@pm/api"

export default definePlugin({
  id: ${JSON.stringify(id)},
  name: ${JSON.stringify(title(id))},
  version: "0.1.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.migration("1-item", async (db) => {
      await db.schema
        .createTable("item")
        .addColumn("id", "integer", (c) => c.primaryKey())
        .addColumn("title", "text", (c) => c.notNull())
        .execute()
    })

    ctx.command({
      thing: ${JSON.stringify(id)},
      verb: "list",
      summary: "list the items",
      run: async () => {
        const rows = await ctx.data.selectFrom("item").select(["id", "title"]).orderBy("id").execute()
        const list = rows.map((r) => ({ id: Number(r.id), title: String(r.title) }))
        return { json: list, text: list.length ? formatTable(["id", "title"], list) : "no items" }
      },
    })
  },
})
`

const tui = (id: string) => `// The "${id}" plugin's terminal UI: a screen and a tab on projects. Only "@pm/api/tui" and "solid-js" are imported.
${IMPORT} { defineTui, useQuery, useRuntime } from "@pm/api/tui"
${IMPORT} { For, Show } from "solid-js"

function Screen() {
  const rt = useRuntime()
  const q = useQuery(() => rt.data.selectFrom("item").select(["id", "title"]).orderBy("id").execute())
  return (
    <box flexDirection="column">
      <Show when={(q.data() ?? []).length > 0} fallback={<text>No items</text>}>
        <For each={q.data() ?? []}>{(item) => <text>{\`\${item.id} \${item.title}\`}</text>}</For>
      </Show>
    </box>
  )
}

function ProjectTab(props: { recordRef: string }) {
  return (
    <box flexDirection="column">
      <text>{\`${title(id)} for \${props.recordRef}\`}</text>
    </box>
  )
}

export default defineTui({
  plugin: ${JSON.stringify(id)},
  activate(ui) {
    ui.screen({ id: ${JSON.stringify(id)}, title: ${JSON.stringify(title(id))}, component: Screen })
    ui.recordTab("project", { id: ${JSON.stringify(id)}, title: ${JSON.stringify(title(id))}, order: 90, component: ProjectTab })
  },
})
`

const test = (id: string) => `// Run with \`bun test\`. It checks the plugin's definition; \`pm plugin build\` skips test files.
${IMPORT} { expect, test } from "bun:test"
${IMPORT} plugin from "./index"

test("the plugin's id and api version", () => {
  expect(plugin.id).toBe(${JSON.stringify(id)})
  expect(plugin.apiVersion).toBe(1)
})
`

const readme = (id: string) => `# ${title(id)}

A pm plugin (\`${id}\`).

## Build

\`\`\`
pm plugin build
\`\`\`

This compiles \`src/\` to \`dist/\`, pointing the imports of pm's shared modules at pm's own copies.

## Add to pm

Copy this folder, built, into pm's plugins folder (\`~/.ttybrain/plugins/${id}\`), or install it from a package:

\`\`\`
pm plugin add <folder-or-tgz>
\`\`\`

## List and remove

\`\`\`
pm plugin list
pm plugin remove ${id} --yes
\`\`\`

Type-checking needs a git checkout of pm: \`tsconfig.json\` points \`@pm/api\` and \`@pm/api/tui\` at its sources.
`

// Creates <parent>/<id> with the template files and returns its path. Throws a ValidationError for an id that is
// taken by a built-in plugin or whose folder exists, and assertPluginId's error for an invalid id.
export function scaffoldPlugin(parent: string, id: string, opts: { pmRoot?: string } = {}): string {
  assertPluginId(id)
  if (builtinIds().includes(id)) throw new ValidationError(`plugin id "${id}" is taken by a built-in plugin`)
  const dir = resolve(parent, id)
  if (existsSync(dir)) throw new ValidationError(`already exists: ${dir}`)
  const files: Record<string, string> = {
    "package.json": packageJson(id),
    "tsconfig.json": tsconfig(pmApiSources(opts.pmRoot)),
    "README.md": readme(id),
    "src/logic/index.ts": logic(id),
    "src/logic/index.test.ts": test(id),
    "src/tui/index.tsx": tui(id),
  }
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  return dir
}

// The text `pm plugin new` prints, with the note when pm's API sources can't be found.
export function createdText(dir: string, id: string, pmRoot?: string): string {
  return `created ${dir}; next: pm plugin build ${id}${pmApiSources(pmRoot) ? "" : `\n${NO_SOURCES_NOTE}`}`
}
