import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
import { people } from "../../people/logic/index"
import { projects } from "../../projects/logic/index"
import { meetings } from "./index"

let k: TestKernel | undefined
afterEach(async () => {
  await k?.cleanup()
  k = undefined
})

type Res = { code: number; out: string; err: string; json: any }
async function cli(argv: string[], stdin = ""): Promise<Res> {
  let out = ""
  let err = ""
  const code = await runCli(argv, k!, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => stdin })
  let json: any
  try {
    json = JSON.parse(out)
  } catch {}
  return { code, out, err, json }
}
async function ok(...argv: string[]) {
  const r = await cli(argv)
  if (r.code !== 0) throw new Error(`pm ${argv.join(" ")} → exit ${r.code}: ${r.out}${r.err}`)
  return r
}
const write = (plugin: string, op: string, input: unknown) => runWithContext(k!.context(), () => (k!.runtime(plugin)!.self() as any).write[op](input))

async function boot() {
  k = await makeTestKernel({ plugins: [meetings, projects, people] })
  await write("people", "addPerson", { name: "Peter Janssens", handle: "peter" })
  await write("people", "addPerson", { name: "Marie Dubois", handle: "marie" })
  await write("projects", "addProject", { code: "CRM", name: "CRM replatforming" })
  await write("projects", "addProject", { code: "ERP", name: "ERP upgrade" })
}
const STEERCO = ["meeting", "add", "Steering committee Q4", "--date", "2026-12-04", "--kind", "steering", "--attendees", "peter,marie", "--projects", "CRM,ERP"]

