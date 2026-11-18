import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig, updateConfigFile } from "./config"
import { resolvePaths } from "./paths"
import { ValidationError } from "./errors"
import { fixedClock } from "./clock"

function setup(file?: string) {
  const dir = mkdtempSync(join(tmpdir(), "pm-cfg-"))
  if (file !== undefined) writeFileSync(join(dir, "config.json"), file)
  return { dir, env: { HOME: "/h", PM_HOME: dir } }
}
test("defaults", () => {
  const { dir, env } = setup()
  const c = loadConfig(resolvePaths(env), env)
  expect(c).toEqual({ exportDir: join(dir, "exports"), staleContactDays: 30, assistant: { provider: "copilot" }, plugins: { disabled: [], allow: [] } })
})
test("file", () => {
  const { env } = setup('{"staleContactDays":45}')
  expect(loadConfig(resolvePaths(env), env).staleContactDays).toBe(45)
})
test("env merge", () => {
  const { env } = setup()
  const e = { ...env, PM_CONFIG_JSON: '{"plugins":{"disabled":["inbox"]}}' }
  const c = loadConfig(resolvePaths(e), e)
  expect(c.plugins).toEqual({ disabled: ["inbox"], allow: [] })
  expect(c.staleContactDays).toBe(30)
})
test("broken file", () => {
  const { dir, env } = setup("{nope")
  expect(() => loadConfig(resolvePaths(env), env)).toThrow(ValidationError)
  expect(() => loadConfig(resolvePaths(env), env)).toThrow(join(dir, "config.json"))
})
test("updateConfigFile keeps other keys, writes 2-space JSON with a trailing newline", () => {
  const { dir, env } = setup('{"staleContactDays": 14}')
  updateConfigFile(resolvePaths(env), (cfg) => {
    cfg.plugins = { disabled: ["meetings"] }
  })
  expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(JSON.stringify({ staleContactDays: 14, plugins: { disabled: ["meetings"] } }, null, 2) + "\n")
})
test("updateConfigFile starts from {} when the file is missing, creating its directory", () => {
  const { dir } = setup()
  const env = { HOME: "/h", PM_HOME: dir, PM_CONFIG: join(dir, "sub", "config.json") }
  updateConfigFile(resolvePaths(env), (cfg) => {
    cfg.a = 1
  })
  expect(readFileSync(join(dir, "sub", "config.json"), "utf8")).toBe('{\n  "a": 1\n}\n')
})
test("updateConfigFile refuses a broken file and leaves it alone", () => {
  const { dir, env } = setup("{nope")
  expect(() => updateConfigFile(resolvePaths(env), () => {})).toThrow(ValidationError)
  expect(readFileSync(join(dir, "config.json"), "utf8")).toBe("{nope")
})
test("fixedClock", () => {
  expect(fixedClock("2026-11-13").now()).toBe("2026-11-13T09:00:00")
  expect(fixedClock("2026-11-13").today()).toBe("2026-11-13")
})
