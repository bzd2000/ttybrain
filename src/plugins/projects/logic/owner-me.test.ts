// Deliverables and risks can be owned by "me" (`--owner me` or `@me`, any case), which is not the same as no owner
// (empty) nor a person. Records and JSON: `owner` "me" | "@bob" | null, `owner_me` tells me from none; the
// published views carry `owner_me` next to `owner_id` (null for me and for none).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
import { people } from "../../people/logic/index"
import { projects } from "./index"

let k: TestKernel

async function cli(argv: string[]): Promise<{ code: number; out: string; json: any }> {
  let out = ""
  const code = await runCli(argv, k, { out: (s) => void (out += s), err: (s) => void (out += s), stdin: async () => "" })
  let json: any
  try {
    json = JSON.parse(out)
  } catch {}
  return { code, out, json }
}
async function ok(...argv: string[]) {
  const r = await cli(argv)
  if (r.code !== 0) throw new Error(`ttybrain ${argv.join(" ")} → exit ${r.code}: ${r.out}`)
  return r
}
const viewRows = (name: string) => k.db.raw.prepare(`SELECT id, owner_id, owner_me FROM "projects__pub_${name}" ORDER BY id`).all([]) as any[]
const tableRows = (name: string) => k.db.raw.prepare(`SELECT id, owner_id, owner_me FROM "projects_${name}" ORDER BY id`).all([]) as any[]

describe('projects: owner "me" on deliverables and risks', () => {
  beforeEach(async () => {
    k = await makeTestKernel({ plugins: [people, projects] })
    await ok("project", "add", "CRM", "CRM replatforming")
    await ok("person", "add", "Bob", "--team")
  })
  afterEach(async () => {
    await k.cleanup()
  })

  test("deliverable: me, @me, a person and none are stored and shown apart", async () => {
    const me = await ok("deliverable", "add", "CRM", "Spec", "--owner", "me", "--json")
    expect(me.json).toMatchObject({ ref: "D-1", owner: "me", owner_me: true })
    expect(me.out).not.toContain("owner_id")
    const at = await ok("deliverable", "add", "CRM", "Plan", "--owner", "@ME", "--json")
    expect(at.json).toMatchObject({ ref: "D-2", owner: "me", owner_me: true })
    const bob = await ok("deliverable", "add", "CRM", "Test", "--owner", "bob", "--json")
    expect(bob.json).toMatchObject({ ref: "D-3", owner: "@bob", owner_me: false })
    const none = await ok("deliverable", "add", "CRM", "Docs", "--json")
    expect(none.json).toMatchObject({ ref: "D-4", owner: null, owner_me: false })
    expect(tableRows("deliverable")).toEqual([
      { id: 1, owner_id: null, owner_me: 1 },
      { id: 2, owner_id: null, owner_me: 1 },
      { id: 3, owner_id: 1, owner_me: 0 },
      { id: 4, owner_id: null, owner_me: 0 },
    ])
    expect(viewRows("deliverable")).toEqual(tableRows("deliverable"))

    // The text list shows `me`; the owner filter takes me / @me and a person.
    const list = (await ok("deliverable", "list", "CRM")).out
    expect(list.split("\n").find((l) => l.includes("Spec"))).toMatch(/Spec\s+me\s/)
    expect((await ok("deliverable", "list", "--owner", "me", "--json")).json.map((d: any) => d.ref)).toEqual(["D-1", "D-2"])
    expect((await ok("deliverable", "list", "--owner", "@me", "--json")).json.map((d: any) => d.ref)).toEqual(["D-1", "D-2"])
    expect((await ok("deliverable", "list", "--owner", "bob", "--json")).json.map((d: any) => d.ref)).toEqual(["D-3"])

    // Edit: me → a person → me → none; each clears the other.
    expect((await ok("deliverable", "edit", "D-1", "--owner", "bob", "--json")).json).toMatchObject({ owner: "@bob", owner_me: false })
    expect((await ok("deliverable", "edit", "D-1", "--owner", "Me", "--json")).json).toMatchObject({ owner: "me", owner_me: true })
    expect((await ok("deliverable", "edit", "D-1", "--owner", "", "--json")).json).toMatchObject({ owner: null, owner_me: false })
    expect((await ok("deliverable", "edit", "D-3", "--owner", "@me", "--json")).json).toMatchObject({ owner: "me", owner_me: true })
    expect(tableRows("deliverable").slice(0, 3)).toEqual([
      { id: 1, owner_id: null, owner_me: 0 },
      { id: 2, owner_id: null, owner_me: 1 },
      { id: 3, owner_id: null, owner_me: 1 },
    ])
    // An edit that does not name the owner keeps it.
    expect((await ok("deliverable", "edit", "D-2", "--title", "Plan v2", "--json")).json).toMatchObject({ owner: "me", owner_me: true })
  })

  test("risk: me, @me, a person and none; list filter and edit", async () => {
    const add = (title: string, ...owner: string[]) => ok("risk", "add", "CRM", title, "--type", "risk", "--severity", "high", ...owner, "--json")
    expect((await add("Vendor delay", "--owner", "me")).json).toMatchObject({ ref: "R-1", owner: "me", owner_me: true })
    expect((await add("Budget", "--owner", "@me")).json).toMatchObject({ ref: "R-2", owner: "me", owner_me: true })
    expect((await add("Staffing", "--owner", "@bob")).json).toMatchObject({ ref: "R-3", owner: "@bob", owner_me: false })
    expect((await add("Scope")).json).toMatchObject({ ref: "R-4", owner: null, owner_me: false })
    expect(viewRows("risk")).toEqual([
      { id: 1, owner_id: null, owner_me: 1 },
      { id: 2, owner_id: null, owner_me: 1 },
      { id: 3, owner_id: 1, owner_me: 0 },
      { id: 4, owner_id: null, owner_me: 0 },
    ])
    expect((await ok("risk", "list", "--owner", "ME", "--json")).json.map((r: any) => r.ref)).toEqual(["R-1", "R-2"])
    expect((await ok("risk", "list", "--owner", "bob", "--json")).json.map((r: any) => r.ref)).toEqual(["R-3"])
    expect((await ok("risk", "edit", "R-4", "--owner", "me", "--json")).json).toMatchObject({ owner: "me", owner_me: true })
    expect((await ok("risk", "edit", "R-1", "--owner", "", "--json")).json).toMatchObject({ owner: null, owner_me: false })
    expect((await ok("risk", "edit", "R-2", "--owner", "bob", "--json")).json).toMatchObject({ owner: "@bob", owner_me: false })
    expect(tableRows("risk")).toEqual([
      { id: 1, owner_id: null, owner_me: 0 },
      { id: 2, owner_id: 1, owner_me: 0 },
      { id: 3, owner_id: 1, owner_me: 0 },
      { id: 4, owner_id: null, owner_me: 1 },
    ])
  })

  test("the ops take me through any client; project status and report show it", async () => {
    await runWithContext(k.context(), async () => {
      const w = k.ops.api("projects")!.write
      expect(await w.addDeliverable!({ project: "CRM", title: "Spec", owner: " me ", due: "2026-11-20" })).toMatchObject({ owner: "me", owner_me: true })
      expect(await w.addRisk!({ project: "CRM", title: "Vendor", type: "risk", severity: "high", owner: "@Me" })).toMatchObject({ owner: "me", owner_me: true })
    })
    const md = (await ok("report", "status", "CRM")).out
    expect(md).toContain("D-1 | Spec | me | 2026-11-20 |")
    expect(md).toContain("R-1 | risk | high | Vendor | me |")
  })
})
