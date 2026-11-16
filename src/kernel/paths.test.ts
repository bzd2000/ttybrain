import { expect, test } from "bun:test"
import { resolvePaths } from "./paths"

test("defaults", () => {
  const p = resolvePaths({ HOME: "/h" })
  expect(p.home).toBe("/h/.pm")
  expect(p.db).toBe("/h/.pm/pm.db")
  expect(p.config).toBe("/h/.pm/config.json")
  expect(p.plugins).toBe("/h/.pm/plugins")
  expect(p.exports).toBe("/h/.pm/exports")
})
test("overrides", () => {
  expect(resolvePaths({ HOME: "/h", PM_HOME: "/data" }).db).toBe("/data/pm.db")
  expect(resolvePaths({ HOME: "/h", PM_DB: "/x.db" }).db).toBe("/x.db")
  expect(resolvePaths({ HOME: "/h", PM_DB: "/x.db" }, { db: "/y.db" }).db).toBe("/y.db")
  const p = resolvePaths({ HOME: "/h", PM_CONFIG: "/c.json", PM_PLUGINS: "/pl", PM_EXPORTS: "/ex" })
  expect([p.config, p.plugins, p.exports]).toEqual(["/c.json", "/pl", "/ex"])
})
