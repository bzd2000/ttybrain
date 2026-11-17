# pm phase 2: TUI kernel and the projects UI. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are `pm-developer`, reviewers `pm-reviewer` (`.claude/agents/`).

**Goal:** typing `pm` with no arguments in your own terminal opens the terminal UI. It covers:
- the frame: header, screen switcher and status bar;
- the screens Overview, Projects with project detail (all eight tabs, Context included), Actions and Inbox;
- forms, a long-text editor, quick capture from any screen, and live refresh when the CLI changes data.

All of it is built on TUI extension points that external plugins will use in phase 5.

**Architecture:**
- A TUI kernel in `src/kernel/tui/` owns the frame, navigation, keys, forms, live refresh and the registries for the UI extension points. Each plugin's optional `tui/` part registers screens, record tabs, panels, forms, global actions and badges through a `TuiContext`.
- The TUI part reads through the same scoped `data`, views and read operations as its logic part (a `PluginRuntime`), and writes only through its exposed write operations.
- The CLI path never imports the TUI. `src/bin/pm.ts` loads it with a dynamic `import()` only when there are no arguments and stdout is a TTY.

**Tech Stack:**
- Runtimes: Bun ≥ 1.3.14 (CI runs 1.4.4) and Node ≥ 26.4 (`--experimental-ffi` for the TUI);
- UI: OpenTUI 0.8.4 (`@opentui/core` and `@opentui/solid`) with Solid 1.9;
- data: Kysely 0.28.18 and TypeBox 1.4.3;
- tests: `bun test`, with `testRender` for the TUI.

**Spec:**
- `docs/superpowers/specs/2026-11-13-pm-design.md` ("spec"): §3.1, §3.4, §5, §9 and §10, plus §11.2 for the spike;
- `docs/superpowers/specs/2026-11-13-pm-plugins.md` ("plugin reference"): the "UI and other contributions" tables;
- `docs/superpowers/specs/2026-11-13-pm-screens.html` (the mockups; where they differ, the spec wins);
- `docs/architecture.md`, the rules every task follows;
- `docs/superpowers/plans/2026-11-13-pm-phase1-followups.md`, which holds the "Before phase 2" items.

## Global Constraints

- **Runtimes.** Both runtimes always. Only `src/kernel/db/sqlite.ts` uses runtime-specific APIs. Relative imports stay extensionless.
- **UI imports.** Only files under `src/kernel/tui/` and `src/plugins/*/tui/` may import `solid-js`, `@opentui/*` or `src/kernel/tui/*`. Logic (`src/plugins/*/logic/`) and the rest of `src/kernel/` must not, and Task 2's test enforces it.
- **TUI data access.** TUI code reads only through `ui.data` (its own tables and published views) and `ui.self().read` / `ui.use(x).read`. It writes only through `ui.self().write.*` or `ui.use(x).write.*`, for `x` in `requires`. It never imports another plugin's files.
- **Context.** All TUI loads and actions run inside an operation context (`runWithContext(kernel.context(origin?))`), through `useQuery` and `act` (Task 5). No `new Date()` or `Date.now()` in TUI or logic code. Timers (refresh interval, message timeout) may use `setTimeout`/`setInterval`.
- **Theme.** All colours live in `src/kernel/tui/theme.ts`, which adds the semantic `red`, `amber` and `green` and an `accent` for the focused border (spec §9).
- **Frame** (spec §9):
  - the header is `pm · <n> <Screen> ▾`, then breadcrumbs, then on the right the badges and the date as `Fri 13 Nov 2026`;
  - the status bar shows the keys valid right now;
  - the focused panel has the accent border.
- **Global keys** (spec §9 table):

  | Keys | Action |
  |---|---|
  | `↑↓` / `j k` | move |
  | `Enter` | open |
  | `Esc` | back |
  | `Tab` | next panel |
  | `←→` | tabs |
  | `1`–`9` | screens |
  | `g` | switcher |
  | `n` | new |
  | `e` | edit |
  | `x` | done or close |
  | `Del` | delete, with an in-TUI confirmation |
  | `/` | filter |
  | `i` | capture |
  | `?` | help |
  | `q` | quit |

  `c` (assistant) stays unclaimed until phase 7. **While a text field has focus, single-letter shortcuts are off.**
- **Screen slots.** Built-in screens take fixed number slots: Overview `1` (kernel), Projects `2`, People `3` (phase 3), Actions `4`, Meetings `5` (phase 4), Inbox `6`. External screens get `7`, `8`, … in load order. An empty slot's key does nothing.
- **Errors** (spec §10):
  - typed errors appear inline in forms (`ValidationError.field`), otherwise as a status-bar message for 5 seconds;
  - a throwing screen, tab or panel shows its error in place (error boundary) and never crashes the app;
  - a `BusyError` shows `database busy, retrying`.
- **Live refresh.** About every 1000 ms, check `PRAGMA data_version`. It also reloads after the TUI's own writes (`record.changed`). Selection stays on the same `ref` when that row still exists.
- **Dates** in the TUI use the same parsing as the CLI (`parseDate`). Display: `Fri` for dates within this week, `13 Nov` otherwise, `-3d` for days overdue, ISO in forms.
- **Tests.**
  - TUI tests use `renderTui` (Task 4) on `makeTestKernel` with the fixed clock **2026-11-13 (a Friday; `weekEnd` = 2026-11-15)**.
  - Assert on `captureCharFrame()` text and on database state, never only "no error".
  - Always destroy the renderer in `finally`.
- **Node.** `bash scripts/smoke-node.sh` must end with `smoke ok`. From Task 4 on it also prints `tui ok` (a frame rendered on Node).
- **Commits.** Each task ends with one commit using the message given, followed by the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A CLI write while the TUI is open** (Copilot running `pm action done A-3`). The current screen reloads within about 1 s and keeps the selection on the same ref. If that row is gone, the selection moves to the row now at the same index. Owner: Task 5, test `keeps selection by ref across reloads`, plus Task 12 `CLI done removes the row and selection moves to the next`.
2. **Typing in a text field.** Typing `q`, `i`, `n`, `g`, `1`–`6` or `?` into a form, the capture overlay or the editor inserts the characters and triggers nothing global. `Esc` closes the overlay, not the app. Owner: Task 4 `text field disables single-letter keys`, Task 14 `typing q and 2 in capture inserts them`.
3. **A small or resized terminal.** At 80×24 every screen renders without throwing. Columns truncate with `…` by display width, wide characters and emoji included. Below 60×15 the main area shows `Terminal too small (need 60×15)`. Owner: Task 6 `Table truncates by display width`, Task 9 `Projects renders at 80x24 with a long CJK name`, Task 4 `too small message`.
4. **A first run on an empty database.** Every screen and tab shows its empty-state text instead of an error. Overview shows each panel's `empty` text. Context shows `No context yet. Press e to write it, or let your MCP integration fill it in.` Owner: Task 13 `empty overview`, Task 10 `empty context`, Task 9 `empty projects`.
5. **The database is locked while a form saves.** The form stays open with its input kept and the status bar shows `database busy, retrying`. Once the lock is released, saving succeeds. No duplicate record is created. Owner: Task 7 `busy save keeps the form and retries`.

---

## File structure

```
src/kernel/
  plugin.ts            + PluginRuntime (read/write side of a context, no registrations)
  host.ts              + kernel.runtime(id), kernel.tuiErrors; read-only boot (Task 1)
  db/kernel-db.ts      + dataVersion()
  views.ts, migrations.ts   only write when something changed (Task 1)
  tags.ts              + types(), suggest()
  tui/                 the TUI kernel (may import solid-js / @opentui/*)
    types.ts           TuiDef, TuiContext, the extension-point defs, Route, Tone
    registry.ts        TuiRegistry: registration rules, slots, key claims, sealing, removal
    boot.ts            bootTui(kernel, parts): activation, failure isolation
    api.ts             the future `@pm/api/tui`: defineTui + building blocks + hooks + theme
    theme.ts           colours (moved from src/theme.ts) + red/amber/green/accent
    run.tsx            runTui(kernel, parts): render(), shutdown wiring
    app.tsx            <TuiApp>: frame, router, overlays
    frame.tsx          Header, StatusBar
    nav.ts             navigation store (route stack, breadcrumbs)
    keys.ts            global key dispatch, text-focus guard, KeyHints registry
    data.ts            useQuery, act, runtime context provider
    refresh.ts         createLiveRefresh
    messages.ts        status-bar messages (5 s)
    format.ts          date display, display-width truncation
    components/        Panel, Table, Tabs, KeyHints, ErrorBoundary, Form, Field, Confirm,
                       Editor, Switcher, Help, RecordView, OverviewScreen, Menu
src/plugins/
  tui.ts               builtinTuiParts (imported only by the TUI entry)
  projects/tui/        index.tsx, projects-screen.tsx, project-*.tsx tabs, actions-screen.tsx,
                       forms.tsx, panels.ts
  projects/logic/overview.ts   overview data shared by the report and the panels (Task 13)
  people/tui/index.tsx   only the "Stakeholders to contact" panel (rest is phase 3)
  inbox/tui/           index.tsx, capture.tsx, inbox-screen.tsx, process.tsx
tests/
  tui.tsx              renderTui helper
  logic-ui-split.test.ts
  fixtures/tui-fixture.ts   a fixture plugin for registry, listColumn and field tests
docs/superpowers/spikes/2026-11-16-web-terminal.md   Task 3's findings
```

