import { expect, test } from "bun:test"
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
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
test("updateConfigFile writes atomically: a failing write leaves the old file intact, a success leaves no temp file", () => {
  const { dir, env } = setup('{"staleContactDays": 14}')
  const paths = resolvePaths(env)
  // Block the temp file the write goes through (same directory, then renamed over the config).
  const temp = `${paths.config}.${process.pid}.tmp`
  mkdirSync(temp)
  expect(() => updateConfigFile(paths, (cfg) => void (cfg.staleContactDays = 1))).toThrow()
  expect(readFileSync(paths.config, "utf8")).toBe('{"staleContactDays": 14}')
  rmSync(temp, { recursive: true })
  updateConfigFile(paths, (cfg) => void (cfg.staleContactDays = 1))
  expect(readFileSync(paths.config, "utf8")).toBe('{\n  "staleContactDays": 1\n}\n')
  expect(readdirSync(dir)).toEqual(["config.json"])
})
test("updateConfigFile writes through a symlinked config and keeps the file's mode", () => {
  const { dir, env } = setup()
  const elsewhere = mkdtempSync(join(tmpdir(), "pm-cfg-real-"))
  const real = join(elsewhere, "real.json")
  writeFileSync(real, '{"staleContactDays": 14}')
  chmodSync(real, 0o600)
  symlinkSync(real, join(dir, "config.json"))
  const paths = resolvePaths(env)
  updateConfigFile(paths, (cfg) => void (cfg.staleContactDays = 1))
  expect(lstatSync(paths.config).isSymbolicLink()).toBe(true)
  expect(readFileSync(real, "utf8")).toBe('{\n  "staleContactDays": 1\n}\n')
  expect(statSync(real).mode & 0o777).toBe(0o600)
  expect(readdirSync(elsewhere)).toEqual(["real.json"])
  expect(readdirSync(dir)).toEqual(["config.json"])
  rmSync(elsewhere, { recursive: true })
})
test("updateConfigFile keeps a regular file's mode", () => {
  const { env } = setup("{}")
  const paths = resolvePaths(env)
  chmodSync(paths.config, 0o640)
  updateConfigFile(paths, (cfg) => void (cfg.a = 1))
  expect(statSync(paths.config).mode & 0o777).toBe(0o640)
})
test("config keys __proto__, constructor and prototype are ignored", () => {
  const { env } = setup('{"__proto__": {"x": 1}, "constructor": {"y": 2}, "prototype": 3, "plugins": {"__proto__": {"z": 1}}}')
  const e = { ...env, PM_CONFIG_JSON: '{"__proto__": {"w": 1}}' }
  const c = loadConfig(resolvePaths(e), e) as unknown as Record<string, unknown>
  expect(Object.getPrototypeOf(c)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(c.plugins)).toBe(Object.prototype)
  expect(c.x).toBeUndefined()
  expect(c.w).toBeUndefined()
  expect((c.plugins as Record<string, unknown>).z).toBeUndefined()
  expect(Object.hasOwn(c, "constructor")).toBe(false)
  expect(Object.hasOwn(c, "prototype")).toBe(false)
})
test("fixedClock", () => {
  expect(fixedClock("2026-11-13").now()).toBe("2026-11-13T09:00:00")
  expect(fixedClock("2026-11-13").today()).toBe("2026-11-13")
})
