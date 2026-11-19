# ttybrain architecture primer

Read this before changing anything under `src/kernel/` or `src/plugins/`. It condenses the design. The full detail, with the reasons, is in `docs/superpowers/specs/2026-11-13-pm-design.md` ("the spec"); per-plugin tables, views and operations are in `docs/superpowers/specs/2026-11-13-pm-plugins.md` ("the plugin reference"). If this primer and the spec disagree, the spec wins. Fix the primer in the same change.

## What ttybrain is

ttybrain is a personal, single-user tool for following up projects, team, stakeholders and meetings. It has:
- a CLI, `ttybrain <thing> <verb>`, also used by GitHub Copilot as an agent;
- a terminal UI (OpenTUI + Solid; `ttybrain` with no arguments in a terminal opens it);
- an inbox for quick capture.

It runs on **Bun ≥ 1.3.14 and Node ≥ 26.4**, both always, locally or in a per-user container behind a web terminal. Data is one SQLite file under `TTYBRAIN_HOME`, default `~/.ttybrain`.

## The one idea: a small kernel plus plugins

```
src/kernel/                 knows nothing about projects or people
  api.ts                    the only module plugins import from the kernel, as `@ttybrain/api` (definePlugin, Type, NonBlank, errors, dates, refs …)
  plugin.ts                 PluginDef and PluginContext (what `activate(ctx)` gets)
  host.ts                   bootKernel(): load order, migrations, contexts, failure isolation, sealing
  db/sqlite.ts              the ONLY runtime-specific code (bun:sqlite / node:sqlite behind RawDb)
  db/kernel-db.ts, driver.ts, scope.ts, explain.ts
                            the connection, kernel transactions/savepoints, layer 1 (scope.ts) and layer 2 (explain.ts)
  migrations.ts, views.ts, operations.ts, records.ts, tags.ts, reports.ts, guide.ts, fields.ts, changesets.ts,
  provenance.ts, events.ts, context.ts, clock.ts, config.ts, paths.ts, home-move.ts, dates.ts, refs.ts, errors.ts
                            the registries and services
  cli/                      args.ts, commands.ts (registry), dispatch.ts (`runCli`), kernel-commands.ts, output.ts
  shutdown.ts               clean shutdown on SIGHUP/SIGTERM
  isolation-selfcheck.ts    repeats the isolation cases on the current runtime (also run by the Node smoke test)
  loader.ts                 discoverPlugins(): built-in folder, plugin folders, npm deps → plugin candidates (manifests)
src/bin/pm.ts               the `ttybrain` entry point: boots the kernel with discovered plugins (`discover: true`) and runs the CLI
src/plugins/<id>/package.json  the plugin manifest (`main`, `ttybrain.id`, `ttybrain.tui`); the build copies it to dist-node with .js entries
src/plugins/<id>/logic/     index.ts (definePlugin), schema.ts, views.ts, ops*.ts, commands*.ts, records.ts, report.ts, guide.ts: NO UI imports
                            (meetings: ops.ts, records.ts, since.ts, reports.ts, commands.ts, views.ts, guide.ts, schema.ts)
src/kernel/tui/             the TUI kernel: frame, router, keys, overlays, data hooks, building blocks (see "The TUI")
src/plugins/<id>/tui/       screens, record tabs, panels, forms, badges: each plugin's TUI part (`defineTui`)
tests/helpers.ts            makeTestKernel; tests/builtins.ts the built-ins as static lists (tests only); tests/fixtures/ fixture plugins
```

