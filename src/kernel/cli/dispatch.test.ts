import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { makeTestKernel, type TestKernel } from "../../../tests/helpers"
import { BusyError, currentContext, definePlugin, NotFoundError, Type, ValidationError, type PluginDef } from "../api"
import { runCli } from "./dispatch"

const widgets: PluginDef = definePlugin({
  id: "widgets",
  name: "Widgets",
  version: "1.2.0",
  apiVersion: 1,
  activate(ctx) {
    ctx.command({
      thing: "widget",
      verb: "add",
      summary: "add a widget",
      args: [{ name: "title", required: true }],
      flags: { due: { type: "date", description: "due date" }, size: { type: "number", description: "size" }, tags: { type: "list", description: "tags" } },
      run: async ({ args, flags }) => ({ json: { title: args.title, due: flags.due ?? null, size: flags.size ?? null, tags: flags.tags ?? null }, text: `added ${args.title}` }),
    })
    ctx.command({
      thing: "widget",
      verb: "delete",
      summary: "delete a widget",
      args: [{ name: "id", required: true }],
      destructive: true,
      run: async ({ args }) => ({ json: { deleted: args.id }, text: `deleted ${args.id}` }),
    })
    ctx.command({
      thing: "widget",
      verb: "fail",
      summary: "always not found",
      run: async () => {
        throw new NotFoundError('unknown person "ana"', { suggestions: ["anna"] })
      },
    })
    ctx.command({
      thing: "widget",
      verb: "busy",
      summary: "always busy",
      run: async () => {
        throw new BusyError("database is busy")
      },
    })
    ctx.command({
      thing: "widget",
      verb: "invalid",
      summary: "always invalid",
      run: async () => {
        throw new ValidationError("title is required", { field: "title", hint: "pass a title" })
      },
    })
    ctx.command({
      thing: "widget",
      verb: "crash",
      summary: "throws a plain error",
      run: async () => {
        throw new Error("UNIQUE constraint failed: widgets_widget.title")
      },
    })
    ctx.command({
      thing: "widget",
      verb: "origin",
      summary: "show the origin",
      run: async () => ({ json: { origin: currentContext().origin ?? null, today: currentContext().today }, text: "" }),
    })
    ctx.command({
      thing: "widget",
      verb: "echo",
      summary: "echo stdin",
      args: [{ name: "words", rest: true }],
      run: async ({ args, readStdin }) => ({ json: { words: args.words, stdin: await readStdin() }, text: "" }),
    })
    ctx.report({
      id: "widget-status",
      cliName: "status",
      title: "Widget status",
      describe: "the status of a widget",
      params: Type.Object({ project: Type.String(), since: Type.Optional(Type.String()) }),
    })
    ctx.reportSection("widget-status", {
      id: "one",
      order: 10,
      run: async (p: { project: string; since?: string }) => ({
        title: "Parameters",
        columns: ["project", "since"],
        rows: [{ project: p.project, since: p.since ?? null }],
        empty: "none",
      }),
    })
    ctx.guideSection({ title: "Widgets", markdown: "Use `pm widget add`." })
  },
})

let k: TestKernel
beforeEach(async () => {
  k = await makeTestKernel({ plugins: [widgets] })
})
afterEach(async () => {
  await k.cleanup()
})

async function cli(argv: string[], stdin = "") {
  let out = ""
  let err = ""
  const code = await runCli(argv, k, { out: (s) => void (out += s), err: (s) => void (err += s), stdin: async () => stdin })
  return { code, out, err }
}