Removed in Task 4: `src/App.tsx`, `src/App.test.tsx`, `src/index.tsx`, `src/sections.tsx`, `src/theme.ts` and `src/components/`.

---

### Task 1: Read-only boot (I4/R20) and after-commit emit

Today every boot takes the write lock: `ensureKernelTables`, and `views.createAll`, which drops and recreates every view. Read-only commands therefore fail while another process writes, and every CLI call bumps `data_version` for the TUI.

**Files:**
- Modify: `src/kernel/migrations.ts` (`ensureKernelTables`)
- Modify: `src/kernel/views.ts` (`createAll`, `create`)
- Modify: `src/kernel/host.ts` (`emit` in the context)
- Test: `src/kernel/readonly-boot.test.ts`

**Interfaces:**
- Produces: `KernelDb.dataVersion(): number` (`PRAGMA data_version`, first column). Tasks 2 and 5 use it.
- Produces: boot opens no write transaction when the kernel tables exist, no migration is pending and every view's stored SQL equals its compiled SQL.

- [ ] **Step 1: Write the failing tests** in `src/kernel/readonly-boot.test.ts`. Use the built-in plugins and two kernels on the same `PM_HOME` (two connections). Kernel B gets `{ env: { PM_HOME: a.home, PM_TEST: "1" } }` through `bootKernel`.
  - `second boot does not write`: boot A, then read `a.db.dataVersion()`, boot B, read it again. Assert it is unchanged (another connection's commit would change it).
  - `help works while another connection holds the write lock`: A runs `a.db.raw.exec("BEGIN IMMEDIATE")`. Then `bootKernel` B and `runCli(["help"], b, io)` resolve with exit `0` in under 1000 ms (no `busy_timeout` wait). Run `ROLLBACK` in `finally`.
  - `project list works while locked`: same setup, with `runCli(["project", "list", "--json"], b, io)` → exit `0`.
  - `changed view definition is recreated`: boot a fixture plugin (in the test) publishing view `v` with columns `{ a: "integer" }`. Reboot with the query changed to select a different literal. `SELECT * FROM fixture__pub_v` returns the new value.
  - `stale view is dropped`: a second boot without that view → no `fixture__pub_v` in `sqlite_schema`.
  - `emit inside a write fires after commit`: a fixture write op calls `ctx.emit("x.done", 1)`, and a handler records `kernel.db.inWrite()`. The handler sees `false`. A write that throws after `emit` fires no event.
- [ ] **Step 2: Run** `bun test src/kernel/readonly-boot.test.ts` and confirm it fails (the data version changes, and the locked cases take about 3 s and exit 3).
- [ ] **Step 3: Implement.**
  - `ensureKernelTables`: when every kernel table already exists in `sqlite_schema`, skip the transaction.
  - `createAll`: compile and check every view first (layer 1, the single-statement check, `tablesTouched` on the compiled SQL; all of it read-only). Compare `CREATE VIEW "<physical>" AS <sql>` with `sql` from `sqlite_schema`, and work out which stale views exist.
    - Open the write transaction only if something differs. Inside it, drop and create only what changed.
    - Run the declared-columns check and the base-table check on every view either way. Both are read-only.
  - Host `emit`: when `db.inWrite()`, push the emit onto `db.afterCommit`, otherwise emit now.
  - Add `dataVersion()`.
- [ ] **Step 4: Run** the new tests, then `bun test`, `bun typecheck` and `bash scripts/smoke-node.sh` (the views path is runtime-sensitive). Expected: all pass, and the smoke test ends with `smoke ok`.
- [ ] **Step 5: Update the follow-ups file.** Mark the first two "Before phase 2" bullets of `docs/superpowers/plans/2026-11-13-pm-phase1-followups.md` as done (`— done in phase 2 Task 1`).
- [ ] **Step 6: Commit** `fix(kernel): read-only boot when nothing changed; emit after commit inside writes`.

---

### Task 2: Plugin runtime, TUI registry and TUI boot (no rendering yet)

**Files:**
- Modify: `src/kernel/plugin.ts`, `src/kernel/host.ts`, `src/kernel/tags.ts`
- Create: `src/kernel/tui/types.ts`, `src/kernel/tui/registry.ts`, `src/kernel/tui/boot.ts`, `src/plugins/tui.ts` (`export const builtinTuiParts: TuiDef[] = []` for now)
- Test: `src/kernel/tui/registry.test.ts`, `tests/logic-ui-split.test.ts`

**Interfaces:**
- Produces, in `plugin.ts`:
  - `export type PluginRuntime = Pick<PluginContext, "id" | "data" | "config" | "clock" | "use" | "self" | "records" | "tags" | "provenance">`
  - `Kernel.runtime(pluginId: string): PluginRuntime | undefined`, which is `undefined` unless the plugin's status is `ok`. It returns the same `data` instance as the plugin's context.
- Produces, in `tags.ts`:
  - `TagRegistry.types(): Array<{ prefix: string; recordType: string }>`;
  - `PluginRuntime.tags.suggest(partial: string, limit: number): Promise<Array<{ ref: string; label: string }>>`. `partial` is like `#cr` or `@ma`. It finds the tag type for the prefix and calls that record type's `search(text, limit)`, and returns `[]` for an unknown prefix.
- Produces, in `types.ts`. These are the exact names later tasks use. `Component` and `JSX` come from `solid-js`.
  ```ts
  export type Tone = "red" | "amber" | "green" | "muted" | "accent" | undefined
  export type Cell = { text: string; tone?: Tone }
  export type Route =
    | { kind: "screen"; screen: string; params?: Record<string, string> }
    | { kind: "record"; screen: string; ref: string; tab?: string }
  export type ScreenDef = { id: string; title: string; slot?: number; component: Component<{}>; count?: () => Promise<number> }
  export type RecordTabDef = { id: string; title: string; order: number; count?: (ref: string) => Promise<number | null>; component: Component<{ ref: string }> }
  export type OverviewRow = { ref: string; cells: Cell[] }
  export type OverviewPanelDef = { id: string; title: string; priority: number; empty: string; footer?: string; load(): Promise<OverviewRow[]> }
  export type ListColumnDef = { id: string; title: string; width: number; value(ref: string): Promise<string | null> }
  export type RecordFormProps = { ref?: string; prefill?: Record<string, string>; origin?: Origin; close(savedRef?: string): void }
  export type RecordFormDef = { id: string; label: string; component: Component<RecordFormProps> }
  export type GlobalActionDef = { id: string; key: string; label: string; overlay: Component<{ close(): void }> }
  export type StatusBadgeDef = { id: string; order: number; text(): Promise<string | null> }
  export type FieldEditorProps = { value: string | null; onChange(v: string | null): void; focused: boolean }
  export interface TuiContext extends PluginRuntime {
    screen(def: ScreenDef): void
    recordTab(recordType: string, def: RecordTabDef): void
    overviewPanel(def: OverviewPanelDef): void
    listColumn(list: string, def: ListColumnDef): void
    recordForm(recordType: string, def: RecordFormDef): void
    fieldEditor(recordType: string, field: string, editor: Component<FieldEditorProps>): void
    globalAction(def: GlobalActionDef): void
    statusBadge(def: StatusBadgeDef): void
  }
  export type TuiDef = { plugin: string; activate(ui: TuiContext): void }
  export function defineTui(def: TuiDef): TuiDef
  ```
- Produces, in `registry.ts` and `boot.ts`:
  - `class TuiRegistry`, with getters `screens()` (sorted by slot), `screenBySlot(n)`, `tabsFor(recordType)` (sorted by `order`), `panels()` (sorted by `priority`, then registration order), `columns(list)`, `forms(recordType)`, `editor(recordType, field)`, `globalActions()`, `badges()` and `errors(): Array<{ plugin: string; error: string }>`.
  - `bootTui(kernel: Kernel, parts: TuiDef[], opts?: { builtin?: boolean }): TuiRegistry`.
- Rules (each one is a test):
  - A part whose `plugin` isn't loaded `ok` is skipped and recorded in `errors()` as `tui part for "<id>": plugin is not loaded`.
  - A part whose `activate` throws: everything it registered is removed, and `errors()` gets `<id>: <message>`. Its logic stays loaded, so `kernel.runtime(id)` is still defined.
  - Built-in parts may pass `slot` 1–6. Two screens on one slot: the later part fails. External parts (`builtin: false`) ignore `slot` and get 7, 8, … in order.
  - Slot `1` is reserved for the kernel's Overview screen. A part's `screen({ slot: 1 })` fails.
  - **`globalAction` keys.** The key must be a single character. A key already used by a global key or by an earlier action fails the later part with `key "<k>" is already taken`. The reserved keys are the global keys `j k n e x g q ? / 1-9` plus `c` (the assistant, phase 7).
  - Registering after `bootTui` returns throws `plugins can only register during activate`.
  - `recordTab` for an unregistered record type is accepted (the type may belong to a plugin loaded later) and simply never shown.
- [ ] **Step 1: Write the failing tests** in `registry.test.ts`, one per rule above, plus `runtime returns the plugin's own scoped data` (`kernel.runtime("people")!.data.selectFrom("person")` works, while `selectFrom("project")` throws `IsolationError`) and `tags.suggest("#cr", 5)` → `[{ ref: "#CRM", label: … }]` after `addProject` CRM.
- [ ] **Step 2: Write `tests/logic-ui-split.test.ts`.** Starting at `src/bin/pm.ts`, follow every **static** relative import (`import … from "./x"` and `export … from`, not `import()`), resolving `.ts`/`.tsx`/`index`. Assert that no visited file imports `solid-js`, `@opentui/` or a path under `src/kernel/tui/`. Also assert the import set includes `src/plugins/index.ts` (so the walk isn't trivially empty). Second test: no file under `src/plugins/*/logic/` or `src/kernel/` (outside `tui/`) imports those modules.
- [ ] **Step 3: Run them** and confirm they fail (the modules don't exist yet).
- [ ] **Step 4: Implement.** The host stores each `ok` plugin's context and `runtime(id)` picks the `PluginRuntime` keys from it. `bootTui` builds one `TuiContext` per part: the runtime plus registration methods tagged with the plugin id, sealed at the end.
- [ ] **Step 5: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(tui): plugin runtime, TUI registry and boot`.

---

### Task 3: Web-terminal feasibility spike (independent, non-blocking)

This task can run in parallel with Tasks 4–16, because no later task depends on it. Its result can change key choices: if it does, the controller writes a follow-up rather than editing finished tasks. It adds **no production code** and no dependencies to `package.json`.

**Files:**
- Create: `docs/superpowers/spikes/2026-11-16-web-terminal.md`
- Create: `scripts/spikes/keyprobe.tsx`, a tiny OpenTUI app that shows each `KeyEvent` (`name`, `ctrl`, `meta`, `shift`, `sequence`), the terminal size on resize, and a 16-colour plus truecolour strip. `y` tries `renderer.copyToClipboardOSC52("pm spike")` and shows `isOsc52Supported()`.

- [ ] **Step 1: Get ttyd.** Use the static `ttyd.x86_64` from the GitHub releases into the scratch dir. Run `ttyd --writable -p 7681 bun scripts/spikes/keyprobe.tsx`. If no browser can be automated, drive xterm.js headless instead: a Node script in the scratch dir with `@xterm/headless` (installed there, not in the repo), plus a websocket client speaking ttyd's protocol. Record which method you used.
- [ ] **Step 2: Record, per item of spec §11.2 "Risks":**
  - colours (16 and truecolour);
  - resize;
  - the keyboard protocol OpenTUI negotiates (kitty or legacy);
  - whether these arrive distinguishably: `Shift+Enter` vs `Enter`, `Ctrl+J`, `Esc` (and its latency), arrows, `Del`, `Ctrl+S`;
  - OSC 52;
  - key-to-frame latency and a full redraw at 120×40.

  For browser key capture (`Ctrl+W/T/N/C`), cite browser behaviour, and test it if a real browser is available.
- [ ] **Step 3: Conclude.** Name a recommended web terminal and its settings, and list key or UI changes for pm. This plan already treats `Ctrl+J` as an alternative to `Shift+Enter` and `Esc` `s` as an alternative to `Ctrl+S`; say whether that's enough.
- [ ] **Step 4: Commit** `docs(spike): web-terminal feasibility (ttyd + xterm.js)`.

---

### Task 4: TUI shell. Entry, frame, navigation, keys, switcher, help

**Files:**
- Create: `src/kernel/tui/theme.ts`, `run.tsx`, `app.tsx`, `frame.tsx`, `nav.ts`, `keys.ts`, `messages.ts`, `api.ts`, `components/Switcher.tsx`, `components/Help.tsx`, `components/OverviewScreen.tsx` (a stub: title and "No panels")
- Create: `tests/tui.tsx`, `src/kernel/tui/selfcheck.tsx`
- Modify: `src/bin/pm.ts`, `package.json` scripts, `scripts/build-node.mjs` (if dynamic imports need `.js`), `scripts/smoke-node.sh`, `src/kernel/shutdown.ts`
- Delete: the starter files listed under "File structure"
- Test: `src/kernel/tui/app.test.tsx`, `tests/bin.test.ts`

**Interfaces:**
- Produces:
  - `runTui(kernel: Kernel, parts: TuiDef[]): Promise<void>`, which resolves after `q` once the renderer is destroyed.
  - `<TuiApp kernel registry />`.
  - `useNav(): { route(): Route; stack(): Route[]; go(screenId: string, params?): void; open(ref: string, tab?: string): Promise<void>; back(): void; replaceParams(p): void }`.
  - `useKeys(): { textFocus(on: boolean): void; hints(list: Array<{ key: string; label: string }>): () => void }`. A focused component registers its hints. `textFocus(true)` turns the single-letter global keys off.
  - `useKeyHandler`-style local handling stays OpenTUI's `useKeyboard`. Global keys are handled in `keys.ts` *after* checking `textFocus`.
  - `notify(text: string, kind?: "info" | "error"): void`. It replaces the status-bar hints for 5000 ms.
  - The test helper `renderTui(kernel, opts?: { width?: number; height?: number; parts?: TuiDef[] })` returns `{ frame(): Promise<string>; input: MockInput; settle(): Promise<void>; nav; destroy(): void }`. `settle()` waits until no query is in flight (`useQuery` registers its promises with the app; the stub here resolves immediately), then calls `renderOnce()`.
- **Header layout:** `pm · 1 Overview ▾` + ` › <crumb>`… on the left. On the right, the badges joined by two spaces, then two spaces and the date `Fri 13 Nov 2026`.
- **Switcher (`g`):** lists every screen as `<slot> <title>` with its `count()` when defined. `↑↓`/`jk` move, `Enter` goes there, `1`–`9` jump, `Esc` closes.
- **Help (`?`):** shows the global keys table, the current hints, and `Plugin problems` listing `registry.errors()` and failed logic plugins from `kernel.plugins`.
- **Small terminals:** below 60×15 the main area shows exactly `Terminal too small (need 60×15)`.
- [ ] **Step 1: Write the failing tests** in `app.test.tsx` (all through `renderTui` with the built-in logic plugins and `builtinTuiParts`):
  - `header shows screen chip and date`: the first line contains `pm · 1 Overview ▾` and `Fri 13 Nov 2026`.
  - `number keys switch screens`: with a test part registering screen `{ id: "t", title: "Test", slot: 2 }` rendering `test screen`, pressing `2` shows `pm · 2 Test ▾` and `test screen`. `3` (empty slot) changes nothing.
  - `g opens switcher`: the frame lists `1 Overview` and `2 Test`. `j`, then `Enter` → Test.
  - `Esc goes back` after `2` → Overview.
  - `? lists plugin problems`: a part for a missing plugin `ghost` → help shows `tui part for "ghost": plugin is not loaded`.
  - `text field disables single-letter keys`: the test screen focuses an `<input>` and calls `textFocus(true)` while focused. Typing `q2g?` puts `q2g?` in the input, and the screen stays Test.
  - `q quits`: the promise from a `runTui`-equivalent resolves (or the renderer is destroyed).
  - `too small message` at 50×12.
- [ ] **Step 2: Update `tests/bin.test.ts`.** With no args and a non-TTY stdout, `main([])` still prints the help and exits `0`. The `PHASE2_NOTE` line goes away.
- [ ] **Step 3: Run them** and confirm they fail.
- [ ] **Step 4: Implement.**
  - **Entry.** `pm.ts`: when `argv.length === 0 && process.stdout.isTTY`, call `await import("../kernel/tui/run")` and `await import("../plugins/tui")`, then `runTui`, then shutdown. On `SIGHUP`/`SIGTERM`, `installShutdownHandlers(kernel, { before: () => renderer.destroy() })` restores the terminal before the database is closed.
  - **Scripts.** `package.json`: `start` → `bun src/bin/pm.ts`, `dev` → `bun --watch src/bin/pm.ts`, `start:node` → `npm run build:node && node --experimental-ffi dist-node/bin/pm.js`, `"module": "src/bin/pm.ts"`.
  - **Node.** Check that the Node build rewrites the dynamic `import("../kernel/tui/run")` to `.js`, and add that to `build-node.mjs` if it doesn't.
- [ ] **Step 5: Add the Node TUI self-check.** `src/kernel/tui/selfcheck.tsx` boots a test kernel in a temp `PM_HOME`, does `testRender(<TuiApp …/>)`, checks the header contains `pm · 1 Overview`, and prints `tui ok`. `smoke-node.sh` runs `node --experimental-ffi dist-node/kernel/tui/selfcheck.js` and greps `tui ok`.
- [ ] **Step 6: Run** `bun test`, `bun typecheck` and `bash scripts/smoke-node.sh`. Expected: everything passes and the smoke output contains `tui ok` and `smoke ok`.
- [ ] **Step 7: Check by hand.** Start `bun src/bin/pm.ts` in a real terminal and press `?`, `g`, then `q`. If no TTY is available, say so in the report.
- [ ] **Step 8: Commit** `feat(tui): shell — entry, frame, navigation, global keys, switcher, help`.

---

### Task 5: Data hooks, live refresh, error boundary, busy handling

**Files:**
- Create: `src/kernel/tui/data.ts`, `refresh.ts`, `components/ErrorBoundary.tsx`
- Modify: `app.tsx` (provide the context; wrap every plugin component in `ErrorBoundary`), `tests/tui.tsx` (`settle` waits for in-flight queries)
- Test: `src/kernel/tui/data.test.tsx`

**Interfaces:**
- Produces:
  - `useRuntime(): PluginRuntime`, the runtime of the plugin whose component is rendering. The app sets it through a Solid context around each registered component.
  - `useQuery<T>(load: () => Promise<T>, opts?: { key?: () => unknown }): { data(): T | undefined; error(): unknown; loading(): boolean; reload(): void }`.
    - It runs `load` inside `runWithContext(kernel.context())`.
    - It reruns on every live-refresh tick that saw a change, and when `key()` changes.
    - On error it keeps the last `data()` and calls `notify(message, "error")`.
  - `act<T>(fn: () => Promise<T>, opts?: { origin?: Origin; ok?: (r: T) => string }): Promise<{ ok: true; value: T } | { ok: false; error: unknown }>`.
    - It runs `fn` in context with the origin.
    - On `BusyError` it shows `database busy, retrying`, waits 1000 ms and retries, up to 5 attempts.
    - Otherwise an error becomes `notify(message, "error")` and is returned. `ok(value)` becomes an info message.
  - `createLiveRefresh(kernel: Kernel, intervalMs = 1000): { version: Accessor<number>; stop(): void }`. It bumps `version` when `kernel.db.dataVersion()` changes, and on `record.changed`, debounced to one bump per tick.
  - `<ErrorBoundary label>` shows `⚠ <label>: <message>` in the theme's red, in place.
- [ ] **Step 1: Write the failing tests:**
  - `reloads after a write from another connection`. A second kernel B on the same home runs `addAction` through `runWithContext`. Within `intervalMs` (use 50 in tests) the screen built on `useQuery` shows the new title.
  - `reloads after own write via record.changed`.
  - `keeps selection by ref across reloads`. This test lives in Task 6, which owns `Table`. Here, test that `data()` keeps its previous value while a reload is in flight (no flash of empty).
  - `query error keeps last data and shows message`. Make `load` throw on the second run: the old rows stay and the status bar shows the message for 5 s, then the hints return. Advance timers with a short fake interval, or set `messages.ts`'s timeout through a test hook.
  - `busy then success`. Connection B holds `BEGIN IMMEDIATE`. `act(addAction)` shows `database busy, retrying`. B rolls back after about 1.5 s, the act resolves `ok`, and exactly one action exists. `busy_timeout` stays 3000 ms, so this test takes about 4–5 s; give it a 15 s timeout.
  - `ErrorBoundary contains a throwing tab`. A test screen whose component throws renders `⚠ Test: boom`, and the header still renders.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement.** `version` is one app-wide signal. `useQuery` uses `createResource`-like logic, but keeps the previous value instead of showing `loading` in place of data.
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(tui): useQuery/act, live refresh via data_version, error boundaries`.

---

### Task 6: Building blocks and record view, Overview panels, badges, global actions

**Files:**
- Create: `components/Panel.tsx`, `Table.tsx`, `Tabs.tsx`, `KeyHints.tsx`, `RecordView.tsx`, `Menu.tsx`, and `format.ts`
- Modify: `components/OverviewScreen.tsx` (render `registry.panels()`), `frame.tsx` (badges), `keys.ts` (global actions), `api.ts` (export the blocks)
- Test: `src/kernel/tui/blocks.test.tsx`, `src/kernel/tui/format.test.ts`

**Interfaces:**
- Produces, in `format.ts`:
  - `displayWidth(s): number`, which counts East Asian wide characters and emoji as 2;
  - `truncate(s, width): string`, which ends with `…` when cut and never exceeds `width`;
  - `dueLabel(date: string | null, today: string): string`. It gives `-3d` when overdue, `today` for today, the weekday `Fri`/`Sat`/`Sun` up to `weekEnd(today)`, otherwise `26 Nov`, and `—` for null;
  - `shortDate(iso): string` → `13 Nov`;
  - `longDate(iso)` → `Fri 13 Nov 2026`.
- Produces, the blocks:
  - `<Panel title count? focused footer?>`. Its border uses the `accent` colour when focused, and its title is `Title · count`.
  - `<Table columns rows selectedRef onSelect onOpen focused groups? empty listId?>`.
    - `columns` is an array of `{ id: string; title: string; width: number | "grow"; tone?: (row) => Tone }`.
    - Each row is `{ ref: string; cells: Record<string, string | Cell> }`.
    - `groups` is `Array<{ title: string; rows: Row[] }>` and renders the headers `Title · n`.
    - `↑↓`/`jk` move, and `Enter` calls `onOpen(ref)`.
    - When rows reload, the selection keeps the same `ref`. If that ref is gone, it keeps the index, clamped.
    - With `listId`, the registry's `columns(listId)` are appended, each loaded through `value(ref)`.
  - `<Tabs tabs={[{ id, title, count? }]} active onChange focused>`, where `←→` switch.
  - `<KeyHints hints />` registers the hints while it's mounted and focused.
  - `<Menu items={[{ key?, label, run }]} close>` is a small overlay list.
  - `useRecord(ref: () => string): { type(): string | undefined; id(): number | undefined; label(): string | undefined }` resolves the ref through `kernel.records` with `useQuery`, so it refreshes live.
  - `nav.open(ref)` routes as follows:
    - It resolves the record type with `kernel.records.typeOfRef`.
    - If `registry.tabsFor(type)` isn't empty, it pushes `{ kind: "record", screen: <current screen>, ref }`.
    - Else, if `registry.forms(type)` has an entry, it opens the first form with `{ ref }`.
    - Else it shows `notify("<ref>: <label>")`.
    - An unknown ref gives `notify("no record <ref>", "error")`.
  - `<RecordView ref tab?>` shows the breadcrumb `› <ref without prefix if #> <label>` (for example `› CRM CRM replatforming`) and the tabs from `tabsFor(type)`, with their counts. It renders the active tab's component with `{ ref }`.
  - `OverviewScreen` renders each panel in a two-column grid (the left column takes panels with an even index, the right one panels with an odd index, in priority order).
    - Each panel title shows its row count.
    - `Tab` moves focus to the next panel, and `Enter` opens the selected row's ref.
    - It shows at most 5 rows plus `+N more`.
    - Each panel loads through `useQuery`.
  - Global action keys open the action's overlay. Its own keys take over until `close()`.
  - Badges are loaded through `useQuery` and render in the header, ordered by `order`.
- [ ] **Step 1: Write the failing tests:**
  - **format:** `displayWidth("名前")` = 4. `truncate("CRM replatforming", 8)` = `CRM rep…`. `truncate("名前名前", 5)` = `名前…`. With today `2026-11-13`, `dueLabel` gives `-3d` for `2026-11-10`, `today` for `2026-11-13`, `Sun` for `2026-11-15`, `16 Nov` for `2026-11-16` and `—` for null.
  - **blocks:**
    - `Table keeps selection by ref across reloads`. Rows A-1, A-2, A-3 with A-2 selected, then reload with A-0 added in front: A-2 is still selected (marked `›`). Reload without A-2: A-3 is selected.
    - `Table truncates by display width`: a 10-wide column with `名前名前名前` renders `名前名前…`.
    - `Overview shows panels in priority order with counts and +more`: a fixture part registers panels P1 (priority 20, 7 rows) and P0 (priority 10, empty `Nothing here.`). The frame shows `P0` with `Nothing here.` before `P1 · 7`, five P1 rows and `+2 more`.
    - `Enter on a panel row opens the record view`: with a fixture record type `thing` (prefix `T-`) that has a tab `Main` rendering `main of T-1`, Tab to P1 and Enter shows `› T-1 …` and `main of T-1`. `←→` switches to a second tab, and Esc returns to Overview.
    - `global action opens its overlay`: key `w` on a fixture opens `fixture overlay`, and Esc closes it.
    - `badge renders in header`: `● 2 things`.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(tui): building blocks, record view, overview panels, badges, global actions`.

---

### Task 7: Forms, confirm dialog, record forms

**Files:**
- Create: `components/Form.tsx`, `components/Field.tsx`, `components/Confirm.tsx`
- Modify: `app.tsx` (an overlay stack), `api.ts`
- Test: `src/kernel/tui/form.test.tsx`

**Interfaces:**
- Produces:
  - `useOverlay(): { open(c: () => JSX.Element): () => void; openForm(recordType: string, formId?: string, props?: Omit<RecordFormProps, "close">): void; confirm(text: string): Promise<boolean> }`;
  - `<Form title fields submit close>`.
    - `fields` is an array of `FieldSpec = { name: string; label: string; kind: "text" | "longtext" | "date" | "number" | "enum" | "record"; required?: boolean; values?: string[]; recordType?: string; initial?: string | null }`.
    - `submit` has the signature `(values: Record<string, string | null>) => Promise<{ ok: true; ref?: string } | { ok: false; error: unknown }>`.
  - Keys:
    - `Tab` and `Shift+Tab` move between fields.
    - `Enter` on the last field, or `Ctrl+S` / `Esc` `s` anywhere, submits.
    - `Esc` (without `s` after it within 1000 ms) cancels.
    - `enum` fields cycle with `←→`.
    - `record` fields autocomplete from `kernel.records.byName(recordType).search(text, 8)`. `↑↓` pick and `Tab` accepts.
    - A `date` field shows the parsed ISO date next to the input (`→ 2026-11-15`) or `invalid date`.
  - While any field has focus, `textFocus(true)`.
  - A `ValidationError` with `field` is shown under that field as `✗ <message>`. Other errors are shown at the bottom of the form. The form stays open and keeps the values.
  - `confirm(text)` shows `<text>  y yes · n no` and resolves `true` only on `y`.
  - `openForm` looks up `registry.forms(recordType)`: the form `formId`, or the first one.
- [ ] **Step 1: Write the failing tests**, with a fixture form over a fixture write op `addThing({ title: NonBlank, due?: string })` that uses `parseDate`:
  - `submit creates record and closes`: type `Write spec`, set due `+2d`. The label shows `→ 2026-11-15`, the submit creates the record with due `2026-11-15`, and the overlay is gone.
  - `validation error shows under field`: an empty title shows `✗ title must not be blank` under Title, and the form stays open with the due value kept.
  - `typing q in a field does not quit`.
  - `Esc cancels without saving` (zero rows).
  - `record field autocompletes people`: with the people plugin and `@anna Anna Peeters`, typing `an` lists `@anna Anna Peeters`. `Tab` fills `@anna`.
  - `busy save keeps the form and retries`. B holds the lock, so the form shows `database busy, retrying`. After B's rollback the record exists exactly once and the form has closed.
  - `confirm resolves on y only`.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(tui): forms with inline validation, confirm, record forms`.

---

### Task 8: Long-text editor and `$EDITOR`

**Files:**
- Create: `components/Editor.tsx`
- Modify: `api.ts` (export `openEditor`)
- Test: `src/kernel/tui/editor.test.tsx`

**Interfaces:**
- Produces: `useOverlay().openEditor(opts: { title: string; initial: string; save(text: string): Promise<{ ok: true } | { ok: false; error: unknown }> }): void`. It's a full-screen overlay with a `<textarea>`, under the title line `<title> · ctrl+s save · esc s save · esc d discard`.
  - `Ctrl+S`, or `Esc` then `s`, saves. Saving calls `save` and closes on `ok`, or shows the error and stays open.
  - `Esc` then `d` discards. `Esc` then anything else returns to editing.
  - Edits stay in the overlay until saved.
- Produces: `editExternal(initial: string, opts?: { editor?: string }): Promise<string | null>`. This is for local mode.
  - It writes a temp file under `os.tmpdir()`, `await renderer.suspend()`, then runs `$VISUAL` or `$EDITOR` (default `vi`) with `spawnSync` and inherited stdio, then `await renderer.resume()`.
  - It returns the new text, or `null` when the editor exited non-zero or the file is unchanged.
  - It always deletes the temp file.
- [ ] **Step 1: Write the failing tests:**
  - `ctrl+s saves edited text`: initial `# A`, type `\nB`, Ctrl+S → `save` called with `# A\nB`, and the overlay is closed.
  - `esc d discards`: `save` not called.
  - `esc then text continues editing`.
  - `save error keeps editor open`.
  - `editExternal uses EDITOR` with `EDITOR` set to a test script that appends a line (`sh -c 'echo added >> "$1"' --`): it returns the text with `added`. Use a fake renderer with `suspend`/`resume` spies, both called once in order.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement.** Confirm on Bun and Node that `suspend()`/`resume()` restore raw mode, and note what you found in the commit body. This is the open item in spec §9. Don't call `editExternal` when `PM_MODE=container` (phase 6 adds the rest).
- [ ] **Step 4: Run** `bun test`, `bun typecheck` and the smoke test. Expected: pass.
- [ ] **Step 5: Commit** `feat(tui): built-in long-text editor and $EDITOR handoff`.

---

### Task 9: Projects screen (2)

**Files:**
- Create: `src/plugins/projects/tui/index.tsx` (`defineTui({ plugin: "projects", … })`), `projects-screen.tsx`, `forms.tsx` (project and health forms)
- Modify: `src/plugins/tui.ts` (add projects), `src/plugins/projects/logic/records.ts` and `items.ts` (change the `makeStore`/`makeItems` parameter type from `PluginContext` to `PluginRuntime`)
- Test: `src/plugins/projects/tui/projects-screen.test.tsx`

**Interfaces:**
- Consumes: `makeStore(rt)` (`recordQuery`, `toProject`) from the projects logic; Task 6 blocks; Task 7 forms.
- Produces:
  - `screen({ id: "projects", title: "Projects", slot: 2, count })`, whose count is the active, non-archived projects;
  - `recordForm("project", { id: "project", label: "Project" })` for add and edit, with the fields code, name, description, status, start, end, effort days and effort note;
  - `recordForm("project", { id: "health", label: "Health update" })`, with the fields health (enum `green`/`amber`/`red`), comment and date (default today). It calls `setHealth`.
- **Table columns:** ` ` (a health dot `●` coloured red, amber or green, `○` muted for not set), `Code`, `Name` (grow), `Next milestone`, `Due` (`dueLabel`), `Act.`, `Risk`, `Effort` (`220pd`, or empty).
- **Groups:**
  - `Projects · <n> active`, sorted red → amber → green → not set, then next milestone due (nulls last), then code;
  - `On hold · <n>`, sorted by code;
  - `Closed · <n>`, sorted by code.
  - Archived projects only show after `a` toggles them, in an `Archived · <n>` group; the panel title then says `· archived shown`.
- **Keys:**
  - `Enter` opens the record view;
  - `n` opens the project form;
  - `e` edits the selected project;
  - `h` opens the health form for the selected project;
  - `/` filters, with free text matching code or name, plus `status:<s>` and `health:<h>`; `Esc` clears it;
  - `a` toggles archived.
  - The hints are `enter open · n new · e edit · h health · / filter · a archived`.
- [ ] **Step 1: Write the failing tests.** Seed through the write ops in context:
  - CRM (amber, next milestone `2026-11-26`);
  - ERP (red, milestone `2026-11-07`);
  - IAM (no health);
  - HRP (green);
  - BI2 (on_hold);
  - OLD (archived).

  The tests:
  - `sorted by health then next milestone`: the row order is ERP, CRM, HRP, IAM. On hold shows BI2, and OLD is hidden.
  - `a shows archived`.
  - `filter health:red` → only ERP. `Esc` clears it.
  - `n creates a project`: the form with code `NEW` and name `New thing` creates it, and the row appears.
  - `h updates health`: on CRM, red with comment `Budget` → the CRM dot is red and the project's health is red in the DB.
  - `empty projects` shows `No projects yet. Press n to add one.`
  - `Projects renders at 80x24 with a long CJK name`: a name of 30 CJK characters renders truncated with `…` and no line is wider than 80.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(projects-tui): Projects screen, project and health forms`.

---

### Task 10: Project detail: Summary, People and Context tabs

**Files:**
- Create: `src/plugins/projects/tui/project-summary.tsx`, `project-people.tsx`, `project-context.tsx`
- Modify: `src/plugins/projects/tui/index.tsx`
- Test: `src/plugins/projects/tui/project-detail.test.tsx`

**Interfaces:**
- Produces `recordTab("project", …)` with these ids, titles and orders. Each count is the number of open items and is shown as `Title n`:

  | id | Title | order | count |
  |---|---|---|---|
  | `summary` | Summary | 10 | — |
  | `milestones` | Milestones | 20 | not done |
  | `deliverables` | Deliverables | 30 | not delivered |
  | `risks` | Risks & issues | 40 | open |
  | `decisions` | Decisions | 50 | all |
  | `actions` | Actions | 60 | open |
  | `people` | People | 70 | involvements |
  | `context` | Context | 80 | — |

  Task 11 fills in the rows for orders 20–60. This task registers Summary, People and Context.
- **Summary.** On the left: Health (`● amber · 10 Nov` plus the comment), Status, Dates (`1 Sep 2026 → 30 Jun 2027`), Effort (`220 person-days (note)`), Sponsor, Team and the description.
  - Sponsor is the person(s) whose involvement role is `sponsor`, case-insensitive.
  - Team is the first names of the people in `people.person` with `is_team = 1` who are involved.
  - On the right are the short lists, three rows each: Milestones (done `✓` or `○`, title, due), Deliverables (title, owner, status, due), Open risks & issues (ref, title, severity, type) and Recent decisions (date, title).
  - `h` opens the health form, and `e` opens the project form.
- **People.** A table of `Person`, `Role`, `Team/Stakeholder`. `n` opens an involvement form with person (record `person`) and role, calling `addInvolvement`. `Del` confirms `Remove @anna as architect from CRM?` and calls `removeInvolvement`.
- **Context.**
  - The header is `Context · markdown` with `updated <shortDate>` and the scroll percentage `NN%`.
  - The body is the `<markdown>` element inside a `scrollbox` (`↑↓` scroll), using `getContext`.
  - `e` opens the editor, which calls `setContext`.
  - `E` calls `editExternal` and then `setContext`, unless the text is unchanged.
  - The empty state is exactly `No context yet. Press e to write it, or let your MCP integration fill it in.`
- [ ] **Step 1: Write the failing tests** (seed CRM with health amber `Design slipping` on 2026-11-10, sponsor `@peter`, team member `@anna` as architect, one milestone, one open risk R-1 high issue):
  - `summary shows health, sponsor, team`: the frame contains `● amber · 10 Nov`, `Design slipping`, `Peter` and `Anna`.
  - `tab titles carry counts`: the frame shows `Milestones 1` and `Risks & issues 1`.
  - `→ goes through tabs to Context`.
  - `empty context`, with the exact text above.
  - `context renders markdown`: after `setContext` `# Background\nLegacy CRM`, the frame contains `Background` (without `#`) and `Legacy CRM`.
  - `e edits context`: the editor, then Ctrl+S, changes `getContext().markdown` to the new text.
  - `people tab adds and removes involvement`.
  - `Esc returns to Projects with CRM still selected`.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement.** If `<markdown>` doesn't render on Node (check with the smoke self-check, by rendering the Context tab there), fall back to a plain `<text>` with headings in bold, and record it in the commit body.
- [ ] **Step 4: Run** `bun test`, `bun typecheck` and the smoke test. Expected: pass.
- [ ] **Step 5: Commit** `feat(projects-tui): project detail — Summary, People, Context`.

---

### Task 11: Project detail item tabs and their forms

**Files:**
- Create: `src/plugins/projects/tui/item-tab.tsx` (one generic tab for the five kinds), `item-forms.tsx`
- Modify: `src/plugins/projects/tui/index.tsx`
- Test: `src/plugins/projects/tui/item-tabs.test.tsx`

**Interfaces:**
- Consumes: `makeItems(rt)` queries and records (`milestoneQuery`, `toMilestone`, …); the write ops of the plugin reference §2.
- Produces: `recordTab("project", { id: "milestones" | "deliverables" | "risks" | "decisions" | "actions", … })` per the table in Task 10.
- Produces `recordForm` entries for add and edit:

  | record type | form id | label | fields |
  |---|---|---|---|
  | `milestone` | `milestone` | Milestone | title, due, done |
  | `deliverable` | `deliverable` | Deliverable | title, owner (person), due, status enum, milestone (record `milestone`) |
  | `risk` | `risk` | Risk / issue | type enum, title, description (longtext), severity, owner, mitigation |
  | `decision` | `decision` | Decision | date (default today), title, description, decided by |
  | `action` | `action` | Action | title, due, owner (person; empty = me), project (record `project`), for (person), notes |

  With `prefill.project`, the project is set and hidden.
- **Columns per tab** (the first column is always the ref):
  - Milestones: `✓/○`, title, due, `late` in red;
  - Deliverables: title, owner, status, due;
  - Risks & issues: type, title, severity (high in red), owner, status. Open first, high first;
  - Decisions: date, title, decided by. Newest first;
  - Actions: title, owner (`me` when empty), for, due (`dueLabel`, red when overdue), status. Open first.
- **Keys:**
  - `n` adds an item, prefilled with the project;
  - `e` edits;
  - `x` completes, by kind: milestones `completeMilestone` (today), deliverables cycle the status forward through `setDeliverableStatus`, risks `closeRisk`, actions `completeAction`, decisions do nothing;
  - `Del` confirms `Delete <ref> "<title>"?` and calls the delete op.
- [ ] **Step 1: Write the failing tests:**
  - **Milestones:**
    - `n adds milestone with project prefilled`: the form has no project field, the milestone is created on CRM, and the row shows `○ Design approved 26 Nov`.
    - `x completes milestone` → `✓` and done_date `2026-11-13`.
    - `late milestone shows late`: due `2026-11-07`.
  - **Deliverables:** `x advances deliverable status` from `in_review` to `delivered`.
  - **Risks:** `x closes risk`; `risks sorted open-high first`.
  - **Actions:** `n action with empty owner is me` shows `me`; `x` on an action sets it to `done`, and the count in the tab title drops by one.
  - **Delete:** `Del asks then deletes`: `n` keeps the row, `y` deletes it.
  - **Validation:** `validation error from op shows under field`: a deliverable due `garbage` shows `✗` under Due.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement.** Use one `ItemTab` component configured per kind: query, columns, form id, `x` op, delete op. Don't build five copies.
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(projects-tui): milestone, deliverable, risk, decision and action tabs`.

---

### Task 12: Actions screen (4)

**Files:**
- Create: `src/plugins/projects/tui/actions-screen.tsx`, `src/plugins/projects/tui/action-filter.ts`
- Modify: `src/plugins/projects/tui/index.tsx`
- Test: `src/plugins/projects/tui/actions-screen.test.tsx`, `action-filter.test.ts`

**Interfaces:**
- Produces: `screen({ id: "actions", title: "Actions", slot: 4, count })`, whose count is the open actions.
- Produces `parseActionFilter(text: string): { owner?: string; project?: string; status?: "open" | "done" | "cancelled" | "all"; text: string[] }`. Tokens are `owner:anna`, `owner:me`, `project:CRM`, `status:done` and free words. The default status is `open`.
- **Groups** (open actions; today 2026-11-13, `weekEnd` 2026-11-15):
  - `Overdue` (due < today);
  - `This week` (today ≤ due ≤ weekEnd);
  - `Next week` (weekEnd < due ≤ weekEnd + 7);
  - `Later`;
  - `No date`.

  Each title shows its count, and each group is sorted by due date, then id. With `status:done`/`all`, the list has a single group, `Actions`, sorted newest first.
- **Columns:**
  - `ID`;
  - `Action` (grow);
  - `Proj.` (code);
  - `Owner` (`me` or the person's first name);
  - `For / from`, which is, in order of preference:
    - the `for` person's name;
    - else the meeting title (`meetings.meeting` when available);
    - else `inbox I-n` when provenance has an inbox origin;
    - else `—`;
  - `Due` (a date `9 Nov` in the Overdue group, `dueLabel` otherwise).
- **Header** line: `Actions · <n> open` and the active filter (`status:open owner:anna`).
- **Keys:**
  - `x` completes the action;
  - `d` opens a one-field date form calling `editAction({ due })`;
  - `e` edits it;
  - `n` adds a new one;
  - `/` opens the filter input (text focus), where `Enter` applies and `Esc` clears;
  - `Enter` opens the action's form (`nav.open`).
- [ ] **Step 1: Write the failing tests.**
  - **Filter parsing:** `parseActionFilter("owner:anna project:CRM budget")` → `{ owner: "anna", project: "CRM", text: ["budget"], status: "open" }`.
  - **Screen** (seed actions due 2026-11-09 (me, CRM, for @peter), 2026-11-13, 2026-11-15, 2026-11-16, 2026-11-30 and no date):
    - `groups by due date`: the frame shows `Overdue · 1`, `This week · 2`, `Next week · 1`, `Later · 1` and `No date · 1`, in that order. The overdue row shows `me` and `Peter`.
    - `filter owner:anna`.
    - `x completes and row leaves`.
    - `d changes due`: `+1w` moves the action to `Next week`, with due `2026-11-20`.
    - `CLI done removes the row and selection moves to the next`: select the second row of This week, then a second kernel connection runs `pm action done <ref>` through `runCli`. After the refresh the row is gone and the selection is on the row now at that index.
    - `for/from shows inbox origin`: an action created by `runCli([... "--from-inbox", "I-1"])` shows `inbox I-1`.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(projects-tui): Actions screen with groups and filter`.

---

### Task 13: Overview panels (projects, people, inbox)

**Files:**
- Create: `src/plugins/projects/logic/overview.ts` (moved from `report.ts`, `registerOverview`), `src/plugins/projects/tui/panels.ts`, `src/plugins/people/tui/index.tsx`
- Modify: `src/plugins/projects/logic/report.ts` (the overview report sections call `overview.ts`), `src/plugins/tui.ts` (add people), `src/plugins/inbox/tui/index.tsx` (created here with only its panel; Task 14 adds the rest)
- Test: `src/plugins/projects/tui/panels.test.tsx`

**Interfaces:**
- Produces, in `overview.ts`: `makeOverview(rt: PluginRuntime, store: Store, items: Items)`, which returns `{ overdueActions(), dueThisWeek(), projectsNeedingAttention(), milestones(), highRisks() }`. Each returns typed rows. The existing `report overview` output must stay byte-identical, and the phase 1 report tests must keep passing unchanged.
- **Panels.** The cells follow the mockup's Overview screen:

  | Plugin | Panel | Priority | Rows | Empty text |
  |---|---|---|---|---|
  | projects | Overdue actions | 10 | `A-27  Send revised budget to Peter  CRM  -3d` (red) | `No overdue actions.` |
  | projects | Due this week | 20 | due as `Fri`; deliverables due this week are left out | `Nothing due this week.` |
  | projects | Projects needing attention | 30 | dot, code, comment, `upd 9d ago`, or `Health not updated` and `31d ago` / `never` | `No project needs attention.` |
  | projects | Late milestones · next 14 days | 40 | late ones first with `-6d` in red, then the upcoming ones with `26 Nov` | `No late milestones and none in the next 14 days.` |
  | projects | High risks & issues | 50 | ref, title, project, type | `No open high-severity risks or issues.` |
  | people | Stakeholders to contact | 60 | name, `high/high · CRM, HRP`, `41d`; footer `last contact over <staleContactDays> days, high influence first` | `No stakeholders to contact.` |
  | inbox | Inbox | 70 | `I-17  <text clipped>` | `Inbox is empty` |

  - People's panel uses `ui.self().read.staleStakeholders({ days: config.staleContactDays })`. The people TUI part has only this panel in phase 2.
  - Inbox's panel lists the new items, oldest first.
- [ ] **Step 1: Write the failing tests:**
  - `empty overview`: on an empty database, all seven empty texts appear.
  - `overdue panel`: action due 2026-11-10 on CRM → `-3d` and `CRM`.
  - `attention panel`: IAM with no health shows `Health not updated`; ERP red shows the red dot first.
  - `stakeholders panel`: a high-influence stakeholder with the last note on 2026-10-03 shows `41d`.
  - `Enter on overdue row opens the action form`.
  - The existing `report overview` tests are unchanged and still pass.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement** (refactor first, then the panels).
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(tui): Overview panels from projects, people and inbox`.

---

### Task 14: Inbox: quick capture, badge, Inbox screen (6), process by hand

**Files:**
- Create: `src/plugins/inbox/tui/capture.tsx`, `inbox-screen.tsx`, `process.tsx`
- Modify: `src/plugins/inbox/tui/index.tsx`, `src/plugins/tui.ts` (add inbox)
- Test: `src/plugins/inbox/tui/capture.test.tsx`, `inbox-screen.test.tsx`

**Interfaces:**
- Consumes: `ui.tags.suggest` (Task 2), `useNav().route()` (Task 4) for the prefill, `useOverlay().openForm` (Task 7) and `registry.forms(type)`, inbox ops `capture`, `editItem`, `markProcessed`, `dismiss`, `reopen`, `getItem`.
- Produces:
  - `globalAction({ id: "capture", key: "i", label: "capture", overlay })`;
  - `statusBadge({ id: "inbox", order: 10 })`, with the text `● <n> new in inbox` when n > 0, otherwise `null`;
  - `screen({ id: "inbox", title: "Inbox", slot: 6, count })`, whose count is the new items.
- **Capture overlay:**
  - The title is `Capture to inbox · enter save · esc cancel`, followed by a multi-line input.
  - When the route is a record route for a `project` or `person` ref, the text starts with that tag (`#CRM `), and a line below says `#CRM added because you're on the CRM project` (for a person: `@anna added because you're on Anna Peeters`).
  - Autocomplete: while the word at the cursor starts with `#` or `@` and has at least one character, show up to 5 `suggest` results (`@marie  Marie Dubois`). `↑↓` select, and `Tab` replaces the word with the ref plus a space.
  - `Enter` saves through `capture` and closes with `notify("captured I-<n>")`. `Shift+Enter` or `Ctrl+J` insert a newline. `Esc` cancels.
  - It sets `textFocus(true)`.
- **Inbox screen:**
  - The group `New · n` lists new items oldest first, with ref, time, then text.
    - Time is `today 09:42`, `yesterday`, or `Mon 9 Nov` for older items.
    - Unresolved tags are marked `⚠` and coloured amber.
  - The group `Processed · last 7 days` lists items processed or dismissed with `processed_at` ≥ today − 7, newest first. Each has a second line:
    - for a processed item: `✓ <by> → <summary>`, then the created records from `getItem` (`→ A-38, R-12`);
    - for a dismissed one: `✗ dismissed by <by>`.
  - Keys:
    - `Enter` on a processed item opens the first created record, and on a new item opens the item's edit form;
    - `e` edits the text (`editItem`);
    - `z` dismisses (`by: "you"`);
    - `u` reopens;
    - `p` processes the item by hand, as described next.
- **Process by hand (`p`):**
  - The menu lists every `recordForm` registered for the types `action`, `decision`, `risk` and `project`/`health`, plus `note` when people registers one (phase 3). Labels come from `RecordFormDef.label`.
  - Picking an entry opens that form with `prefill: { title: <item text without tags>, project: <first #tag ref>, … }` and `origin: { type: "inbox", ref: "I-n" }`.
  - On save, call `markProcessed({ ref, summary: "<label> <savedRef>", by: "you" })`.
  - The created record then shows as provenance.
- [ ] **Step 1: Write the failing tests:**
  - **Capture:**
    - `i captures from any screen`: on Projects, press `i`, type `call @anna about #CRM`, then Enter. An inbox item exists with that text and links to `@anna` and `#CRM`, and the screen is still Projects.
    - `prefill on project`: in the CRM record view, `i` starts with `#CRM ` and shows the explanation line.
    - `autocomplete @an + Tab`: the text becomes `@anna `.
    - `typing q and 2 in capture inserts them`.
    - `ctrl+j inserts newline`: the item text contains `\n`.
    - `Esc cancels`: no item.
  - **Badge:** `badge counts new items`: the header shows `● 2 new in inbox`, and nothing once both items are dismissed.
  - **Inbox screen:**
    - `inbox groups new and processed`: dismissed I-3 (processed_at 2026-11-12) shows `✗ dismissed by you`, and one processed on 2026-11-01 is hidden.
    - `unknown tag flagged`: `#CMR ⚠`.
    - `p → Action creates action with provenance and marks processed`: the action's title has the tags stripped and its project is CRM. The item is `processed`, with summary `Action A-1`, and the screen shows `→ A-1`.
    - `z dismisses, u reopens`.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(inbox-tui): quick capture, badge, Inbox screen, process by hand`.

---

### Task 15: `listColumn` and `field` extension points

No built-in plugin uses these, so they're proven with `tests/fixtures/tui-fixture.ts`.

**Files:**
- Create: `src/kernel/fields.ts` (FieldRegistry), `components/RecordFields.tsx`, `tests/fixtures/tui-fixture.ts`
- Modify: `src/kernel/plugin.ts` and `host.ts` (`ctx.field`), `src/kernel/tui/components/Form.tsx` (extra fields), `src/plugins/projects/tui/projects-screen.tsx` (`listId: "projects"`), `actions-screen.tsx` (`listId: "actions"`), `project-summary.tsx` (`<RecordFields>`), `api.ts`
- Test: `src/kernel/tui/extensions.test.tsx`, `src/kernel/fields.test.ts`

**Interfaces:**
- Produces: `ctx.field(recordType: string, def: FieldDef)` in logic, with `FieldDef = { name: string; label: string; type: "text" | "number" | "date" | "enum"; values?: string[]; get: string; set: string }`.
  - `get` names the plugin's own read operation, taking `{ ref }` and returning `{ value: string | number | null }`.
  - `set` names the plugin's own write operation, taking `{ ref, value }` and returning `{ ref }`.
  - At boot, the kernel checks that both operations exist (missing → the plugin fails: `field "<name>": no read operation "<get>"`).
  - Fields are sealed like other registrations.
- Produces: `kernel.fields.for(recordType): Array<{ plugin: string; def: FieldDef }>`.
- Produces: `<RecordFields recordType ref />` (`Label  value` rows, each value read through the owning plugin's `get` op). Record forms show those fields after their own. On submit, the plugin's own operation runs first, then each changed extra field's `set` op. A `fieldEditor` overrides the default editor for its field type.
- **CLI.** `show --json` / `edit --<flag>` integration is **deferred to phase 5** (ruling R22, below), because built-in commands format their own output and no plugin registers a field before external plugins exist.
- [ ] **Step 1: Write the failing tests.** The fixture plugin `budget` requires `projects`, owns a table `amount(project_id, eur)`, exposes `getBudget`/`setBudget`, and registers `field("project", { name: "budget", label: "Budget", type: "number", get: "getBudget", set: "setBudget" })`. Its TUI part registers `listColumn("projects", { id: "budget", title: "Budget", width: 8, value })`. The tests:
  - `projects table shows the extra column`: `Budget` header, `12000` on CRM;
  - `summary shows extra field`: `Budget  12000`;
  - `project form edits extra field`: setting 15000 → `getBudget` returns 15000;
  - `field with missing op fails the plugin`;
  - `field registration after boot throws`.
- [ ] **Step 2: Run them** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(kernel): field and listColumn extension points`.

---

### Task 16: Docs, CLAUDE.md, final checks

**Files:**
- Modify: `docs/architecture.md`:
  - a TUI section covering the layout of `src/kernel/tui/`, `TuiContext`, the rules for `useQuery`/`act`, keys and focus, and live refresh;
  - the UI-import rule now names `src/kernel/tui/` and `src/plugins/*/tui/`;
  - new red flags: a TUI component calling `ctx.data` DML, a `new Date()` in the TUI, or a single-letter key handled without the text-focus guard.
- Modify: `CLAUDE.md`. Remove the starter-UI paragraph. Describe `bun start` = the `pm` TUI, the TUI test helper `renderTui`, and the new smoke line `tui ok`.
- Modify: `docs/superpowers/plans/2026-11-13-pm-phase1-followups.md`. Add a "Phase 2" section with the rulings made during execution and the deferred minors.
- Modify: `README.md` (one line: `pm` with no arguments opens the TUI).

- [ ] **Step 1: Update the docs.**
- [ ] **Step 2: Run** `bun test`, `bun typecheck` and `bash scripts/smoke-node.sh`. Expected: all pass, and the smoke output contains `tui ok` and `smoke ok`.
- [ ] **Step 3: Walk through it by hand** in a real terminal on Bun and on Node (`npm run start:node`): Overview, `2`, Enter on a project, `→` to Context, `e`, Ctrl+S, `i` capture, `6`, `q`. Report what was tried, and say so if no TTY was available.
- [ ] **Step 4: Commit** `docs: phase 2 TUI architecture, CLAUDE.md, follow-ups`.

---

## Rulings made in this plan (review these)

- **R22.** The `field` extension point gets its data side and TUI side in phase 2. Its CLI side (`show --json`, `edit --<flag>`) moves to phase 5. Cost if wrong: a field added by a plugin is invisible to Copilot until phase 5. No built-in plugin uses fields.
- **R23.** `overviewPanel` is data-driven (`load()` returns rows of cells with a ref), not a free component. All panels then look the same and support Tab, Enter and `+N more`. Cost if wrong: a plugin can't draw a custom panel (a chart, say) until a `component` option is added. That addition is compatible.
- **R24.** `recordForm(recordType, def)` is a TUI registration the spec's list doesn't name. It is how `n`/`e` open forms and how Inbox `p` offers "turn into action, decision, risk or health update" without inbox requiring `projects`. Cost if wrong: one more extension point to keep stable in `apiVersion` 1.
- **R25.** Shift+Enter has `Ctrl+J` as an alternative and `Ctrl+S` has `Esc` `s`, because many terminals (and possibly xterm.js) can't tell Shift+Enter apart from Enter. Task 3 may suggest more.
- **R26.** In phase 2 the People TUI part holds only the "Stakeholders to contact" panel, so Overview is complete. The People screen is phase 3.
- **R27.** Closed (but not archived) projects show in their own `Closed` group on the Projects screen. The spec only names active, on-hold and archived.
