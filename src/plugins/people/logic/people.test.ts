import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { definePlugin, Type } from "../../../kernel/api"
import { runCli } from "../../../kernel/cli/dispatch"
import { runWithContext } from "../../../kernel/context"
import { people } from "./index"

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
  if (r.code !== 0) throw new Error(`pm ${argv.join(" ")} → exit ${r.code}: ${r.out}${r.err}`)
  return r
}

const people_ = () => k.ops.api("people")!
const read = (op: string, input: unknown) => runWithContext(k.context(), () => people_().read[op]!(input))

// A stand-in for the `overview` report that `projects` registers later.
const overview = definePlugin({
  id: "overview",
  name: "Overview",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.report({ id: "overview", cliName: "overview", title: "Overview", params: Type.Object({}), describe: "the overview" })
  },
})

describe("people", () => {
  beforeEach(async () => {
    k = await makeTestKernel({ plugins: [people] })
  })
  afterEach(async () => {
    await k.cleanup()
  })

  test("boots with its views", () => {
    expect(k.plugins).toEqual([{ id: "people", version: "1.0.0", source: "built-in", status: "ok" }])
  })

  test("person add gives @anna, then @anna2", async () => {
    const a = await ok("person", "add", "Anna Peeters", "--team", "--json")
    expect(a.json).toEqual({
      ref: "@anna",
      id: 1,
      handle: "anna",
      name: "Anna Peeters",
      organisation: null,
      job_title: null,
      email: null,
      phone: null,
      is_team: true,
      is_stakeholder: false,
      influence: null,
      interest: null,
      last_contact: null,
      archived: false,
    })
    const b = await ok("person", "add", "Anna Smith", "--json")
    expect(b.json.ref).toBe("@anna2")
    const text = await ok("person", "add", "Bob Jansen")
    expect(text.out).toBe('@bob Bob Jansen\n')
  })

  test("handle generation", async () => {
    const r = await ok("person", "add", "Ségolène Royal", "--stakeholder", "--json")
    expect(r.json.ref).toBe("@segolene")
    expect(r.json.handle).toBe("segolene")
    // An explicit handle is normalized; a taken one is a conflict; a malformed one is invalid.
    expect((await ok("person", "add", "Seg Two", "--handle", "@SEG", "--json")).json.ref).toBe("@seg")
    const taken = await cli("person", "add", "Other", "--handle", "segolene", "--json")
    expect(taken.code).toBe(3)
    expect(taken.json.error.message).toBe('handle "segolene" is taken')
    const bad = await cli("person", "add", "Other", "--handle", "a b", "--json")
    expect(bad.code).toBe(1)
    expect(bad.json.error.field).toBe("handle")
  })

  test("the handle me is reserved: it means you", async () => {
    expect((await ok("person", "add", "Mé Linh", "--json")).json.ref).toBe("@me2")
    for (const argv of [
      ["person", "add", "Other", "--handle", "me", "--json"],
      ["person", "add", "Other", "--handle", "@ME", "--json"],
      ["person", "edit", "me2", "--handle", "me", "--json"],
    ]) {
      const r = await cli(...argv)
      expect(r.code).toBe(1)
      expect(r.json.error).toEqual({ code: "validation", field: "handle", message: 'handle "me" is reserved', hint: '"me" means you (as in --owner me); choose another --handle' })
    }
  })

  test("note on an unknown person is not found, with suggestions", async () => {
    await ok("person", "add", "Petra Janssens")
    const r = await cli("note", "add", "peter", "Worried about budget", "--interaction", "--json")
    expect(r.code).toBe(2)
    expect(r.json.error.message).toBe('unknown person "peter"')
    expect(r.json.error.hint).toBe('did you mean "petra"?')
  })

  test("archived person", async () => {
    await ok("person", "add", "Anna Peeters", "--team")
    const arch = await ok("person", "archive", "anna", "--json")
    expect(arch.json.archived).toBe(true)
    const r = await cli("note", "add", "anna", "x", "--1on1", "--json")
    expect(r.code).toBe(1)
    expect(r.json.error.message).toBe("@anna is archived")
    expect(r.json.error.hint).toContain("restore it first")
    const g = await cli("goal", "add", "@anna", "PM training", "--json")
    expect(g.json.error.hint).toContain("restore it first")
    // Archived people leave the default list and show under --archived; restoring brings them back.
    expect((await ok("person", "list", "--json")).json).toEqual([])
    expect((await ok("person", "list", "--archived", "--json")).json.map((p: any) => p.ref)).toEqual(["@anna"])
    await ok("person", "restore", "anna")
    expect((await ok("note", "add", "anna", "x", "--1on1", "--json")).json.ref).toBe("N-1")
  })

  test("note add needs exactly one of --1on1 and --interaction", async () => {
    await ok("person", "add", "Anna Peeters")
    const none = await cli("note", "add", "anna", "x", "--json")
    expect(none.code).toBe(1)
    expect(none.json.error.message).toBe("pass --1on1 or --interaction")
    const both = await cli("note", "add", "anna", "x", "--1on1", "--interaction", "--json")
    expect(both.code).toBe(1)
  })

  test("notes: add, list, edit, delete", async () => {
    await ok("person", "add", "Peter Claes", "--stakeholder")
    const n = await ok("note", "add", "@peter", "Worried about budget", "--interaction", "--date", "2026-11-10", "--json")
    expect(n.json).toEqual({ ref: "N-1", id: 1, person: "@peter", person_id: 1, project_id: null, kind: "interaction", date: "2026-11-10", text: "Worried about budget" })
    // The date defaults to today (the injected clock).
    expect((await ok("note", "add", "peter", "1:1 catch-up", "--1on1", "--json")).json.date).toBe("2026-11-13")
    expect((await ok("note", "list", "--person", "peter", "--kind", "interaction", "--json")).json.map((x: any) => x.ref)).toEqual(["N-1"])
    expect((await ok("note", "list", "--json")).json.map((x: any) => x.ref)).toEqual(["N-2", "N-1"])
    expect((await ok("note", "edit", "N-1", "Very worried", "--json")).json.text).toBe("Very worried")
    expect((await cli("note", "delete", "1", "--json")).code).toBe(1) // needs --yes
    expect((await ok("note", "delete", "1", "--yes", "--json")).json).toEqual({ ref: "N-1", deleted: true })
    const gone = await cli("note", "edit", "N-1", "x", "--json")
    expect(gone.code).toBe(2)
    expect(gone.json.error.message).toBe('unknown note "N-1"')
    // A project on a note is a soft reference resolved through the record types: none is loaded here.
    const proj = await cli("note", "add", "peter", "x", "--interaction", "--project", "CRM", "--json")
    expect(proj.code).toBe(2)
    expect(proj.json.error.message).toBe('unknown project "CRM"')
  })

  test("person list --stakeholders --json returns last_contact", async () => {
    await ok("person", "add", "Marie Dubois", "--stakeholder", "--influence", "high", "--interest", "low", "--phone", "+32 470 12 34 56")
    await ok("person", "add", "Anna Peeters", "--team")
    await ok("note", "add", "marie", "Kick-off", "--interaction", "--date", "2026-10-03")
    await ok("note", "add", "marie", "Follow-up", "--interaction", "--date", "2026-10-20")
    const r = await ok("person", "list", "--stakeholders", "--json")
    expect(r.json).toEqual([
      {
        ref: "@marie",
        id: 1,
        handle: "marie",
        name: "Marie Dubois",
        organisation: null,
        job_title: null,
        email: null,
        phone: "+32 470 12 34 56",
        is_team: false,
        is_stakeholder: true,
        influence: "high",
        interest: "low",
        last_contact: "2026-10-20",
        archived: false,
      },
    ])
    expect((await ok("person", "list", "--team", "--json")).json.map((p: any) => p.ref)).toEqual(["@anna"])
    expect((await cli("person", "list", "--team", "--stakeholders")).code).toBe(1)
  })

  test("blank text fields are rejected with the field name", async () => {
    await ok("person", "add", "Anna Peeters")
    await ok("note", "add", "anna", "x", "--1on1")
    await ok("goal", "add", "anna", "Learn SQL")
    const cases: Array<[string[], string]> = [
      [["person", "add", "   "], "name"],
      [["person", "add", ""], "name"],
      [["person", "edit", "anna", "--name", "  "], "name"],
      [["note", "add", "anna", "  ", "--1on1"], "text"],
      [["note", "edit", "N-1", " "], "text"],
      [["goal", "add", "anna", " "], "title"],
      [["goal", "edit", "G-1", "--title", "  "], "title"],
    ]
    for (const [argv, field] of cases) {
      const r = await cli(...argv, "--json")
      expect([argv.join(" "), r.code, r.json.error.field]).toEqual([argv.join(" "), 1, field])
      expect(r.json.error.message).toEndWith(`${field} must not be blank`)
    }
    expect((await ok("person", "show", "anna", "--json")).json.name).toBe("Anna Peeters")
    expect((await ok("person", "list", "--json")).json.map((p: any) => p.ref)).toEqual(["@anna"])
  })

  test("influence and interest are for stakeholders only", async () => {
    const r = await cli("person", "add", "Anna Peeters", "--team", "--influence", "high", "--json")
    expect(r.code).toBe(1)
    expect(r.json.error.message).toBe("influence and interest are for stakeholders only")
    expect(r.json.error.hint).toBe("add --stakeholder")
  })

  test("person edit, show and the change-set lines", async () => {
    await ok("person", "add", "Peter Claes", "--stakeholder", "--influence", "low")
    const ed = await ok("person", "edit", "peter", "--influence", "high", "--org", "Finance", "--json")
    expect(ed.json.influence).toBe("high")
    expect(ed.json.organisation).toBe("Finance")
    const lines = await runWithContext(k.context(), async () => [
      await k.ops.describe("people", "addPerson", { name: "Anna Peeters", is_team: true }),
      await k.ops.describe("people", "editPerson", { ref: "peter", influence: "low" }),
      await k.ops.describe("people", "archivePerson", { ref: "peter" }),
      await k.ops.describe("people", "addNote", { person: "peter", kind: "interaction", text: "x", project: "crm" }),
      await k.ops.describe("people", "addGoal", { person: "peter", title: "PM training 2027" }),
      await k.ops.describe("people", "deleteNote", { ref: "N-12" }),
    ])
    expect(lines).toEqual([
      '+ person @anna "Anna Peeters" (team)',
      "~ @peter influence high → low",
      "~ @peter archived",
      "+ note on @peter (interaction, CRM)",
      '+ goal for @peter "PM training 2027"',
      "- N-12",
    ])
    // Stakeholder off clears influence and interest.
    expect((await ok("person", "edit", "peter", "--no-stakeholder", "--team", "--json")).json).toMatchObject({
      is_stakeholder: false,
      is_team: true,
      influence: null,
    })
    await ok("note", "add", "peter", "1:1", "--1on1", "--date", "2026-11-12")
    await ok("goal", "add", "peter", "PM training 2027", "--target", "2027-06-30")
    const show = await ok("person", "show", "1", "--json")
    expect(show.json.ref).toBe("@peter")
    expect(show.json.last_contact).toBe("2026-11-12")
    expect(show.json.notes.map((n: any) => n.ref)).toEqual(["N-1"])
    expect(show.json.goals.map((g: any) => g.ref)).toEqual(["G-1"])
    const missing = await cli("person", "show", "petr", "--json")
    expect(missing.code).toBe(2)
    expect(missing.json.error.hint).toBe('did you mean "peter"?')
  })

  test("goals: add, list, edit, done, drop", async () => {
    await ok("person", "add", "Sofie Maes", "--team")
    const g = await ok("goal", "add", "sofie", "PM training 2027", "--target", "2027-06-30", "--json")
    expect(g.json).toEqual({ ref: "G-1", id: 1, person: "@sofie", person_id: 1, title: "PM training 2027", target_date: "2027-06-30", status: "open", notes: null })
    expect((await ok("goal", "edit", "G-1", "--title", "PRINCE2 training", "--json")).json.title).toBe("PRINCE2 training")
    expect((await ok("goal", "done", "G-1", "--json")).json.status).toBe("achieved")
    await ok("goal", "add", "sofie", "Public speaking")
    expect((await ok("goal", "drop", "2", "--json")).json.status).toBe("dropped")
    expect((await ok("goal", "list", "sofie", "--json")).json.map((x: any) => [x.ref, x.status])).toEqual([
      ["G-1", "achieved"],
      ["G-2", "dropped"],
    ])
    const line = await runWithContext(k.context(), () => k.ops.describe("people", "setGoalStatus", { ref: "G-1", status: "open" }))
    expect(line).toBe("~ G-1 achieved → open")
  })

  test("staleStakeholders", async () => {
    await ok("person", "add", "Marie Dubois", "--stakeholder", "--influence", "high")
    await ok("person", "add", "Luc Peeters", "--stakeholder", "--influence", "high")
    await ok("person", "add", "Jan Wouters", "--stakeholder", "--influence", "low")
    await ok("person", "add", "Peter Claes", "--stakeholder", "--influence", "high")
    await ok("person", "add", "Anna Peeters", "--team") // not a stakeholder
    await ok("person", "add", "Old Stake", "--stakeholder", "--influence", "high")
    await ok("person", "archive", "old") // archived: left out
    await ok("note", "add", "marie", "x", "--interaction", "--date", "2026-10-03")
    await ok("note", "add", "jan", "x", "--interaction", "--date", "2026-10-01")
    await ok("note", "add", "peter", "x", "--interaction", "--date", "2026-11-11")
    const rows = await read("staleStakeholders", { days: 30 })
    expect(rows).toEqual([
      { ref: "@luc", name: "Luc Peeters", influence: "high", interest: null, last_contact: null, projects: [] },
      { ref: "@marie", name: "Marie Dubois", influence: "high", interest: null, last_contact: "2026-10-03", projects: [] },
      { ref: "@jan", name: "Jan Wouters", influence: "low", interest: null, last_contact: "2026-10-01", projects: [] },
    ])
    expect((await read("staleStakeholders", { days: 30, limit: 2 })).map((r: any) => r.ref)).toEqual(["@luc", "@marie"])
    // Exactly `days` ago is stale (>= days): marie's note is 41 days old.
    expect((await read("staleStakeholders", { days: 41 })).map((r: any) => r.ref)).toEqual(["@luc", "@marie", "@jan"])
    expect((await read("staleStakeholders", { days: 42 })).map((r: any) => r.ref)).toEqual(["@luc", "@jan"])
  })

  test("never-contacted sorts first and is stale", async () => {
    await ok("person", "add", "Dated One", "--stakeholder", "--influence", "high")
    await ok("person", "add", "Zed Never", "--stakeholder", "--influence", "high")
    await ok("note", "add", "dated", "x", "--interaction", "--date", "2026-09-01")
    expect((await read("staleStakeholders", { days: 30 })).map((r: any) => r.ref)).toEqual(["@zed", "@dated"])
  })

  test("stale boundary is staleContactDays or more", async () => {
    await ok("person", "add", "Exact", "--stakeholder", "--influence", "high")
    await ok("person", "add", "Almost", "--stakeholder", "--influence", "high")
    await ok("note", "add", "exact", "x", "--interaction", "--date", "2026-10-14") // 30 days before 2026-11-13
    await ok("note", "add", "almost", "x", "--interaction", "--date", "2026-10-15") // 29 days
    expect((await read("staleStakeholders", { days: 30 })).map((r: any) => r.ref)).toEqual(["@exact"])
  })

  test("record types and the @ tag", async () => {
    await ok("person", "add", "Anna Peeters")
    await ok("note", "add", "anna", "x", "--1on1")
    await ok("goal", "add", "anna", "Learn SQL")
    expect(await k.records.resolveAny("@Anna")).toEqual({ type: "person", id: 1 })
    expect(await k.records.resolveAny("N-1")).toEqual({ type: "note", id: 1 })
    expect(await k.records.resolveAny("g-1")).toEqual({ type: "goal", id: 1 })
    expect(await k.records.label("@anna")).toBe("Anna Peeters")
    expect(await k.records.refOf("person", 1)).toBe("@anna")
    expect(await k.records.byName("person")!.search("peet", 10)).toEqual([{ ref: "@anna", label: "Anna Peeters" }])
    expect(await k.tags.resolve("Ask @anna. And @nobody")).toEqual({
      links: [{ recordType: "person", recordId: 1, raw: "@anna" }],
      unresolved: ["@nobody"],
    })
  })

  test("guide section", () => {
    const guide = k.guide.render("0.1.0")
    expect(guide).toContain("## People and stakeholders")
    expect(guide).toContain("--1on1")
    expect(guide).toContain("--interaction")
    expect(guide).toContain("--project")
  })
})

describe("people report section", () => {
  afterEach(async () => {
    await k.cleanup()
  })

  test("stakeholders-to-contact in the overview report uses staleContactDays", async () => {
    k = await makeTestKernel({ plugins: [people, overview], env: { TTYBRAIN_CONFIG_JSON: '{"staleContactDays": 10}' } })
    await ok("person", "add", "Marie Dubois", "--stakeholder", "--influence", "high")
    await ok("note", "add", "marie", "x", "--interaction", "--date", "2026-11-01")
    const r = await ok("report", "overview", "--json")
    expect(r.json.sections).toEqual([
      {
        title: "Stakeholders to contact",
        columns: ["person", "name", "influence", "last contact", "projects"],
        rows: [{ person: "@marie", name: "Marie Dubois", influence: "high", "last contact": "2026-11-01", projects: "" }],
        empty: "No stakeholders to contact.",
      },
    ])
  })
})