describe("runCli: plugin commands", () => {
  test("a date flag is parsed against today, and --json prints only the json", async () => {
    const r = await cli(["widget", "add", "x", "--due", "fri", "--json"])
    expect(r).toEqual({ code: 0, out: expect.any(String), err: "" })
    expect(JSON.parse(r.out)).toEqual({ title: "x", due: "2026-11-20", size: null, tags: null })
  })

  test("without --json the text goes to stdout", async () => {
    expect(await cli(["widget", "add", "x"])).toEqual({ code: 0, out: "added x\n", err: "" })
  })

  test("number and list flags; global flags may come first", async () => {
    const r = await cli(["--json", "widget", "add", "x", "--size", "3", "--tags", "a, b,c"])
    expect(JSON.parse(r.out)).toEqual({ title: "x", due: null, size: 3, tags: ["a", "b", "c"] })
  })

  test("a destructive command needs --yes", async () => {
    const r = await cli(["widget", "delete", "1"])
    expect(r.code).toBe(1)
    expect(r.out).toBe("")
    expect(r.err).toContain("--yes")
    expect(r.err).toStartWith('error: "widget delete" is destructive; add --yes\n')
    expect(await cli(["widget", "delete", "1", "--yes"])).toEqual({ code: 0, out: "deleted 1\n", err: "" })
  })

  test("not found maps to exit 2 with the hint on stdout under --json", async () => {
    const r = await cli(["widget", "fail", "--json"])
    expect(r.code).toBe(2)
    expect(r.err).toBe("")
    expect(JSON.parse(r.out)).toEqual({ error: { code: "not_found", message: 'unknown person "ana"', hint: 'did you mean "anna"?' } })
  })

  test("not found without --json goes to stderr", async () => {
    expect(await cli(["widget", "fail"])).toEqual({ code: 2, out: "", err: 'error: unknown person "ana"\nhint: did you mean "anna"?\n' })
  })

  test("busy maps to exit 3", async () => {
    const r = await cli(["widget", "busy", "--json"])
    expect(r.code).toBe(3)
    expect(JSON.parse(r.out)).toEqual({ error: { code: "busy", message: "database is busy", hint: "another pm process is writing; try again" } })
  })

  test("a ValidationError carries its field", async () => {
    const r = await cli(["widget", "invalid", "--json"])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out)).toEqual({ error: { code: "validation", message: "title is required", hint: "pass a title", field: "title" } })
  })

  test("a non-PmError is exit 1, code internal, message kept, no stack", async () => {
    const r = await cli(["widget", "crash", "--json"])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.out)).toEqual({ error: { code: "internal", message: "UNIQUE constraint failed: widgets_widget.title", hint: null } })
    expect(await cli(["widget", "crash"])).toEqual({ code: 1, out: "", err: "error: UNIQUE constraint failed: widgets_widget.title\n" })
  })

  test("an unknown thing suggests the known things", async () => {
    const r = await cli(["widgt", "add"])
    expect(r.code).toBe(1)
    expect(r.err).toBe('error: unknown command "widgt"\nhint: did you mean "widget"?\n')
    const j = await cli(["widgt", "add", "--json"])
    expect(j.code).toBe(1)
    expect(JSON.parse(j.out)).toEqual({ error: { code: "validation", message: 'unknown command "widgt"', hint: 'did you mean "widget"?' } })
  })

  test("an unknown verb suggests the thing's verbs", async () => {
    const r = await cli(["widget", "addd"])
    expect(r.code).toBe(1)
    expect(r.err).toBe('error: unknown command "widget addd"\nhint: did you mean "widget add"?\n')
    expect((await cli(["widget", "zzzzzz"])).err).toBe('error: unknown command "widget zzzzzz"\nhint: run "pm widget --help" to list its commands\n')
  })

  test("a thing without a verb lists its verbs", async () => {
    const r = await cli(["widget"])
    expect(r.code).toBe(1)
    expect(r.err).toBe('error: "widget" needs a verb\nhint: one of: add, delete, fail, busy, invalid, crash, origin, echo\n')
  })

  test("an unknown flag, a missing value, a bad number, a bad date and a missing argument are validation errors", async () => {
    const errs = async (...argv: string[]) => {
      const r = await cli([...argv, "--json"])
      return { code: r.code, error: JSON.parse(r.out).error }
    }
    expect(await errs("widget", "add", "x", "--colour", "red")).toEqual({
      code: 1,
      error: { code: "validation", message: "unknown flag --colour", hint: 'run "pm widget add --help" for its flags', field: "colour" },
    })
    expect(await errs("widget", "add", "x", "--due")).toEqual({
      code: 1,
      error: { code: "validation", message: "--due needs a value", hint: null, field: "due" },
    })
    expect(await errs("widget", "add", "x", "--size", "big")).toEqual({
      code: 1,
      error: { code: "validation", message: '--size must be a number, not "big"', hint: null, field: "size" },
    })
    expect(await errs("widget", "add", "x", "--due", "2026-02-30")).toEqual({
      code: 1,
      error: { code: "validation", message: 'invalid date "2026-02-30"', hint: "use YYYY-MM-DD, today, tomorrow, +3d, +2w or mon…sun", field: "due" },
    })
    expect(await errs("widget", "add")).toEqual({
      code: 1,
      error: { code: "validation", message: "missing argument <title>", hint: "usage: pm widget add <title> [--due <date>] [--size <number>] [--tags <a,b>]", field: "title" },
    })
    expect(await errs("widget", "add", "x", "y")).toEqual({
      code: 1,
      error: { code: "validation", message: 'unexpected argument "y"', hint: "usage: pm widget add <title> [--due <date>] [--size <number>] [--tags <a,b>]" },
    })
    expect(await errs("widget", "add", "x", "--json=yes")).toEqual({
      code: 1,
      error: { code: "validation", message: "--json takes no value", hint: null, field: "json" },
    })
  })

  test("rest arguments and readStdin", async () => {
    const r = await cli(["widget", "echo", "a", "b", "--json"], "piped text")
    expect(JSON.parse(r.out)).toEqual({ words: ["a", "b"], stdin: "piped text" })
  })

  test("--from-inbox naming a registered record type must resolve; without a list command the hint is generic", async () => {
    const tickets = definePlugin({
      id: "tickets",
      name: "Tickets",
      version: "1.0.0",
      apiVersion: 1,
      activate(ctx) {
        ctx.recordType({ name: "ticket", prefix: "I-", resolve: async (r) => (r.trim() === "I-1" ? 1 : null), label: async () => "one", search: async () => [] })
      },
    })
    await k.cleanup()
    k = await makeTestKernel({ plugins: [widgets, tickets] })
    const r = await cli(["widget", "origin", "--from-inbox", "I-9", "--json"])
    expect(r.code).toBe(2)
    expect(JSON.parse(r.out)).toEqual({ error: { code: "not_found", message: '--from-inbox: no record "I-9"', hint: 'run "pm help"' } })
    expect(JSON.parse((await cli(["widget", "origin", "--from-inbox", "I-1", "--json"])).out).origin).toEqual({ type: "inbox", ref: "I-1" })
  })

  test("--from-inbox I-2 sets the origin seen inside run", async () => {
    // An origin needs a plugin that owns the I- prefix (else: "needs the inbox plugin"); this one has every ref.
    const items = definePlugin({
      id: "items",
      name: "Items",
      version: "1.0.0",
      apiVersion: 1,
      activate(ctx) {
        ctx.recordType({ name: "item", prefix: "I-", resolve: async () => 1, label: async () => "one", search: async () => [] })
      },
    })
    await k.cleanup()
    k = await makeTestKernel({ plugins: [widgets, items] })
    expect(JSON.parse((await cli(["widget", "origin", "--from-inbox", "I-2", "--json"])).out)).toEqual({
      origin: { type: "inbox", ref: "I-2" },
      today: "2026-11-13",
    })
    expect(JSON.parse((await cli(["widget", "origin", "--from-inbox", "i-7", "--json"])).out).origin).toEqual({ type: "inbox", ref: "I-7" })
    expect(JSON.parse((await cli(["widget", "origin", "--json"])).out).origin).toBeNull()
    const bad = await cli(["widget", "origin", "--from-inbox", "A-2", "--json"])
    expect(bad.code).toBe(1)
    expect(JSON.parse(bad.out)).toEqual({
      error: { code: "validation", message: 'invalid --from-inbox "A-2"', hint: "use an inbox item id, e.g. I-12", field: "from-inbox" },
    })
  })

  test("--db is accepted (it is applied before boot)", async () => {
    expect((await cli(["widget", "add", "x", "--db", join(k.home, "ttybrain.db")])).code).toBe(0)
  })
})

