import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../../tests/helpers"
import { builtinPlugins } from "../../index"
import { people } from "../../people/logic/index"
import { projects } from "../../projects/logic/index"
import { meetings } from "./index"

let k: TestKernel | undefined
afterEach(async () => {
  await k?.cleanup()
  k = undefined
})

const viewCols = (kernel: TestKernel, name: string) =>
  (kernel.db.raw.prepare(`PRAGMA table_info("meetings__pub_${name}")`).all([]) as any[]).map((r) => r.name)

describe("meetings plugin skeleton", () => {
  test("meetings loads after projects and people and publishes its views", async () => {
    k = await makeTestKernel({ plugins: [meetings, projects, people] })
    expect(meetings.requires).toEqual({ projects: "^1", people: "^1" })
    expect(viewCols(k, "meeting")).toEqual(["id", "title", "date", "kind", "status"])
    expect(viewCols(k, "agenda_item")).toEqual(["id", "meeting_id", "position", "text", "project_id", "ask"])
    expect(viewCols(k, "attendee")).toEqual(["meeting_id", "person_id"])
    expect(k.db.raw.prepare(`SELECT * FROM "meetings__pub_meeting"`).all([])).toEqual([])
  })

  test("the built-in plugin list includes meetings", async () => {
    expect(builtinPlugins).toContain(meetings)
    k = await makeTestKernel({ plugins: builtinPlugins })
    expect(viewCols(k, "meeting")).toEqual(["id", "title", "date", "kind", "status"])
  })
})
