import { afterEach, beforeEach, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { runCli } from "../src/kernel/cli/dispatch"
import { builtinPlugins, builtinTuiParts } from "./builtins"
import { makeTestKernel, type TestKernel } from "./helpers"
import { renderTui } from "./tui"

let kernel: TestKernel
beforeEach(async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
})
afterEach(async () => {
  await kernel.cleanup()
})

async function run(argv: string[]) {
  let out = ""
  const code = await runCli(argv, kernel, { out: (s) => void (out += s), err: () => {}, stdin: async () => "" })
  return { code, out }
}

test("the help starts with ttybrain and its usage lines say ttybrain", async () => {
  const r = await run(["help"])
  expect(r.code).toBe(0)
  expect(r.out.startsWith("usage: ttybrain <thing> <verb>")).toBe(true)
  expect(r.out).not.toMatch(/\bpm [a-z<]/)
  const u = await run(["project", "add", "--help"])
  expect(u.out).toContain("ttybrain project add <code> <name>")
})

test("the TUI header says ttybrain", async () => {
  const tui = await renderTui(kernel, { parts: builtinTuiParts })
  try {
    expect((await tui.frame()).split("\n")[0]).toContain("ttybrain · 1 Overview")
  } finally {
    tui.destroy()
  }
})

test("package.json names the command ttybrain with the alias tb", () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8"))
  expect(pkg.name).toBe("ttybrain")
  expect(pkg.bin).toEqual({ ttybrain: "dist-node/bin/pm.js", tb: "dist-node/bin/pm.js" })
})

// No name from before the rename is left in the code, the tests, the scripts or CI. The patterns are built from
// pieces so that this file does not match itself.
const OLD_NAMES: Array<[string, RegExp]> = [
  ["old variable", new RegExp("\\bPM" + "_[A-Z]")],
  ["old module name", new RegExp("@" + "pm/")],
  ["old global", new RegExp("__PM" + "_MODULES__")],
  ["old manifest key", new RegExp('"p' + 'm"\\s*:\\s*\\{')],
  ["old manifest field", new RegExp("\\bp" + "m\\.(plugin|id|tui)\\b")],
  ["old manifest read", new RegExp("\\bpkg\\.p" + "m\\b")],
  ["old manifest object", new RegExp("\\bp" + "m: \\{ ?plugin\\b")],
]
// Allowed: [file, pattern name, why]. The other mentions of the old name that stay are not matched by the patterns
// at all: the one-time move of the data folder (src/kernel/home-move.ts and its tests: `~/.pm`, `pm.db`), the entry
// file (`src/bin/pm.ts`, `dist-node/bin/pm.js`, which kept its name) and temp-dir prefixes such as `pm-test-`.
const ALLOWED: Array<[string, string, string]> = [
  ["src/kernel/loader.ts", "old manifest read", "reads the old manifest key only to tell the user to rebuild a plugin built before the rename"],
  ["tests/external-plugin.test.ts", "old manifest object", "writes a manifest from before the rename, to test that it is reported"],
]

function textFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) textFiles(p, out)
    else out.push(p)
  }
  return out
}

test("no old names left", () => {
  const root = join(import.meta.dir, "..")
  const files = [...["src", "tests", "scripts"].flatMap((d) => textFiles(join(root, d))), join(root, ".gitlab-ci.yml")]
  const offenders: string[] = []
  for (const file of files) {
    const buf = readFileSync(file)
    if (buf.includes(0)) continue // binary
    const rel = relative(root, file).split(sep).join("/")
    buf
      .toString("utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const [name, re] of OLD_NAMES) {
          if (re.test(line) && !ALLOWED.some(([f, n]) => f === rel && n === name)) offenders.push(`${rel}:${i + 1}: ${name}: ${line.trim()}`)
        }
      })
  }
  expect(offenders).toEqual([])
})
