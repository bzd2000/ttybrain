// The actions plugin's links in the TUI (2026-11-20 design: "Every person, project and meeting gets an Actions tab
// from the actions plugin, listing the actions linked to it"; the key list's `l edit links`):
// - the Actions tab, one component on a project, a person and a meeting (after the meeting's Export tab), with the
//   Actions screen's columns, the record itself left out of Linked to;
// - the links editor on `l`: one refs field autocompleted as in quick capture (`@`, `#`, `M-`), saved through
//   unlinkAction / linkAction; an archived project cannot be added (the operation's error shows), unlinking always works;
// - 80×24 (Review Focus 5): long link lists are cut whole with `…`, codes, handles and 9-character ids
//   (`A-1000001`, the handover's high range) stay whole, on the screen and on the tabs.
// Seeded with the designs' example data (today Thu 12 Nov 2026) or a small seed of their own.
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { fgAt, isSelected, line, seedDesign } from "../design"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"
import { runWithContext } from "../../src/kernel/context"
import { theme } from "../../src/kernel/tui/theme"

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

async function until(t: RenderedTui, check: (frame: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 150 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

type Write = Record<string, (input: any) => Promise<any>>
const write = (plugin: string) => kernel!.runtime(plugin)!.self().write as Write
const inCtx = <T,>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)
// The links of an action as `<type>:<id>`, in their order.
const linksOf = (id: number) =>
  inCtx(async () =>
    ((await (kernel!.runtime("actions")!.data as any).selectFrom("link").select(["record_type", "record_id"]).where("action_id", "=", id).orderBy("id").execute()) as any[]).map(
      (l) => `${l.record_type}:${l.record_id}`,
    ),
  )
const inside = (frame: string, i: number) => (line(frame, i).split("│")[1] ?? "").slice(1).trimEnd()
const cols = (texts: string[], widths: number[]) =>
  texts
    .map((s, i) => s.padEnd(widths[i]!))
    .join(" ")
    .trimEnd()
const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""

// Opens `ref` and moves right to its Actions tab.
// `ready`: a text the settled tab shows (the Action column is measured after the first draw).
async function actionsTab(t: RenderedTui, ref: string, ready: string): Promise<string> {
  await t.nav.open(ref, "actions")
  await until(t, (f) => line(f, 2).includes("Actions"))
  return until(t, (f) => t.nav.crumb() === ref && f.includes("Actions ·") && f.includes(ready))
}

// The Actions screen's columns at 118: ID 5, Action 58, Owner 8, Linked to 30, Due 7.
const WIDE = [5, 58, 8, 30, 7]

test("a project's Actions tab: the screen's columns, the project left out of Linked to", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12", seed: seedDesign })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  const frame = await actionsTab(tui, "#CRM", "Invite Marie to design walkthrough")
  // The meetings plugin's Meetings and Talk sit before Context (the 2026-11-20 `project` design); the tabs no longer
  // fit, so they window around the active one.
  expect(line(frame, 2)).toBe(" ‹  Deliverables 6   Risks & issues 4   Decisions 7   Actions 9   People 7   Meetings   Talk   Context")
  expect(line(frame, 3)).toMatch(/^ ╭─ Actions · 9 open ─+╮$/)
  expect([4, 5, 6, 7, 8, 9].map((i) => inside(frame, i))).toEqual([
    cols(["ID", "Action", "Owner", "Linked to", "Due"], WIDE),
    cols(["A-1", "Send revised budget to Peter", "@me", "@peter", "9 Nov"], WIDE),
    cols(["A-4", "Prepare SteerCo deck input", "@me", "Steering committee Q4 4 Dec", "Fri"], WIDE),
    cols(["A-6", "Align migration scope with DWH team", "Bob", "—", "16 Nov"], WIDE),
    cols(["A-8", "Invite Marie to design walkthrough", "@me", "@marie", "17 Nov"], WIDE),
    cols(["A-10", "Draft cutover plan", "@me", "—", "23 Nov"], WIDE),
  ])
  // `t to talk`: the meetings plugin's key on every tab of a project (M9).
  expect(line(frame, 35)).toBe(" ←→ tabs   esc back   n add   e edit   x done   d due   l links   del delete   t to talk   ↑↓ select   ? help   q quit")
  const spans = await tui.spans()
  expect(isSelected(spans, "Send revised budget to Peter")).toBe(true)
  expect(fgAt(spans, "A-4", 6)).toBe(theme.muted)
  expect(fgAt(spans, "@peter", 5)).toBe(theme.magenta)
  expect(fgAt(spans, "Steering committee Q4 4 Dec", 6)).toBe(theme.muted)
  expect(fgAt(spans, "—", 7)).toBe(theme.muted)
  expect(fgAt(spans, "9 Nov", 5)).toBe(theme.red)
  expect(fgAt(spans, "Bob", 7)).toBe(theme.text)
})

