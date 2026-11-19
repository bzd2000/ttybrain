// The draft store (drafts.ts): one JSON file per key under TTYBRAIN_HOME/drafts, written atomically, read back,
// deleted, pruned after 30 days, and a debounced writer that flushes on demand.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fixedClock } from "../clock"
import { createDraftStore, draftFile, draftPromptText } from "./drafts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let home: string
let dir: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pm-drafts-"))
  dir = join(home, "drafts")
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

const store = (today = "2026-11-13", time = "10:42:00", delayMs = 20, onError?: (e: unknown) => void) =>
  createDraftStore({ dir, clock: fixedClock(today, time), delayMs, ...(onError ? { onError } : {}) })

describe("draft store", () => {
  test("write, read and delete one draft per key", () => {
    const s = store()
    s.write("projects:project:#P1", { name: "CRM", notes: null })
    const file = draftFile(dir, "projects:project:#P1")
    expect(file).toBe(join(dir, "projects%3Aproject%3A%23P1.json"))
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      key: "projects:project:#P1",
      savedAt: "2026-11-13T10:42:00",
      values: { name: "CRM", notes: null },
    })
    expect(s.read("projects:project:#P1")).toEqual({ key: "projects:project:#P1", savedAt: "2026-11-13T10:42:00", values: { name: "CRM", notes: null } })
    expect(s.read("projects:project:#P2")).toBeUndefined()
    s.remove("projects:project:#P1")
    expect(existsSync(file)).toBe(false)
    expect(s.read("projects:project:#P1")).toBeUndefined()
    s.remove("projects:project:#P1") // removing what is gone is fine
  })

  test("a key with a slash stays one file in the drafts dir", () => {
    const s = store()
    s.write("x:../../evil", { text: "a" })
    expect(readdirSync(dir)).toEqual(["x%3A..%2F..%2Fevil.json"])
    expect(s.read("x:../../evil")?.values).toEqual({ text: "a" })
  })

  test("writes atomically: a temp file renamed over the draft, none left behind", () => {
    const s = store()
    s.write("inbox:capture", { text: "one" })
    s.write("inbox:capture", { text: "two" })
    expect(readdirSync(dir)).toEqual(["inbox%3Acapture.json"])
    expect(s.read("inbox:capture")?.values).toEqual({ text: "two" })
  })

  test("a corrupt or foreign file is ignored", () => {
    const s = store()
    mkdirSync(dir, { recursive: true })
    writeFileSync(draftFile(dir, "inbox:capture"), "{not json")
    expect(s.read("inbox:capture")).toBeUndefined()
    writeFileSync(draftFile(dir, "inbox:capture"), JSON.stringify({ key: "other", savedAt: "2026-11-13T10:00:00", values: {} }))
    expect(s.read("inbox:capture")).toBeUndefined()
    writeFileSync(draftFile(dir, "inbox:capture"), JSON.stringify({ key: "inbox:capture", savedAt: 3, values: {} }))
    expect(s.read("inbox:capture")).toBeUndefined()
    expect(s.prune()).toBe(0) // and pruning skips it
  })

  test("prune deletes drafts older than 30 days", () => {
    store("2026-10-13").write("a", { text: "31 days" })
    store("2026-10-14").write("b", { text: "30 days" })
    store("2026-11-13").write("c", { text: "today" })
    writeFileSync(join(dir, "notes.txt"), "not a draft")
    expect(store("2026-11-13").prune()).toBe(1)
    expect(readdirSync(dir).sort()).toEqual(["b.json", "c.json", "notes.txt"])
    expect(store().prune()).toBe(0)
    rmSync(dir, { recursive: true })
    expect(store().prune()).toBe(0) // no drafts dir yet
  })

  test("the writer writes after the delay, or at once on flush; a value equal to the initial one deletes", async () => {
    const s = store()
    const w = s.writer<{ text: string }>("inbox:capture", () => ({ text: "" }))
    w.schedule({ text: "a" })
    w.schedule({ text: "ab" })
    expect(s.read("inbox:capture")).toBeUndefined()
    await sleep(60)
    expect(s.read("inbox:capture")?.values).toEqual({ text: "ab" })
    expect(w.kept()).toBe(true)
    w.schedule({ text: "abc" })
    w.flush()
    expect(s.read("inbox:capture")?.values).toEqual({ text: "abc" })
    w.schedule({ text: "" })
    w.flush()
    expect(s.read("inbox:capture")).toBeUndefined()
    expect(w.kept()).toBe(false)
    w.schedule({ text: "x" })
    w.discard()
    await sleep(60)
    expect(s.read("inbox:capture")).toBeUndefined()
  })

  test("flushAll writes every pending draft; a closed writer is flushed and forgotten", () => {
    const s = store(undefined, undefined, 10_000)
    const a = s.writer<{ text: string }>("a", () => ({ text: "" }))
    const b = s.writer<{ text: string }>("b", () => ({ text: "" }))
    a.schedule({ text: "1" })
    b.schedule({ text: "2" })
    s.flushAll()
    expect([s.read("a")?.values, s.read("b")?.values]).toEqual([{ text: "1" }, { text: "2" }])
    b.close()
    b.schedule({ text: "3" })
    s.flushAll()
    expect(s.read("b")?.values).toEqual({ text: "2" })
    a.close()
  })

  test("I/O errors are swallowed and reported once", () => {
    writeFileSync(join(home, "drafts"), "a file where the dir should be")
    const errors: unknown[] = []
    const s = store(undefined, undefined, 20, (e) => errors.push(e))
    expect(() => s.write("a", { text: "x" })).not.toThrow()
    const w = s.writer<{ text: string }>("b", () => ({ text: "" }))
    w.schedule({ text: "y" })
    expect(() => w.flush()).not.toThrow()
    expect(() => s.remove("a")).not.toThrow()
    expect(s.read("a")).toBeUndefined()
    expect(errors.length).toBe(1)
  })

  test("prompt text: the time today, the date and time otherwise", () => {
    expect(draftPromptText("2026-11-13T10:42:00", "2026-11-13")).toBe("Unsaved draft from 10:42 · r restore · x discard")
    expect(draftPromptText("2026-11-12T10:42:00", "2026-11-13")).toBe("Unsaved draft from 12 Nov 10:42 · r restore · x discard")
  })
})
