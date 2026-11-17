// Draft recovery in forms and the editor (drafts.ts): a draft of the unsaved values under PM_HOME/drafts, written
// after a pause in typing and at once on Esc or quit, deleted by a save, offered on reopen
// (`Unsaved draft from HH:MM · r restore · x discard`). Against a fixture plugin `todo` (table `thing`, record
// type `thing` with prefix `TH-`, write ops `addThing` and `editThing`).
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Show } from "solid-js"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { definePlugin, NonBlank, Type, type PluginDef } from "../api"
import { runWithContext } from "../context"
import { Form } from "./components/Form"
import { act, useQuery, useRuntime } from "./data"
import { createDraftStore, draftFile } from "./drafts"
import { useOverlay, type Overlay } from "./overlay"
import { defineTui, type RecordFormProps, type TuiDef } from "./types"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const todoPlugin: PluginDef = definePlugin({
  id: "todo",
  name: "Todo",
  version: "1.0.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.migration("001", async (db) => {
      await db.schema
        .createTable("thing")
        .addColumn("id", "integer", (c) => c.primaryKey())
        .addColumn("title", "text", (c) => c.notNull())
        .addColumn("notes", "text")
        .execute()
    })
    ctx.recordType({
      name: "thing",
      prefix: "TH-",
      resolve: async (ref) => {
        const m = /^(?:TH-)?(\d+)$/i.exec(ref)
        return m ? Number(m[1]) : null
      },
      label: async (id) => String((await ctx.data.selectFrom("thing").select("title").where("id", "=", id).executeTakeFirstOrThrow()).title),
      search: async () => [],
    })
    const out = Type.Object({ ref: Type.String() })
    ctx.expose({
      write: {
        addThing: {
          input: Type.Object({ title: NonBlank(), notes: Type.Optional(Type.String()) }),
          output: out,
          describe: (i) => `+ thing "${i.title}"`,
          run: async (i) => {
            const r = await ctx.data.insertInto("thing").values({ title: i.title, notes: i.notes ?? null }).executeTakeFirstOrThrow()
            return { ref: `TH-${r.insertId}` }
          },
        },
        editThing: {
          input: Type.Object({ ref: Type.String(), title: Type.Optional(NonBlank()), notes: Type.Optional(Type.Union([Type.String(), Type.Null()])) }),
          output: out,
          describe: (i) => `~ thing ${i.ref}`,
          run: async (i) => {
            const id = Number(i.ref.slice(3))
            await ctx.data
              .updateTable("thing")
              .set({ ...(i.title !== undefined ? { title: i.title } : {}), ...(i.notes !== undefined ? { notes: i.notes } : {}) })
              .where("id", "=", id)
              .execute()
            return { ref: i.ref }
          },
        },
      },
    })
  },
})

type Thing = { title: string; notes: string | null }

function ThingForm(props: RecordFormProps) {
  const rt = useRuntime()
  const row = useQuery(async (): Promise<Thing | null> => {
    if (props.recordRef === undefined) return null
    return ((await rt.data.selectFrom("thing").select(["title", "notes"]).where("id", "=", Number(props.recordRef.slice(3))).executeTakeFirst()) ?? null) as Thing | null
  })
  return (
    <Show when={row.data() !== undefined}>
      <Form
        title={props.recordRef ? `Edit ${props.recordRef}` : "New thing"}
        fields={[
          { name: "title", label: "Title", kind: "text", required: true, initial: row.data()?.title ?? props.prefill?.title ?? null },
          { name: "notes", label: "Notes", kind: "longtext", initial: row.data()?.notes ?? null },
        ]}
        submit={async (v) => {
          const r =
            props.recordRef === undefined
              ? await act(() => rt.self().write.addThing!({ title: v.title ?? "", ...(v.notes ? { notes: v.notes } : {}) }) as Promise<{ ref: string }>)
              : await act(() => rt.self().write.editThing!({ ref: props.recordRef!, title: v.title ?? "", notes: v.notes }) as Promise<{ ref: string }>)
          return r.ok ? { ok: true, ref: r.value.ref } : r
        }}
        close={props.close}
      />
    </Show>
  )
}