test("a person's and a meeting's Actions tabs list the actions linked to them; n links the new one", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12", seed: seedDesign })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  let frame = await actionsTab(tui, "@peter", "Send revised budget to Peter")
  expect(line(frame, 2)).toBe("  Summary   Talk 0   Meetings   Notes 3   Projects & roles 2   Actions 1")
  expect(inside(frame, 5)).toBe(cols(["A-1", "Send revised budget to Peter", "@me", "CRM", "9 Nov"], WIDE))
  expect(fgAt(await tui.spans(), "CRM", 5)).toBe(theme.cyan)
  tui.input.pressEscape()
  await until(tui, (f) => !f.includes("› Peter Janssens"))

  // The meeting's tab comes after its Export tab; its new action is linked to it, opened as the meetings plugin's
  // "log action" opens it.
  frame = await actionsTab(tui, "M-2", "Prepare SteerCo deck input")
  expect(line(frame, 2)).toBe("  Agenda   Prep   Notes   Export   Actions 1")
  expect(line(frame, 3)).toMatch(/^ ╭─ Actions · 1 open ─+╮$/)
  expect(inside(frame, 5)).toBe(cols(["A-4", "Prepare SteerCo deck input", "@me", "CRM", "Fri"], WIDE))
  tui.input.pressKey("n")
  frame = await until(tui, (f) => f.includes("New action · M-2"))
  expect(lineWith(frame, "│ Links ")).toContain("M-2")
  await tui.input.typeText("Circulate the minutes")
  tui.input.pressKey("s", { ctrl: true })
  frame = await until(tui, (f) => f.includes("Circulate the minutes"))
  expect(line(frame, 2)).toBe("  Agenda   Prep   Notes   Export   Actions 2")
  expect(inside(frame, 6)).toBe(cols(["A-47", "Circulate the minutes", "@me", "—", "—"], WIDE))
  expect(await linksOf(47)).toEqual(["meeting:2"])
})

test("l edits the links: @ and M- autocomplete, a removed link is unlinked", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12", seed: seedDesign })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  tui.input.pressKey("4")
  await until(tui, (f) => f.includes("Send revised budget to Peter"))
  tui.input.pressKey("l")
  let frame = await until(tui, (f) => f.includes("Links of A-1"))
  expect(lineWith(frame, "│ Links ")).toContain("#CRM @peter")
  expect(line(frame, 35)).toBe(" tab field   ctrl+s save   esc cancel")
  await tui.input.typeText(" @an")
  frame = await until(tui, (f) => f.includes("@anna Anna Peeters"))
  tui.input.pressTab()
  await tui.input.typeText("M-")
  frame = await until(tui, (f) => f.includes("M-2 Steering committee Q4"))
  expect(frame).toContain("M-1 SteerCo")
  tui.input.pressTab()
  expect(lineWith(await tui.frame(), "│ Links ")).toContain("#CRM @peter @anna M-2")
  tui.input.pressKey("s", { ctrl: true })
  frame = await until(tui, (f) => !f.includes("Links of A-1") && lineWith(f, "Send revised budget").includes("@anna"))
  // Four links in 30 cells: the meeting's title gives way, its date stays.
  expect(inside(frame, 4)).toBe(cols(["A-1", "Send revised budget to Peter", "@me", "CRM @peter @anna Steeri… 4 Dec", "9 Nov"], WIDE))
  expect(await linksOf(1)).toEqual(["project:2", "person:5", "person:8", "meeting:2"])

  // Removing a ref unlinks it.
  tui.input.pressKey("l")
  await until(tui, (f) => f.includes("Links of A-1"))
  for (let i = 0; i < 4; i++) tui.input.pressBackspace()
  tui.input.pressKey("s", { ctrl: true })
  frame = await until(tui, (f) => !f.includes("Links of A-1") && !lineWith(f, "Send revised budget").includes("Steeri"))
  expect(inside(frame, 4)).toBe(cols(["A-1", "Send revised budget to Peter", "@me", "CRM @peter @anna", "9 Nov"], WIDE))
  expect(await linksOf(1)).toEqual(["project:2", "person:5", "person:8"])
})

