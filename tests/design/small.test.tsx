// The designed screens at 80×24 (the degradation rule of the design, §3): one test per screen. At the small size
// no project code or person name in view is cut with `…`, the header keeps the chip and the date, every panel
// keeps its bottom border, nothing is wider than the terminal, and the status bar holds only whole hints (each
// one is a hint the same screen shows at 160 columns). Several screens' own design tests assert more at 80×24
// (column drops, exact lines); this file covers the shared rules once per screen. Today is Thu 12 Nov 2026 with the
// 2026-11-13 designs' data, Fri 20 Nov 2026 with the 2026-11-20 meeting designs' data (`meetings: true`).
import { afterEach, expect, test } from "bun:test"
import { builtinPlugins } from "../builtins"
import { line, seedDesign, seedLongRefs, seedMeetings } from "../design"
import { makeTestKernel, type TestKernel } from "../helpers"
import { renderTui, type RenderedTui } from "../tui"

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
  for (let i = 0; i < 100 && !check(frame); i++) {
    await new Promise((r) => setTimeout(r, 10))
    frame = await t.frame()
  }
  return frame
}

const CODES = ["CRM", "ERP", "DWH", "IAM", "HRP", "SEC", "WMS", "BI2"]
const NAMES = [
  "Marie Dubois", "Luc Vermeulen", "Ingrid Claes", "Tom Maes", "Peter Janssens", "Nadia El Amrani", "Jan De Smet",
  "Anna Peeters", "Bob Willems", "Karim Haddad", "Mathias Wouters", "Sofie Lambert",
]
// The meeting designs' codes and first names (the About columns).
const MEETING_WORDS = ["CRM", "ERP", "BOARD", "Anna", "Bob", "Sofie", "Karim"]

type Screen = {
  name: string
  chip: string // what the header's chip shows
  open: (t: RenderedTui) => Promise<string> // drives to the screen, returns the settled frame
  panels?: boolean // the screen draws bordered panels
  must: string[] // codes and names that show whole at 80×24
  meetings?: boolean // seeded with the 2026-11-20 meeting designs' data (today Fri 20 Nov 2026)
}

// Waits for `check`, lets the loads and the measured layout settle, then returns the frame that still passes it.
const settled = async (t: RenderedTui, check: (frame: string) => boolean) => {
  await until(t, check)
  await t.settle()
  return until(t, check)
}

const crm = async (t: RenderedTui) => {
  t.input.pressKey("2")
  await until(t, (f) => f.includes("CRM replatforming"))
  await t.nav.open("#CRM")
  await until(t, (f) => f.includes("Milestones 5"))
}