let overlay: Overlay | undefined
function Home() {
  overlay = useOverlay()
  return <text>todo screen</text>
}
const todoPart: TuiDef = defineTui({
  plugin: "todo",
  activate: (ui) => {
    ui.screen({ id: "todo", title: "Todo", slot: 2, component: Home })
    ui.recordForm("thing", { id: "thing", label: "Thing", component: ThingForm })
  },
})

let kernel: TestKernel
let tui: RenderedTui | undefined
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  overlay = undefined
  await kernel.cleanup()
})

async function boot(): Promise<void> {
  kernel = await makeTestKernel({ plugins: [todoPlugin] })
}
async function session(draftMs = 20): Promise<RenderedTui> {
  tui = await renderTui(kernel, { parts: [todoPart], draftMs })
  tui.input.pressKey("2")
  expect(await tui.frame()).toContain("todo screen")
  return tui
}

const draftsDir = () => join(kernel.home, "drafts")
const draftOf = (key: string) => {
  const file = draftFile(draftsDir(), key)
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined
}
const things = () => runWithContext(kernel.context(), () => kernel.runtime("todo")!.data.selectFrom("thing").select(["title", "notes"]).orderBy("id").execute())
const seed = (title: string) => runWithContext(kernel.context(), () => kernel.runtime("todo")!.self().write.addThing!({ title }))
const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""
const statusLine = (frame: string) => frame.trimEnd().split("\n").at(-1)!
async function until(t: RenderedTui, ok: (f: string) => boolean): Promise<string> {
  let frame = await t.frame()
  for (let i = 0; i < 80 && !ok(frame); i++) {
    await sleep(25)
    frame = await t.frame()
  }
  return frame
}
// Esc, then (as a separate key, not an Alt prefix) a key that is not `s`: the form cancels.
async function cancel(t: RenderedTui): Promise<string> {
  t.input.pressEscape()
  await sleep(30)
  t.input.pressKey("z")
  return t.frame()
}
const PROMPT = "Unsaved draft from 09:00 · r restore · x discard"

