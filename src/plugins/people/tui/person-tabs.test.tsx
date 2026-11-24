// The person record view (Summary, Notes, Goals) against the built-in plugins, seeded through the write ops.
import { rgbToHex } from "@opentui/core"
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../../tests/tui"
import { runWithContext } from "../../../kernel/context"
import { theme } from "../../../kernel/tui/api"
import { builtinPlugins } from "../../../../tests/builtins"
import { isSelected } from "../../../../tests/design"

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
const rows = <T = any,>(table: string, cols: string[]) =>
  inCtx(async () => (await (kernel!.runtime("people")!.data as any).selectFrom(table).select(cols).orderBy("id").execute()) as T[])

const lines = (frame: string) => frame.split("\n")
const lineWith = (frame: string, s: string) => lines(frame).find((l) => l.includes(s)) ?? ""
const indexOf = (frame: string, s: string) => lines(frame).findIndex((l) => l.includes(s))
// The tab line under the breadcrumb.
const tabLine = (frame: string) => lineWith(frame, "Summary")

async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}

// As in the People screen tests: stakeholders marie (CFO, Acme; sponsor of #CRM; a note on 3 Oct; a follow-up due
// 10 Nov), luc and nadia; anna (team and stakeholder) and bob (team; a 1:1 note on 12 Nov and an open goal).
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
    await write("actions").addAction!({ title: "Send revised budget", due: "2026-11-10", forPerson: "@marie" })
    await w.addNote!({ person: "@bob", kind: "one_on_one", date: "2026-11-12", text: "Talked about training" })
    await w.addGoal!({ person: "@bob", title: "PM training 2027" })
  })
}

// Opens `ref` from the People screen on its tab `tabs` (Summary 0, Notes 1, Goals 2; the meetings plugin's Talk and
// Meetings tabs sit between Summary and Notes).
async function open(ref: string, opts: { tabs?: number; extra?: () => Promise<void> } = {}): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await seed()
  if (opts.extra) await inCtx(opts.extra)
  tui = await renderTui(kernel, { width: 120, height: 32 })
  tui.input.pressKey("3")
  await until(tui, (f) => f.includes("People ·"))
  await tui.nav.open(ref, ["summary", "notes", "goals"][opts.tabs ?? 0])
  await until(tui, (f) => tabLine(f).includes("Summary"))
  await tui.frame()
  return tui
}

