import { afterEach, describe, expect, test } from "bun:test"
import { rgbToHex } from "@opentui/core"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { definePlugin } from "../api"
import { ReportSections } from "./components/ReportSections"
import { useCopyText, useWriteExport } from "./export"
import { theme } from "./theme"
import { defineTui } from "./types"

const thingPlugin = definePlugin({ id: "thing", name: "Thing", version: "1.0.0", apiVersion: 1, activate() {} })
const screenPart = (component: () => any) => defineTui({ plugin: "thing", activate: (ui) => ui.screen({ id: "t", title: "T", slot: 2, component }) })

let kernel: TestKernel | undefined
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  await kernel?.cleanup()
  kernel = undefined
})

const sections = [
  {
    title: "Milestones",
    group: "Project Alpha",
    columns: ["ref", "title", "due", "note"],
    rows: [
      { ref: "MS-1", title: "Solution outline approved", due: "2026-10-14", note: null },
      { ref: "MS-2", title: "Budget", due: "2026-12-01", note: "late" },
    ],
    marks: [
      { icon: "✓", tone: "green" as const },
      { icon: "!", tone: "red" as const },
    ],
    empty: "No milestones.",
  },
  { title: "Risks", group: "Project Alpha", columns: ["x"], rows: [], empty: "No open risks.", note: "Last reviewed 2026-11-01" },
  { title: "Notes", columns: [], rows: [], empty: "-", text: "Plain line one\nPlain line two" },
]

// The foreground colour of the first span containing `text`, as lowercase hex.
function colorOf(frame: Awaited<ReturnType<RenderedTui["spans"]>>, text: string): string | undefined {
  for (const line of frame.lines)
    for (const sp of line.spans)
      if (sp.text.includes(text)) return rgbToHex(sp.fg).toLowerCase()
  return undefined
}

describe("ReportSections", () => {
  test("ReportSections draws marks, tones, groups and empty texts", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    tui = await renderTui(kernel, { parts: [screenPart(() => <ReportSections sections={sections} skipColumns={["note"]} />)] })
    tui.input.pressKey("2")
    const frame = await tui.frame()
    expect(frame.split("\n").filter((l) => l.includes("Project Alpha"))).toHaveLength(1)
    expect(frame).toContain("✓ MS-1 · Solution outline approved · 2026-10-14")
    expect(frame).toContain("! MS-2 · Budget · 2026-12-01")
    expect(frame).not.toContain("late")
    expect(frame).toContain("No open risks.")
    expect(frame).toContain("Last reviewed 2026-11-01")
    expect(frame).toContain("Plain line one")
    expect(frame).toContain("Plain line two")
    const spans = await tui.spans()
    expect(colorOf(spans, "✓ MS-1")).toBe(theme.green)
    expect(colorOf(spans, "! MS-2")).toBe(theme.red)
    expect(colorOf(spans, "Milestones")).toBe(theme.muted) // section titles are muted sub-headings (gap M6)
    expect(colorOf(spans, "No open risks.")).toBe(theme.muted)
    expect(colorOf(spans, "Last reviewed")).toBe(theme.muted)
  })

  test("a long row is cut with an ellipsis to the width of its box and takes one line", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const long = [{ title: "S", columns: ["a"], rows: [{ a: "word ".repeat(20) + "END" }], empty: "" }]
    tui = await renderTui(kernel, {
      parts: [screenPart(() => (
        <box width={40}>
          <ReportSections sections={long} />
        </box>
      ))],
    })
    tui.input.pressKey("2")
    let frame = await tui.frame()
    for (let i = 0; i < 20 && !frame.includes("…"); i++) frame = await tui.frame() // the measure lands after a render
    const lines = frame.split("\n").map((l) => l.trimEnd())
    const hits = lines.filter((l) => l.includes("word word"))
    expect(hits).toHaveLength(1)
    expect(hits[0]!.endsWith("…")).toBe(true)
    expect(hits[0]!.length).toBeLessThanOrEqual(40)
    expect(lines.some((l) => l.includes("END"))).toBe(false)
  })

  test("compact: a fact line, muted sub-headings, three columns; sections without a compact form as before", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    const compact = [
      {
        title: "Health",
        columns: ["h"],
        rows: [{ h: "amber" }],
        empty: "",
        compact: { fact: true, lines: [{ text: [{ text: "● amber", tone: "amber" as const }, { text: "  Slipping" }] }] },
      },
      {
        title: "Decisions",
        columns: ["d"],
        rows: [{ d: "x" }],
        empty: "none since 2026-10-28",
        compact: {
          title: "Decisions since last meeting",
          lines: [{ icon: { text: "·", tone: "muted" as const }, text: [{ text: "Phase 1 excludes marketing" }], aside: { text: "28 Oct", tone: "muted" as const } }],
        },
      },
      { title: "Empty", columns: ["d"], rows: [], empty: "none since 2026-10-28", compact: { lines: [], empty: "none since 28 Oct" } },
      { title: "Other", columns: ["a", "b"], rows: [{ a: "A-1", b: "plain" }], marks: [{ icon: "!", tone: "red" as const }], empty: "" },
    ]
    tui = await renderTui(kernel, {
      parts: [screenPart(() => (
        <box width={60}>
          <ReportSections sections={compact} compact />
        </box>
      ))],
    })
    tui.input.pressKey("2")
    let frame = await tui.frame()
    for (let i = 0; i < 20 && !frame.includes("28 Oct"); i++) frame = await tui.frame()
    const at = frame.split("\n").findIndex((l) => l.startsWith("Health"))
    expect(frame.split("\n").slice(at, at + 8).map((l) => l.trimEnd())).toEqual([
      "Health          ● amber  Slipping",
      "",
      "Decisions since last meeting",
      "·  Phase 1 excludes marketing               28 Oct",
      "Empty",
      "none since 28 Oct",
      "Other",
      "! A-1 · plain",
    ])
    const spans = await tui.spans()
    expect(colorOf(spans, "Health")).toBe(theme.muted)
    expect(colorOf(spans, "● amber")).toBe(theme.amber)
    expect(colorOf(spans, "Slipping")).toBe(theme.text)
    expect(colorOf(spans, "Decisions since")).toBe(theme.muted)
    expect(colorOf(spans, "28 Oct")).toBe(theme.muted)
    expect(colorOf(spans, "Phase 1")).toBe(theme.text)
    expect(colorOf(spans, "! A-1")).toBe(theme.red)
  })

  test("useCopyText calls OSC 52 and useWriteExport writes into the export folder", async () => {
    kernel = await makeTestKernel({ plugins: [thingPlugin] })
    let copy!: (t: string) => boolean
    let write!: (f: string, t: string) => Promise<string>
    function Probe() {
      copy = useCopyText()
      write = useWriteExport()
      return <text>probe</text>
    }
    tui = await renderTui(kernel, { parts: [screenPart(Probe)] })
    tui.input.pressKey("2")
    await tui.frame()
    const calls: string[] = []
    ;(tui.renderer as any).copyToClipboardOSC52 = (t: string) => (calls.push(t), true)
    expect(copy("hello")).toBe(true)
    expect(calls).toEqual(["hello"])
    const path = await write("m.md", "body")
    expect(path).toBe(join(kernel.config.exportDir, "m.md"))
    expect(await readFile(path, "utf8")).toBe("body")
  })
})