describe("form drafts", () => {
  test("Esc keeps a draft; reopening offers it, r restores it, a save deletes it", async () => {
    await boot()
    const t = await session()
    void overlay!.openForm("thing")
    expect(await t.frame()).toContain("New thing")
    await t.input.typeText("Buy milk")
    t.input.pressTab()
    await t.input.typeText("two litres")
    let frame = await cancel(t)
    expect(frame).not.toContain("New thing")
    expect(statusLine(frame)).toContain("draft kept")
    expect(draftOf("todo:thing:new")).toEqual({ key: "todo:thing:new", savedAt: "2026-11-13T09:00:00", values: { title: "Buy milk", notes: "two litres" } })

    void overlay!.openForm("thing")
    frame = await t.frame()
    expect(frame).toContain(PROMPT)
    // Nothing reaches the fields (or the global keys) while the prompt is open.
    await t.input.typeText("qa")
    t.input.pressKey("s", { ctrl: true })
    frame = await t.frame()
    expect(t.renderer.isDestroyed).toBe(false)
    expect(frame).toContain(PROMPT)
    expect(lineWith(frame, "Title")).not.toContain("q")
    expect(await things()).toEqual([])
    t.input.pressKey("r")
    frame = await t.frame()
    expect(frame).not.toContain(PROMPT)
    expect(lineWith(frame, "Title")).toContain("Buy milk")
    expect(frame).toContain("two litres")
    expect(draftOf("todo:thing:new")).toBeDefined() // kept until saved or discarded
    t.input.pressKey("s", { ctrl: true })
    frame = await until(t, (f) => !f.includes("New thing"))
    expect(await things()).toEqual([{ title: "Buy milk", notes: "two litres" }])
    expect(draftOf("todo:thing:new")).toBeUndefined()

    // The next new form starts empty, without a prompt.
    void overlay!.openForm("thing")
    frame = await t.frame()
    expect(frame).toContain("New thing")
    expect(frame).not.toContain("Unsaved draft")
  })

  test("x discards the draft and starts from the saved values", async () => {
    await boot()
    await seed("Old title")
    const t = await session()
    void overlay!.openForm("thing", "thing", { recordRef: "TH-1" })
    expect(await until(t, (f) => f.includes("Edit TH-1"))).toContain("Old title")
    await t.input.typeText(" changed")
    await cancel(t)
    expect(draftOf("todo:thing:TH-1")?.values).toEqual({ title: "Old title changed", notes: null })

    void overlay!.openForm("thing", "thing", { recordRef: "TH-1" })
    expect(await until(t, (f) => f.includes("Edit TH-1"))).toContain(PROMPT)
    t.input.pressKey("x")
    const frame = await t.frame()
    expect(frame).not.toContain(PROMPT)
    expect(lineWith(frame, "Title")).toContain("Old title")
    expect(lineWith(frame, "Title")).not.toContain("changed")
    expect(draftOf("todo:thing:TH-1")).toBeUndefined()
    // The form takes keys again.
    await t.input.typeText("!")
    expect(lineWith(await t.frame(), "Title")).toContain("Old title!")
  })

  test("Esc on the prompt closes the form and leaves the draft", async () => {
    await boot()
    const t = await session()
    void overlay!.openForm("thing")
    await t.frame()
    await t.input.typeText("Keep me")
    await cancel(t)
    const before = draftOf("todo:thing:new")
    void overlay!.openForm("thing")
    expect(await t.frame()).toContain(PROMPT)
    t.input.pressEscape()
    const frame = await until(t, (f) => !f.includes("New thing"))
    expect(frame).toContain("todo screen")
    expect(draftOf("todo:thing:new")).toEqual(before)
  })

  test("a draft equal to the saved values is deleted without a prompt", async () => {
    await boot()
    await seed("Same")
    createDraftStore({ dir: draftsDir(), clock: kernel.clock }).write("todo:thing:TH-1", { title: "Same", notes: null })
    const t = await session()
    void overlay!.openForm("thing", "thing", { recordRef: "TH-1" })
    const frame = await until(t, (f) => f.includes("Edit TH-1"))
    expect(frame).not.toContain("Unsaved draft")
    expect(draftOf("todo:thing:TH-1")).toBeUndefined()
    // And a cancel without changes keeps nothing and says nothing.
    const after = await cancel(t)
    expect(statusLine(after)).not.toContain("draft kept")
    expect(existsSync(draftsDir()) ? readdirSync(draftsDir()) : []).toEqual([])
  })

  test("a form opened from an inbox item keeps its draft under the item", async () => {
    await boot()
    const t = await session()
    void overlay!.openForm("thing", "thing", { prefill: { title: "From inbox" }, origin: { type: "inbox", ref: "I-3" } })
    expect(lineWith(await t.frame(), "Title")).toContain("From inbox")
    await t.input.typeText("!")
    await cancel(t)
    expect(draftOf("todo:thing:new:from:I-3")?.values).toEqual({ title: "From inbox!", notes: null })
    expect(draftOf("todo:thing:new")).toBeUndefined()
  })

  test("the draft is written after a pause in typing; quitting without saving leaves it for the next session", async () => {
    await boot()
    let t = await session(20)
    void overlay!.openForm("thing")
    await t.frame()
    await t.input.typeText("Half done")
    await sleep(80)
    // Written by the debounce alone (no Esc, no quit): a crash now would keep it.
    expect(draftOf("todo:thing:new")?.values).toEqual({ title: "Half done", notes: null })
    await t.input.typeText(" and more")
    t.destroy() // quit: flushed at once, without waiting for the debounce
    tui = undefined
    expect(draftOf("todo:thing:new")?.values).toEqual({ title: "Half done and more", notes: null })

    t = await session(10_000)
    void overlay!.openForm("thing")
    expect(await t.frame()).toContain(PROMPT)
    t.input.pressKey("r")
    expect(lineWith(await t.frame(), "Title")).toContain("Half done and more")
  })

  test("typing never writes to the database", async () => {
    await boot()
    const t = await session(10)
    let writes = 0
    const write = kernel.db.write.bind(kernel.db)
    kernel.db.write = ((fn: () => Promise<unknown>, opts?: unknown) => (writes++, write(fn, opts as never))) as typeof kernel.db.write
    const version = kernel.db.dataVersion()
    void overlay!.openForm("thing")
    await t.frame()
    for (const ch of "lots of typing") {
      await t.input.typeText(ch)
      await sleep(15)
    }
    await sleep(40)
    expect(draftOf("todo:thing:new")?.values.title).toBe("lots of typing")
    expect(writes).toBe(0)
    expect(kernel.db.inWrite()).toBe(false)
    expect(kernel.db.dataVersion()).toBe(version)
  })
})