describe("person record view", () => {
  test("Goals tab only for team members", async () => {
    let t = await open("@bob")
    let frame = await until(t, (f) => tabLine(f).includes("Goals"))
    expect(frame).toContain("› Bob Maes · team") // the crumb shows the name without the handle (2026-11-20 designs)
    expect(tabLine(frame)).toMatch(/Summary\s+Talk 0\s+Meetings\s+Notes 1\s+Goals 1/)
    t.destroy()
    tui = undefined
    await kernel!.cleanup()

    t = await open("@marie")
    frame = await t.frame()
    expect(tabLine(frame)).toMatch(/Summary\s+Talk 0\s+Meetings\s+Notes 1/)
    expect(frame).not.toContain("Goals")
  })

  test("summary shows the person and e edits", async () => {
    const t = await open("@marie")
    let frame = await until(t, (f) => f.includes("Budget talk"))
    expect(frame).toContain("@marie · Stakeholder")
    expect(frame).not.toContain("archived")
    expect(frame).toContain("CFO, Acme")
    expect(frame).toContain("CRM sponsor")
    expect(frame).toContain("Open follow-ups")
    expect(frame).toContain("Send revised budget")
    expect(lines(frame.trimEnd()).at(-1)).toContain("e edit   n note   del archive   r restore")

    t.input.pressKey("e")
    frame = await until(t, (f) => f.includes("Edit @marie"))
    for (let i = 0; i < 5; i++) t.input.pressTab() // name → job title
    await t.input.typeText(" Officer")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => f.includes("CFO Officer, Acme"))
    expect(frame).not.toContain("Edit @marie")
    expect((await rows("person", ["job_title"]))[0].job_title).toBe("CFO Officer")

    t.input.pressKey("n")
    frame = await until(t, (f) => f.includes("New note · @marie"))
    t.input.pressEscape()
    await until(t, (f) => !f.includes("New note · @marie"))

    // A team member who is a stakeholder too.
    t.input.pressEscape()
    await until(t, () => t.nav.route().kind === "screen")
    await t.nav.open("@anna")
    frame = await until(t, (f) => f.includes("@anna · Team · Stakeholder"))
    expect(frame).toContain("› Anna Smit")
  })

  test("a handle edit from Summary follows the rename, and Esc selects the renamed person", async () => {
    const t = await open("@bob")
    await until(t, (f) => tabLine(f).includes("Goals"))
    t.input.pressKey("e")
    await until(t, (f) => f.includes("Edit @bob"))
    t.input.pressTab() // name → handle
    await t.input.typeText("by")
    t.input.pressKey("s", { ctrl: true })
    let frame = await until(t, (f) => f.includes("@bobby · Team") && tabLine(f).includes("Goals"))
    expect(frame).toContain("› Bob Maes")
    expect(tabLine(frame)).toMatch(/Summary\s+Talk 0\s+Meetings\s+Notes 1\s+Goals 1/)
    expect(frame).toContain("@bobby · Team")
    expect((await rows("person", ["handle"])).map((r) => r.handle)).toContain("bobby")
    expect(t.nav.stack().length).toBe(3) // Overview, People, @bobby: the old route was replaced, not stacked on

    t.input.pressEscape()
    frame = await until(t, (f) => t.nav.route().kind === "screen" && f.includes("Bob Maes"))
    expect(t.nav.route()).toEqual({ kind: "screen", screen: "people", params: { selected: "@bobby" } })
    for (let i = 0; i < 80 && !isSelected(await t.spans(), "Bob Maes"); i++) await sleep(25)
    expect(isSelected(await t.spans(), "Bob Maes")).toBe(true)
  })

  test("notes tab lists newest first; n adds; Del deletes after confirm", async () => {
    const t = await open("@marie", {
      tabs: 1,
      extra: async () => {
        await write().addNote!({ person: "@marie", kind: "interaction", date: "2026-11-05", project: "CRM", text: "Steering prep\nsecond line" }) // N-3
        await write().addNote!({ person: "@marie", kind: "one_on_one", date: "2026-10-03", text: "Same day" }) // N-4
      },
    })
    let frame = await until(t, (f) => f.includes("Steering prep"))
    expect(tabLine(frame)).toContain("Notes 3")
    expect(lineWith(frame, "Ref")).toMatch(/Ref\s+Date\s+Kind\s+Project\s+Note/)
    expect(indexOf(frame, "N-3")).toBeLessThan(indexOf(frame, "N-4"))
    expect(indexOf(frame, "N-4")).toBeLessThan(indexOf(frame, "N-1"))
    expect(lineWith(frame, "N-3")).toMatch(/N-3\s+5 Nov\s+interaction\s+CRM\s+Steering prep/)
    expect(frame).not.toContain("second line")
    expect(lineWith(frame, "N-4")).toMatch(/N-4\s+3 Oct\s+1:1\s+Same day/)
    expect(lineWith(frame, "N-1")).toMatch(/N-1\s+3 Oct\s+interaction\s+Budget talk/)
    expect(lines(frame.trimEnd()).at(-1)).toContain("n add   e edit   enter text   del delete")

    t.input.pressKey("n")
    frame = await until(t, (f) => f.includes("New note · @marie"))
    t.input.pressTab() // date
    t.input.pressTab() // project
    t.input.pressTab() // text
    await t.input.typeText("Fresh one")
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => f.includes("Fresh one") && !f.includes("New note"))
    expect(indexOf(frame, "N-5")).toBeLessThan(indexOf(frame, "N-3"))
    expect(isSelected(await t.spans(), "N-5")).toBe(true) // the new note is selected
    expect(lineWith(frame, "N-5")).toContain("13 Nov")

    t.input.pressKey("DELETE")
    frame = await until(t, (f) => f.includes("Delete N-5?"))
    t.input.pressKey("n")
    await until(t, (f) => !f.includes("Delete N-5?"))
    expect((await rows("note", ["id"])).map((r) => r.id)).toEqual([1, 2, 3, 4, 5])
    t.input.pressKey("DELETE")
    await until(t, (f) => f.includes("Delete N-5?"))
    t.input.pressKey("y")
    frame = await until(t, (f) => !f.includes("Fresh one"))
    expect((await rows("note", ["id"])).map((r) => r.id)).toEqual([1, 2, 3, 4])
    expect(tabLine(frame)).toContain("Notes 3")
  })

  test("notes tab shows a 16-character project code whole", async () => {
    const t = await open("@marie", {
      tabs: 1,
      extra: async () => {
        await write("projects").addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
        await write().addNote!({ person: "@marie", kind: "interaction", date: "2026-11-05", project: "DATAPLATFORM2027", text: "Kickoff" })
      },
    })
    const frame = await until(t, (f) => f.includes("Kickoff"))
    expect(lineWith(frame, "Kickoff")).toMatch(/N-3\s+5 Nov\s+interaction\s+DATAPLATFORM2027 Kickoff/)
  })

  test("notes tab empty text", async () => {
    const t = await open("@luc", { tabs: 1 })
    const frame = await until(t, (f) => f.includes("No notes yet"))
    expect(frame).toContain("No notes yet. Press n to add one.")
  })

  test("Enter edits a note's text in the editor and Ctrl+S saves it", async () => {
    const t = await open("@marie", { tabs: 1 })
    await until(t, (f) => f.includes("Budget talk"))
    t.input.pressEnter()
    await until(t, (f) => f.includes("Note N-1"))
    t.input.pressKey("END")
    await t.input.typeText("!")
    t.input.pressKey("s", { ctrl: true })
    const frame = await until(t, (f) => !f.includes("Note N-1") && f.includes("Budget talk!"))
    expect(lineWith(frame, "N-1")).toContain("Budget talk!")
    expect((await rows("note", ["text"]))[0].text).toBe("Budget talk!")
  })

  test("goals: x achieves, x again reopens, d drops", async () => {
    const t = await open("@bob", {
      tabs: 2,
      extra: async () => {
        await write().addGoal!({ person: "@bob", title: "Certification", target_date: "2026-11-10" }) // G-2, overdue
        await write().addGoal!({ person: "@bob", title: "Mentor a junior", target_date: "2026-12-01" }) // G-3
      },
    })
    let frame = await until(t, (f) => f.includes("Certification"))
    expect(tabLine(frame)).toContain("Goals 3")
    expect(lineWith(frame, "Ref")).toMatch(/Ref\s+Goal\s+Target\s+Status/)
    expect(indexOf(frame, "G-2")).toBeLessThan(indexOf(frame, "G-3"))
    expect(indexOf(frame, "G-3")).toBeLessThan(indexOf(frame, "G-1"))
    expect(lineWith(frame, "G-2")).toMatch(/G-2\s+Certification\s+-3d\s+open/)
    expect(lineWith(frame, "G-3")).toMatch(/G-3\s+Mentor a junior\s+1 Dec\s+open/)
    const spans = await t.spans()
    const row = spans.lines.find((l) => l.spans.map((s) => s.text).join("").includes("Certification"))!
    expect(rgbToHex(row.spans.find((s) => s.text.includes("-3d"))!.fg).toLowerCase()).toBe(theme.red)
    expect(lines(frame.trimEnd()).at(-1)).toContain("n add   e edit   x achieved/open   d drop")

    const status = async () => (await rows("goal", ["status"])).map((r) => r.status)
    expect(isSelected(await t.spans(), "G-2")).toBe(true)
    t.input.pressKey("x")
    frame = await until(t, (f) => lineWith(f, "G-2").includes("achieved"))
    expect(await status()).toEqual(["open", "achieved", "open"])
    // Achieved goals come after the open ones; the selection stays on G-2.
    expect(indexOf(frame, "G-2")).toBeGreaterThan(indexOf(frame, "G-1"))
    expect(isSelected(await t.spans(), "G-2")).toBe(true)
    expect(tabLine(frame)).toContain("Goals 2")
    t.input.pressKey("x")
    frame = await until(t, (f) => lineWith(f, "G-2").includes("open"))
    expect(await status()).toEqual(["open", "open", "open"])
    t.input.pressKey("d")
    frame = await until(t, (f) => lineWith(f, "G-2").includes("dropped"))
    expect(await status()).toEqual(["open", "dropped", "open"])

    // Dropped after achieved.
    t.input.pressKey("k")
    t.input.pressKey("k")
    frame = await t.frame()
    expect(isSelected(await t.spans(), "G-3")).toBe(true)
    t.input.pressKey("x")
    frame = await until(t, (f) => lineWith(f, "G-3").includes("achieved"))
    expect(indexOf(frame, "G-3")).toBeLessThan(indexOf(frame, "G-2"))
    expect(await status()).toEqual(["open", "dropped", "achieved"])
  })

  test("goals tab empty text", async () => {
    const t = await open("@anna", { tabs: 2 })
    const frame = await until(t, (f) => f.includes("No goals yet"))
    expect(frame).toContain("No goals yet. Press n to add one.")
  })

  test("n on Notes and Goals for an archived person opens nothing and says so", async () => {
    const t = await open("@bob", { tabs: 1, extra: () => write().archivePerson!({ ref: "@bob" }) })
    await until(t, (f) => f.includes("Talked about training"))
    t.input.pressKey("n")
    let frame = await until(t, (f) => f.includes("@bob is archived — press r to restore"))
    expect(lines(frame.trimEnd()).at(-1)).toContain("@bob is archived — press r to restore")
    expect(frame).not.toContain("New note")
    t.input.pressArrow("right")
    await until(t, (f) => f.includes("PM training 2027") && !f.includes("Talked about training"))
    t.input.pressKey("n")
    frame = await until(t, (f) => f.includes("@bob is archived — press r to restore"))
    expect(frame).not.toContain("New goal")
    expect((await rows("note", ["id"])).length).toBe(2)
    expect((await rows("goal", ["id"])).length).toBe(1)
  })

  test("archived person's summary says archived; r restores", async () => {
    const t = await open("@marie")
    await until(t, (f) => f.includes("@marie · Stakeholder"))
    t.input.pressKey("DELETE")
    let frame = await until(t, (f) => f.includes("Archive @marie?"))
    expect(frame).toContain("Archive @marie? They stay in the history and can be restored.")
    t.input.pressKey("y")
    frame = await until(t, (f) => f.includes("@marie · Stakeholder · archived"))
    expect(lineWith(frame, "Archived")).toContain("yes")
    expect((await rows("person", ["archived_at"]))[0].archived_at).not.toBeNull()

    t.input.pressKey("r")
    frame = await until(t, (f) => !f.includes("· archived"))
    expect(frame).toContain("@marie · Stakeholder")
    expect((await rows("person", ["archived_at"]))[0].archived_at).toBeNull()
  })
})
