// Forms, the overlay stack (useOverlay: open, openForm, confirm) and nav.open's form path, against a fixture
// plugin `todo` (table `thing`, record type `thing` with prefix `TH-`, write op `addThing`).
import { afterEach, describe, expect, test } from "bun:test"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { renderTui, type RenderedTui } from "../../../tests/tui"
import { builtinPlugins } from "../../../tests/builtins"
import { currentContext, definePlugin, NonBlank, parseDate, Type, type PluginDef } from "../api"
import { fixedClock } from "../clock"
import { runWithContext } from "../context"
import { bootKernel, type Kernel } from "../host"
import { Form } from "./components/Form"
import { act, useQuery, useRuntime } from "./data"
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
        .addColumn("due", "text")
        .addColumn("created_at", "text", (c) => c.notNull())
        .addColumn("updated_at", "text", (c) => c.notNull())
        .execute()
    })
    ctx.recordType({
      name: "thing",
      prefix: "TH-",
      resolve: async (ref) => {
        const m = /^(?:TH-)?(\d+)$/i.exec(ref)
        if (!m) return null
        const row = await ctx.data.selectFrom("thing").select("id").where("id", "=", Number(m[1])).executeTakeFirst()
        return row ? Number(row.id) : null
      },
      label: async (id) => String((await ctx.data.selectFrom("thing").select("title").where("id", "=", id).executeTakeFirstOrThrow()).title),
      search: async () => [],
    })
    ctx.expose({
      write: {
        addThing: {
          input: Type.Object({ title: NonBlank(), due: Type.Optional(Type.String()) }),
          output: Type.Object({ ref: Type.String(), title: Type.String(), due: Type.Union([Type.String(), Type.Null()]) }),
          describe: (i) => `+ thing "${i.title}"`,
          run: async (i) => {
            const due = i.due === undefined ? null : parseDate(i.due, currentContext().today)
            const now = ctx.clock.now()
            const r = await ctx.data.insertInto("thing").values({ title: i.title.trim(), due, created_at: now, updated_at: now }).executeTakeFirstOrThrow()
            return { ref: `TH-${r.insertId}`, title: i.title.trim(), due }
          },
        },
      },
    })
  },
})

function ThingForm(props: RecordFormProps) {
  const rt = useRuntime()
  return (
    <Form
      title={props.recordRef ? `Edit ${props.recordRef}` : "New thing"}
      fields={[
        { name: "title", label: "Title", kind: "text", required: true },
        { name: "due", label: "Due", kind: "date" },
      ]}
      submit={async (v) => {
        const r = await act(() => rt.self().write.addThing!({ title: v.title ?? "", ...(v.due ? { due: v.due } : {}) }), {
          ok: (out: any) => `added ${out.ref}`,
        })
        return r.ok ? { ok: true, ref: (r.value as { ref: string }).ref } : r
      }}
      close={props.close}
    />
  )
}

let submitted: Array<Record<string, string | null>> = []
function AssignForm(props: RecordFormProps) {
  return (
    <Form
      title="Assign"
      fields={[
        { name: "owner", label: "Owner", kind: "record", recordType: "person" },
        { name: "size", label: "Size", kind: "enum", values: ["small", "medium", "large"], required: true },
      ]}
      submit={async (v) => {
        submitted.push(v)
        return { ok: true }
      }}
      close={props.close}
    />
  )
}

function NotesForm(props: RecordFormProps) {
  return (
    <Form
      title="Notes"
      fields={[
        { name: "notes", label: "Notes", kind: "longtext", initial: "line one\nline two" },
        { name: "title", label: "Title", kind: "text" },
      ]}
      submit={async (v) => {
        submitted.push(v)
        return { ok: true }
      }}
      close={props.close}
    />
  )
}