describe("runCli: help", () => {
  test("pm help lists every command with its flags, the kernel commands and the global flags", async () => {
    const r = await cli(["help"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("  widget add <title>")
    expect(r.out).toContain("--due <date>")
    expect(r.out).toContain("  widget delete <id>")
    expect(r.out).toContain("(destructive; needs --yes)")
    for (const c of ["help", "guide", "plugin list", "report status <project>"]) expect(r.out).toContain(`  ${c}`)
    for (const f of ["--json", "--db <path>", "--from-inbox <I-n>", "--yes", "--help"]) expect(r.out).toContain(f)
    expect(await cli([])).toEqual(r)
  })

  test("pm help --json is structured", async () => {
    const r = await cli(["help", "--json"])
    const add = JSON.parse(r.out).commands.find((c: { command: string }) => c.command === "widget add")
    expect(add).toEqual({
      command: "widget add",
      usage: "pm widget add <title> [--due <date>] [--size <number>] [--tags <a,b>]",
      summary: "add a widget",
      destructive: false,
      args: [{ name: "title", required: true, rest: false }],
      flags: [
        { name: "due", type: "date", description: "due date", required: false },
        { name: "size", type: "number", description: "size", required: false },
        { name: "tags", type: "list", description: "tags", required: false },
      ],
    })
  })

  test("pm <thing> --help lists that thing's verbs; pm <thing> <verb> --help one command", async () => {
    const t = await cli(["widget", "--help"])
    expect(t.code).toBe(0)
    expect(t.out).toContain("  widget add <title>")
    expect(t.out).toContain("  widget echo [words...]")
    expect(t.out).not.toContain("plugin list")
    const c = await cli(["widget", "add", "--help"])
    expect(c.code).toBe(0)
    expect(c.out).toStartWith("usage: pm widget add <title> [--due <date>] [--size <number>] [--tags <a,b>]\n\nadd a widget\n")
    expect(c.out).toContain("  --due <date>")
    expect(c.out).not.toContain("widget delete")
    expect(await cli(["help", "widget", "add"])).toEqual(c)
    expect((await cli(["report", "status", "--help"])).out).toStartWith("usage: pm report status <project> [--since <value>] [--format <md|text|json>]\n")
  })
})

describe("runCli: kernel commands", () => {
  test("plugin list", async () => {
    const r = await cli(["plugin", "list", "--json"])
    expect(JSON.parse(r.out)).toEqual([{ id: "widgets", version: "1.2.0", source: "built-in", status: "ok", error: null }])
    const t = await cli(["plugin", "list"])
    expect(t.out).toBe("id       version  source    status  error\nwidgets  1.2.0    built-in  ok\n")
  })

  test("guide prints the markdown, and --write writes it to a file", async () => {
    const r = await cli(["guide"])
    expect(r.code).toBe(0)
    expect(r.out).toStartWith("# pm: guide for agents\n")
    expect(r.out).toContain("## Widgets\n\nUse `pm widget add`.")
    const path = join(k.home, "out", "guide.md")
    const w = await cli(["guide", "--write", path, "--json"])
    expect(JSON.parse(w.out)).toEqual({ path })
    expect(readFileSync(path, "utf8")).toBe(r.out)
    expect(await cli(["guide", "--write", path])).toEqual({ code: 0, out: `wrote ${path}\n`, err: "" })
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse((await cli(["guide", "--json"])).out)).toEqual({ markdown: r.out })
  })

  test("report: a required param is positional, an optional one a flag; md by default", async () => {
    const r = await cli(["report", "status", "CRM"])
    expect(r).toEqual({ code: 0, out: "# Widget status\n\n## Parameters\n\n| project | since |\n| --- | --- |\n| CRM |  |\n", err: "" })
    const t = await cli(["report", "status", "CRM", "--since", "2026-10-01", "--format", "text"])
    expect(t.out).toBe("Widget status\n\nParameters\nproject  since\nCRM      2026-10-01\n")
    const j = await cli(["report", "status", "CRM", "--json"])
    expect(JSON.parse(j.out)).toEqual({
      title: "Widget status",
      sections: [{ title: "Parameters", columns: ["project", "since"], rows: [{ project: "CRM", since: null }], empty: "none" }],
    })
    const f = await cli(["report", "status", "CRM", "--format", "json"])
    expect(JSON.parse(f.out)).toEqual(JSON.parse(j.out))
  })

  test("report errors: a missing param, a bad format, an unknown report", async () => {
    const missing = await cli(["report", "status", "--json"])
    expect(missing.code).toBe(1)
    expect(JSON.parse(missing.out).error).toMatchObject({ code: "validation", message: "missing argument <project>", field: "project" })
    const fmt = await cli(["report", "status", "CRM", "--format", "pdf", "--json"])
    expect(JSON.parse(fmt.out)).toEqual({ error: { code: "validation", message: 'invalid --format "pdf"', hint: "use md, text or json", field: "format" } })
    const unknown = await cli(["report", "stats"])
    expect(unknown).toEqual({ code: 1, out: "", err: 'error: unknown command "report stats"\nhint: did you mean "report status"?\n' })
  })
})
