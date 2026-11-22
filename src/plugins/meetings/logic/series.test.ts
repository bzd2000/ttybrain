// Recurring series and their occurrences (design §5.2, rulings M1–M3): a series makes ordinary meetings ahead for
// the next 8 weeks (56 days from today); skip and move keep an occurrence's place, so it is never made again; end
// removes the planned ones after its date; the `occurrences` upkeep tops up later boots with future dates only.
import { afterEach, describe, expect, test } from "bun:test"
import { builtinPlugins } from "../../../../tests/builtins"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { runCli } from "../../../kernel/cli/dispatch"
import { fixedClock } from "../../../kernel/clock"
import { runWithContext } from "../../../kernel/context"
import { bootKernel, type Kernel } from "../../../kernel/host"

let kernels: Kernel[] = []
let home: TestKernel | undefined
afterEach(async () => {
  for (const k of kernels.reverse()) await k.shutdown()
  kernels = []
  await home?.cleanup()
  home = undefined
})

type Api = { read: Record<string, (i: any) => Promise<any>>; write: Record<string, (i: any) => Promise<any>> }
const api = (k: Kernel, plugin = "meetings") => k.runtime(plugin)!.self() as Api
const w = (k: Kernel, op: string, input: unknown, plugin = "meetings") => runWithContext(k.context(), () => api(k, plugin).write[op]!(input))
const r = (k: Kernel, op: string, input: unknown) => runWithContext(k.context(), () => api(k).read[op]!(input))
const failure = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as { name: string; message: string; hint?: string; field?: string }
  }
  throw new Error("expected a failure")
}

async function cli(k: Kernel, ...argv: string[]): Promise<{ code: number; out: string; err: string; json: any }> {
  let out = ""
  let err = ""
  const code = await runCli(argv, k, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => "" })
  let json: any
  try {
    json = JSON.parse(out)
  } catch {}
  return { code, out, err, json }
}

// The meetings as stored, in date order: [ref, date, series_date, status].
const rows = (k: Kernel) =>
  k.db.raw
    .prepare("SELECT id, title, date, kind, status, subject_type, subject_id, series_id, series_date, auto_close FROM meetings_meeting ORDER BY date, id")
    .all([]) as Array<Record<string, unknown>>
const occurrences = (k: Kernel) => rows(k).map((m) => [`M-${m.id}`, m.date, m.series_date, m.status])
const attendees = (k: Kernel, meetingId: number) =>
  k.db.raw.prepare("SELECT p.handle FROM meetings_attendee a JOIN people_person p ON p.id = a.person_id WHERE a.meeting_id = ? ORDER BY p.handle").all([meetingId]).map((x) => x.handle)

// Today Fri 20 Nov 2026 (the mock's); Karim and Anna, CRM.
async function boot(today = "2026-11-20"): Promise<TestKernel> {
  home = await makeTestKernel({ plugins: builtinPlugins, today })
  await w(home, "addPerson", { name: "Karim Haddad", handle: "karim" }, "people")
  await w(home, "addPerson", { name: "Anna Peeters", handle: "anna" }, "people")
  await w(home, "addProject", { code: "CRM", name: "CRM replatforming" }, "projects")
  return home
}
async function later(today: string): Promise<Kernel> {
  const k = await bootKernel({ env: { TTYBRAIN_HOME: home!.home, TTYBRAIN_TEST: "1" }, plugins: builtinPlugins, clock: fixedClock(today) })
  kernels.push(k)
  return k
}