const SCREENS: Screen[] = [
  // HRP is under "+2 more" since Upcoming meetings came first (2026-11-20 designs).
  { name: "Attention", must: ["CRM", "ERP", "DWH", "IAM", "Marie Dubois", "Luc Vermeulen"], chip: "1 Attention", panels: true, open: (t) => until(t, (f) => f.includes("Overdue actions")) },
  {
    name: "Projects",
    must: CODES,
    chip: "2 Projects",
    panels: true,
    open: async (t) => {
      t.input.pressKey("2")
      return until(t, (f) => f.includes("BI2") && f.includes("Warehouse scanners"))
    },
  },
  {
    name: "Project detail",
    must: ["CRM", "Peter Janssens"],
    chip: "2 Projects",
    panels: true,
    open: async (t) => {
      await crm(t)
      return until(t, (f) => f.includes("Solution outline approved") && f.includes("Milestones"))
    },
  },
  {
    name: "Context",
    must: ["CRM"],
    chip: "2 Projects",
    panels: true,
    open: async (t) => {
      await crm(t)
      for (let i = 0; i < 9; i++) t.input.pressArrow("right") // past the meetings plugin's Meetings and Talk
      return until(t, (f) => f.includes("Background") && f.includes("100%"))
    },
  },
  {
    name: "People",
    must: [...NAMES, "CRM", "ERP", "DWH"],
    chip: "3 People",
    panels: true,
    open: async (t) => {
      t.input.pressKey("3")
      return until(t, (f) => f.includes("Sofie Lambert"))
    },
  },
  {
    name: "Actions",
    must: ["CRM", "ERP", "DWH", "IAM", "HRP"],
    chip: "4 Actions",
    panels: true,
    open: async (t) => {
      t.input.pressKey("4")
      return until(t, (f) => f.includes("Book vendor demo slot") && f.includes("Pilot user list"))
    },
  },
  {
    name: "Meeting prep",
    must: ["CRM", "ERP", "HRP"],
    chip: "5 Meetings",
    panels: true,
    open: async (t) => {
      await t.settle()
      await t.nav.open("M-2")
      await until(t, (f) => f.includes("Agenda") && f.includes("Export"))
      t.input.pressArrow("right")
      await until(t, (f) => f.includes("Ask for this meeting"))
      t.input.pressArrow("down")
      // The ask is the prep's last section; at 80×24 Overdue actions is below the panel's fold.
      return until(t, (f) => f.includes("Prep · CRM replatforming") && f.includes("contingency budget") && (f.split("\n").length < 40 || f.includes("Overdue actions")))
    },
  },
  {
    name: "Attention with upcoming meetings",
    meetings: true,
    must: ["Anna", "CRM", "Marie Dubois"],
    chip: "1 Attention",
    panels: true,
    open: (t) => until(t, (f) => f.includes("Before 1:1 Anna") && f.includes("Marie Dubois")),
  },
  {
    name: "Meetings",
    meetings: true,
    must: [...MEETING_WORDS, "BOARD Management board"], // the Boards panel's code and name
    chip: "5 Meetings",
    panels: true,
    open: async (t) => {
      t.input.pressKey("5")
      const ready = (f: string) => f.includes("Held, closes itself") && f.split("BOARD").length > 3
      await until(t, ready)
      await t.settle()
      return until(t, ready)
    },
  },
  {
    name: "New recurring meeting",
    meetings: true,
    must: [],
    chip: "5 Meetings",
    open: async (t) => {
      t.input.pressKey("5")
      await until(t, (f) => f.includes("Series ·"))
      t.input.pressKey("N")
      await until(t, (f) => f.includes("New recurring meeting"))
      await t.input.typeText("@karim")
      return until(t, (f) => f.includes("@karim"))
    },
  },
  {
    name: "Person · Talk",
    meetings: true,
    must: ["ERP", "CRM", "Anna Peeters"],
    chip: "3 People",
    panels: true,
    open: async (t) => {
      await t.nav.open("@anna", "talk")
      return settled(t, (f) => f.includes("To talk about · 4 open") && f.includes("AWS training") && f.includes("Anna's actions"))
    },
  },
  {
    name: "1:1 in progress",
    meetings: true,
    must: ["Anna Peeters"], // the project tags give way to the items' text
    chip: "3 People",
    panels: true,
    open: async (t) => {
      await t.nav.open("@anna", "meetings")
      await until(t, (f) => f.includes("Past meetings"))
      await t.settle()
      t.input.pressEnter()
      return settled(t, (f) => f.includes("Talk · 0 of 5 discussed") && f.includes("Open from before") && f.includes("Feedback from Marie on"))
    },
  },
  {
    name: "Project · Meetings",
    meetings: true,
    must: ["CRM"],
    chip: "2 Projects",
    panels: true,
    open: async (t) => {
      await t.nav.open("#CRM", "meetings")
      return settled(t, (f) => f.includes("Past meetings") && f.includes("A-1 Send"))
    },
  },
  {
    name: "Project · Talk",
    meetings: true,
    must: ["CRM", "Anna"],
    chip: "2 Projects",
    panels: true,
    open: async (t) => {
      await t.nav.open("#CRM", "talk")
      return settled(t, (f) => f.includes("To talk about · 3 open") && f.includes("Shift design") && f.includes("Your actions for CRM"))
    },
  },
  {
    name: "Board · Summary",
    meetings: true,
    must: ["BOARD", "Management board"],
    chip: "5 Meetings",
    panels: true,
    open: async (t) => {
      await t.nav.open("#BOARD", "summary")
      return settled(t, (f) => f.includes("Status") && f.includes("active"))
    },
  },
  {
    name: "Board · Meetings",
    meetings: true,
    must: ["BOARD", "Board · monthly, last Fri", "Your actions for BOARD", "Marie D., Peter J.", "30 Oct    Board"],
    chip: "5 Meetings",
    panels: true,
    open: async (t) => {
      await t.nav.open("#BOARD", "meetings")
      return settled(t, (f) => f.includes("Past meetings") && f.includes("A-5"))
    },
  },
  {
    name: "Board · Talk",
    meetings: true,
    must: ["BOARD", "Your actions for BOARD"],
    chip: "5 Meetings",
    panels: true,
    open: async (t) => {
      await t.nav.open("#BOARD", "talk")
      return settled(t, (f) => f.includes("To talk about · 2 open") && f.includes("Hiring freeze") && f.includes("A-5"))
    },
  },
  {
    name: "Board meeting",
    meetings: true,
    must: ["BOARD", "CRM", "ERP", "HRP"],
    chip: "5 Meetings",
    panels: true,
    open: async (t) => {
      await t.nav.open("#BOARD", "meetings")
      await until(t, (f) => f.includes("Past meetings"))
      await t.settle()
      t.input.pressEnter()
      return settled(t, (f) => f.includes("Board talk-list · 2") && f.includes("Budget 2027"))
    },
  },
  {
    name: "Capture to a talk-list",
    meetings: true,
    must: [],
    chip: "4 Actions",
    panels: true,
    open: async (t) => {
      t.input.pressKey("4")
      await until(t, (f) => f.includes("Actions · 7 open"))
      t.input.pressKey("i")
      await until(t, (f) => f.includes("Capture to inbox"))
      await t.input.typeText("talk @anna holiday planning #CRM ")
      return settled(t, (f) => f.includes("talk-list"))
    },
  },
  {
    name: "Capture to a board's talk-list",
    meetings: true,
    must: ["Management board's talk-list"],
    chip: "4 Actions",
    panels: true,
    open: async (t) => {
      t.input.pressKey("4")
      await until(t, (f) => f.includes("Actions · 7 open"))
      t.input.pressKey("i")
      await until(t, (f) => f.includes("Capture to inbox"))
      await t.input.typeText("talk #BOARD office move ")
      return settled(t, (f) => f.includes("talk-list"))
    },
  },
  {
    name: "Inbox",
    must: ["CRM"],
    chip: "6 Inbox",
    panels: true,
    open: async (t) => {
      t.input.pressKey("6")
      return until(t, (f) => f.includes("New · 3") && f.includes("unknown project"))
    },
  },
  {
    name: "Capture",
    must: ["CRM"],
    chip: "2 Projects",
    open: async (t) => {
      await crm(t)
      t.input.pressKey("i")
      return until(t, (f) => f.includes("Capture to inbox"))
    },
  },
  {
    name: "Switcher",
    must: ["CRM", "ERP"],
    chip: "1 Attention",
    open: async (t) => {
      await t.settle()
      t.input.pressKey("g")
      return until(t, (f) => f.includes("▴"))
    },
  },
]

