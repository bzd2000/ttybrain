# pm architecture primer

Read this before changing anything under `src/kernel/` or `src/plugins/`. It condenses the design. The full detail, with the reasons, is in `docs/superpowers/specs/2026-11-13-pm-design.md` ("the spec"); per-plugin tables, views and operations are in `docs/superpowers/specs/2026-11-13-pm-plugins.md` ("the plugin reference"). If this primer and the spec disagree, the spec wins. Fix the primer in the same change.

## What pm is

pm is a personal, single-user tool for following up projects, team, stakeholders and meetings. It has:
- a CLI, `pm <thing> <verb>`, also used by GitHub Copilot as an agent;
- a terminal UI (OpenTUI + Solid, from phase 2);
- an inbox for quick capture.

It runs on **Bun ≥ 1.3.14 and Node ≥ 26.4**, both always, locally or in a per-user container behind a web terminal. Data is one SQLite file under `PM_HOME`, default `~/.pm`.

## The one idea: a small kernel plus plugins

```
src/kernel/                 knows nothing about projects or people
  api.ts                    the only module plugins import from the kernel (definePlugin, Type, NonBlank, errors, dates, refs …)
  plugin.ts                 PluginDef and PluginContext (what `activate(ctx)` gets)
  host.ts                   bootKernel(): load order, migrations, contexts, failure isolation, sealing
  db/sqlite.ts              the ONLY runtime-specific code (bun:sqlite / node:sqlite behind RawDb)
  db/kernel-db.ts, driver.ts, scope.ts, explain.ts
                            the connection, kernel transactions/savepoints, layer 1 (scope.ts) and layer 2 (explain.ts)
  migrations.ts, views.ts, operations.ts, records.ts, tags.ts, reports.ts, guide.ts, changesets.ts,
  provenance.ts, events.ts, context.ts, clock.ts, config.ts, paths.ts, dates.ts, refs.ts, errors.ts
                            the registries and services
  cli/                      args.ts, commands.ts (registry), dispatch.ts (`runCli`), kernel-commands.ts, output.ts
  shutdown.ts               clean shutdown on SIGHUP/SIGTERM
  isolation-selfcheck.ts    repeats the isolation cases on the current runtime (also run by the Node smoke test)
src/bin/pm.ts               the `pm` entry point: boots the kernel with `src/plugins/index.ts` and runs the CLI
src/plugins/<id>/logic/     index.ts (definePlugin), schema.ts, views.ts, ops*.ts, commands*.ts, records.ts, report.ts, guide.ts: NO UI imports
src/plugins/<id>/tui/       screens, tabs, panels, overlays (phase 2+)
tests/helpers.ts            makeTestKernel; tests/fixtures/ fixture plugins
```

Every feature is a plugin, built-ins included: `people`, `projects`, `meetings`, `inbox`, `assistant`. Built-ins use exactly the same API that external plugins will use in phase 5. If a built-in needs something the API doesn't offer, **extend the API**; never take a shortcut into the kernel.

## Data rules (enforced by the kernel)

1. **Plugins never touch the database directly.** They get `ctx.data`, a scoped Kysely instance (`Kysely<any>`), and nothing else. There is no connection handle and no `kysely.transaction()`, `BEGIN`, `SAVEPOINT` or `PRAGMA` (raw `sql` for those is rejected).
2. **Short names, prefixed physically.** A plugin writes `selectFrom("action")`; the kernel turns it into `projects_action`. A plugin can only address tables it created in its own migrations. Plugin ids and table short names may not contain `__` (it is the view separator), and `kernel` and `sqlite` are reserved ids.
3. **Cross-plugin reads use published views only**, written `<plugin>.<view>`, e.g. `leftJoin("people.person as o", "o.id", "a.owner_id")`. Views are read-only, declared with `ctx.publish(name, { version, columns, query })`, and are a versioned contract. Declare the plugins whose views you read in `reads`. `reads` is recorded after `activate` returns, so **do not query views during `activate`**.
4. **Cross-plugin writes use exposed write operations only**: `ctx.use("projects").write.addAction({...})`, and only for plugins in `requires`.
5. **Two checks enforce 1–4.**
   - *Layer 1* rewrites and checks the Kysely query tree: tables, aliases, views, columns, and DDL only in migrations.
   - *Layer 2* runs `EXPLAIN` on the compiled SQL and checks the tables actually touched.
   - Their state travels with each query: no shared mutable state.
   - **R15: plugin data changes (insert/update/delete/replace, also raw) are only accepted inside a write operation.** Outside one, `ctx.data` can read and nothing else. Migrations are the exception.
