// seedDesign: the screen designs' example data lands through the plugins' operations, with the counts the designs
// show (as of Thu 12 Nov 2026).
import { afterEach, expect, test } from "bun:test"
import { runWithContext } from "../src/kernel/context"
import { builtinPlugins } from "./builtins"
import { seedDesign } from "./design"
import { makeTestKernel, type TestKernel } from "./helpers"

let kernel: TestKernel | undefined
afterEach(async () => {
  await kernel?.cleanup()
  kernel = undefined
})

const db = (plugin: string) => kernel!.runtime(plugin)!.data as any
const read = <T>(fn: () => Promise<T>) => runWithContext(kernel!.context(), fn)

test("seedDesign seeds the designs' people, projects, actions, meetings and inbox", async () => {
  kernel = await makeTestKernel({ plugins: builtinPlugins, today: "2026-11-12" })
  await seedDesign(kernel)
  await read(async () => {
    const people = await db("people").selectFrom("person").select(["name", "is_stakeholder", "is_team", "influence"]).orderBy("id").execute()
    expect(people.filter((p: any) => p.is_stakeholder).map((p: any) => p.name)).toEqual([
      "Marie Dubois",
      "Luc Vermeulen",
      "Ingrid Claes",
      "Tom Maes",
      "Peter Janssens",
      "Nadia El Amrani",
      "Jan De Smet",
    ])
    expect(people.filter((p: any) => p.is_team).map((p: any) => p.name)).toEqual(["Anna Peeters", "Bob Willems", "Karim Haddad", "Mathias Wouters", "Sofie Lambert"])

    const projects = await db("projects").selectFrom("project").select(["code", "status"]).orderBy("id").execute()
    expect(projects.map((p: any) => `${p.code}:${p.status}`)).toEqual([
      "ERP:active",
      "CRM:active",
      "HRP:active",
      "DWH:active",
      "IAM:active",
      "SEC:active",
      "WMS:active",
      "BI2:on_hold",
    ])

    const open = await db("projects").selectFrom("action").select(["due_date", "project_id"]).where("status", "=", "open").execute()
    expect(open).toHaveLength(46)
    expect(open.filter((a: any) => a.due_date !== null && a.due_date < "2026-11-12")).toHaveLength(3) // overdue
    expect(open.filter((a: any) => a.due_date >= "2026-11-12" && a.due_date <= "2026-11-15")).toHaveLength(3) // this week
    expect(open.filter((a: any) => a.due_date >= "2026-11-16" && a.due_date <= "2026-11-22")).toHaveLength(3) // next week
    expect(open.filter((a: any) => a.due_date === null)).toHaveLength(3)
    const crm = projects.findIndex((p: any) => p.code === "CRM") + 1
    expect(open.filter((a: any) => a.project_id === crm)).toHaveLength(9)

    const highRisks = await db("projects").selectFrom("risk").select("title").where("status", "=", "open").where("severity", "=", "high").execute()
    expect(highRisks.map((r: any) => r.title).sort()).toEqual(["Budget overrun ~12%", "Source data quality", "Vendor B may miss go-live"])

    const meetings = await db("meetings").selectFrom("meeting").select(["title", "date", "status"]).orderBy("id").execute()
    expect(meetings).toEqual([
      { title: "SteerCo", date: "2026-10-28", status: "held" },
      { title: "Steering committee Q4", date: "2026-12-04", status: "planned" },
    ])
    const agenda = await db("meetings").selectFrom("agenda_item").select(["text", "ask"]).where("meeting_id", "=", 2).orderBy("position").execute()
    expect(agenda.map((a: any) => a.text)).toEqual(["Minutes & open actions", "CRM status", "ERP vendor decision", "HR portal pilot go/no-go", "AOB"])
    expect(agenda[1].ask).toBe("Approve 2-week shift of design milestone and release of contingency budget.")
    expect(await db("meetings").selectFrom("attendee").select("person_id").where("meeting_id", "=", 2).execute()).toHaveLength(8)

    const items = await db("inbox").selectFrom("item").select("status").orderBy("id").execute()
    expect(items.map((i: any) => i.status)).toEqual(["dismissed", "processed", "processed", "processed", "new", "new", "new"])
  })
})