test("an archived project cannot be linked (the error shows, nothing is written); unlinking it always works", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await inCtx(async () => {
    await write("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
    await write("projects").addProject!({ code: "OLD", name: "Old platform" })
    await write("actions").addAction!({ title: "Reply to vendor", due: "2026-11-16", project: "CRM" }) // A-1
    await write("actions").addAction!({ title: "Wrap up", due: "2026-11-17", project: "OLD" }) // A-2
    await write("projects").archiveProject!({ project: "OLD" })
  })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  tui.input.pressKey("4")
  await until(tui, (f) => f.includes("Wrap up"))
  tui.input.pressKey("l")
  await until(tui, (f) => f.includes("Links of A-1"))
  await tui.input.typeText(" #OLD")
  tui.input.pressKey("s", { ctrl: true })
  let frame = await until(tui, (f) => f.includes("✗"))
  expect(frame).toContain("✗ #OLD is archived")
  expect(frame).toContain("Links of A-1")
  expect(await linksOf(1)).toEqual(["project:1"])
  tui.input.pressEscape()
  await until(tui, (f) => !f.includes("Links of A-1"))

  // In the full form too: a refused link in a save that also changes the title shows under Links; nothing is written.
  tui.input.pressKey("e")
  await until(tui, (f) => f.includes("Edit A-1"))
  await tui.input.typeText(" now")
  tui.input.pressTab()
  tui.input.pressTab()
  tui.input.pressTab()
  await tui.input.typeText(" #OLD")
  tui.input.pressKey("s", { ctrl: true })
  frame = await until(tui, (f) => f.includes("✗"))
  const rows = frame.split("\n")
  const at = rows.findIndex((l) => l.includes("✗ #OLD is archived"))
  expect(rows[at - 1]).toContain("Links")
  expect(await linksOf(1)).toEqual(["project:1"])
  tui.input.pressEscape()
  await until(tui, (f) => !f.includes("Edit A-1"))
  expect(lineWith(await tui.frame(), "Reply to vendor")).not.toContain("now")

  // A-2's only project is archived (the action is frozen), but its link can go.
  tui.input.pressArrow("down")
  for (let i = 0; i < 100 && !isSelected(await tui.spans(), "Wrap up"); i++) await new Promise((r) => setTimeout(r, 10))
  tui.input.pressKey("l")
  frame = await until(tui, (f) => f.includes("Links of A-2"))
  expect(lineWith(frame, "│ Links ")).toContain("#OLD")
  for (let i = 0; i < 4; i++) tui.input.pressBackspace()
  tui.input.pressKey("s", { ctrl: true })
  frame = await until(tui, (f) => !f.includes("Links of A-2"))
  expect(lineWith(frame, "Wrap up")).toContain("—")
  expect(await linksOf(2)).toEqual([])
})

// The links write and editAction share one act: a refused owner rolls the changed links back with it.
test("the full form: new Links and an unknown owner fail together; the links stay as they were", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await inCtx(async () => {
    await write("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
    await write("projects").addProject!({ code: "ERP", name: "ERP upgrade" })
    await write("actions").addAction!({ title: "Reply to vendor", due: "2026-11-16", project: "CRM" }) // A-1
  })
  tui = await renderTui(kernel, { width: 118, height: 36 })
  tui.input.pressKey("4")
  await until(tui, (f) => f.includes("Reply to vendor"))
  tui.input.pressKey("e")
  await until(tui, (f) => f.includes("Edit A-1"))
  tui.input.pressTab()
  tui.input.pressTab()
  await tui.input.typeText("@nobody")
  tui.input.pressTab()
  await tui.input.typeText(" #ERP")
  tui.input.pressKey("s", { ctrl: true })
  const frame = await until(tui, (f) => f.includes("✗"))
  expect(frame).toContain("Edit A-1")
  expect(frame.toLowerCase()).toContain("nobody")
  expect(await linksOf(1)).toEqual(["project:1"])
  tui.input.pressEscape()
  await until(tui, (f) => !f.includes("Edit A-1"))
  expect(await linksOf(1)).toEqual(["project:1"])
})