// The whole hints of the status bar (the last line): groups of words 3 or more cells apart.
const hints = (frame: string) =>
  line(frame, frame.replace(/\n$/, "").split("\n").length - 1)
    .trim()
    .split(/ {3,}/)
    .filter(Boolean)

async function render(s: Screen, width: number, height: number): Promise<string> {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: s.meetings ? "2026-11-20" : "2026-11-12", seed: s.meetings ? seedMeetings : seedDesign })
  tui = await renderTui(kernel, { width, height })
  const frame = await s.open(tui)
  tui.destroy()
  tui = undefined
  await kernel.cleanup()
  kernel = undefined
  return frame
}

for (const s of SCREENS) {
  test(`${s.name} at 80x24: names whole, chip and date, panel borders, whole hints`, async () => {
    const wide = await render(s, 160, 40)
    const frame = await render(s, 80, 24)
    const rows = frame.replace(/\n$/, "").split("\n")
    expect(rows.length).toBe(24)
    for (const l of rows) expect(l.length).toBeLessThanOrEqual(80)

    // Codes and names are whole wherever they show: no proper prefix of one is followed by `…`.
    for (const [list, min] of [[CODES, 2], [NAMES, 3]] as const)
      for (const word of list) for (let k = min; k < word.length; k++) expect(frame).not.toContain(word.slice(0, k) + "…")

    // The header: ttybrain, the chip and the date.
    expect(line(frame, 0)).toContain(`ttybrain ·  ${s.chip}`)
    expect(line(frame, 0)).toMatch(s.meetings ? /Fri 20 Nov 2026$/ : /Thu 12 Nov 2026$/)

    // Every panel top has its bottom border.
    if (s.panels) {
      const tops = [...frame.matchAll(/╭/g)].length
      const bottoms = [...frame.matchAll(/╰/g)].length
      expect(tops).toBeGreaterThan(0)
      expect(bottoms).toBe(tops)
    }

    // The status bar: whole hints only, each one the same screen shows when it has room.
    const bar = hints(frame)
    expect(bar.length).toBeGreaterThan(0)
    expect(line(frame, 23)).not.toContain("…")
    const known = new Set(hints(wide))
    for (const h of bar) expect(known.has(h)).toBe(true)
    // The first hints survive (the screen's own come first, the frame's tail drops).
    const first = hints(wide).slice(0, 2)
    expect(bar.slice(0, first.length)).toEqual(first)
    for (const w of s.must) expect(frame).toContain(w)
  })
}

// Attention with long refs at 80×24: the 16-character code, the four-digit ids and the long name are whole in every
// panel (the panels' columns grow to them and the titles give way); tests/design/attention.test.tsx has the lines.
test("Attention at 80x24 with long codes, ids and names: whole", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedLongRefs(kernel)
  tui = await renderTui(kernel, { width: 80, height: 24 })
  const frame = await until(tui, (f) => f.includes("R-1000") && f.includes("Alexandra"))
  for (const word of ["DATAPLATFORM2027", "A-1000", "A-1001", "R-1000", "Alexandra Vandenberghe"]) {
    for (let k = 2; k < word.length; k++) expect(frame).not.toContain(word.slice(0, k) + "…")
    expect(frame).toContain(word)
  }
  expect([...frame.matchAll(/DATAPLATFORM2027/g)].length).toBe(5)
  expect([...frame.matchAll(/╭/g)].length).toBe([...frame.matchAll(/╰/g)].length)
})
