import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { seedDev } from "./seed-dev"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "seed-dev-"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const run = async (args: string[]) => {
  let out = ""
  let err = ""
  const code = await seedDev(args, { HOME: join(root, "home") }, { out: (s) => (out += s), err: (s) => (err += s) })
  return { code, out, err }
}

test("refuses the real data folders", async () => {
  for (const name of [".ttybrain", ".pm"]) {
    const real = join(root, "home", name)
    mkdirSync(real, { recursive: true })
    const r = await run([real, "--fresh"])
    expect(r.code).toBe(2)
    expect(r.err).toContain("real data folder")
    expect(existsSync(join(real, "ttybrain.db"))).toBe(false)
  }
})

test("refuses an existing database; --fresh clears only the dev folder's database files", async () => {
  const dev = join(root, "dev")
  const first = await run([dev])
  expect(first.code).toBe(0)
  expect(existsSync(join(dev, "ttybrain.db"))).toBe(true)
  const keep = join(dev, "keep.txt")
  writeFileSync(keep, "x")
  const outside = join(root, "outside.txt")
  writeFileSync(outside, "x")

  const again = await run([dev])
  expect(again.code).toBe(2)
  expect(again.err).toContain("--fresh")

  const fresh = await run([dev, "--fresh", "--set", "11-13"])
  expect(fresh.code).toBe(0)
  expect(existsSync(keep)).toBe(true)
  expect(existsSync(outside)).toBe(true)
}, 60000)

test("rejects an unknown set", async () => {
  expect((await run([join(root, "d"), "--set", "x"])).code).toBe(2)
})