// Review Focus 5 and the 9-character ids of the handover's high range.
test("80x24: long link lists are cut whole; codes, handles and 9-character ids stay whole", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins })
  await inCtx(async () => {
    await write("people").addPerson!({ name: "Alexandra Vandenberghe", handle: "alexandra", is_stakeholder: true })
    await write("projects").addProject!({ code: "DATAPLATFORM2027", name: "Data platform" })
    await write("projects").addProject!({ code: "CRM", name: "CRM replatforming" })
    await write("meetings").addMeeting!({ about: "#CRM", title: "Steering committee Q4", date: "2026-12-04" })
    await write("actions").addAction!({ title: "Short one", due: "2026-11-16", project: "CRM" }) // A-1
    const long = await write("actions").addAction!({ title: "Agree the ingest cut-over plan with the vendor", due: "2026-11-17" })
    // Moved before it is linked (a link references the action's id).
    kernel!.db.raw.exec(`UPDATE actions_action SET id = 1000001 WHERE id = ${Number(long.ref.slice(2))}`)
    await write("actions").editAction!({ ref: "A-1000001", links: ["#DATAPLATFORM2027", "@alexandra", "#CRM", "M-1"] })
  })
  tui = await renderTui(kernel, { width: 80, height: 24 })
  tui.input.pressKey("4")
  let frame = await until(tui, (f) => f.includes("A-1000001") && f.includes("cut-ove…"))
  // ID 9 (the longest ref), Action 74 − 9 − 30 − 7 − 3 = 25, Linked to 30, Due 7; Owner dropped.
  const narrow = [9, 25, 30, 7]
  expect(inside(frame, 2)).toBe(cols(["ID", "Action", "Linked to", "Due"], narrow))
  expect(inside(frame, lineIndex(frame, "A-1000001"))).toBe(cols(["A-1000001", "Agree the ingest cut-ove…", "DATAPLATFORM2027 @alexandra …", "Tue"], narrow))
  expect(inside(frame, lineIndex(frame, "Short one"))).toBe(cols(["A-1", "Short one", "CRM", "Mon"], narrow))
  const spans = await tui.spans()
  expect(fgAt(spans, "DATAPLATFORM2027", "A-1000001")).toBe(theme.cyan)
  expect(fgAt(spans, "@alexandra", "A-1000001")).toBe(theme.magenta)
  expect(fgAt(spans, " …", "A-1000001")).toBe(theme.muted)
  for (const l of frame.split("\n")) expect(l.length).toBeLessThanOrEqual(80)

  // The project's tab leaves CRM out; the rest is cut the same way (a tab has no week groups: the due date shows).
  frame = await actionsTab(tui, "#CRM", "Short one")
  expect(inside(frame, lineIndex(frame, "A-1000001"))).toBe(cols(["A-1000001", "Agree the ingest cut-ove…", "DATAPLATFORM2027 @alexandra …", "17 Nov"], narrow))
  tui.input.pressEscape()
  await until(tui, (f) => !f.includes("› CRM"))
  // The person's tab keeps Owner (owned or linked must stay visible) and lets Linked to go first: ID 9, Action
  // 74 − 9 − 8 − 7 − 3 = 47, Owner 8, Due 7.
  frame = await actionsTab(tui, "@alexandra", "with the vendor")
  const person = [9, 47, 8, 7]
  expect(frame).not.toContain("Linked to")
  expect(inside(frame, lineIndex(frame, "ID "))).toBe(cols(["ID", "Action", "Owner", "Due"], person))
  expect(inside(frame, lineIndex(frame, "A-1000001"))).toBe(cols(["A-1000001", "Agree the ingest cut-over plan with the vendor", "@me", "17 Nov"], person))
  for (const word of ["DATAPLATFORM2027", "A-1000001", "@alexandra"]) for (let k = 2; k < word.length; k++) expect(frame).not.toContain(word.slice(0, k) + "…")
})

const lineIndex = (frame: string, s: string) => frame.split("\n").findIndex((l) => l.includes(s))