// A submit that fails with a plain error, naming the field to show it under.
function OwnerErrorForm(props: RecordFormProps) {
  return (
    <Form
      title="Owner check"
      fields={[
        { name: "owner", label: "Owner", kind: "text" },
        { name: "title", label: "Title", kind: "text" },
      ]}
      submit={async () => ({ ok: false, error: new Error('unknown person "zorro"'), field: "owner" })}
      close={props.close}
    />
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
    ui.recordForm("thing", { id: "assign", label: "Assign", component: AssignForm })
    ui.recordForm("thing", { id: "notes", label: "Notes", component: NotesForm })
    ui.recordForm("thing", { id: "owner-error", label: "Owner check", component: OwnerErrorForm })
  },
})

let kernel: TestKernel
let tui: RenderedTui | undefined
let others: Kernel[] = []
afterEach(async () => {
  tui?.destroy()
  tui = undefined
  overlay = undefined
  submitted = []
  for (const k of others) await k.shutdown()
  others = []
  await kernel.cleanup()
})

async function open(plugins: PluginDef[] = [todoPlugin]): Promise<RenderedTui> {
  kernel = await makeTestKernel({ plugins })
  tui = await renderTui(kernel, { parts: [todoPart] })
  tui.input.pressKey("2")
  expect(await tui.frame()).toContain("todo screen")
  return tui
}

const things = async () =>
  runWithContext(kernel.context(), () => kernel.runtime("todo")!.data.selectFrom("thing").select(["title", "due"]).orderBy("id").execute())

const lineWith = (frame: string, s: string) => frame.split("\n").find((l) => l.includes(s)) ?? ""
const statusLine = (frame: string) => frame.trimEnd().split("\n").at(-1)!