describe("editor drafts", () => {
  test("with a draftKey: a confirmed Esc d deletes the draft; a quit keeps it, reopening offers it, a save deletes it", async () => {
    await boot()
    let t = await session()
    const saved: string[] = []
    const open = () => overlay!.openEditor({ title: "Notes", initial: "# A", draftKey: "notes:TH-1", save: async (x) => (saved.push(x), { ok: true }) })
    open()
    await t.frame()
    t.input.pressKey("END")
    await t.input.typeText("!")
    await sleep(60)
    // The kernel prefixes the calling plugin.
    expect(draftOf("todo:notes:TH-1")?.values).toEqual({ text: "# A!" })
    t.input.pressEscape()
    await sleep(30)
    t.input.pressKey("d")
    expect(await t.frame()).toContain("Discard changes?")
    t.input.pressKey("y")
    let frame = await until(t, (f) => !f.includes("ctrl+s save"))
    expect(statusLine(frame)).not.toContain("draft kept")
    expect(draftOf("todo:notes:TH-1")).toBeUndefined()

    open()
    await t.frame()
    t.input.pressKey("END")
    await t.input.typeText("!")
    t.destroy() // quit without saving
    tui = undefined
    expect(draftOf("todo:notes:TH-1")?.values).toEqual({ text: "# A!" })

    t = await session()
    open()
    frame = await t.frame()
    expect(frame).toContain(PROMPT)
    // While the prompt shows, the status bar lists its keys, not the editor's.
    expect(statusLine(frame)).toContain("r restore draft")
    expect(statusLine(frame)).not.toContain("Ctrl+S")
    await t.input.typeText("zz")
    expect(await t.frame()).not.toContain("zz")
    t.input.pressKey("r")
    frame = await t.frame()
    expect(frame).not.toContain(PROMPT)
    expect(frame).toContain("# A!")
    t.input.pressKey("s", { ctrl: true })
    await until(t, (f) => !f.includes("ctrl+s save"))
    expect(saved).toEqual(["# A!"])
    expect(draftOf("todo:notes:TH-1")).toBeUndefined()
  })

  test("without a draftKey the editor keeps no draft", async () => {
    await boot()
    const t = await session()
    overlay!.openEditor({ title: "Notes", initial: "# A", save: async () => ({ ok: true }) })
    await t.frame()
    await t.input.typeText("x")
    await sleep(60)
    t.input.pressKey("d", { meta: true })
    expect(await t.frame()).toContain("Discard changes?")
    t.input.pressKey("y")
    const frame = await until(t, (f) => !f.includes("ctrl+s save"))
    expect(statusLine(frame)).not.toContain("draft kept")
    expect(existsSync(draftsDir()) ? readdirSync(draftsDir()) : []).toEqual([])
  })
})
