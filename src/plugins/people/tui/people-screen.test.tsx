// The People screen (slot 3): the All / Stakeholders / Team tabs, the grouped list, sorts, the filter, archived
// people and the keys that open the person and note forms, against the built-in plugins seeded through write ops.
import { rgbToHex } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { theme } from "../../../kernel/tui/api"
import { builtinPlugins } from "../../../../tests/builtins"

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
// The detail panel's title (the selected person's name) sits in the panels' top border line: skip that line so a
// name finds its list row.
const titleLine = (l: string) => l.includes("┌")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s) && !titleLine(l)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s) && !titleLine(l))
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
// stakeholder, no levels) and bob (team); marie is the sponsor of #CRM. An open follow-up for marie (due 10 Nov),
// a 1:1 note and an open goal for bob.
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
    await write("projects").addAction!({ title: "Send revised budget", due: "2026-11-10", forPerson: "@marie" })
    await w.addNote!({ person: "@bob", kind: "one_on_one", date: "2026-11-12", text: "Talked about training" })
    await w.addGoal!({ person: "@bob", title: "PM training 2027" })
  })
}

async function open(opts: { seed?: boolean; width?: number; height?: number } = {}): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  if (opts.seed !== false) await seed()
  tui = await renderTui(kernel, { width: opts.width ?? 120, height: opts.height ?? 30 })
  tui.input.pressKey("3")
  await until(tui, (f) => f.includes("People ·") || f.includes("No people yet"))
  return tui
}

const ALL = ["Luc Peeters", "Marie Dubois", "Nadia Benali", "Anna Smit", "Bob Maes"]

