import { afterEach, beforeEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
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