describe("series", () => {
  test("a 1:1 series makes 8 weeks of occurrences with its subject, kind and attendees", async () => {
    const k = await boot()
    const s = await w(k, "addSeries", { about: "@karim", title: "1:1 Karim", every: "every 2 weeks on wednesday", from: "wed" })
    expect(s).toEqual({
      ref: "S-1",
      id: 1,
      title: "1:1 Karim",
      kind: "one_on_one",
      about: "@karim",
      rhythm: "every 2 weeks on wed",
      first_date: "2026-11-25",
      end_date: null,
      attendees: ["@karim"],
      next: "2026-11-25",
    })
    expect(occurrences(k)).toEqual([
      ["M-1", "2026-11-25", "2026-11-25", "planned"],
      ["M-2", "2026-12-09", "2026-12-09", "planned"],
      ["M-3", "2026-12-23", "2026-12-23", "planned"],
      ["M-4", "2027-01-06", "2027-01-06", "planned"],
    ])
    for (const m of rows(k)) expect(m).toMatchObject({ title: "1:1 Karim", kind: "one_on_one", subject_type: "person", series_id: 1, auto_close: 1 })
    expect(attendees(k, 1)).toEqual(["karim"])
    const m1 = await w(k, "editMeeting", { ref: "M-1" }) // no change: returns the record
    expect(m1).toMatchObject({ ref: "M-1", kind: "one_on_one", about: "@karim", series: "S-1" })
  })

  test("a project series: kind from the subject, explicit attendees; board kind is allowed on a project", async () => {
    const k = await boot()
    const s = await w(k, "addSeries", { about: "#CRM", title: "CRM steering", every: "monthly on the 4th tue", from: "today", attendees: ["anna", "@karim"] })
    expect(s).toMatchObject({ ref: "S-1", kind: "project", about: "#CRM", rhythm: "monthly on the 4th tue", first_date: "2026-11-20", attendees: ["@anna", "@karim"], next: "2026-11-24" })
    expect(occurrences(k)).toEqual([
      ["M-1", "2026-11-24", "2026-11-24", "planned"],
      ["M-2", "2026-12-22", "2026-12-22", "planned"],
    ])
    expect(attendees(k, 2)).toEqual(["anna", "karim"])
    const board = await w(k, "addSeries", { about: "CRM", title: "Board", kind: "board", every: "monthly on the last fri", from: "today" })
    expect(board).toMatchObject({ ref: "S-2", kind: "board", attendees: [], next: "2026-11-27" })
  })

  test("validation: rhythm, kind against the subject, unknown subject, until before from", async () => {
    const k = await boot()
    const bad = await failure(w(k, "addSeries", { about: "@karim", title: "x", every: "daily", from: "today" }))
    expect([bad.name, bad.message, bad.field]).toEqual(["ValidationError", 'invalid rhythm "daily"', "every"])
    const kind = await failure(w(k, "addSeries", { about: "@karim", title: "x", kind: "board", every: "weekly on mon", from: "today" }))
    expect([kind.name, kind.message, kind.field]).toEqual(["ValidationError", "a board meeting needs a project; @karim is a person", "kind"])
    const oneOnOne = await failure(w(k, "addSeries", { about: "#CRM", title: "x", kind: "one_on_one", every: "weekly on mon", from: "today" }))
    expect(oneOnOne.message).toBe("a 1:1 needs a person; #CRM is a project")
    const unknown = await failure(w(k, "addSeries", { about: "@nobody", title: "x", every: "weekly on mon", from: "today" }))
    expect([unknown.name, unknown.message]).toEqual(["NotFoundError", 'unknown person "@nobody"'])
    const until = await failure(w(k, "addSeries", { about: "@karim", title: "x", every: "weekly on mon", from: "2026-12-01", until: "2026-11-30" }))
    expect([until.message, until.field]).toEqual(["until 2026-11-30 is before the first date 2026-12-01", "until"])
    expect(rows(k)).toEqual([])
  })

  test("skip and move keep the occurrence's place: the upkeep never makes them again", async () => {
    const k = await boot()
    await w(k, "addSeries", { about: "@karim", title: "1:1 Karim", every: "2 weeks on wed", from: "wed" })
    expect(await w(k, "skipMeeting", { ref: "M-1" })).toMatchObject({ ref: "M-1", status: "cancelled", date: "2026-11-25", series: "S-1" })
    expect(await w(k, "moveMeeting", { ref: "M-2", to: "2026-12-10" })).toMatchObject({ ref: "M-2", status: "planned", date: "2026-12-10" })
    const next = await later("2026-11-23")
    await w(next, "addPerson", { name: "Sofie Lambert", handle: "sofie" }, "people") // a write: the upkeep runs first
    expect(occurrences(next)).toEqual([
      ["M-1", "2026-11-25", "2026-11-25", "cancelled"],
      ["M-2", "2026-12-10", "2026-12-09", "planned"],
      ["M-3", "2026-12-23", "2026-12-23", "planned"],
      ["M-4", "2027-01-06", "2027-01-06", "planned"],
    ])
    // Skip and move only a planned meeting.
    expect((await failure(w(next, "skipMeeting", { ref: "M-1" }))).message).toBe("M-1 is cancelled")
    expect((await failure(w(next, "moveMeeting", { ref: "M-1", to: "+1d" }))).message).toBe("M-1 is cancelled")
  })

  test("the occurrences upkeep on a later boot tops up only future dates", async () => {
    const k = await boot()
    await w(k, "addSeries", { about: "@karim", title: "1:1 Karim", every: "weekly on wed", from: "wed" })
    expect(occurrences(k).map((o) => o[1])).toEqual(["2026-11-25", "2026-12-02", "2026-12-09", "2026-12-16", "2026-12-23", "2026-12-30", "2027-01-06", "2027-01-13"])
    // Three weeks later: nothing back-filled, the window moves on to 56 days from the new today.
    const next = await later("2026-12-11")
    expect(occurrences(next)).toHaveLength(8) // a read-only boot changes nothing
    await next.upkeep()
    expect(occurrences(next).map((o) => o[1])).toEqual([
      "2026-11-25",
      "2026-12-02",
      "2026-12-09",
      "2026-12-16",
      "2026-12-23",
      "2026-12-30",
      "2027-01-06",
      "2027-01-13",
      "2027-01-20",
      "2027-01-27",
      "2027-02-03",
    ])
    expect(attendees(next, 11)).toEqual(["karim"])
    // A gap in the past (the series started before the app was opened) is not filled either.
    await w(next, "addSeries", { about: "@anna", title: "1:1 Anna", every: "weekly on mon", from: "2026-11-02" })
    expect(rows(next).filter((m) => m.series_id === 2).map((m) => m.date)).toEqual([
      "2026-12-14",
      "2026-12-21",
      "2026-12-28",
      "2027-01-04",
      "2027-01-11",
      "2027-01-18",
      "2027-01-25",
      "2027-02-01",
    ])
  })

  test("end removes the planned occurrences after its date; ones with content and held ones stay", async () => {
    const k = await boot()
    await w(k, "addSeries", { about: "@karim", title: "1:1 Karim", every: "weekly on wed", from: "wed" })
    await w(k, "setNotes", { meeting: "M-4", markdown: "keep me" })
    await w(k, "addAgendaItem", { meeting: "M-5", text: "keep me too" })
    await w(k, "addAction", { title: "linked", links: ["M-6"] }, "actions")
    const ended = await w(k, "endSeries", { ref: "S-1", on: "2026-12-02" })
    expect(ended).toMatchObject({ ref: "S-1", end_date: "2026-12-02", next: "2026-11-25" })
    expect(occurrences(k).map((o) => o[0])).toEqual(["M-1", "M-2", "M-4", "M-5", "M-6"])
    // The upkeep makes none after the end.
    const next = await later("2026-11-27")
    await next.upkeep()
    expect(occurrences(next).map((o) => o[0])).toEqual(["M-1", "M-2", "M-4", "M-5", "M-6"])
    expect(k.db.raw.prepare("SELECT count(*) AS n FROM meetings_attendee WHERE meeting_id NOT IN (SELECT id FROM meetings_meeting)").all([])[0]!.n).toBe(0)
    // Ending defaults to today.
    await w(next, "addSeries", { about: "@anna", title: "1:1 Anna", every: "weekly on mon", from: "today" })
    expect(await w(next, "endSeries", { ref: "S-2" })).toMatchObject({ end_date: "2026-11-27", next: null })
    expect(rows(next).filter((m) => m.series_id === 2)).toEqual([])
  })

  test("edit: title and attendees reach the planned occurrences from today; a new rhythm replaces the untouched ones", async () => {
    const k = await boot()
    await w(k, "addSeries", { about: "@karim", title: "1:1 Karim", every: "2 weeks on wed", from: "wed" })
    await w(k, "setNotes", { meeting: "M-2", markdown: "prep" })
    const s = await w(k, "editSeries", { ref: "S-1", title: "Karim 1:1", attendees: ["karim", "anna"], every: "2 weeks on thu" })
    expect(s).toMatchObject({ ref: "S-1", title: "Karim 1:1", rhythm: "every 2 weeks on thu", attendees: ["@anna", "@karim"], next: "2026-11-26" })
    // M-1, M-3 and M-4 carried nothing and went; their ids are free again (a new meeting takes the highest id + 1).
    expect(rows(k).map((m) => [`M-${m.id}`, m.title, m.date, m.series_date])).toEqual([
      ["M-3", "Karim 1:1", "2026-11-26", "2026-11-26"],
      ["M-2", "Karim 1:1", "2026-12-09", "2026-12-09"], // has notes: kept
      ["M-4", "Karim 1:1", "2026-12-10", "2026-12-10"],
      ["M-5", "Karim 1:1", "2026-12-24", "2026-12-24"],
      ["M-6", "Karim 1:1", "2027-01-07", "2027-01-07"],
    ])
    expect(attendees(k, 2)).toEqual(["anna", "karim"])
    expect(attendees(k, 6)).toEqual(["anna", "karim"])
    const until = await w(k, "editSeries", { ref: "S-1", until: "2026-12-20" })
    expect(until.end_date).toBe("2026-12-20")
    expect(rows(k).map((m) => `M-${m.id}`)).toEqual(["M-3", "M-2", "M-4"])
    expect((await w(k, "editSeries", { ref: "S-1", until: null })).end_date).toBeNull()
    expect(rows(k).map((m) => `M-${m.id}`)).toEqual(["M-3", "M-2", "M-4", "M-5", "M-6"])
  })

  test("upcoming lists the planned meetings between two dates; the series view and S- refs", async () => {
    const k = await boot()
    await w(k, "addSeries", { about: "@karim", title: "1:1 Karim", every: "2 weeks on wed", from: "wed" })
    await w(k, "addMeeting", { about: "#CRM", title: "Vendor call", date: "2026-11-26" })
    await w(k, "skipMeeting", { ref: "M-2" })
    expect(await r(k, "upcoming", { from: "today", to: "+3w" })).toEqual({
      meetings: [
        { ref: "M-1", id: 1, title: "1:1 Karim", date: "2026-11-25", kind: "one_on_one", status: "planned", about: "@karim", series: "S-1" },
        { ref: "M-5", id: 5, title: "Vendor call", date: "2026-11-26", kind: "project", status: "planned", about: "#CRM", series: null },
      ],
    })
    expect(k.db.raw.prepare(`SELECT * FROM "meetings__pub_series"`).all([])).toEqual([
      { id: 1, subject_type: "person", subject_id: 1, title: "1:1 Karim", kind: "one_on_one", rhythm: "every 2 weeks on wed", first_date: "2026-11-25", end_date: null },
    ])
    const meetingView = k.db.raw.prepare(`SELECT * FROM "meetings__pub_meeting" WHERE id = 5`).all([])
    expect(meetingView).toEqual([{ id: 5, title: "Vendor call", date: "2026-11-26", kind: "project", status: "planned", subject_type: "project", subject_id: 1, series_id: null }])
    expect(await runWithContext(k.context(), () => k.records.label("S-1"))).toBe("1:1 Karim")
    expect(await runWithContext(k.context(), () => k.records.resolveAny("s-1"))).toEqual({ type: "series", id: 1 })
  })
})

