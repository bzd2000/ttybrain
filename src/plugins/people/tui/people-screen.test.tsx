// The People screen (slot 3): the All / Stakeholders / Team tabs, the grouped list, sorts, the filter, archived
// people and the keys that open the person and note forms, against the built-in plugins seeded through write ops.
import { rgbToHex } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { defineTui, theme, type TuiDef } from "../../../kernel/tui/api"
import { builtinPlugins } from "../../index"
import { builtinTuiParts } from "../../tui"
import { peopleTui } from "./index"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const write = (plugin = "people") => kernel!.runtime(plugin)!.self().write as Record<string, (i: any) => Promise<any>>
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
const people = () =>
  inCtx(async () => (await (kernel!.runtime("people")!.data as any).selectFrom("person").select(["handle", "name", "archived_at"]).orderBy("id").execute()) as any[])

const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))
const statusLine = (frame: string) => lines(frame.trimEnd()).at(-1)!
// The names, in the order the frame shows them (each must be there).
const order = (frame: string, names: string[]) => {
  const at = names.map((n) => indexOf(frame, n))
  expect(at.every((i) => i > 0)).toBe(true)
  return [...names].sort((a, b) => indexOf(frame, a) - indexOf(frame, b))
}

async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}

async function escape(t: RenderedTui) {
  t.input.pressEscape()
  await sleep(30) // a lone ESC is flushed by the input parser's timeout
}

// Stakeholders marie (high/high, a note on 3 Oct), luc (high/low) and nadia (low/low); anna (team and
// stakeholder, no levels) and bob (team); marie is the sponsor of #CRM.
async function seed() {
  await inCtx(async () => {
    const w = write()
    await write("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
    await w.addPerson!({ name: "Marie Dubois", handle: "marie", is_stakeholder: true, influence: "high", interest: "high", job_title: "CFO", organisation: "Acme" })
    await w.addPerson!({ name: "Luc Peeters", handle: "luc", is_stakeholder: true, influence: "high", interest: "low" })
    await w.addPerson!({ name: "Nadia Benali", handle: "nadia", is_stakeholder: true, influence: "low", interest: "low" })
    await w.addPerson!({ name: "Anna Smit", handle: "anna", is_team: true, is_stakeholder: true })
    await w.addPerson!({ name: "Bob Maes", handle: "bob", is_team: true })
    await w.addNote!({ person: "@marie", kind: "interaction", date: "2026-10-03", text: "Budget talk" })
    await write("projects").addInvolvement!({ project: "CRM", person: "@marie", role: "sponsor" })
  })
}

// The person record view comes later (its tabs); until then a stand-in tab gives `nav.open("@x")` a record view
// instead of the person form, so Enter and Esc can be tested here.
const withPersonTab: TuiDef = defineTui({
  plugin: "people",
  activate(ui) {
    peopleTui.activate(ui)
    ui.recordTab("person", { id: "stand-in", title: "Stand-in", order: 1, component: () => <text>person view</text> })
  },
})

async function open(opts: { seed?: boolean; personTab?: boolean } = {}): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  if (opts.seed !== false) await seed()
  const parts = opts.personTab ? builtinTuiParts.map((p) => (p === peopleTui ? withPersonTab : p)) : undefined
  tui = await renderTui(kernel, { width: 120, height: 30, parts })
  tui.input.pressKey("3")
  await until(tui, (f) => f.includes("People ·") || f.includes("No people yet"))
  return tui
}

const ALL = ["Luc Peeters", "Marie Dubois", "Nadia Benali", "Anna Smit", "Bob Maes"]

