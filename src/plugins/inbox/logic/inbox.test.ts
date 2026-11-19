import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runWithContext } from "../../../kernel/context"
import { runCli } from "../../../kernel/cli/dispatch"
import { people } from "../../people/logic/index"
import { projects } from "../../projects/logic/index"
import { inbox } from "./index"

let k: TestKernel

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string; json: any }> {
  let out = ""
  let err = ""
  const code = await runCli(argv, k, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => "" })
  let json: any
  try {
    json = JSON.parse(out)
  } catch {
    json = undefined
  }
  return { code, out, err, json }
}

async function ok(...argv: string[]) {
  const r = await cli(...argv)
  if (r.code !== 0) throw new Error(`ttybrain ${argv.join(" ")} → exit ${r.code}: ${r.out}${r.err}`)
  return r
}

describe("inbox", () => {
  beforeEach(async () => {
    k = await makeTestKernel({ plugins: [people, projects, inbox] })
    await ok("person", "add", "Peter Janssens", "--handle", "peter", "--stakeholder")
    await ok("project", "add", "CRM", "CRM replatforming")
  })
  afterEach(async () => {
    await k.cleanup()
  })

  test("boots", () => {
    expect(k.plugins.find((p) => p.id === "inbox")).toEqual({ id: "inbox", version: "1.0.0", source: "built-in", status: "ok" })
  })

  test("add links tags", async () => {
    const a = await ok("inbox", "add", "Peter worried about budget (#CRM), update before board @peter.", "--json")
    expect(a.json.ref).toBe("I-1")
    const s = await ok("inbox", "show", "I-1", "--json")
    expect(s.json.links.map((l: any) => l.ref)).toEqual(["#CRM", "@peter"])
    expect(s.json.links.map((l: any) => l.label)).toEqual(["CRM replatforming", "Peter Janssens"])
    expect(s.json.unresolved).toEqual([])
    expect(s.json.status).toBe("new")
  })

  test("unresolved tags, then edit resolves them", async () => {
    await ok("inbox", "add", "first")
    await ok("inbox", "add", "ask Marie #CMR")
    let s = await ok("inbox", "show", "I-2", "--json")
    expect(s.json.unresolved).toEqual(["#CMR"])
    expect(s.json.links).toEqual([])
    await ok("inbox", "edit", "I-2", "ask Marie #CRM")
    s = await ok("inbox", "show", "I-2", "--json")
    expect(s.json.unresolved).toEqual([])
    expect(s.json.links.map((l: any) => l.ref)).toEqual(["#CRM"])
    expect(s.json.text).toBe("ask Marie #CRM")
  })

  test("tag parsing end to end: e-mail addresses and C# are not tags", async () => {
    await ok("inbox", "add", "mail anna@example.com about C# code")
    const s = await ok("inbox", "show", "I-1", "--json")
    expect(s.json.links).toEqual([])
    expect(s.json.unresolved).toEqual([])
  })

  test("capture appends context as a tag unless already in the text", async () => {
    const run = (input: unknown) => k.ops.api("inbox")!.write.capture!(input)
    const a: any = await runWithContext(k.context(), () => run({ text: "call vendor", context: "#CRM" }))
    expect(a.text).toBe("call vendor #CRM")
    const b: any = await runWithContext(k.context(), () => run({ text: "call @peter", context: "@peter" }))
    expect(b.text).toBe("call @peter")
    const s = await ok("inbox", "show", "I-1", "--json")
    expect(s.json.links.map((l: any) => l.ref)).toEqual(["#CRM"])
  })

  test("blank text is rejected", async () => {
    expect((await cli("inbox", "add", "   ", "--json")).code).not.toBe(0)
  })

  test("provenance: created records and done", async () => {
    await ok("inbox", "add", "Peter worried about budget (#CRM), update before board @peter.")
    const a = await ok("action", "add", "Budget update for Peter", "--for", "peter", "--from-inbox", "I-1", "--json")
    expect(a.json.ref).toBe("A-1")
    await ok("note", "add", "peter", "Worried about budget", "--interaction", "--from-inbox", "I-1")
    const d = await ok("inbox", "done", "I-1", "--summary", "note on @peter, A-1", "--json")
    expect(d.json.status).toBe("processed")
    expect(d.json.processed_by).toBe("cli")
    const s = await ok("inbox", "show", "I-1", "--json")
    expect(s.json.created.map((c: any) => c.ref)).toEqual(["A-1", "N-1"])
    expect(s.json.status).toBe("processed")
    expect(s.json.summary).toBe("note on @peter, A-1")
  })

  test("provenance: deletes with --from-inbox succeed and return { ref, deleted: true }", async () => {
    await ok("inbox", "add", "Peter worried about budget @peter")
    await ok("note", "add", "peter", "Worried about budget", "--interaction", "--from-inbox", "I-1")
    await ok("action", "add", "Budget update", "--for", "peter", "--from-inbox", "I-1")
    await ok("action", "add", "Second", "--for", "peter", "--from-inbox", "I-1")
    const n = await cli("note", "delete", "N-1", "--yes", "--from-inbox", "I-1")
    expect(n.code).toBe(0)
    expect(n.out).toBe("N-1 deleted\n")
    const a = await cli("action", "delete", "A-2", "--yes", "--from-inbox", "I-1", "--json")
    expect(a.code).toBe(0)
    expect(a.json).toEqual({ ref: "A-2", deleted: true })
    expect((await ok("inbox", "show", "I-1", "--json")).json.created).toEqual([{ ref: "A-1", label: "Budget update" }])
  })

  test("provenance: a deleted record's id reused later does not show as created from the item", async () => {
    await ok("inbox", "add", "Peter worried about budget @peter")
    await ok("action", "add", "Budget update", "--for", "peter", "--from-inbox", "I-1")
    await ok("action", "delete", "A-1", "--yes")
    expect((await ok("action", "add", "Unrelated later action", "--json")).json.ref).toBe("A-1")
    const s = await ok("inbox", "show", "I-1", "--json")
    expect(s.json.created).toEqual([])
    expect((await ok("inbox", "show", "I-1")).out).not.toContain("Unrelated")
  })

  test("provenance: an item is not recorded as created from itself", async () => {
    await ok("inbox", "add", "first")
    await ok("inbox", "add", "second")
    await ok("inbox", "done", "I-2", "--summary", "nothing", "--from-inbox", "I-2")
    expect((await ok("inbox", "show", "I-2", "--json")).json.created).toEqual([])
  })

  test("delete outputs: every delete returns { ref, deleted: true }", async () => {
    await ok("action", "add", "x", "--project", "CRM")
    await ok("milestone", "add", "CRM", "Design approved", "--due", "2026-12-15")
    await ok("deliverable", "add", "CRM", "Spec")
    await ok("risk", "add", "CRM", "Vendor delay", "--type", "risk", "--severity", "high")
    await ok("decision", "add", "Go with vendor X", "--project", "CRM")
    for (const [thing, ref] of [["action", "A-1"], ["milestone", "MS-1"], ["deliverable", "D-1"], ["risk", "R-1"], ["decision", "DE-1"]]) {
      expect((await ok(thing!, "delete", ref!, "--yes", "--json")).json).toEqual({ ref, deleted: true })
    }
  })

  test("--from-inbox with an item that does not exist is not found, and nothing is written", async () => {
    await ok("inbox", "add", "first")
    const r = await cli("action", "add", "typo", "--for", "peter", "--from-inbox", "I-99", "--json")
    expect(r.code).toBe(2)
    expect(r.json).toEqual({ error: { code: "not_found", message: '--from-inbox: no record "I-99"', hint: 'run "ttybrain inbox list"' } })
    expect((await ok("action", "add", "real", "--for", "peter", "--from-inbox", "I-1", "--json")).json.ref).toBe("A-1")
    expect((await ok("inbox", "show", "I-1", "--json")).json.created.map((c: any) => c.ref)).toEqual(["A-1"])
  })

  test("done --by, dismiss, reopen, list filters", async () => {
    await ok("inbox", "add", "one")
    await ok("inbox", "add", "two")
    await ok("inbox", "add", "three")
    await ok("inbox", "done", "I-1", "--summary", "handled", "--by", "assistant")
    await ok("inbox", "dismiss", "I-2")
    expect((await ok("inbox", "list", "--json")).json.map((i: any) => i.ref)).toEqual(["I-3"])
    expect((await ok("inbox", "list", "--new", "--json")).json.map((i: any) => i.ref)).toEqual(["I-3"])
    const all = await ok("inbox", "list", "--all", "--json")
    expect(all.json.map((i: any) => `${i.ref} ${i.status}`)).toEqual(["I-1 processed", "I-2 dismissed", "I-3 new"])
    expect(all.json[0].processed_by).toBe("assistant")
    await ok("inbox", "reopen", "I-1")
    const s = await ok("inbox", "show", "I-1", "--json")
    expect(s.json.status).toBe("new")
    expect(s.json.summary).toBeNull()
    expect((await cli("inbox", "done", "I-3", "--summary", "x", "--by", "robot")).code).not.toBe(0)
    expect((await cli("inbox", "show", "I-99")).code).not.toBe(0)
  })

  test("dismiss records who dismissed it (cli from the CLI), null without by; reopen clears it", async () => {
    await ok("inbox", "add", "one")
    await ok("inbox", "add", "two")
    const w = k.runtime("inbox")!.self().write as Record<string, (i: any) => Promise<any>>
    const out = await runWithContext(k.context(), () => w.dismiss!({ ref: "I-1", by: "you" }))
    expect([out.status, out.processed_by, out.processed_at]).toEqual(["dismissed", "you", "2026-11-13T09:00:00"])
    await ok("inbox", "dismiss", "I-2")
    await ok("inbox", "reopen", "I-1")
    let all = await ok("inbox", "list", "--all", "--json")
    expect(all.json.map((i: any) => `${i.ref} ${i.status} ${i.processed_by}`)).toEqual(["I-1 new null", "I-2 dismissed cli"])
    // without `by`, nobody is recorded: a processed item dismissed later is not attributed to who processed it
    await ok("inbox", "done", "I-1", "--summary", "handled", "--by", "assistant")
    await runWithContext(k.context(), () => w.dismiss!({ ref: "I-1" }))
    all = await ok("inbox", "list", "--all", "--json")
    expect(all.json.map((i: any) => `${i.ref} ${i.status} ${i.processed_by}`)).toEqual(["I-1 dismissed null", "I-2 dismissed cli"])
  })

  test("view inbox.item", async () => {
    await ok("inbox", "add", "one")
    const views = k.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE '%inbox%'").all([]) as Array<{ name: string }>
    expect(views).toHaveLength(1)
    const rows = k.db.raw.prepare(`SELECT * FROM "${views[0]!.name}"`).all([])
    expect(rows).toHaveLength(1)
  })

  test("overview section lists new items, text truncated to 60", async () => {
    await ok("inbox", "add", "x".repeat(80))
    await ok("inbox", "add", "done soon")
    await ok("inbox", "done", "I-2", "--summary", "ok")
    const r = await ok("report", "overview", "--format", "text")
    expect(r.out).toContain("Inbox")
    expect(r.out).toContain("I-1")
    expect(r.out).toContain("x".repeat(59) + "…")
    expect(r.out).not.toContain("I-2")
    await ok("inbox", "dismiss", "I-1")
    expect((await ok("report", "overview", "--format", "text")).out).toContain("Inbox is empty")
  })

  test("guide: sections in order, with the rules", async () => {
    const g = (await ok("guide")).out
    const at = (h: string) => g.indexOf(`## ${h}`)
    expect(at("People and stakeholders")).toBeGreaterThan(-1)
    expect(at("Projects")).toBeGreaterThan(at("People and stakeholders"))
    expect(at("Processing the inbox")).toBeGreaterThan(at("Projects"))
    expect(g).toContain("ttybrain inbox list --new --json")
    expect(g).toContain("ask the user when something is ambiguous instead of guessing")
    expect(g).toContain("on the commands that create or change records for that item (not on `ttybrain inbox done`)")
    expect(g).not.toContain("on every command")
  })
})