describe("forms", () => {
  test("submit creates record and closes", async () => {
    const t = await open()
    overlay!.openForm("thing")
    expect(await t.frame()).toContain("New thing")
    await t.input.typeText("Write spec")
    t.input.pressTab()
    await t.input.typeText("+2d")
    const frame = await t.frame()
    expect(lineWith(frame, "Due")).toContain("→ 2026-11-15")
    t.input.pressKey("s", { ctrl: true })
    const after = await t.frame()
    expect(await things()).toEqual([{ title: "Write spec", due: "2026-11-15" }])
    expect(after).not.toContain("New thing")
    expect(statusLine(after)).toContain("added TH-1")
  })

  test("longtext keeps newlines through an edit and submit; Enter adds a line", async () => {
    const t = await open()
    void overlay!.openForm("thing", "notes")
    let frame = await t.frame()
    expect(frame).toContain("line one")
    expect(frame).toContain("line two")
    await t.input.typeText(" end")
    t.input.pressEnter()
    await t.input.typeText("three")
    frame = await t.frame()
    expect(frame).toContain("three")
    t.input.pressTab()
    await t.input.typeText("T")
    t.input.pressKey("s", { ctrl: true })
    await t.frame()
    expect(submitted).toEqual([{ notes: "line one\nline two end\nthree", title: "T" }])
  })

  test("Enter in a one-line field does nothing", async () => {
    const t = await open()
    overlay!.openForm("thing")
    await t.frame()
    await t.input.typeText("Keep")
    t.input.pressEnter()
    let frame = await t.frame()
    expect(frame).toContain("New thing")
    expect(lineWith(frame, "Title")).toContain("›")
    expect(lineWith(frame, "Due")).not.toContain("›")
    t.input.pressTab()
    t.input.pressEnter() // last field: still nothing (no save)
    frame = await t.frame()
    expect(frame).toContain("New thing")
    expect(lineWith(frame, "Due")).toContain("›")
    expect(await things()).toEqual([])
  })

  test("Shift+Tab moves back a field", async () => {
    const t = await open()
    overlay!.openForm("thing")
    await t.frame()
    t.input.pressTab()
    expect(lineWith(await t.frame(), "Due")).toContain("›")
    t.input.pressTab({ shift: true })
    expect(lineWith(await t.frame(), "Title")).toContain("›")
  })

  test("date field shows invalid date", async () => {
    const t = await open()
    overlay!.openForm("thing")
    await t.frame()
    t.input.pressTab()
    await t.input.typeText("someday")
    expect(lineWith(await t.frame(), "Due")).toContain("invalid date")
  })

  test("validation error shows under field", async () => {
    const t = await open()
    overlay!.openForm("thing")
    await t.frame()
    t.input.pressTab()
    await t.input.typeText("+2d")
    t.input.pressKey("s", { ctrl: true })
    const frame = await t.frame()
    const lines = frame.split("\n")
    const title = lines.findIndex((l) => l.includes("Title"))
    expect(lines[title + 1]).toContain("✗ title must not be blank")
    expect(frame).toContain("New thing")
    expect(lineWith(frame, "Due")).toContain("+2d")
    expect(await things()).toEqual([])
  })

  test("a failed submit that names a field shows its error under that field", async () => {
    const t = await open()
    overlay!.openForm("thing", "owner-error")
    await t.frame()
    t.input.pressKey("s", { ctrl: true })
    const frame = await t.frame()
    const lines = frame.split("\n")
    const owner = lines.findIndex((l) => l.includes("Owner") && !l.includes("Owner check"))
    expect(lines[owner + 1]).toContain('✗ unknown person "zorro"')
    expect(frame).toContain("Owner check")
  })

  test("typing q in a field does not quit", async () => {
    const t = await open()
    overlay!.openForm("thing")
    await t.frame()
    await t.input.typeText("q2g?")
    const frame = await t.frame()
    expect(t.renderer.isDestroyed).toBe(false)
    expect(frame).toContain("New thing")
    expect(lineWith(frame, "Title")).toContain("q2g?")
    expect(frame.split("\n")[0]).toContain("pm · 2 Todo ▾")
  })

  test("Esc cancels without saving", async () => {
    const t = await open()
    overlay!.openForm("thing")
    await t.frame()
    await t.input.typeText("Nope")
    t.input.pressEscape()
    await sleep(30) // a lone ESC is flushed by the input parser's timeout
    expect(await t.frame()).toContain("New thing") // still waiting for a possible `s`
    await sleep(1100)
    const frame = await t.frame()
    expect(frame).not.toContain("New thing")
    expect(frame).toContain("todo screen")
    expect(await things()).toEqual([])
  })

  test("Esc then Ctrl+S or Alt+S saves instead of cancelling", async () => {
    const t = await open()
    for (const mod of [{ ctrl: true }, { meta: true }]) {
      overlay!.openForm("thing")
      expect(await t.frame()).toContain("New thing")
      await t.input.typeText(mod.ctrl ? "Via esc ctrl-s" : "Via esc alt-s")
      t.input.pressEscape()
      await sleep(30) // a separate Esc, not an Alt prefix
      t.input.pressKey("s", mod)
      await t.settle()
      expect(await t.frame()).not.toContain("New thing")
    }
    expect(await things()).toEqual([
      { title: "Via esc ctrl-s", due: null },
      { title: "Via esc alt-s", due: null },
    ])
  })

  test("Esc then s submits", async () => {
    const t = await open()
    overlay!.openForm("thing")
    await t.frame()
    await t.input.typeText("Via esc s")
    t.input.pressEscape()
    await sleep(30)
    t.input.pressKey("s")
    const frame = await t.frame()
    expect(frame).not.toContain("New thing")
    expect(await things()).toEqual([{ title: "Via esc s", due: null }])
  })

  test("record field autocompletes people", async () => {
    const t = await open([...builtinPlugins, todoPlugin])
    await runWithContext(kernel.context(), () => kernel.runtime("people")!.self().write.addPerson!({ name: "Anna Peeters", handle: "anna" }))
    await runWithContext(kernel.context(), () => kernel.runtime("people")!.self().write.addPerson!({ name: "Bob Stone", handle: "bob" }))
    overlay!.openForm("thing", "assign")
    expect(await t.frame()).toContain("Assign")
    await t.input.typeText("an")
    let frame = await t.frame()
    expect(frame).toContain("@anna Anna Peeters")
    expect(frame).not.toContain("@bob Bob Stone")
    t.input.pressTab()
    frame = await t.frame()
    expect(frame).not.toContain("@anna Anna Peeters")
    expect(lineWith(frame, "Owner")).toContain("@anna")
    // Tab without suggestions moves on; ←→ cycle the enum.
    t.input.pressTab()
    t.input.pressArrow("right")
    t.input.pressArrow("right")
    expect(lineWith(await t.frame(), "Size")).toContain("large")
    t.input.pressKey("s", { ctrl: true })
    await t.frame()
    expect(submitted).toEqual([{ owner: "@anna", size: "large" }])
  })

  test(
    "busy save keeps the form and retries",
    async () => {
      const t = await open()
      const b = await bootKernel({ env: { PM_HOME: kernel.home, PM_TEST: "1" }, plugins: [todoPlugin], clock: fixedClock("2026-11-13") })
      others.push(b)
      overlay!.openForm("thing")
      await t.frame()
      await t.input.typeText("Busy one")
      b.db.raw.exec("BEGIN IMMEDIATE")
      setTimeout(() => b.db.raw.exec("ROLLBACK"), 1500)
      t.input.pressKey("s", { ctrl: true })
      let seen = false
      for (let i = 0; i < 100 && !seen; i++) {
        await sleep(50)
        const frame = await t.peek()
        seen = statusLine(frame).includes("database busy, retrying")
        if (seen) {
          expect(frame).toContain("New thing")
          expect(lineWith(frame, "Title")).toContain("Busy one")
        }
      }
      expect(seen).toBe(true)
      t.input.pressKey("s", { ctrl: true }) // a second save while one is in flight is ignored
      const frame = await t.frame()
      expect(frame).not.toContain("New thing")
      expect(await things()).toEqual([{ title: "Busy one", due: null }])
    },
    15_000,
  )

  test(
    "Esc while a busy save retries does not cancel",
    async () => {
      const t = await open()
      const b = await bootKernel({ env: { PM_HOME: kernel.home, PM_TEST: "1" }, plugins: [todoPlugin], clock: fixedClock("2026-11-13") })
      others.push(b)
      const saved = overlay!.openForm("thing")
      await t.frame()
      await t.input.typeText("Not cancelled")
      b.db.raw.exec("BEGIN IMMEDIATE")
      t.input.pressKey("s", { ctrl: true })
      let seen = false
      for (let i = 0; i < 100 && !seen; i++) {
        await sleep(50)
        seen = statusLine(await t.peek()).includes("database busy, retrying")
      }
      expect(seen).toBe(true)
      t.input.pressEscape()
      await sleep(1100) // past the Esc window: a cancel would have closed the form by now
      const during = await t.peek()
      expect(during).toContain("New thing")
      expect(during).toContain("saving…")
      // Each attempt blocks for busy_timeout (3 s), so the lock is released by hand once the Esc window has passed.
      b.db.raw.exec("ROLLBACK")
      expect(await saved).toBe("TH-1")
      const frame = await t.frame()
      expect(frame).not.toContain("New thing")
      expect(await things()).toEqual([{ title: "Not cancelled", due: null }])
    },
    15_000,
  )

  test("openForm resolves with the saved ref, undefined on cancel", async () => {
    const t = await open()
    const saved = overlay!.openForm("thing")
    await t.frame()
    await t.input.typeText("Saved")
    t.input.pressKey("s", { ctrl: true })
    expect(await saved).toBe("TH-1")
    const cancelled = overlay!.openForm("thing")
    await t.frame()
    t.input.pressEscape()
    expect(await cancelled).toBeUndefined()
    expect(await overlay!.openForm("thing", "missing")).toBeUndefined()
    expect(statusLine(await t.frame())).toContain('no form "missing" for thing')
  })

  test("an overlay opened from a plugin screen runs in that plugin's scope", async () => {
    const t = await open()
    await runWithContext(kernel.context(), () => kernel.runtime("todo")!.self().write.addThing!({ title: "Existing" }))
    function Inner() {
      const rt = useRuntime()
      const q = useQuery(() => rt.data.selectFrom("thing").select("title").execute())
      return <text>{`overlay rows: ${(q.data() ?? []).map((r: { title: string }) => r.title).join(",")}`}</text>
    }
    const close = overlay!.open(() => <Inner />)
    expect(await t.frame()).toContain("overlay rows: Existing")
    close()
    expect(await t.frame()).not.toContain("overlay rows")
  })

  test("a throwing overlay shows its error in place and Esc closes it", async () => {
    const t = await open()
    function Broken(): any {
      throw new Error("boom")
    }
    overlay!.open(() => <Broken />)
    expect(await t.frame()).toContain("⚠ todo: boom")
    t.input.pressEscape()
    await sleep(30)
    const frame = await t.frame()
    expect(frame).not.toContain("⚠ todo: boom")
    expect(frame).toContain("todo screen")
  })

  test("confirm resolves on y only", async () => {
    const t = await open()
    const answers: boolean[] = []
    overlay!.confirm("Delete TH-1?").then((a) => answers.push(a))
    expect(await t.frame()).toContain("Delete TH-1?  y yes · n no")
    t.input.pressKey("x")
    t.input.pressKey("q")
    await t.frame()
    expect(answers).toEqual([])
    expect(t.renderer.isDestroyed).toBe(false)
    t.input.pressKey("n")
    await sleep(10)
    expect(answers).toEqual([false])
    expect(await t.frame()).not.toContain("Delete TH-1?")
    overlay!.confirm("Delete TH-1?").then((a) => answers.push(a))
    expect(await t.frame()).toContain("Delete TH-1?")
    t.input.pressKey("y")
    await sleep(10)
    expect(answers).toEqual([false, true])
    expect(await t.frame()).not.toContain("Delete TH-1?")
  })

  test("confirm, openForm and openEditor refuse to wait for the user inside act (the write lock would stay held)", async () => {
    const t = await open()
    const waits: Array<[string, () => unknown]> = [
      ["confirm", () => overlay!.confirm("Sure?")],
      ["openForm", () => overlay!.openForm("thing")],
      ["openEditor", () => overlay!.openEditor({ title: "Notes", initial: "", save: async () => ({ ok: true }) })],
    ]
    for (const [name, wait] of waits) {
      const res = await act(async () => {
        await wait()
        return { ref: "TH-0" }
      })
      expect(res.ok).toBe(false)
      expect(res.ok ? "" : (res.error as Error).message).toBe(`${name}() waits for the user: call it before act(), not inside it`)
    }
    const frame = await t.frame()
    expect(frame).not.toContain("Sure?")
    expect(frame).not.toContain("New thing")
    // the lock was released: a write right after succeeds
    expect((await act(() => kernel.runtime("todo")!.self().write.addThing!({ title: "After" }))).ok).toBe(true)
  })

  test("nav.open on a type with forms but no tabs opens its first form with the ref", async () => {
    const t = await open()
    await runWithContext(kernel.context(), () => kernel.runtime("todo")!.self().write.addThing!({ title: "Existing" }))
    await t.nav.open("TH-1")
    const frame = await t.frame()
    expect(frame).toContain("Edit TH-1")
    expect(frame).not.toContain("Assign")
  })

  test("open returns a close function", async () => {
    const t = await open()
    const close = overlay!.open(() => <text>plain overlay</text>)
    expect(await t.frame()).toContain("plain overlay")
    close()
    expect(await t.frame()).not.toContain("plain overlay")
  })
})