6. **Schema changes only in `ctx.migration(id, up)`.** The kernel runs each migration in its own transaction and checks the result: prefixes, no foreign objects, no triggers for external plugins.
7. **Transactions belong to the kernel.** Every write operation runs in a kernel transaction, and nested calls use savepoints. Never start one in a plugin. **A nested write (`ctx.use(x).write.y(...)`) must be awaited** before the parent issues more statements; a statement guard fails a statement issued while a nested write is still pending, and an un-awaited nested write is drained into its parent (commits or rolls back with it). After-commit hooks (events such as `record.changed`) run after the outermost commit and **without an origin**. Reads share one connection, so a read can see another concurrent chain's uncommitted writes; this is accepted for a single-user tool.
8. **Soft references.** A plugin may store another plugin's record id as a plain column, e.g. `owner_id`. It displays it by joining that plugin's published view, never its tables.
9. **Registrations only during `activate`.** `migration`, `publish`, `expose`, `recordType`, `tagType`, `command`, `report`, `reportSection` and `guideSection` throw once boot is done (the host seals the contexts).

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
- `describe(input)` returns the one-line change description shown in change sets.
- **Read operations are only for logic** (`projectStatus`, `sinceDate`, `staleStakeholders`, `getContext`). Plain lists and joins use views.
- **Context comes from the kernel** (`currentContext()`: `today`, `now`, `origin`), never from `new Date()`. Use the injected clock everywhere, so tests can pin "today".
- `ctx.records` offers `resolve(ref)`, `label(ref)`, `refOf(type, id)` and `hasType(name)`; use `hasType` to validate a soft reference to an optional plugin's records only when that plugin is loaded.
- **Every write emits `record.changed`.** With an origin (`--from-inbox I-n`), the kernel records provenance itself. Don't add `inbox_item_id` columns.

## Who owns what

| Plugin | Requires | Reads views of | Owns | Record types |
|---|---|---|---|---|
| `people` | — | projects | person, note, goal | `@handle`, `N-`, `G-` |
| `projects` | people | people, meetings | project, health_update, milestone, deliverable, risk, decision, action, involvement | `#CODE`, `MS-`, `D-`, `R-`, `DE-`, `A-` |
| `meetings` (phase 4) | projects, people | people, projects | meeting, attendee, agenda_item | `M-` |
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
- An empty action owner, or the token `me`, means **me**.
- **Reports** are registered with `ctx.report({ id, params, prepare?, … })` and extended with `ctx.reportSection(reportId, …)`. The optional `prepare(params)` turns validated params into what the sections get (parsed dates, defaults). Param names `json`, `db`, `from-inbox`, `yes`, `help` and `format` are reserved (they collide with CLI flags).

## Runtimes

- Only `src/kernel/db/sqlite.ts` may use runtime-specific APIs (`bun:sqlite` or `node:sqlite`, behind `globalThis.Bun`). Everything else is plain ESM and `node:*` modules that both runtimes support.
- The Node build is `scripts/build-node.mjs` (Babel, `.js` extensions added). Keep relative imports **extensionless** in `src/`.
- **Logic never imports `solid-js` or `@opentui/*`**, so the CLI runs on Node without `--experimental-ffi` (the `bin` shebang carries the flag for the future TUI only).
- Run-as-script detection is runtime-neutral: compare `realpathSync(process.argv[1])` with `fileURLToPath(import.meta.url)`; never `import.meta.main`.
- `bash scripts/smoke-node.sh` builds for Node and runs the savepoint and isolation self-checks plus a CLI walk-through; it needs only node/npm and ends with `smoke ok`. CI runs it in the `node-smoke` job, and `bun typecheck && bun test` in the `test` job.

## Testing conventions

- Use `bun test`. Tests sit next to the code as `*.test.ts`; cross-cutting tests and fixtures go in `tests/`. The CLI is `bun run pm …` (`bun src/bin/pm.ts`).
- `makeTestKernel({ plugins, today })` (from `tests/helpers.ts`) gives a temp `PM_HOME` and a fixed clock, default `2026-11-13` (a Friday).
- Test plugins through the CLI (`runCli([...], kernel, io)`) and through their operations. Assert exact values from the spec.
- Anything runtime-sensitive (SQLite behaviour, isolation, savepoints) must also pass `bash scripts/smoke-node.sh` on Node 26.

## Red flags in a change

- A SQL string or `sql\`` template that names another plugin's table, or a `*_` physical table name in plugin code.
- `kysely.transaction()`, `BEGIN` or `SAVEPOINT` in plugin code.
- `new Date()` or `Date.now()` in plugin logic; use the context or clock instead.
- A cross-plugin write that bypasses `ctx.use(...).write`, or a `requires` cycle.
- An import of `solid-js` or `@opentui/*` from `logic/` or `src/kernel/` (other than the starter UI files).
- `Bun.*` outside `sqlite.ts`; a relative import with an extension.
- A new `inbox_item_id`-style column; use provenance instead.
- A write operation whose output lacks `ref`, or that has no `describe`.
- A command that prompts, prints non-JSON under `--json`, or exits with a code outside 0–3.
- A test that only checks "no error", or uses the real clock.
