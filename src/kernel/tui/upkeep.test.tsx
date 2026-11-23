// The TUI runs the plugins' upkeeps (ctx.upkeep) when it starts and again when the day changes while it is open,
// and reloads its screens afterwards, so what the upkeep wrote shows.
import { afterEach, describe, expect, test } from "bun:test"
import { For } from "solid-js"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { definePlugin } from "../api"
import type { Clock } from "../clock"
import { useQuery, useRuntime } from "./data"
import { defineTui } from "./types"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

// Each upkeep writes a row named after the day it ran on.
const fixture = definePlugin({
  id: "fixture",
  name: "Fixture",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.migration("001", async (db) => {
      await db.schema.createTable("row").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("note", "text").execute()
    })
    ctx.upkeep("u1", async () => {
      await ctx.data.insertInto("row").values({ note: `upkept ${ctx.clock.today()}` }).execute()
    })
  },
})

function Rows() {
  const rt = useRuntime()
  const q = useQuery(() => rt.data.selectFrom("row").select("note").orderBy("id").execute())
  return (
    <box flexDirection="column">
      <For each={q.data() ?? []}>{(r: { note: string }) => <text>{`row ${r.note}`}</text>}</For>
    </box>
  )
}
const part = defineTui({ plugin: "fixture", activate: (ui) => ui.screen({ id: "rows", title: "Rows", slot: 2, component: Rows }) })

async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}

describe("TUI upkeep", () => {
  test("runs at start and when the day changes, then the screens reload", async () => {
    let today = "2026-11-13"
    const clock: Clock = { today: () => today, now: () => `${today}T09:00:00` }
    kernel = await makeTestKernel({ plugins: [fixture], clock })
    tui = await renderTui(kernel, { parts: [part], refreshMs: 20 })
    tui.input.pressKey("2")
    let frame = await until(tui, (f) => f.includes("row upkept 2026-11-13"))
    expect(frame).toContain("row upkept 2026-11-13")
    today = "2026-11-14"
    frame = await until(tui, (f) => f.includes("row upkept 2026-11-14"))
    const rows = frame.split("\n").filter((l) => l.includes("row upkept"))
    expect(rows.map((l) => l.trim())).toEqual(["row upkept 2026-11-13", "row upkept 2026-11-14"])
  })
})
