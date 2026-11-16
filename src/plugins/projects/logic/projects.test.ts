import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
import { people } from "../../people/logic/index"
import { projects } from "./index"

let k: TestKernel

async function cli(argv: string[], stdin = ""): Promise<{ code: number; out: string; err: string; json: any }> {
  let out = ""
  let err = ""
  const code = await runCli(argv, k, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => stdin })
  let json: any
  try {
    json = JSON.parse(out)
  } catch {
    json = undefined
  }
  return { code, out, err, json }
}
const run = (...argv: string[]) => cli(argv)
async function ok(...argv: string[]) {
  const r = await cli(argv)
  if (r.code !== 0) throw new Error(`pm ${argv.join(" ")} → exit ${r.code}: ${r.out}${r.err}`)
  return r
}

const api = (id: string) => k.ops.api(id)!
const inCtx = <T>(fn: () => Promise<T>) => runWithContext(k.context(), fn)
// The published view, read as another plugin would (through the kernel's raw connection).
const viewRows = (name: string) => k.db.raw.prepare(`SELECT * FROM "projects__pub_${name}" ORDER BY 1`).all([]) as any[]

describe("projects", () => {
  beforeEach(async () => {
    k = await makeTestKernel({ plugins: [people, projects] })
  })
  afterEach(async () => {
    await k.cleanup()
  })

  test("declares the views it reads: people's and meetings'", () => {
    expect(projects.reads).toEqual({ people: "^1", meetings: "^1" })
    expect(projects.requires).toEqual({ people: "^1" })
  })

  test("boots after people, with every table of migration 001", () => {
    expect(k.plugins.map((p) => `${p.id} ${p.status}`)).toEqual(["people ok", "projects ok"])
    const tables = (k.db.raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'projects_%' ORDER BY name").all([]) as any[]).map(
      (r) => r.name,
    )
    expect(tables).toEqual([
      "projects_action",
      "projects_decision",
      "projects_deliverable",
      "projects_health_update",
      "projects_involvement",
      "projects_milestone",
      "projects_project",
      "projects_risk",
    ])
    const deliverable = (k.db.raw.prepare(`PRAGMA table_info("projects_deliverable")`).all([]) as any[]).map((r) => r.name)
    expect(deliverable).toContain("status_changed_at")
  })

  test("project add: code rules, ref and conflict", async () => {
    const bad = await run("project", "add", "crm", "CRM replatforming", "--json")
    expect(bad.code).toBe(1)
    expect(bad.json.error.field).toBe("code")
    expect(bad.json.error.hint).toBe("2–8 letters or digits, e.g. CRM")
    const text = await run("project", "add", "crm", "CRM replatforming")
    expect(text.err).toContain("hint: 2–8 letters or digits, e.g. CRM")

    const a = await ok("project", "add", "CRM", "CRM replatforming", "--effort", "220", "--start", "2026-11-02", "--json")
    expect(a.json).toEqual({
      ref: "#CRM",
      id: 1,
      code: "CRM",
      name: "CRM replatforming",
      description: null,
      status: "active",
      start_date: "2026-11-02",
      end_date: null,
      effort_estimate_days: 220,
      effort_note: null,
      health: null,
      health_comment: null,
      health_date: null,
      next_milestone_title: null,
      next_milestone_due: null,
      open_actions: 0,
      open_risks: 0,
      context_updated_at: null,
      archived: false,
    })
    const again = await run("project", "add", "CRM", "Other", "--json")
    expect(again.code).toBe(3)
    expect(again.json.error.message).toBe('project "CRM" already exists')
  })

  test("project edit --health inserts a health update shown by the view", async () => {
    await ok("project", "add", "CRM", "CRM replatforming")
    const r = await ok("project", "edit", "CRM", "--health", "amber", "--health-comment", "Design slipping", "--json")
    expect(r.json.health).toBe("amber")
    const [row] = viewRows("project")
    expect(row.health).toBe("amber")
    expect(row.health_comment).toBe("Design slipping")
    expect(row.health_date).toBe("2026-11-13")
    expect(viewRows("health_update")).toEqual([{ id: 1, project_id: 1, date: "2026-11-13", health: "amber", comment: "Design slipping" }])
    // The latest update by date (then id) wins; an older-dated update does not replace it.
    await inCtx(() => api("projects").write.setHealth!({ project: "CRM", health: "red", date: "2026-11-01" }))
    expect(viewRows("project")[0].health).toBe("amber")
    await ok("project", "edit", "#crm", "--health", "green")
    expect(viewRows("project")[0].health).toBe("green")
    expect(viewRows("project")[0].health_comment).toBe(null)
    // --health-comment alone is refused; other fields go through editProject.
    expect((await run("project", "edit", "CRM", "--health-comment", "x", "--json")).code).toBe(1)
    const e = await ok("project", "edit", "CRM", "--name", "CRM 2", "--status", "on_hold", "--json")
    expect([e.json.name, e.json.status]).toEqual(["CRM 2", "on_hold"])
  })

  test("project context --stdin, --set-file, show and getContext", async () => {
    await ok("project", "add", "CRM", "CRM replatforming")
    const set = await cli(["project", "context", "CRM", "--stdin", "--json"], "# Background")
    expect(set.code).toBe(0)
    expect(set.json).toEqual({ ref: "#CRM", markdown: "# Background", updatedAt: k.clock.now() })
    const show = await ok("project", "show", "CRM", "--json")
    expect(show.json.context).toBe("# Background")
    expect(show.json.context_updated_at).toBe(k.clock.now())
    expect(await inCtx(() => api("projects").read.getContext!({ project: "#crm" }))).toEqual({
      ref: "#CRM",
      markdown: "# Background",
      updatedAt: k.clock.now(),
    })
    expect((await ok("project", "context", "CRM")).out).toBe("# Background\n")

    const dir = mkdtempSync(join(tmpdir(), "pm-ctx-"))
    try {
      writeFileSync(join(dir, "ctx.md"), "# From file\n")
      await ok("project", "context", "CRM", "--set-file", join(dir, "ctx.md"))
      expect((await ok("project", "show", "CRM", "--json")).json.context).toBe("# From file\n")
      const missing = await run("project", "context", "CRM", "--set-file", join(dir, "nope.md"), "--json")
      expect(missing.code).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect((await run("project", "context", "CRM", "--stdin", "--set-file", "x", "--json")).code).toBe(1)
  })

  test("project context: empty --stdin or --set-file is refused; --clear clears", async () => {
    await ok("project", "add", "CRM", "CRM replatforming")
    await cli(["project", "context", "CRM", "--stdin"], "# Background")
    for (const input of ["", "  \n\t\n"]) {
      const r = await cli(["project", "context", "CRM", "--stdin", "--json"], input)
      expect(r.code).toBe(1)
      expect(r.json.error).toEqual({ code: "validation", message: "the new context is empty", hint: "use --clear to remove the context" })
    }
    const dir = mkdtempSync(join(tmpdir(), "pm-ctx-"))
    try {
      writeFileSync(join(dir, "empty.md"), "\n\n")
      const r = await run("project", "context", "CRM", "--set-file", join(dir, "empty.md"), "--json")
      expect(r.code).toBe(1)
      expect(r.json.error.hint).toBe("use --clear to remove the context")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect((await ok("project", "show", "CRM", "--json")).json.context).toBe("# Background")
    expect((await run("project", "context", "CRM", "--clear", "--stdin", "--json")).code).toBe(1)
    const cleared = await ok("project", "context", "CRM", "--clear")
    expect(cleared.out).toBe("#CRM context updated (cleared)\n")
    expect((await ok("project", "show", "CRM", "--json")).json.context).toBe(null)
  })

  test("involvement: person refs are validated, and people's staleStakeholders sees the projects", async () => {
    await ok("project", "add", "CRM", "CRM replatforming")
    const missing = await run("involve", "add", "CRM", "marie", "--role", "sponsor", "--json")
    expect(missing.code).toBe(2)
    expect(missing.json.error.message).toBe('unknown person "marie"')

    await ok("person", "add", "Marie Dubois", "--stakeholder", "--influence", "high")
    const added = await ok("involve", "add", "CRM", "marie", "--role", "sponsor", "--json")
    expect(added.json).toEqual({ ref: "#CRM", project: "#CRM", person: "@marie", person_id: 1, name: "Marie Dubois", role: "sponsor" })
    expect(viewRows("involvement")).toEqual([{ project_id: 1, person_id: 1, role: "sponsor" }])
    const stale = await inCtx(() => api("people").read.staleStakeholders!({ days: 30 }))
    expect(stale).toEqual([{ ref: "@marie", name: "Marie Dubois", influence: "high", interest: null, last_contact: null, projects: ["CRM"] }])

    // A typo suggests a handle from people.person; a duplicate is a conflict.
    const typo = await run("involve", "add", "CRM", "mari", "--role", "x", "--json")
    expect(typo.code).toBe(2)
    expect(typo.json.error.hint).toBe('did you mean "marie"?')
    expect((await run("involve", "add", "CRM", "@marie", "--role", "sponsor", "--json")).code).toBe(3)

    const show = await ok("project", "show", "CRM", "--json")
    expect(show.json.involvement).toEqual([{ person: "@marie", name: "Marie Dubois", role: "sponsor" }])
    expect((await ok("project", "show", "CRM")).out).toContain("@marie  Marie Dubois  sponsor")

    const removed = await ok("involve", "remove", "CRM", "marie", "--role", "sponsor", "--json")
    expect(removed.json.ref).toBe("#CRM")
    expect(viewRows("involvement")).toEqual([])
    expect((await run("involve", "remove", "CRM", "marie", "--role", "sponsor", "--json")).code).toBe(2)
  })

  test("archived project", async () => {
    await ok("project", "add", "CRM", "CRM replatforming")
    await ok("person", "add", "Anna Peeters", "--team")
    const arch = await ok("project", "archive", "CRM", "--json")
    expect(arch.json.archived).toBe(true)
    const r = await run("involve", "add", "CRM", "anna", "--role", "x", "--json")
    expect(r.code).toBe(1)
    expect(r.json.error.message).toBe("#CRM is archived")
    expect(r.json.error.hint).toContain("restore it first")
    expect((await run("project", "edit", "CRM", "--health", "red", "--json")).json.error.hint).toContain("restore it first")
    expect((await cli(["project", "context", "CRM", "--stdin", "--json"], "x")).json.error.hint).toContain("restore it first")
    // Archived projects leave the default list and show under --archived.
    expect((await ok("project", "list", "--json")).json).toEqual([])
    expect((await ok("project", "list", "--archived", "--json")).json.map((p: any) => p.ref)).toEqual(["#CRM"])
    await ok("project", "restore", "CRM")
    expect((await ok("involve", "add", "CRM", "anna", "--role", "x", "--json")).json.role).toBe("x")
  })

  test("an archived person cannot be involved", async () => {
    await ok("project", "add", "CRM", "CRM replatforming")
    await ok("person", "add", "Anna Peeters")
    await ok("person", "archive", "anna")
    const r = await run("involve", "add", "CRM", "anna", "--role", "x", "--json")
    expect(r.code).toBe(1)
    expect(r.json.error.message).toBe("@anna is archived")
    expect(r.json.error.hint).toContain("restore it first")
  })

  test("project list: filters and the text table", async () => {
    await ok("project", "add", "CRM", "CRM replatforming", "--effort", "220")
    await ok("project", "add", "ERP", "ERP upgrade")
    await ok("project", "edit", "CRM", "--health", "amber")
    await ok("project", "edit", "ERP", "--status", "on_hold")
    expect((await ok("project", "list", "--json")).json.map((p: any) => p.ref)).toEqual(["#CRM", "#ERP"])
    expect((await ok("project", "list", "--health", "amber", "--json")).json.map((p: any) => p.ref)).toEqual(["#CRM"])
    expect((await ok("project", "list", "--status", "on_hold", "--json")).json.map((p: any) => p.ref)).toEqual(["#ERP"])
    expect((await ok("project", "list")).out).toBe(
      [
        "health   code  name               next milestone  due  actions  risks  effort",
        "● amber  CRM   CRM replatforming                       0        0      220d",
        "○        ERP   ERP upgrade                             0        0",
        "",
      ].join("\n"),
    )
  })

  test("record type, tag type and resolve forms", async () => {
    await ok("project", "add", "CRM", "CRM replatforming")
    await ok("project", "add", "B2", "Second")
    expect(await k.records.resolveAny("#crm")).toEqual({ type: "project", id: 1 })
    expect(await k.records.resolveAny("#CRM")).toEqual({ type: "project", id: 1 })
    expect(await k.records.resolveAny("#2")).toEqual({ type: "project", id: 2 })
    expect(await k.records.refOf("project", 1)).toBe("#CRM")
    expect(await k.records.label("#CRM")).toBe("CRM replatforming")
    expect((await ok("project", "show", "1", "--json")).json.ref).toBe("#CRM")
    const tags = await k.tags.resolve("call about (#crm), and #2 #NOPE")
    expect(tags).toEqual({ links: [{ recordType: "project", recordId: 1, raw: "#crm" }], unresolved: ["#2", "#NOPE"] })
    const nf = await run("project", "show", "CRN", "--json")
    expect(nf.code).toBe(2)
    expect(nf.json.error.message).toBe('unknown project "CRN"')
    expect(nf.json.error.hint).toBe('did you mean "CRM"?')
  })

  test("describe lines", async () => {
    await ok("project", "add", "CRM", "CRM replatforming")
    await ok("person", "add", "Marie Dubois")
    const d = (op: string, input: unknown) => inCtx(() => k.ops.describe("projects", op, input))
    expect(await d("addProject", { code: "CRM", name: "CRM replatforming" })).toBe('+ project CRM "CRM replatforming"')
    expect(await d("setHealth", { project: "CRM", health: "amber" })).toBe("~ CRM health not set → amber")
    await ok("project", "edit", "CRM", "--health", "amber")
    expect(await d("setHealth", { project: "crm", health: "red", comment: "Budget overrun" })).toBe('~ CRM health amber → red: "Budget overrun"')
    expect(await d("setContext", { project: "CRM", markdown: "x".repeat(3100) })).toBe("~ CRM context (none → 3.1 kB)")
    await cli(["project", "context", "CRM", "--stdin"], "x".repeat(2400))
    expect(await d("setContext", { project: "CRM", markdown: "x".repeat(3100) })).toBe("~ CRM context (2.4 kB → 3.1 kB)")
    expect(await d("addInvolvement", { project: "CRM", person: "marie", role: "key user" })).toBe("+ @marie on CRM as key user")
    expect(await d("removeInvolvement", { project: "CRM", person: "marie", role: "key user" })).toBe("- @marie on CRM as key user")
    expect(await d("editProject", { project: "CRM", name: "X", status: "closed" })).toBe("~ CRM name, status")
    expect(await d("archiveProject", { project: "CRM" })).toBe("~ CRM archived")
    expect(await d("restoreProject", { project: "CRM" })).toBe("~ CRM restored")
  })

  test("the guide has a Projects section", async () => {
    const g = await ok("guide")
    expect(g.out).toContain("## Projects")
    expect(g.out).toContain("pm project edit CRM --health amber")
  })
})
