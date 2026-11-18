import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ValidationError } from "../errors"
import { writeExport } from "./export"

let root: string | undefined
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

test("writeExport creates the folder, overwrites, refuses separators", async () => {
  root = await mkdtemp(join(tmpdir(), "pm-export-"))
  const dir = join(root, "exports", "deep")
  const path = await writeExport(dir, "minutes.md", "one")
  expect(path).toBe(join(dir, "minutes.md"))
  expect(await readFile(path, "utf8")).toBe("one")
  await writeExport(dir, "minutes.md", "two")
  expect(await readFile(path, "utf8")).toBe("two")
  for (const bad of ["a/b.md", "../x.md", "..", "", "a b.md"]) {
    await expect(writeExport(dir, bad, "x")).rejects.toThrow(ValidationError)
  }
  await expect(writeExport(dir, "a/b.md", "x")).rejects.toThrow("invalid export file name")
})