describe("People screen", () => {
  test("opens on 3 and lists stakeholders then team", async () => {
    const t = await open()
    const frame = await t.frame()
    expect(lines(frame)[0]).toContain("ttybrain · 3 People ▾")
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
    expect(lines(frame)[0]).toContain("ttybrain · 3 People ▾") // Esc cleared the filter; it did not go back
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
    const t = await open()
    t.input.pressKey("j") // marie
    t.input.pressEnter()
    let frame = await until(t, (f) => f.includes("› @marie Marie Dubois"))
    expect(frame).toContain("› @marie Marie Dubois")
    expect(lines(frame)[0]).toContain("ttybrain · 3 People")
    expect(frame).toContain("Summary")
    expect(frame).toContain("@marie · Stakeholder")
    // A person sorting above marie: she would be row 0 if the selection had been reset.
    await inCtx(() => write().addPerson!({ name: "Aaron Aerts", handle: "aaron", is_stakeholder: true, influence: "high" }))
    t.input.pressEscape()
    frame = await until(t, (f) => f.includes("Aaron Aerts") && lineWith(f, "Marie Dubois").includes("›"))
    expect(lines(frame)[0]).toContain("ttybrain · 3 People")
    expect(lineWith(frame, "Marie Dubois")).toContain("›")
    expect(lineWith(frame, "Aaron Aerts")).not.toContain("›")
  })

  test("Esc back from a person keeps the tab", async () => {
    const t = await open()
    t.input.pressKey("t")
    await until(t, (f) => f.includes("People · 2"))
    t.input.pressEnter() // anna
    await until(t, (f) => f.includes("› @anna"))
    t.input.pressEscape()
    const frame = await until(t, (f) => t.nav.route().kind === "screen" && f.includes("People · 2"))
    expect(frame).toContain("People · 2")
    expect(frame).toContain("Bob Maes")
    for (const n of ["Luc Peeters", "Marie Dubois", "Nadia Benali"]) expect(frame).not.toContain(n)
    expect(lineWith(frame, "Anna Smit")).toContain("›")
  })

  test("Esc back from an archived person keeps the archived group and the selection", async () => {
    const t = await open()
    await inCtx(() => write().archivePerson!({ ref: "@nadia" }))
    t.input.pressKey("A")
    await until(t, (f) => f.includes("Archived · 1"))
    while (!lineWith(await t.frame(), "Nadia Benali").includes("›")) t.input.pressKey("j")
    t.input.pressEnter()
    await until(t, (f) => f.includes("› @nadia"))
    t.input.pressEscape()
    const frame = await until(t, (f) => t.nav.route().kind === "screen" && f.includes("Archived · 1") && lineWith(f, "Nadia Benali").includes("›"))
    expect(frame).toContain("Archived · 1")
    expect(lineWith(frame, "Nadia Benali")).toContain("›")
  })

  test("Esc back from a person keeps the sort", async () => {
    const t = await open()
    t.input.pressKey("o")
    await until(t, (f) => f.includes("sort: last contact"))
    t.input.pressEnter()
    await until(t, (f) => f.includes("› @"))
    t.input.pressEscape()
    const frame = await until(t, (f) => t.nav.route().kind === "screen" && f.includes("People ·"))
    expect(frame).toContain("sort: last contact")
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

describe("People screen: the detail panel", () => {
  test("panel shows a stakeholder's facts, follow-ups and interactions", async () => {
    const t = await open()
    t.input.pressKey("j") // marie
    const frame = await until(t, (f) => f.includes("Open follow-ups"))
    expect(lines(frame).find(titleLine)).toContain("Marie Dubois")
    expect(frame).toContain("CFO, Acme")
    expect(frame).toContain("CRM sponsor")
    expect(frame).toContain("high · interest high")
    expect(frame).toContain("Open follow-ups")
    expect(lineWith(frame, "Send revised budget")).toContain("A-1")
    expect(lineWith(frame, "Send revised budget")).toContain("-3d")
    expect(frame).toContain("Interactions")
    expect(lineWith(frame, "Budget talk")).toContain("3 Oct")
    expect(frame).not.toContain("Goals")
    expect(indexOf(frame, "Open follow-ups")).toBeLessThan(indexOf(frame, "Interactions"))
    const spans = await t.spans()
    const row = spans.lines.find((l) => l.spans.map((s) => s.text).join("").includes("Send revised budget"))!
    const due = row.spans.find((s) => s.text.includes("-3d"))!
    expect(rgbToHex(due.fg).toLowerCase()).toBe(theme.red)
    const head = spans.lines.flatMap((l) => l.spans).find((s) => s.text.includes("Open follow-ups"))!
    expect(rgbToHex(head.fg).toLowerCase()).toBe(theme.accent)
  })

  test("panel shows a team member's actions, 1:1 notes and goals", async () => {
    const t = await open()
    await inCtx(() => write("projects").addAction!({ title: "Book trainer", owner: "@bob", due: "2026-11-20" }))
    for (let i = 0; i < 4; i++) t.input.pressKey("j") // luc → marie → nadia → anna → bob
    const frame = await until(t, (f) => f.includes("1:1 notes") && f.includes("Book trainer"))
    expect(lines(frame).find(titleLine)).toContain("Bob Maes")
    expect(frame).toContain("Open actions")
    expect(lineWith(frame, "Book trainer")).toContain("A-2")
    expect(lineWith(frame, "Book trainer")).toContain("20 Nov")
    expect(frame).not.toContain("Send revised budget") // marie's follow-up, owned by me
    expect(frame).toContain("1:1 notes")
    expect(lineWith(frame, "Talked about training")).toContain("12 Nov")
    expect(frame).toContain("Goals")
    expect(frame).toContain("PM training 2027")
    expect(frame).not.toContain("Open follow-ups")
    expect(frame).not.toContain("Interactions")
    expect(frame).not.toContain("interest") // no Influence fact for a team member
    expect(indexOf(frame, "Open actions")).toBeLessThan(indexOf(frame, "1:1 notes"))
    expect(indexOf(frame, "1:1 notes")).toBeLessThan(indexOf(frame, "Goals"))
  })

  test("the Projects column shows a 16-character code whole at 80x24", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(async () => {
      await write().addPerson!({ name: "Marie Dubois", handle: "marie", is_stakeholder: true })
      await write().addPerson!({ name: "Luc Peeters", handle: "luc", is_stakeholder: true })
      await write("projects").addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
      await write("projects").addProject!({ code: "CRM", name: "CRM" })
      await write("projects").addInvolvement!({ project: "DATAPLATFORM2027", person: "@marie", role: "sponsor" })
      await write("projects").addInvolvement!({ project: "CRM", person: "@luc", role: "sponsor" })
    })
    tui = await renderTui(kernel, { width: 80, height: 24 })
    tui.input.pressKey("3")
    const frame = await until(tui, (f) => f.includes("Marie Dubois"))
    expect(lineWith(frame, "Marie Dubois")).toContain(" DATAPLATFORM2027 ")
    expect(lineWith(frame, "Luc Peeters").indexOf(" CRM ")).toBe(lineWith(frame, "Marie Dubois").indexOf(" DATAPLATFORM2027 "))
    // The columns after it are still there, in line with the header.
    expect(lineWith(frame, "Marie Dubois")).toMatch(/ DATAPLATFORM2027 —\s+—\s+never/)
    expect(lineWith(frame, "Infl.").indexOf("Infl.")).toBe(lineWith(frame, "Marie Dubois").indexOf(" DATAPLATFORM2027 ") + 18)
  })

  test("a row with two codes keeps whole codes and ends with … at 80x24", async () => {
    kernel = await makeTestKernel({ plugins: builtinPlugins })
    await inCtx(async () => {
      await write().addPerson!({ name: "Marie Dubois", handle: "marie", is_stakeholder: true })
      await write().addPerson!({ name: "Luc Peeters", handle: "luc", is_stakeholder: true })
      await write("projects").addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
      await write("projects").addProject!({ code: "CRM", name: "CRM" })
      await write("projects").addProject!({ code: "ERP", name: "ERP" })
      await write("projects").addInvolvement!({ project: "DATAPLATFORM2027", person: "@marie", role: "sponsor" })
      await write("projects").addInvolvement!({ project: "CRM", person: "@marie", role: "sponsor" })
      await write("projects").addInvolvement!({ project: "DATAPLATFORM2027", person: "@luc", role: "sponsor" })
      await write("projects").addInvolvement!({ project: "ERP", person: "@luc", role: "sponsor" })
    })
    tui = await renderTui(kernel, { width: 80, height: 24 })
    tui.input.pressKey("3")
    const frame = await until(tui, (f) => f.includes("Marie Dubois"))
    // Codes are sorted: CRM, then DATAPLATFORM2027, which does not fit beside it in 18 cells.
    expect(lineWith(frame, "Marie Dubois")).toMatch(/ CRM …\s+—\s+—\s+never/)
    expect(lineWith(frame, "Luc Peeters")).toMatch(/ DATAPLATFORM2027 … —\s+—\s+never/) // DATAPLATFORM2027, ERP
    // The column is 18 wide; the header's next column lines up with the rows'.
    expect(lineWith(frame, "Infl.").indexOf("Infl.")).toBe(lineWith(frame, "Luc Peeters").indexOf(" DATAPLATFORM2027 ") + 20)
    expect(lineWith(frame, "Marie Dubois").indexOf(" CRM …")).toBe(lineWith(frame, "Luc Peeters").indexOf(" DATAPLATFORM2027 "))
    expect(frame).not.toMatch(/DATAPLAT\w*…|CRM \w+…/)
  })

  test("panel hidden below 110 columns", async () => {
    const long = "Maximiliaan Vandenbroucke-De Smet-Claess"
    expect(long.length).toBe(40)
    let t = await open({ width: 80, height: 24 })
    await inCtx(() => write().addPerson!({ name: long, handle: "max" }))
    let frame = await until(t, (f) => f.includes("Other · 1"))
    expect(frame).toContain("Stakeholders · 4")
    expect(frame).not.toContain("Open follow-ups")
    expect(frame).not.toContain(long)
    expect(lineWith(frame, "Maximiliaan")).toContain("…")
    t.destroy()
    tui = undefined
    await kernel!.cleanup()
    kernel = undefined
    t = await open({ width: 110, height: 30 })
    frame = await until(t, (f) => f.includes("Influence"))
    expect(lines(frame).find(titleLine)).toContain("Luc Peeters")
    expect(frame).toContain("high · interest low")
  })

  test("panel follows the selection", async () => {
    const t = await open()
    let frame = await until(t, (f) => f.includes("high · interest low"))
    expect(lines(frame).find(titleLine)).toContain("Luc Peeters")
    t.input.pressArrow("down")
    frame = await until(t, (f) => f.includes("high · interest high"))
    expect(lines(frame).find(titleLine)).toContain("Marie Dubois")
    expect(frame).toContain("CRM sponsor")
    expect(frame).not.toContain("high · interest low")
    t.input.pressArrow("down")
    t.input.pressArrow("down") // anna: a stakeholder and a team member
    frame = await until(t, (f) => (lines(f).find(titleLine) ?? "").includes("Anna Smit") && f.includes("Goals"))
    expect(frame).toContain("— · interest —")
    expect(indexOf(frame, "Interactions")).toBeLessThan(indexOf(frame, "Goals"))
  })

  test("nothing selected shows a prompt", async () => {
    const t = await open()
    t.input.pressKey("/")
    await t.input.typeText("zzz")
    t.input.pressEnter()
    const frame = await until(t, (f) => f.includes("Select a person."))
    expect(frame).toContain("No people match the filter.")
    expect(frame).toContain("Select a person.")
  })
})