describe("pm meeting", () => {
  test("meeting add, show and list", async () => {
    await boot()
    expect((await ok(...STEERCO)).out).toBe("M-1 Steering committee Q4 on 2026-12-04\n")
    expect((await ok("meeting", "show", "M-1")).out).toBe(
      [
        "M-1 Steering committee Q4",
        "  date: 2026-12-04",
        "  kind: steering",
        "  status: planned",
        "  attendees: @marie, @peter",
        "",
        "Agenda",
        "1. CRM replatforming status [CRM]",
        "2. ERP upgrade status [ERP]",
        "",
      ].join("\n"),
    )
    await ok("meeting", "add", "Old board", "--date", "2026-09-01")
    await ok("meeting", "add", "Recent board", "--date", "2026-11-05", "--kind", "board")
    await ok("meeting", "close", "M-3")
    await ok("meeting", "cancel", "M-2")
    expect((await ok("meeting", "list")).out).toBe(
      [
        "ref  date        title                  kind      status   attendees       projects",
        "M-3  2026-11-05  Recent board           board     held",
        "M-1  2026-12-04  Steering committee Q4  steering  planned  @marie, @peter  CRM, ERP",
        "",
      ].join("\n"),
    )
    const all = await ok("meeting", "list", "--all", "--json")
    expect(all.json.map((m: any) => m.ref)).toEqual(["M-2", "M-3", "M-1"])
    expect((await ok("meeting", "edit", "M-1", "--date", "2026-12-11", "--since", "2026-10-01")).out).toBe("M-1 Steering committee Q4 on 2026-12-11\n")
    expect((await ok("meeting", "show", "M-1")).out).toContain("  since: 2026-10-01\n")
    expect((await ok("meeting", "edit", "M-1", "--no-since", "--json")).json.since_date).toBeNull()
    expect((await ok("meeting", "attendees", "M-1", "peter")).out).toBe("M-1 attendees @peter\n")
  })

  test("agenda add with project and ask, edit, move, remove", async () => {
    await boot()
    await ok(...STEERCO)
    expect((await ok("meeting", "agenda", "M-1", "add", "Budget", "--project", "CRM", "--ask", "Release contingency")).out).toBe('M-1 item 3 "Budget"\n')
    expect((await ok("meeting", "show", "M-1")).out).toContain("3. Budget [CRM] — ask: Release contingency\n")
    expect((await ok("meeting", "agenda", "M-1", "add", "Minutes", "--at", "1")).out).toBe('M-1 item 1 "Minutes"\n')
    expect((await ok("meeting", "agenda", "M-1", "edit", "4", "--text", "Budget 2027", "--no-ask")).out).toBe('M-1 item 4 "Budget 2027"\n')
    const e = await ok("meeting", "agenda", "M-1", "edit", "4", "--no-project", "--ask", "Sign off", "--json")
    expect(e.json.agenda[3]).toEqual({ position: 4, text: "Budget 2027", project: null, project_id: null, ask: "Sign off" })
    expect((await ok("meeting", "agenda", "M-1", "move", "4", "1")).out).toBe("M-1 item 4 → 1\n")
    expect((await ok("meeting", "agenda", "M-1", "remove", "2")).out).toBe("M-1 item 2 removed\n")
    expect((await ok("meeting", "agenda", "M-1", "remove", "1", "--json")).json.agenda.map((a: any) => a.text)).toEqual([
      "CRM replatforming status",
      "ERP upgrade status",
    ])
    const bad = await cli(["meeting", "agenda", "M-1", "remove", "9"])
    expect([bad.code, bad.err]).toEqual([2, "error: M-1 has no item 9\nhint: M-1 has items 1 to 2\n"])
    expect((await cli(["meeting", "agenda", "M-1", "shuffle"])).code).toBe(1)
  })

  test("close prints what was logged", async () => {
    await boot()
    await ok("meeting", "add", "Board", "--date", "2026-11-10")
    expect((await ok("meeting", "close", "M-1")).out).toBe("M-1 held\nlogged: 0 actions, 0 decisions\n")
    await ok("meeting", "add", "Board 2", "--date", "2026-11-11")
    await ok("action", "add", "One", "--meeting", "M-2")
    await ok("action", "add", "Two", "--meeting", "M-2")
    await ok("action", "add", "Three", "--meeting", "M-2")
    await ok("decision", "add", "Go", "--meeting", "M-2")
    expect((await ok("meeting", "close", "M-2")).out).toBe("M-2 held\nlogged: 3 actions, 1 decision\n")
    expect((await cli(["meeting", "close", "M-2"])).code).toBe(1)
    await ok("meeting", "add", "Board 3", "--date", "2026-11-12")
    await ok("action", "add", "Solo", "--meeting", "M-3")
    expect((await ok("meeting", "close", "M-3")).out).toBe("M-3 held\nlogged: 1 action, 0 decisions\n")
  })

  test("cancelled meeting: writes exit 1 with the message", async () => {
    await boot()
    await ok("meeting", "add", "Board", "--date", "2026-11-20")
    expect((await ok("meeting", "cancel", "M-1")).out).toBe("M-1 cancelled\n")
    const r = await cli(["meeting", "agenda", "M-1", "add", "Late"])
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/^error: M-1 is cancelled/)
    expect((await cli(["meeting", "show", "M-9"])).code).toBe(2)
  })

  test("notes from stdin", async () => {
    await boot()
    await ok("meeting", "add", "Board", "--date", "2026-11-20")
    expect((await ok("meeting", "notes", "M-1")).out).toBe("no notes for M-1\n")
    const set = await cli(["meeting", "notes", "M-1", "--file", "-"], "# Minutes\n\n- agreed\n")
    expect([set.code, set.out]).toEqual([0, "M-1 notes updated\n"])
    expect((await ok("meeting", "notes", "M-1")).out).toBe("# Minutes\n\n- agreed\n")
    expect((await ok("meeting", "show", "M-1")).out).toContain("\nNotes\n# Minutes\n\n- agreed\n")
  })

  test("pm guide includes the meetings section", async () => {
    await boot()
    const g = await ok("guide")
    expect(g.out).toContain("## Meetings")
    expect(g.out).toContain("pm meeting close")
    expect(g.out).toContain("--meeting M-4")
  })
})