describe("People screen", () => {
  test("opens on 3 and lists stakeholders then team", async () => {
    const t = await open()
    const frame = await t.frame()
    expect(lines(frame)[0]).toContain("pm · 3 People ▾")
    expect(frame).toContain("All 5")
    expect(frame).toContain("Stakeholders 4")
    expect(frame).toContain("Team 2")
    expect(frame).toContain("People · 5")
    const sh = indexOf(frame, "Stakeholders · 4")
    const team = indexOf(frame, "Team · 1")
    expect(sh).toBeGreaterThan(0)
    expect(team).toBeGreaterThan(sh)
    expect(order(frame, ALL)).toEqual(ALL)
    expect(indexOf(frame, "Anna Smit")).toBeLessThan(team)
    expect(indexOf(frame, "Bob Maes")).toBeGreaterThan(team)
    expect(lineWith(frame, "Marie Dubois")).toContain("CFO, Acme")
    expect(lineWith(frame, "Marie Dubois")).toContain("CRM")
    expect(lineWith(frame, "Luc Peeters")).toMatch(/high\s+low/)
    expect(lineWith(frame, "Anna Smit")).toMatch(/—\s+—/)
    expect(frame).toContain("sort: influence, then last contact")
    expect(statusLine(frame)).toContain("Enter open  n note  N new  e edit  o sort  / filter")
  })

  test("last contact shows days, never and amber", async () => {
    const t = await open()
    const frame = await t.frame()
    expect(lineWith(frame, "Marie Dubois")).toContain("41d")
    expect(lineWith(frame, "Luc Peeters")).toContain("never")
    const spans = await t.spans()
    const row = spans.lines.find((l) => l.spans.map((s) => s.text).join("").includes("Marie Dubois"))!
    const last = row.spans.find((s) => s.text.includes("41d"))!
    expect(rgbToHex(last.fg).toLowerCase()).toBe(theme.amber)
  })

  test("o cycles the sort and the footer says which", async () => {
    const t = await open()
    t.input.pressKey("o")
    let frame = await until(t, (f) => f.includes("sort: last contact"))
    expect(frame).toContain("sort: last contact")
    // Never first (by name), then oldest.
    expect(order(frame, ["Luc Peeters", "Marie Dubois", "Nadia Benali", "Anna Smit"])).toEqual(["Anna Smit", "Luc Peeters", "Nadia Benali", "Marie Dubois"])
    t.input.pressKey("o")
    frame = await until(t, (f) => f.includes("sort: name"))
    expect(order(frame, ["Luc Peeters", "Marie Dubois", "Nadia Benali", "Anna Smit"])).toEqual(["Anna Smit", "Luc Peeters", "Marie Dubois", "Nadia Benali"])
    t.input.pressKey("o")
    frame = await until(t, (f) => f.includes("sort: influence, then last contact"))
    expect(order(frame, ["Luc Peeters", "Marie Dubois", "Nadia Benali", "Anna Smit"])).toEqual(["Luc Peeters", "Marie Dubois", "Nadia Benali", "Anna Smit"])
  })

  test("t and s switch tabs; a person who is both shows in both", async () => {
    const t = await open()
    t.input.pressKey("t")
    let frame = await until(t, (f) => f.includes("People · 2"))
    expect(order(frame, ["Anna Smit", "Bob Maes"])).toEqual(["Anna Smit", "Bob Maes"])
    for (const n of ["Luc Peeters", "Marie Dubois", "Nadia Benali"]) expect(frame).not.toContain(n)
    expect(frame).not.toContain("Team · ") // one untitled group
    t.input.pressKey("s")
    frame = await until(t, (f) => f.includes("People · 4"))
    expect(order(frame, ["Luc Peeters", "Marie Dubois", "Nadia Benali", "Anna Smit"])).toEqual(["Luc Peeters", "Marie Dubois", "Nadia Benali", "Anna Smit"])
    expect(frame).not.toContain("Bob Maes")
    expect(frame).not.toContain("Stakeholders · ")
    t.input.pressArrow("right") // ←→ too: Stakeholders → Team
    frame = await until(t, (f) => f.includes("People · 2"))
    expect(frame).toContain("Bob Maes")
    t.input.pressKey("a")
    frame = await until(t, (f) => f.includes("People · 5"))
    expect(frame).toContain("Stakeholders · 4")
  })

  test("filter infl:high", async () => {
    const t = await open()
    t.input.pressKey("/")
    await t.input.typeText("infl:high")
    t.input.pressEnter()
    let frame = await until(t, (f) => f.includes("filter: infl:high"))
    expect(frame).toContain("sort: influence, then last contact · filter: infl:high")
    expect(frame).toContain("People · 2")
    expect(order(frame, ["Luc Peeters", "Marie Dubois"])).toEqual(["Luc Peeters", "Marie Dubois"])
    for (const n of ["Nadia Benali", "Anna Smit", "Bob Maes"]) expect(frame).not.toContain(n)
    await escape(t)
    frame = await until(t, (f) => !f.includes("filter:"))
    expect(lines(frame)[0]).toContain("pm · 3 People ▾") // Esc cleared the filter; it did not go back
    expect(order(frame, ALL)).toEqual(ALL)
    t.input.pressKey("/")
    await t.input.typeText("zzz")
    t.input.pressEnter()
    expect(await until(t, (f) => f.includes("No people match the filter."))).toContain("No people match the filter.")
  })

  test("archived people only after A, r restores", async () => {
    const t = await open()
    const ops = kernel!.ops as any
    const call = ops.call.bind(ops)
    const calls: string[] = []
    ops.call = (plugin: string, name: string, kind: string, input: unknown) => {
      calls.push(name)
      return call(plugin, name, kind, input)
    }
    t.input.pressKey("j")
    t.input.pressKey("j") // luc → marie → nadia
    expect(lineWith(await t.frame(), "Nadia Benali")).toContain("›")
    t.input.pressKey("DELETE")
    let frame = await until(t, (f) => f.includes("Archive @nadia?"))
    expect(frame).toContain("Archive @nadia? They stay in the history and can be restored.")
    t.input.pressKey("y")
    frame = await until(t, (f) => !f.includes("Nadia Benali"))
    expect(frame).not.toContain("Nadia Benali")
    expect(frame).toContain("All 4")
    expect(frame).toContain("People · 4")
    expect((await people()).find((p) => p.handle === "nadia")!.archived_at).not.toBeNull()
    t.input.pressKey("A")
    frame = await until(t, (f) => f.includes("Archived · 1"))
    expect(indexOf(frame, "Nadia Benali")).toBeGreaterThan(indexOf(frame, "Archived · 1"))
    expect(frame).toContain("People · 4") // archived excluded
    while (!lineWith(await t.frame(), "Nadia Benali").includes("›")) t.input.pressKey("j")
    t.input.pressKey("n")
    frame = await until(t, (f) => f.includes("is archived"))
    expect(statusLine(frame)).toContain("@nadia is archived — press r to restore")
    expect(frame).not.toContain("New note")
    t.input.pressKey("e")
    frame = await t.frame()
    expect(frame).not.toContain("Edit @nadia")
    t.input.pressKey("r")
    frame = await until(t, (f) => !f.includes("Archived · 1"))
    expect(frame).toContain("All 5")
    expect(calls).toContain("restorePerson")
    expect((await people()).find((p) => p.handle === "nadia")!.archived_at).toBeNull()
    expect(indexOf(frame, "Nadia Benali")).toBeLessThan(indexOf(frame, "Team · 1"))
    t.input.pressKey("A")
    frame = await until(t, (f) => !f.includes("Archived"))
    expect(frame).toContain("Nadia Benali")
  })

  test("Del asks no, and archives nothing", async () => {
    const t = await open()
    t.input.pressKey("DELETE")
    await until(t, (f) => f.includes("Archive @luc?"))
    t.input.pressKey("n")
    const frame = await until(t, (f) => !f.includes("Archive @luc?"))
    expect(frame).toContain("Luc Peeters")
    expect((await people()).every((p) => p.archived_at === null)).toBe(true)
  })

  test("N adds a person and selects it", async () => {
    const t = await open()
    t.input.pressKey("N")
    let frame = await until(t, (f) => f.includes("New person"))
    expect(frame).toContain("New person")
    await t.input.typeText("Zoe Claes")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => !f.includes("New person") && lineWith(f, "Zoe Claes").includes("›"))
    expect(lineWith(frame, "Zoe Claes")).toContain("›")
    expect(frame).toContain("All 6")
    expect((await people()).map((p) => p.name)).toContain("Zoe Claes")
  })

  test("n opens a note on the selected person", async () => {
    const t = await open()
    t.input.pressKey("j") // marie
    t.input.pressKey("n")
    const frame = await until(t, (f) => f.includes("New note"))
    expect(frame).toContain("New note · @marie")
  })

  test("e edits the selected person", async () => {
    const t = await open()
    t.input.pressKey("j") // marie
    t.input.pressKey("e")
    let frame = await until(t, (f) => f.includes("Edit @marie"))
    expect(lineWith(frame, "Name*")).toContain("Marie Dubois")
    await t.input.typeText(" M")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => f.includes("Marie Dubois M"))
    expect(lineWith(frame, "Marie Dubois M")).toContain("›")
    expect((await people()).find((p) => p.handle === "marie")!.name).toBe("Marie Dubois M")
  })

  test("Enter opens the person and Esc comes back to the same row", async () => {
    const t = await open({ personTab: true })
    t.input.pressKey("j") // marie
    t.input.pressEnter()
    let frame = await until(t, (f) => f.includes("› @marie Marie Dubois"))
    expect(frame).toContain("› @marie Marie Dubois")
    expect(lines(frame)[0]).toContain("pm · 3 People")
    expect(frame).toContain("person view")
    // A person sorting above marie: she would be row 0 if the selection had been reset.
    await inCtx(() => write().addPerson!({ name: "Aaron Aerts", handle: "aaron", is_stakeholder: true, influence: "high" }))
    t.input.pressEscape()
    frame = await until(t, (f) => f.includes("Aaron Aerts") && lineWith(f, "Marie Dubois").includes("›"))
    expect(lines(frame)[0]).toContain("pm · 3 People")
    expect(lineWith(frame, "Marie Dubois")).toContain("›")
    expect(lineWith(frame, "Aaron Aerts")).not.toContain("›")
  })

  test("empty database shows EMPTY", async () => {
    const t = await open({ seed: false })
    const frame = await t.frame()
    expect(frame).toContain("No people yet. Press N to add one.")
    expect(frame).toContain("All 0")
  })

  test("the switcher count is the non-archived people", async () => {
    const t = await open()
    await inCtx(() => write().archivePerson!({ ref: "@bob" }))
    t.input.pressKey("g")
    const frame = await until(t, (f) => /3 People\s+4\b/.test(f))
    expect(lines(frame).find((l) => l.includes("3 People") && !l.includes("▾"))).toMatch(/3 People\s+4\b/)
  })
})