Every feature is a plugin, built-ins included: `people`, `projects`, `meetings`, `inbox`, `assistant`. Built-ins use exactly the same API as external plugins: they are found by the same loader, described by the same manifest, and import only `@ttybrain/api` and `@ttybrain/api/tui` (`tests/logic-ui-split.test.ts` and a plugin-imports test enforce it; a relative import into `src/kernel` from a plugin's non-test file fails). If a built-in needs something the API doesn't offer, **extend the API**; never take a shortcut into the kernel. There are no static plugin lists in `src/` (`src/plugins/index.ts` and `tui.ts` are gone); tests that need the built-ins import `tests/builtins.ts`.

## Plugin loading

- **Manifest.** A plugin is a directory with a `package.json`: `"type": "module"`, `main` (the logic entry, default export a `PluginDef`), `"ttybrain": { "plugin": true, "id": "<id>", "tui"?: "<entry>" }` (the default export of the tui entry is a `TuiDef`). `ttybrain.id` is required, so a disabled plugin's id is known without importing it; the loader fails a candidate whose `ttybrain.id` differs from `PluginDef.id`, or whose `version` differs from `PluginDef.version`. Built-ins carry `"private": true`, with source entries (`logic/index.ts`, `tui/index.tsx`); the Node build copies their manifests to `dist-node/plugins/<id>/` with `.js` entries.
- **Sources and order.** `discoverPlugins()` (`src/kernel/loader.ts`) yields candidates with source `built-in` (ttybrain's own `plugins` folder, found from the loader's module URL), then `folder` (subdirectories of `paths.plugins`, `~/.ttybrain/plugins` or `TTYBRAIN_PLUGINS`, by directory name), then `npm` (the `dependencies` of `paths.plugins/package.json`, by package name). The host then sorts by `requires`. `bootKernel({ discover: true })` boots them; `makeTestKernel({ plugins })` still passes `PluginDef`s.
- **Failure and timeouts.** A failing import, a bad default export, a manifest mismatch, a duplicate id (`duplicate plugin id "<id>"`), or an external id equal to a built-in's (`plugin id "<id>" is taken by a built-in plugin`) makes a failed entry that `ttybrain plugin list` and Help show; nothing it did is kept. Importing an external candidate, an external `activate` and importing an external plugin's `ttybrain.tui` entry are each raced against 5000 ms (`<id>: timed out after 5000 ms while <importing|activating>`); built-ins have no timeout. An external migration's `up` has no timeout (an accepted gap: one that never settles hangs boot while holding the write lock). Disabled plugins (`plugins.disabled`) are never imported. External migrations run with the trigger ban; built-ins without it.
- **Shared modules.** `globalThis.__TTYBRAIN_MODULES__` holds `@ttybrain/api` (set at CLI start) and, in the TUI, `@ttybrain/api/tui`, `solid-js`, `solid-js/store`, `@opentui/solid`, `@opentui/core` (`installTuiModules`, `src/kernel/tui/load.ts`). `ttybrain plugin build` rewrites a plugin's imports of those names to generated shims in `dist/__pm/`. Shims are generated from what the plugin imports, so the build never loads UI modules; each shim checks at load that every imported name exists on the host module and throws `rebuild the plugin with this ttybrain (missing export "<x>" from "<name>")` otherwise. Only named imports are allowed: `import * as x` or `export *` of a shared module fails the build (`<file>: use named imports from "<name>"`), as does importing a `@opentui/*` package other than `@opentui/solid` and `@opentui/core`, and a logic entry that reaches `solid-js`, `@opentui/*` or `@ttybrain/api/tui`. A computed import such as ``import(`solid-${x}`)`` is not caught; a plugin's own npm dependencies that import Solid load their own copy (a known limit).
- **TUI parts.** `loadTuiParts` imports the `ttybrain.tui` entry of each plugin whose logic is `ok`, in load order. A part that fails to import, throws, or returns a thenable from `activate` fails alone (its registrations are removed, the rejection swallowed); its logic stays loaded.
- **Commands.** `ttybrain plugin list|enable|disable|build|add|remove|new`. `enable`/`disable` edit `plugins.disabled` in the config file (written atomically, through a symlinked config, keeping its mode); `disable` names the plugins that require it; `enable` notes when `TTYBRAIN_CONFIG_JSON` still disables the id. `add <npm-name|path|tgz>` installs into `paths.plugins` with `npm` when `npm --version` runs, else `bun add --cwd` under Bun, else `ttybrain plugin add needs npm on the PATH` (`ttybrain plugin remove …` for remove); an add that turns out not to be a ttybrain plugin is undone (a package that was there before is reinstalled from its previous spec); `TTYBRAIN_PLUGIN_INSTALLER=npm|bun` forces one (tests use it). The first add of a package name prints the trust warning and records the name in `plugins.allow` (it only means "already warned"; it gates nothing). `remove <id>` is **destructive** (needs `--yes`: it deletes a folder or uninstalls a package), refuses a built-in (`"<id>" is built in; use "ttybrain plugin disable <id>"`) and an id shared by more than one plugin; a symlinked folder entry is only unlinked, never its target; `--purge-data` also drops the plugin's tables and kernel rows. A disabled plugin's data stays; a built-in's data cannot be purged. `new <id>` scaffolds a buildable plugin.
- **Kernel services for this.** `Kernel.checkOrigin(origin)` (see Operations), `Kernel.requiresOf(id)`, and a deep-frozen `ctx.config`.

## Data rules (enforced by the kernel)

1. **Plugins never touch the database directly.** They get `ctx.data`, a scoped Kysely instance (`Kysely<any>`), and nothing else. There is no connection handle and no `kysely.transaction()`, `BEGIN`, `SAVEPOINT` or `PRAGMA` (raw `sql` for those is rejected).
2. **Short names, prefixed physically.** A plugin writes `selectFrom("action")`; the kernel turns it into `projects_action`. A plugin can only address tables it created in its own migrations. Plugin ids and table short names may not contain `__` (it is the view separator), and `kernel` and `sqlite` are reserved ids.
3. **Cross-plugin reads use published views only**, written `<plugin>.<view>`, e.g. `leftJoin("people.person as o", "o.id", "a.owner_id")`. Views are read-only, declared with `ctx.publish(name, { version, columns, query })`, and are a versioned contract. Declare the plugins whose views you read in `reads`. `reads` is recorded after `activate` returns, so **do not query views during `activate`**.
4. **Cross-plugin writes use exposed write operations only**: `ctx.use("projects").write.addAction({...})`, and only for plugins in `requires`.
5. **Two checks enforce 1–4.**
   - *Layer 1* rewrites and checks the Kysely query tree: tables, aliases, views, columns, and DDL only in migrations.
   - *Layer 2* runs `EXPLAIN` on the compiled SQL and checks the tables actually touched. Table-valued functions and virtual tables (`pragma_table_info`, `dbstat`, `json_each`: opcodes `VOpen`/`VFilter`) are rejected, since they open no table the check can see.
   - Their state travels with each query: no shared mutable state.
   - **R15: plugin data changes (insert/update/delete/replace, also raw) are only accepted inside a write operation.** Outside one, `ctx.data` can read and nothing else. A bare kernel write that is not an operation (the TUI's `act`, a change set) is a transaction only and does not count: only the scope the operation wrapper opens does. Migrations are the exception.
6. **Schema changes only in `ctx.migration(id, up)`.** The kernel runs each migration in its own transaction and checks the result: prefixes, no foreign objects, no triggers for external plugins. Foreign keys are deferred to the migration's commit, so an own table that other own tables reference can be rebuilt (copy, drop, create, copy back: projects `002`); don't rename it out of the way, since a rename rewrites the references to it.
7. **Transactions belong to the kernel.** Every write operation runs in a kernel transaction, and nested calls use savepoints. Never start one in a plugin. **A nested write (`ctx.use(x).write.y(...)`) must be awaited** before the parent issues more statements; a statement guard fails a statement issued while a nested write is still pending, and an un-awaited nested write is drained into its parent (commits or rolls back with it). After-commit hooks (events such as `record.changed`) run after the outermost commit and **without an origin**. Reads share one connection, so a read can see another concurrent chain's uncommitted writes; this is accepted for a single-user tool.
8. **Soft references.** A plugin may store another plugin's record id as a plain column, e.g. `owner_id`. It displays it by joining that plugin's published view, never its tables.
9. **Registrations only during `activate`.** `migration`, `publish`, `expose`, `recordType`, `tagType`, `command`, `report`, `reportSection`, `guideSection` and `field` throw once boot is done (the host seals the contexts).

## Operations

```ts
ctx.expose({
  read:  { projectStatus: { input: T.Object(…), output: T.Object(…), run: async (i) => … } },
  write: { addAction:     { input: …, output: …, describe: (i) => `+ action "${i.title}"`, run: async (i) => … } },
})
```

- Schemas use **TypeBox** (`Type` from `src/kernel/api.ts`). The kernel validates the input before `run` and reports the failing field.
- Text inputs use `NonBlank(...)` (from `api.ts`) instead of a bare `Type.String()`, so blank strings are rejected as validation errors.
- **Write outputs must include `ref`**, the display ref of the main record (`"A-41"`). Provenance and change sets depend on it.
- **One delete convention:** a write that deletes its record returns `Deleted` (from `api.ts`): `{ ref, deleted: true }`. The kernel then records no provenance for it and forgets the record's provenance rows in the same transaction (ids are rowids and get reused). A delete of a record whose type has a custom ref (`#CODE`, `@handle`) also returns the record's `id` (`{ ref, deleted: true, id }`), since the ref says nothing about it; without it the write fails. A write may only delete its own plugin's records: a delete output naming another plugin's record fails the write.
- `describe(input)` returns the one-line change description shown in change sets.
- **Read operations are only for logic** (`projectStatus`, `sinceDate`, `staleStakeholders`, `getContext`). Plain lists and joins use views.
- **Context comes from the kernel** (`currentContext()`: `today`, `now`, `origin`), never from `new Date()`. Use the injected clock everywhere, so tests can pin "today".
- `ctx.config` is deep-frozen: every plugin shares the one object, so none can change it for the others.
- **Extra fields on another plugin's records:** `ctx.field(recordType, { name, label, type, values?, get, set })` names two of the plugin's own operations, `get` (read, `{ ref }` → `{ value }`) and `set` (write, `{ ref, value }` → `{ ref }`); boot fails the plugin when either is missing. The value lives in the plugin's own table. The TUI shows it in the record's Summary (`<RecordFields>`) and forms (`<Form recordType recordRef>`: the kernel saves the changed extra fields itself, inside the act the form's submit runs, after the plugin's own operation and for the ref it returned); its CLI side is phase 5 (R22).
- `ctx.records` offers `resolve(ref)`, `label(ref)`, `refOf(type, id)` and `hasType(name)`; use `hasType` to validate a soft reference to an optional plugin's records only when that plugin is loaded.
- **Every write emits `record.changed`.** With an origin (`--from-inbox I-n`), the kernel records provenance itself (not for a delete, and not when the ref is the origin itself). Don't add `inbox_item_id` columns. The kernel refuses an origin whose ref belongs to a registered record type but does not resolve (`no record "I-99"`, exit 2), and an inbox origin when no plugin owns the `I-` prefix (`--from-inbox needs the inbox plugin, which is not loaded`, exit 1); both checks are `kernel.checkOrigin(origin)`, which every path that writes with an origin awaits first: the CLI dispatcher (which names the flag: `--from-inbox: no record "I-99"`), `changeSets.apply` and the TUI's `act`.

## The TUI (phase 2)

The TUI is a kernel part plus one `tui/` part per plugin, with the same isolation idea as the data side: the kernel knows no domain, plugins fill it in through extension points.

```
src/kernel/tui/
  api.ts                    the ONLY module a plugin's tui/ part imports from the kernel, as `@ttybrain/api/tui` (defineTui, types, hooks, blocks, format, theme)
  types.ts, registry.ts     TuiDef/TuiContext and the registry of all registrations; boot.ts: bootTui() activates each part in its plugin scope
  load.ts                   installTuiModules() (the shared UI modules for external plugins), loadTuiParts(): each ok plugin's ttybrain.tui entry
  run.tsx                   runTui(): loads the tui parts, creates the renderer, mounts <TuiApp>, restores the terminal on quit; selfcheck.tsx: the Node `tui ok` check
  app.tsx, frame.tsx        <TuiApp> (router, overlay stack, global keys), header and status bar
  keys.ts, escChord.ts      key dispatch layers, hints, text focus, the Esc chord; nav.ts: routes; overlay.tsx: overlays, openForm, confirm
  data.ts, refresh.ts       useQuery, act, useRuntime, useRecord; live refresh (PRAGMA data_version)
  drafts.ts                 drafts of unsaved forms, capture and editor text (TTYBRAIN_HOME/drafts), useDraft
  scope.tsx, external.ts    PluginScope (which plugin a component belongs to); $VISUAL/$EDITOR handoff
  components/               Table, Form, Field, Panel, Tabs, Menu, RecordView, RecordFields, OverviewScreen, Editor, DraftPrompt, Help, Switcher, KeyHints, ErrorBoundary, ReportSections
  export.ts                 writeExport(dir, fileName, text), the hooks useWriteExport() and useCopyText()
  format.ts, theme.ts, messages.ts   display width/dates, colours and tones, status-bar notices
src/plugins/<id>/tui/       index.tsx = defineTui({ plugin, activate(ui) }) plus the plugin's screens, forms, panels
tests/tui.tsx               renderTui(kernel, { parts, external, width, height, refreshMs, draftMs }) -> { frame(), peek(), spans(), input, settle(), nav, renderer, destroy() }
```

A part registers in `activate(ui)` with: `ui.screen` (built-in screens use a fixed number key: `1` Overview, `2` Projects, `4` Actions, `6` Inbox; `3` People (phase 3) and `5` Meetings (phase 4) are built; other screens get `7`, `8`, … in registration order), `recordTab`, `overviewPanel`, `listColumn`, `recordForm`, `fieldEditor`, `globalAction`, `statusBadge`. Registrations may be made only during `activate`. A part that throws, or whose entry fails to import, is isolated and listed in Help; the rest of the app runs. `activate(ui)` must be synchronous: a part whose activate returns a promise fails with `<id>: tui activate must be synchronous`. Help's key list adds one line per registered global action, so `i capture` shows only when inbox is loaded.

Rules:
- **Imports.** A tui part imports kernel things only from `@ttybrain/api/tui` (`src/kernel/tui/api.ts`), and logic only from its own plugin's `logic/`, never another plugin's files. Logic and the rest of the kernel never import `solid-js` or `@opentui/*`. Only `src/kernel/tui/` and `src/plugins/*/tui/` may. Keep imports extensionless (the Node build adds `.js`).
- **Reading.** `useQuery(load, { key })` runs `load` in an operation context (views, `rt.self().read`), reloads on live refresh, and keeps the last data while reloading. Get your plugin's runtime with `useRuntime()` (`data`, `self()`, `use(x)`, `records`, `tags`, `provenance`, `clock`, `config`). Reading is the only thing `rt.data` is for.
- **Writing.** Only through `act(() => rt.self().write.op(...), { origin?, ok? })`; never DML on `rt.data`. `act` runs `fn` in ONE outermost kernel write transaction: ops inside become savepoints, so several ops in one `act` are all-or-nothing, and a busy retry (`BusyError`) redoes the whole thing. It therefore holds the write lock for as long as `fn` runs: **never await user interaction (`confirm`, `openForm`, an editor) inside `act`**; await it first, then `act`. The kernel also saves a form's extra fields (the `field` extension point) inside the same `act` as the form's own op.
- **Time.** No `new Date()`/`Date.now()`; today is `rt.clock.today()` inside a load or an action, and `useToday()` (an accessor) in memos and JSX: live refresh notices a new day and updates it (and reloads), so a TUI left open overnight follows.
- **Keys and focus.** Take keys only with `useScreenKeys(handler)`: it ignores keys while an overlay sits above the component, so overlays get them first. Claim a handled key with `key.preventDefault()`; screen keys run before a child Table's, and the global keys skip a claimed key. Dispatch order: overlay, text field, focused screen's keys, global actions, global keys. A text input calls `useKeys().textFocus(true)` while focused, which switches the single-letter global keys off, and `useScreenKeys` then withholds printable keys and Enter from every handler on that layer; the component that owns the text field (a form, an editor, a filter input) passes `useScreenKeys(handler, { whileTyping: true })` to get them. Other keys (arrows, Esc, Tab, Delete) still reach every handler: `useKeys().typing()` tells a block or screen that acts on them that a text field has focus. Pass `focused` props gated on `useKeys().active()`. Register status-bar hints with `useKeys().hints([...])` or `<KeyHints>`; the bar drops whole hints that do not fit. A plugin's `globalAction` key may not be one of `RESERVED_KEYS` in `registry.ts` (`j k n e x g q ? / c` and `1`-`9`) or already taken; a conflict skips just that action, with `<plugin>: key "<k>" is already taken` in Help (spec §3.4), and the rest of the part loads. Screen-local letters are not reserved; screen keys run before global actions, so a screen's own letter shadows a global action with the same key while that screen is focused (the action cannot be reached there; revisit in phase 5). Text-entry keys have one meaning each: Enter is always "new line" (it inserts a newline in a multi-line field, the editor and quick capture, and does nothing in a one-line form field: it never saves and never moves field); Tab / Shift+Tab change field; saving is Ctrl+S (saves and closes), or `Esc` then `s` (a fast `Esc` `s` arrives as Alt+S, which saves too); `Esc` alone cancels. Do not advertise Shift+Enter or Ctrl+J: many terminals, and browser terminals (xterm.js), send Shift+Enter as plain Enter. Filter inputs (`/`) are not forms: Enter applies the filter there.
- **The `recordRef` prop rule.** A record reference prop is `recordRef`, never `ref`: Solid compiles a JSX `ref=` into an element-ref callback. This holds for `RecordTabDef.component`, `count?(recordRef)`, `when?(recordRef)` (the tab shows only for records it resolves true for; a throwing check keeps it), `RecordFormProps.recordRef` and `<RecordView recordRef>`. `Route` objects (plain data) keep a `ref` field.
- **Live refresh.** `createLiveRefresh` polls `PRAGMA data_version` about every second and bumps a version that makes every `useQuery` reload, so changes from the CLI show up. After the app's own `act`, a refresh bump is scheduled too. `renderTui`'s `settle()` waits for in-flight loads and that scheduled bump; wait on a frame condition rather than sleeping.
- **Acting on rows.** `Table` calls `onSelect(undefined)` when it has no rows; act on `e`, `x`, `Del` and the like only when the selected ref is among the rows currently shown. Selection is kept by ref across reloads. A Table scrolls only inside a height-bounded parent (a `<Panel grow>`). Edit forms send only the fields whose value changed, and close without writing when nothing changed.
- **Forms.** `<Form title fields submit close>`; a field's `name` must equal the op input name, so a `ValidationError(field)` shows inline. `required` only marks `*`; the op validates. `submit(values)` returns `{ ok: true, ref? } | { ok: false, error, field? }`, typically from `act`; `field` puts an error that names no field itself (an op's `NotFoundError` for one of the values) under that field. `openForm(recordType, formId?, { recordRef?, prefill?, origin? })` resolves to the saved ref, or `undefined` on cancel.
- **Drafts.** `drafts.ts` keeps unsaved text as JSON files in `TTYBRAIN_HOME/drafts/` (one per key, `{ key, savedAt, values }`, written atomically with `node:fs`), never in the database, so typing takes no write lock and causes no live refresh. A `<Form>` that `openForm` opened keeps one by itself under `<plugin>:<form>:<recordRef | new>[:from:<origin ref>]`, holding every field it shows (extra fields too); the editor keeps one only when `openEditor` gets a `draftKey` (the kernel prefixes the calling plugin); a plugin overlay uses `useDraft(key, initial)` (prefixed the same way) with `<DraftPrompt>`, as quick capture does. A draft is written 1 s after the last change (`renderTui`'s `draftMs` shortens it), at once on Esc and when the tree is disposed (quit), deleted by a save or by the editor's confirmed discard (Esc d, `y`), kept by a form's or quick capture's Esc cancel (`draft kept`); `savedAt` comes from the kernel clock. On reopen a draft that differs from the initial values is offered by `<DraftPrompt>` (`r` restore, `x` discard, Esc close) before the component takes any key: it claims every key and shows its own status-bar hints, and the component's own handler returns early, its hints are withdrawn and its fields are unfocused meanwhile. Drafts older than 30 days are pruned at TUI start; draft I/O errors are swallowed (the first one is reported in the status bar).
- **Reports and exports in the TUI.** `<ReportSections sections skipColumns?>` draws `ReportSectionResult`s as lines (title, one line per row with its mark's icon and tone, `empty`, `text`, muted `note`, a group heading once per group); it takes no keys and the caller puts it in a scrollbox. `useWriteExport()` returns `(fileName, text) => Promise<absolute path>` that writes into `config.exportDir` (creating it, overwriting a file of that name; the name is plain, no separators), and `useCopyText()` returns `(text) => boolean` that copies through the terminal with OSC 52 (false when the terminal refuses; ttyd ignores OSC 52). Call both hooks during component setup. Plugins never import `node:fs` for exports.
- **Tests.** Use `renderTui` and assert on frame text and on the database; seed through write ops inside `runWithContext(kernel.context())`; call `destroy()` in `finally`. `bash scripts/smoke-node.sh` runs the TUI self-check on Node.

## Who owns what

| Plugin | Requires | Reads views of | Owns | Record types |
|---|---|---|---|---|
| `people` | — | projects | person, note, goal | `@handle`, `N-`, `G-` |
| `projects` | people | people, meetings | project, health_update, milestone, deliverable, risk, decision, action, involvement | `#CODE`, `MS-`, `D-`, `R-`, `DE-`, `A-` |
| `meetings` | projects, people | people, projects | meeting, attendee, agenda_item | `M-` |
| `inbox` | — | — | item, link | `I-` |
| `assistant` (phase 7) | — | all (as tools) | — | — |

`requires` must stay acyclic. Use `reads` plus soft references to look "upwards" (as `people` → `projects.involvement` does).

## CLI conventions

- Commands are registered with `ctx.command({ thing, verb, args, flags, run })`. `run` reads through `ctx.data` and views, and writes **only** through `ctx.self().write.*`.
- **Output:**
  - every command supports `--json`;
  - exit codes are `0` OK, `1` validation, `2` not found, `3` conflict or busy;
  - errors are `PmError` subclasses with a `hint`;
  - "not found" includes `did you mean` suggestions.
- **Input:**
  - no prompts, ever; `destructive: true` commands need `--yes`;
  - dates accept `YYYY-MM-DD`, `today`, `tomorrow`, `+Nd`, `+Nw` and `mon`–`sun`, and are output as ISO;
  - references accept `A-12` or `12`, `CRM` or `#CRM`, `anna` or `@anna`.
- An empty action owner, or the token `me`, means **me**. So `me` is a reserved handle: no person can have it.
- **Reports** are registered with `ctx.report({ id, params, prepare?, … })` and extended with `ctx.reportSection(reportId, …)`. The optional `prepare(params)` turns validated params into what the sections get (parsed dates, defaults). Param names `json`, `db`, `from-inbox`, `yes`, `help` and `format` are reserved (they collide with CLI flags).
  - A section result may carry `group` (a heading shared by consecutive sections: Markdown writes it as `##` and the section title as `###`, text and the TUI draw it once), `marks` (one `{ icon?, tone? }` or `null` per row; the icon is written before the row's first cell, the TUI colours it by tone) and `text` (a Markdown paragraph after the table). All three are optional and additive in `apiVersion` 1.
  - A section's `run` may return an array of results, spliced into the report in its place; each element is checked on its own, and a malformed one becomes an error note. A report's `title` may be a function of what `prepare` returned (the board's title names the meeting).
  - `ctx.reports.run(reportId, params)` runs any registered report in the caller's operation context and `ctx.reports.render(result, "md" | "text" | "json")` renders one. The meetings board pack embeds `project-status` this way (one run per agenda project), so sections other plugins add to it appear in the board pack too. Report params become CLI flags verbatim, so they are kebab-case (`previous-meeting`).

## Runtimes

- Only `src/kernel/db/sqlite.ts` may use runtime-specific APIs (`bun:sqlite` or `node:sqlite`, behind `globalThis.Bun`). Everything else is plain ESM and `node:*` modules that both runtimes support.
- The Node build is `scripts/build-node.mjs` (Babel, `.js` extensions added). Keep relative imports **extensionless** in `src/`.
- **Logic never imports `solid-js` or `@opentui/*`**, so the CLI runs on Node without `--experimental-ffi`. The TUI is imported lazily by `src/bin/pm.ts` only when there are no arguments and stdout is a TTY, and needs `--experimental-ffi` on Node (the `bin` shebang and `npm run start:node` carry it).
- Run-as-script detection is runtime-neutral: compare `realpathSync(process.argv[1])` with `fileURLToPath(import.meta.url)`; never `import.meta.main`.
- `bash scripts/smoke-node.sh` builds for Node and runs the savepoint, isolation and TUI self-checks (the TUI one prints `tui ok`, twice: once for the built-ins and once with the built fixture plugin's screen, `--expect-screen`), a CLI walk-through, the fixture plugin walk (build, load as a folder and through `npm pack` + `ttybrain plugin add <tgz>`) and a `ttybrain plugin new` scaffold step; it needs only node/npm and ends with `smoke ok`. CI runs it in the `node-smoke` job, and `bun typecheck && bun test` in the `test` job.

## Testing conventions

- Use `bun test`. Tests sit next to the code as `*.test.ts`; cross-cutting tests and fixtures go in `tests/`. The CLI is `bun run pm …` (`bun src/bin/pm.ts`).
- `makeTestKernel({ plugins, today })` (from `tests/helpers.ts`) gives a temp `TTYBRAIN_HOME` and a fixed clock, default `2026-11-13` (a Friday).
- Test plugins through the CLI (`runCli([...], kernel, io)`) and through their operations. Assert exact values from the spec.
- Anything runtime-sensitive (SQLite behaviour, isolation, savepoints) must also pass `bash scripts/smoke-node.sh` on Node 26.

## Red flags in a change

- A SQL string or `sql\`` template that names another plugin's table, or a `*_` physical table name in plugin code.
- `kysely.transaction()`, `BEGIN` or `SAVEPOINT` in plugin code.
- `new Date()` or `Date.now()` in plugin logic; use the context or clock instead.
- A cross-plugin write that bypasses `ctx.use(...).write`, or a `requires` cycle.
- An import of `solid-js` or `@opentui/*` from `logic/` or from `src/kernel/` outside `src/kernel/tui/`; a plugin `tui/` part importing anything from the kernel other than `@ttybrain/api/tui`, a plugin's non-test file importing the kernel other than through `@ttybrain/api` / `@ttybrain/api/tui`, or another plugin's files.
- `Bun.*` outside `sqlite.ts`; a relative import with an extension.
- A static list of plugins in `src/` (use the loader); a plugin that assumes another built-in is loaded without `requires`/`hasType`.
- A new `inbox_item_id`-style column; use provenance instead.
- A write operation whose output lacks `ref`, or that has no `describe`.
- A command that prompts, prints non-JSON under `--json`, or exits with a code outside 0–3.
- A TUI component that calls `ctx.data` for writes (DML), or any write that does not go through `act(() => rt.self().write.op(...))`.
- `new Date()` or `Date.now()` in the TUI; today is `rt.clock.today()`.
- Raw `useKeyboard` instead of `useScreenKeys` (which withholds printable keys and Enter while a text field has focus); `{ whileTyping: true }` on a handler that does not own the text field; an arrow, Delete or Tab action without a `typing()` check on a layer that has a text field.
- A component prop named `ref` for a record reference (Solid compiles it into an element ref); use `recordRef`.
- `await confirm(...)`, `await openForm(...)` or any other wait for the user inside an `act` callback.
- A TUI test that sleeps a fixed time instead of waiting on a frame condition, or that forgets `destroy()` in `finally`.
- A test that only checks "no error", or uses the real clock.
