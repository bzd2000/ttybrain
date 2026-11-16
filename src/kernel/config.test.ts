import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "./config"
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
test("fixedClock", () => {
  expect(fixedClock("2026-11-13").now()).toBe("2026-11-13T09:00:00")
  expect(fixedClock("2026-11-13").today()).toBe("2026-11-13")
})