describe("ttybrain meeting series, skip, move", () => {
  test("series add, list, edit and end; skip and move", async () => {
    const k = await boot()
    const add = await cli(k, "meeting", "series", "add", "@karim", "1:1 Karim", "--every", "2 weeks on wed", "--from", "wed")
    expect([add.code, add.out, add.err]).toEqual([0, "S-1 1:1 Karim: every 2 weeks on wed, next 2026-11-25\n", ""])
    await cli(k, "meeting", "series", "add", "CRM", "CRM steering", "--every", "monthly on the 4th tue", "--attendees", "anna,karim")
    expect((await cli(k, "meeting", "series", "list")).out).toBe(
      [
        "ref  title         about   kind        rhythm                  next        ends",
        "S-1  1:1 Karim     @karim  one_on_one  every 2 weeks on wed    2026-11-25",
        "S-2  CRM steering  #CRM    project     monthly on the 4th tue  2026-11-24",
        "",
      ].join("\n"),
    )
    expect((await cli(k, "meeting", "series", "list", "--json")).json.map((s: any) => s.ref)).toEqual(["S-1", "S-2"])
    expect((await cli(k, "meeting", "series", "edit", "S-1", "--title", "Karim", "--until", "2026-12-31")).out).toBe("S-1 Karim: every 2 weeks on wed, next 2026-11-25, until 2026-12-31\n")
    expect((await cli(k, "meeting", "series", "edit", "S-1", "--no-until")).out).toBe("S-1 Karim: every 2 weeks on wed, next 2026-11-25\n")
    expect((await cli(k, "meeting", "skip", "M-1")).out).toBe("M-1 skipped (2026-11-25)\n")
    expect((await cli(k, "meeting", "move", "M-2", "--to", "2026-12-10")).out).toBe("M-2 moved to 2026-12-10\n")
    expect((await cli(k, "meeting", "series", "end", "S-2", "--on", "2026-11-30")).out).toBe("S-2 CRM steering ends 2026-11-30\n")
    const bad = await cli(k, "meeting", "series", "add", "@karim", "x", "--every", "sometimes")
    expect([bad.code, bad.err]).toEqual([
      1,
      'error: invalid rhythm "sometimes"\nhint: use weekly on <day>, every <n> weeks on <day>, monthly on the <1st|2nd|3rd|4th|last> <day> or monthly on day <n>\n',
    ])
    expect((await cli(k, "meeting", "series", "shuffle")).code).toBe(1)
    expect((await cli(k, "meeting", "series", "end", "S-9")).code).toBe(2)
    expect((await cli(k, "meeting", "move", "M-3")).code).toBe(1) // --to is required
  })
})
