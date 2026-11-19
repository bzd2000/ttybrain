// Renaming a project's code: `editProject({ code })` and `ttybrain project edit <code> --code <new>`. Everything
// links by id, so actions, risks, roles and agenda items follow; the old code stops resolving.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { builtinPlugins } from "../../../../tests/builtins"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"

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
const write = (plugin = "projects") => k.ops.api(plugin)!.write as Record<string, (i: any) => Promise<any>>
const inCtx = <T>(fn: () => Promise<T>) => runWithContext(k.context(), fn)

// CRM with an action, a risk, a role and an agenda item on M-1; ERP exists too.
beforeEach(async () => {
  k = await makeTestKernel({ plugins: builtinPlugins })
  await inCtx(async () => {
    await write("people").addPerson!({ name: "Anna Smit", handle: "anna", is_team: true })
    await write().addProject!({ code: "CRM", name: "CRM replatforming" })
    await write().addProject!({ code: "ERP", name: "ERP upgrade" })
    await write().addAction!({ title: "Call vendor", project: "CRM" })
    await write().addRisk!({ project: "CRM", title: "Vendor lock-in", type: "risk", severity: "high" })
    await write().addInvolvement!({ project: "CRM", person: "@anna", role: "lead" })
    await write("meetings").addMeeting!({ title: "SteerCo", date: "2026-11-20", kind: "steering" })
    await write("meetings").addAgendaItem!({ meeting: "M-1", text: "CRM status", project: "CRM" })
  })
})
afterEach(async () => {
  await k.cleanup()
})

describe("renaming a project's code", () => {
  test("editProject({ code }) renames; links follow by id; the old code no longer resolves", async () => {
    expect(await k.ops.describe("projects", "editProject", { project: "CRM", code: "CRM2027" })).toBe("~ CRM code → CRM2027")
    expect(await k.ops.describe("projects", "editProject", { project: "CRM", code: "#CRM2027", name: "CRM 2027" })).toBe("~ CRM code → CRM2027, name")
    // The line names the code as the op checks it: trimmed, without `#`; a lower-case one is shown as given (the op
    // refuses it, as addProject does).
    expect(await k.ops.describe("projects", "editProject", { project: "#crm", code: "  #CRM2027 " })).toBe("~ CRM code → CRM2027")
    expect(await k.ops.describe("projects", "editProject", { project: "CRM", code: "#crm2027" })).toBe("~ CRM code → crm2027")
    const out = await inCtx(() => write().editProject!({ project: "#CRM", code: "#CRM2027" }))
    expect([out.ref, out.id, out.code, out.open_actions, out.open_risks]).toEqual(["#CRM2027", 1, "CRM2027", 1, 1])

    expect((await cli("action", "list", "--project", "CRM2027", "--json")).json.map((a: any) => [a.ref, a.project])).toEqual([["A-1", "#CRM2027"]])
    expect((await cli("risk", "list", "CRM2027", "--json")).json.map((r: any) => [r.ref, r.project])).toEqual([["R-1", "#CRM2027"]])
    const shown = await cli("project", "show", "CRM2027", "--json")
    expect(shown.code).toBe(0)
    expect(shown.json.involvement).toEqual([{ person: "@anna", name: "Anna Smit", role: "lead" }])
    expect((await cli("meeting", "show", "M-1", "--json")).json.agenda[0].project).toBe("#CRM2027")

    const old = await cli("project", "show", "CRM", "--json")
    expect(old.code).toBe(2)
    expect(old.json.error.message).toBe('unknown project "CRM"')
  })

  test("the same code is a no-op; a taken or invalid code is refused; 16 characters are accepted", async () => {
    const same = await inCtx(() => write().editProject!({ project: "CRM", code: "CRM" }))
    expect(same.ref).toBe("#CRM")
    expect(await k.ops.describe("projects", "editProject", { project: "CRM", code: "#CRM" })).toBe("~ CRM (no change)")

    const taken = await cli("project", "edit", "CRM", "--code", "ERP", "--json")
    expect(taken.code).toBe(3)
    expect(taken.json.error).toMatchObject({ message: 'project "ERP" already exists', hint: "choose another code" })

    const bad = await cli("project", "edit", "CRM", "--code", "C-1", "--json")
    expect(bad.code).toBe(1)
    expect(bad.json.error).toMatchObject({ message: 'invalid project code "C-1"', field: "code", hint: "2–16 letters or digits, e.g. CRM" })
    // The same casing rule as add: lower case is refused, as `project add crm` is.
    expect((await cli("project", "edit", "CRM", "--code", "crm2", "--json")).code).toBe(1)
    expect((await cli("project", "add", "crm2", "x", "--json")).code).toBe(1)

    const long = await inCtx(() => write().editProject!({ project: "CRM", code: "DATAPLATFORM2027" }))
    expect(long.ref).toBe("#DATAPLATFORM2027")
    expect((await cli("project", "edit", "DATAPLATFORM2027", "--code", "DATAPLATFORM20271", "--json")).code).toBe(1)
  })

  test("CLI: project edit --code prints the renamed project; --health goes to the new code; provenance follows", async () => {
    const r = await cli("project", "edit", "CRM", "--code", "CRM2027")
    expect([r.code, r.err]).toEqual([0, ""])
    expect(r.out).toBe("#CRM2027 CRM replatforming\n  status: active\n  health: not set\n  open: 1 actions, 1 risks\n")

    const h = await cli("project", "edit", "CRM2027", "--code", "CRM27", "--health", "green", "--json")
    expect(h.code).toBe(0)
    expect([h.json.ref, h.json.health]).toEqual(["#CRM27", "green"])

    await inCtx(() => write("inbox").capture!({ text: "rename CRM" }))
    const p = await cli("project", "edit", "CRM27", "--code", "CRMX", "--from-inbox", "I-1", "--json")
    expect([p.code, p.json.ref]).toEqual([0, "#CRMX"])
    expect(k.db.raw.prepare("SELECT record_type, record_id, origin_ref FROM kernel_record_origin").all([])).toEqual([
      { record_type: "project", record_id: 1, origin_ref: "I-1" },
    ])
  })
})
