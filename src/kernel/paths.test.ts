import { expect, test } from "bun:test"
import { resolvePaths } from "./paths"

test("defaults", () => {
  const p = resolvePaths({ HOME: "/h" })
  expect(p.home).toBe("/h/.ttybrain")
  expect(p.db).toBe("/h/.ttybrain/ttybrain.db")
  expect(p.config).toBe("/h/.ttybrain/config.json")
  expect(p.plugins).toBe("/h/.ttybrain/plugins")
  expect(p.exports).toBe("/h/.ttybrain/exports")
})
test("overrides", () => {
  expect(resolvePaths({ HOME: "/h", TTYBRAIN_HOME: "/data" }).db).toBe("/data/ttybrain.db")
  expect(resolvePaths({ HOME: "/h", TTYBRAIN_DB: "/x.db" }).db).toBe("/x.db")
  expect(resolvePaths({ HOME: "/h", TTYBRAIN_DB: "/x.db" }, { db: "/y.db" }).db).toBe("/y.db")
  const p = resolvePaths({ HOME: "/h", TTYBRAIN_CONFIG: "/c.json", TTYBRAIN_PLUGINS: "/pl", TTYBRAIN_EXPORTS: "/ex" })
  expect([p.config, p.plugins, p.exports]).toEqual(["/c.json", "/pl", "/ex"])
})
