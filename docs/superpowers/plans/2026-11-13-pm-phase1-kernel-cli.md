# pm Phase 1: Kernel, CLI and core plugin logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working `pm` command-line tool. It's built on a plugin kernel with kernel-mediated data access, and the `people`, `projects` and `inbox` plugins provide their logic parts. Copilot, or you, can manage projects, people and the inbox from a terminal on Bun and on Node 26.

**Architecture:**
- **Kernel** (`src/kernel/`): the only owner of the SQLite connection. It gives each plugin a Kysely query builder scoped to its own tables plus other plugins' published views. Two layers enforce this: a query-tree check, and an `EXPLAIN` check on the compiled SQL.
- **Plugins** (`src/plugins/<id>/logic/`) register:
  - migrations and published views;
  - typed read and write operations (TypeBox schemas);
  - CLI commands, record types, tag types, report sections and guide sections.
- **The CLI** (`src/kernel/cli/`) dispatches `pm <thing> <verb>` to plugin commands and applies the shared conventions: `--json`, exit codes and date parsing.

**Tech Stack:**
- TypeScript, ESM
- Bun ≥ 1.3.14 / Node ≥ 26.4
- `bun:sqlite` / `node:sqlite`
- `kysely@0.28.18`, `typebox@1.4.3`
- `node:util` `parseArgs`, `node:async_hooks` `AsyncLocalStorage`
- `bun test`

**Spec:** `docs/superpowers/specs/2026-11-13-pm-design.md` (rev. 6). Plugin reference: `docs/superpowers/specs/2026-11-13-pm-plugins.md`. Read both. Section numbers below (§) refer to the design spec.

## Global Constraints

**Runtimes and dependencies**
- Both runtimes must work. Bun ≥ 1.3.14. Node ≥ 26.4. The TUI needs `--experimental-ffi`; the CLI must not.
- ESM only. No Bun-only API outside `src/kernel/db/sqlite.ts`, and there only behind `globalThis.Bun`.
- Phase 1 has no UI. Nothing under `src/kernel/` (except the existing starter files) or `src/plugins/*/logic/` may import `solid-js` or `@opentui/*` (§3.1).
- Exact dependency versions: `kysely` `0.28.18`, `typebox` `1.4.3`. No other new runtime dependencies.

**Data and SQL**
- Dates are `YYYY-MM-DD` strings. Timestamps are ISO 8601 strings.
- Every table has `id INTEGER PRIMARY KEY`, plus `created_at` and `updated_at` as ISO timestamps (§4).
- Physical table names are `<pluginId>_<table>`. Published views are `<pluginId>__pub_<view>`. Kernel tables are `kernel_*` (§3.3.1).
- The database runs in WAL mode with `busy_timeout = 3000` ms (§2).

**IDs and references**
- Display prefixes (§4): `A-` action, `R-` risk/issue, `D-` deliverable, `DE-` decision, `MS-` milestone, `M-` meeting, `I-` inbox item, `N-` note, `G-` goal.
- Projects are referenced by code. Inputs accept `CRM` or `#CRM`.
- People are referenced by handle. Inputs accept `anna` or `@anna`.
- Any record also accepts its display ID or a bare number.
- Person handle: unique, `[a-z0-9-]+`. Default: the lowercased first name; if taken, add a digit suffix (`anna2`).
- Project code: unique, `[A-Z0-9]{2,8}`.

**CLI**
- Pattern: `pm <thing> <verb> [args] [--flags]`.
- `--json` on every command. Errors with `--json` print `{"error":{"code","message","hint"}}`.
- Exit codes: `0` OK, `1` validation error, `2` not found, `3` conflict or locked database (§6).
- Commands never prompt. `delete` requires `--yes`.
- Date input forms: `YYYY-MM-DD`, `today`, `tomorrow`, `+Nd`, `+Nw`, and `mon` to `sun` (the next such day after today). Output is always ISO.

**Paths and config** (§2, §11.2)
- Path defaults: `PM_HOME` defaults to `~/.pm`. Inside it: `pm.db`, `config.json`, `plugins/`, `exports/`.
- Path overrides: `PM_DB`, `PM_CONFIG`, `PM_PLUGINS`, `PM_EXPORTS`, and `--db <path>`.
- `PM_CONFIG_JSON` overrides config values.
- Config defaults: `{"exportDir": "<PM_HOME>/exports", "staleContactDays": 30, "assistant": {"provider": "copilot"}, "plugins": {"disabled": [], "allow": []}}`.

**Behaviour**
- Action `owner_id` empty means **you**, shown as `me`.
- Before applying migrations to an existing database, copy it to `pm.db.bak-v<N>`, where N is the number of migrations already applied.
- On `SIGHUP` or `SIGTERM`: roll back any open transaction, close the database, exit 0.

## Review Focus

1. **Names with accents or duplicates.** `Ségolène Royal` gets the handle `segolene`, and a second Anna gets `anna2`. People are never rejected because of their name. → Task 2 and Task 12, tests `handle generation`.
2. **Edge-case dates.** `2026-02-30` is rejected with a clear message. `fri` on a Friday means next week's Friday. `+0d` is today. Upper case (`FRI`) works. → Task 2, test cases listed there.
3. **Two processes at once**, for example the TUI later and a Copilot CLI call, including both starting on a fresh database. Migrations must not run twice, and a busy database gives exit `3` with a hint instead of a crash. → Task 6, test `concurrent first boot`; Task 11, test `busy maps to exit 3`.
4. **Tags next to punctuation, and e-mail addresses.**
   - `(#CRM)`, `#CRM,` and `@peter.` resolve to their tags.
   - `anna@example.com` and `C#` are not tags.
   - Matching is case-insensitive.
   - → Task 9 and Task 16, tests `tag parsing`.
5. **Archived or deleted references.**
   - Adding an action, risk or milestone to an archived project, or assigning an archived person, is a `ValidationError` with the hint `restore it first`.
   - Deleting a milestone clears `milestone_id` on its deliverables instead of failing.
   - → Tasks 12, 13 and 14 (tests `archived person`, `archived project`), and Task 14 (test `milestone delete clears deliverables`).

---

## File Structure

```
src/kernel/
  errors.ts            PmError + ValidationError/NotFoundError/ConflictError/BusyError/IsolationError/ViewUnavailableError; suggest()
  paths.ts             resolvePaths(env, flags) → Paths
  config.ts            loadConfig(paths, env) → Config
  clock.ts             Clock (today, now), systemClock, fixedClock
  dates.ts             parseDate, addDays, weekEnd
  refs.ts              formatRef/parseRef helpers, handle and code rules
  semver.ts            satisfies(version, range)
  db/sqlite.ts         openRaw(path) → RawDb (bun:sqlite | node:sqlite), WAL, busy_timeout
  db/explain.ts        createTableChecker(raw) → tablesTouched(sql) with cache
  db/scope.ts          ScopeTransformer (layer 1) + column check
  db/driver.ts         PmDialect/PmDriver per plugin: layer 2, migration mode
  db/kernel-db.ts      KernelDb: raw, kernel Kysely, transaction(fn) with savepoints, write mutex, pluginDb(id)
  migrations.ts        MigrationRunner: per plugin, schema diff checks, backup
  views.ts             ViewRegistry: publish, create at startup, columns
  context.ts           OpContext + AsyncLocalStorage helpers (runWithContext, currentContext)
  operations.ts        OperationRegistry: expose, use, validation, transactions, provenance, events
  records.ts           RecordTypeRegistry
  tags.ts              TagRegistry + parseTags
  provenance.ts        ProvenanceStore (kernel_record_origin)
  changesets.ts        ChangeSetService (kernel_change_set, kernel_change_set_op)
  reports.ts           ReportRegistry + render md/text/json
  guide.ts             GuideRegistry
  events.ts            EventBus
  plugin.ts            definePlugin, PluginDef, PluginContext types
  host.ts              bootKernel(): load order, version checks, failure isolation
  api.ts               re-exports for plugins (future @pm/api): definePlugin, Type, types
  cli/args.ts          parse argv → { thing, verb, positionals, flags, global }
  cli/dispatch.ts      runCli(argv, kernel, io) → exit code
  cli/output.ts        text tables, JSON, error rendering
  cli/kernel-commands.ts  help, guide, plugin list, report
  shutdown.ts          installShutdownHandlers(kernel)
  isolation-selfcheck.ts  runnable on both runtimes; used by test and Node smoke
src/plugins/index.ts   builtinPlugins = [people, projects, inbox]
src/plugins/people/logic/   index.ts schema.ts views.ts ops.ts commands.ts report.ts guide.ts
src/plugins/projects/logic/ index.ts schema.ts views.ts ops-project.ts ops-items.ts ops-actions.ts status.ts commands.ts report.ts guide.ts
src/plugins/inbox/logic/    index.ts schema.ts views.ts ops.ts commands.ts report.ts guide.ts
src/bin/pm.ts          entry
tests/helpers.ts       makeTestKernel({ plugins?, today? }) on a temp PM_HOME
tests/fixtures/        fixture plugins for kernel tests
scripts/build-node.mjs (modify: shebang for bin/pm.js)
scripts/smoke-node.sh  Node 26 smoke test
```

Tests live next to code as `*.test.ts`, except the cross-cutting ones in `tests/`. The existing starter UI (`src/App.tsx`, `src/components/*`, `src/index.tsx`, `src/sections.tsx`, `src/theme.ts`) stays untouched in phase 1.

---

### Task 1: Dependencies, errors, paths, config, clock

**Files:**
- Modify: `package.json`: add the dependencies `kysely@0.28.18` and `typebox@1.4.3`; add `"bin": {"pm": "dist-node/bin/pm.js"}`; add the script `"pm": "bun src/bin/pm.ts"`.
- Create: `src/kernel/errors.ts`, `src/kernel/paths.ts`, `src/kernel/config.ts`, `src/kernel/clock.ts`
- Test: `src/kernel/errors.test.ts`, `src/kernel/paths.test.ts`, `src/kernel/config.test.ts`

**Interfaces:**
- Produces:
  - `class PmError extends Error { code: string; hint?: string; exitCode: 0|1|2|3; details?: unknown }`
  - `ValidationError(message, { field?, hint? })`: code `"validation"`, exit 1
  - `NotFoundError(message, { suggestions?: string[] })`: code `"not_found"`, exit 2; with suggestions, hint = `did you mean "<s1>"?`
  - `ConflictError`: `"conflict"`, exit 3
  - `BusyError`: `"busy"`, exit 3, hint `"another pm process is writing; try again"`
  - `IsolationError`: `"isolation"`, exit 1
  - `ViewUnavailableError(view)`: `"view_unavailable"`, exit 1
  - `suggest(input: string, candidates: string[], max = 3): string[]`: Levenshtein distance ≤ 2, case-insensitive, nearest first
  - `type Paths = { home; db; config; plugins; exports }` (absolute strings)
  - `resolvePaths(env: Record<string,string|undefined>, flags?: { db?: string }): Paths`
  - `type Config = { exportDir: string; staleContactDays: number; assistant: { provider: string }; plugins: { disabled: string[]; allow: string[] } }`
  - `loadConfig(paths: Paths, env): Config`: defaults ← `config.json` (if present) ← `PM_CONFIG_JSON` (deep merge). Invalid JSON → `ValidationError` naming the file.
  - `interface Clock { today(): string; now(): string }`, `systemClock`, `fixedClock(today: string, time = "09:00:00")`

- [ ] **Step 1: Write failing tests**
  - `suggest("ana", ["anna","bob","annie"])` returns `["anna","annie"]`.
  - `new NotFoundError("unknown person \"ana\"", { suggestions: ["anna"] }).hint` is `'did you mean "anna"?'`, and `.exitCode` is 2.
  - `resolvePaths({ HOME: "/h" })`:
    - `.home` is `/h/.pm`
    - `.db` is `/h/.pm/pm.db`
    - `.exports` is `/h/.pm/exports`
  - With `{ HOME: "/h", PM_HOME: "/data" }`, `.db` is `/data/pm.db`. With `PM_DB=/x.db` it's `/x.db`. `flags.db` beats `PM_DB`.
  - `loadConfig` with no file gives `staleContactDays` 30. A file `{"staleContactDays":45}` gives 45. `PM_CONFIG_JSON='{"plugins":{"disabled":["inbox"]}}'` merges and keeps `staleContactDays`. A broken file throws `ValidationError` whose message contains the path.
- [ ] **Step 2: Run** `bun test src/kernel` → FAIL (modules missing).
- [ ] **Step 3: Implement** the four modules. Run `bun install` to update `bun.lock`, and `npm install --package-lock-only` to update `package-lock.json`.
- [ ] **Step 4: Run** `bun test src/kernel && bun typecheck` → PASS.
- [ ] **Step 5: Commit** with `feat(kernel): errors, paths, config, clock`.

### Task 2: Dates and reference helpers

**Files:**
- Create: `src/kernel/dates.ts`, `src/kernel/refs.ts`, `src/kernel/semver.ts`
- Test: `src/kernel/dates.test.ts`, `src/kernel/refs.test.ts`, `src/kernel/semver.test.ts`

**Interfaces:**
- Produces:
  - `parseDate(input: string, today: string): string`. Throws `ValidationError` with hint `use YYYY-MM-DD, today, tomorrow, +3d, +2w or mon…sun`.
  - `addDays(date: string, n: number): string`
  - `weekEnd(today: string): string`: the Sunday on or after `today`
  - `isValidDate(s: string): boolean`
  - `formatRef(prefix: string, id: number): string`, e.g. `formatRef("A-", 12)` → `"A-12"`
  - `parseRef(input: string, prefix: string): number | null`: accepts `"A-12"`, `"a-12"` and `"12"`; anything else → null
  - `makeHandle(name: string, taken: (h: string) => boolean): string`
  - `normalizeHandle(input: string): string`: strips a leading `@` and lowercases
  - `isValidCode(s: string): boolean` (`/^[A-Z0-9]{2,8}$/`)
  - `normalizeCode(input: string): string`: strips a leading `#` and uppercases
  - `satisfies(version: string, range: string): boolean`: supports `*`, exact `1.2.3`, `^N`, `^N.M` and `^N.M.P`

- [ ] **Step 1: Write failing tests.** With today = `2026-11-13` (a Friday):

  | Input | Expected |
  |---|---|
  | `"2026-12-04"` | `"2026-12-04"` |
  | `"today"` | `"2026-11-13"` |
  | `"tomorrow"` | `"2026-11-14"` |
  | `"+3d"` | `"2026-11-16"` |
  | `"+2w"` | `"2026-11-27"` |
  | `"+0d"` | `"2026-11-13"` |
  | `"fri"` / `"FRI"` | `"2026-11-20"` |
  | `"mon"` | `"2026-11-16"` |
  | `"2026-02-30"` / `"31/12/2026"` / `"next week"` | throws `ValidationError` |

  - `weekEnd("2026-11-13")` → `"2026-11-15"`, and `weekEnd("2026-11-15")` → `"2026-11-15"`.
  - **`handle generation`**:
    - `makeHandle("Ségolène Royal", () => false)` → `"segolene"`
    - `makeHandle("Anna Peeters", h => h === "anna")` → `"anna2"`
    - `makeHandle("Anna X", h => ["anna","anna2"].includes(h))` → `"anna3"`
    - `makeHandle("Jean-Luc Picard", …)` → `"jean-luc"`
    - `makeHandle("李雷", …)` → `"person"` (fallback when nothing ASCII remains)
  - `parseRef("A-12","A-")` → 12, `parseRef("12","A-")` → 12, `parseRef("R-12","A-")` → null.
  - `satisfies("1.4.0","^1")` → true, `satisfies("2.0.0","^1")` → false, `satisfies("1.1.0","^1.2")` → false.
- [ ] **Step 2: Run** `bun test src/kernel/dates.test.ts src/kernel/refs.test.ts src/kernel/semver.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Dates are pure string/UTC arithmetic: `Date.UTC`, never local time zones. `makeHandle` uses NFKD normalisation, removes combining marks, keeps `[a-z0-9-]` from the first word, and falls back to `"person"`.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** with `feat(kernel): date parsing, refs, semver ranges`.

### Task 3: SQLite adapter, kernel DB and transactions

**Files:**
- Create: `src/kernel/db/sqlite.ts`, `src/kernel/db/kernel-db.ts`
- Test: `src/kernel/db/kernel-db.test.ts`

**Interfaces:**
- Produces:
  - `interface RawStatement { reader: boolean; all(params: unknown[]): any[]; run(params: unknown[]): { changes: number; lastInsertRowid: number } }`
  - `interface RawDb { exec(sql: string): void; prepare(sql: string): RawStatement; close(): void; inTransaction(): boolean }`
  - `openRaw(path: string): RawDb`. Uses `bun:sqlite` `Database` (`query()`, `columnNames`) under Bun and `node:sqlite` `DatabaseSync` (`prepare()`, `columns()`) under Node. It sets `PRAGMA journal_mode=WAL` (file databases only), `busy_timeout=3000` and `foreign_keys=ON`. It converts `bigint`/`number` consistently: always `number`. A `SQLITE_BUSY` error is rethrown as `BusyError`.
  - `class KernelDb`, constructed with `(raw: RawDb)`:
    - `transaction<T>(fn: () => Promise<T>): Promise<T>`: the outermost call does `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`; nested calls use `SAVEPOINT sp_<n>` / `RELEASE` / `ROLLBACK TO`.
    - `withWriteLock<T>(fn): Promise<T>`: an in-process async mutex, so one write operation runs at a time.
    - `pluginDb(pluginId): Kysely<any>`: implemented in Task 5.
    - `kysely: Kysely<any>`: unscoped, kernel-only.
    - `close(): Promise<void>`: rolls back an open transaction, then closes.

- [ ] **Step 1: Write failing tests.** Use a temp file DB.
  - Writes in `transaction` are visible after commit.
  - A throw rolls everything back.
  - Nested: the outer transaction writes A, the inner writes B and throws, the outer catches and commits → A present, B absent.
  - Two concurrent `withWriteLock` calls run sequentially (record start/end order).
  - `close()` during an open transaction leaves the DB without that transaction's rows when reopened.
  - `journal_mode` reports `wal`.
- [ ] **Step 2: Run** `bun test src/kernel/db/kernel-db.test.ts` → FAIL.
- [ ] **Step 3: Implement.** The kernel `kysely` instance uses a minimal Kysely `Driver` over `RawDb`; Task 5 extends that same driver. `beginTransaction` on the driver must throw `IsolationError("transactions are managed by the kernel")`, so `kysely.transaction()` is unusable by design.
- [ ] **Step 4: Run** → PASS. Then check the same scenario under Node:
  1. Create `src/kernel/db/savepoint-selfcheck.ts`. It opens a temp DB through `KernelDb`, runs the nested-rollback scenario, prints `savepoints ok`, and exits 0 (or 1 on any mismatch).
  2. Run `node scripts/build-node.mjs && node dist-node/kernel/db/savepoint-selfcheck.js` and `bun src/kernel/db/savepoint-selfcheck.ts`. Both must print `savepoints ok`.

  **This is the spec's "confirm savepoints first" check.** If nesting fails on either runtime, stop and report. Task 17's smoke script runs this file too.
- [ ] **Step 5: Commit** with `feat(kernel): sqlite adapter and kernel transactions`.

### Task 4: Layer 2: the EXPLAIN table check

**Files:**
- Create: `src/kernel/db/explain.ts`
- Test: `src/kernel/db/explain.test.ts`

**Interfaces:**
- Produces: `createTableChecker(raw: RawDb): { tablesTouched(sql: string): string[]; invalidate(): void }`.
  - It runs `EXPLAIN <sql>` with `null` for each `?`, collects the `p2` of every `OpenRead`/`OpenWrite` opcode, and maps root pages to `tbl_name` through `sqlite_schema`.
  - Results are cached per SQL string. `invalidate()` clears both the cache and the root-page map; migrations call it.

- [ ] **Step 1: Write failing tests.** Schema: `a_t1`, `b_t2`, an index on `a_t1`, and a view `a__pub_v` over `a_t1`.

  | Statement | `tablesTouched` |
  |---|---|
  | `SELECT * FROM a_t1 WHERE x = ?` | `["a_t1"]` |
  | a join of `a_t1` and `b_t2` | both |
  | `UPDATE b_t2 …` | `["b_t2"]` |
  | `INSERT INTO a_t1 SELECT … FROM b_t2` | both |
  | `SELECT * FROM a__pub_v` | `["a_t1"]` |
  | an index lookup on `a_t1` | `["a_t1"]` (index maps to its table) |
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** with `feat(kernel): explain-based table check`.

### Task 5: Layer 1 and the per-plugin driver: scoped `ctx.data`

**Files:**
- Create: `src/kernel/db/scope.ts`, `src/kernel/db/driver.ts`
- Modify: `src/kernel/db/kernel-db.ts`, to implement `pluginDb`
- Test: `src/kernel/db/scope.test.ts`

**Interfaces:**
- Consumes: `RawDb`, `createTableChecker` (Task 4), `IsolationError`
- Produces:
  - `KernelDb.pluginDb(pluginId: string, access: TableAccess): Kysely<any>`
  - `interface TableAccess { ownTables(): Set<string>; views(): Map<string, { physical: string; columns: string[]; baseTables: string[] }>; migrating(): boolean }`: short names for own tables; view keys are `"<plugin>.<view>"`
  - `ScopeTransformer`, an `OperationNodeTransformer`, applied through a Kysely plugin:
    - `TableNode` with a schema `X` and name `Y`: must exist in `views()`, and becomes `physical`. In a write (`InsertQueryNode`/`UpdateQueryNode`/`DeleteQueryNode` target) → `IsolationError("<X>.<Y> is a published view and is read-only")`.
    - `TableNode` without a schema: an alias collected from `AliasNode{node: TableNode}` stays as is. An own table becomes `<pluginId>_<name>`. Anything else → `IsolationError('table "<name>" is not owned by plugin "<id>"; read <owner>.<name> if published, or use <owner>.<operation>')`. Name the owner when another plugin has that table, using the `ownerOf(table)` callback passed into the transformer.
    - Schema nodes: `CreateTableNode`, `CreateIndexNode` (prefix the index name too), `CreateViewNode`, `AlterTableNode` and `DropTableNode` are only allowed while `migrating()`. Otherwise `IsolationError("schema changes are only allowed in migrations")`.
    - **Column check:** every `ColumnNode` name must exist in at least one of the query's source tables or views. Own-table columns come from `PRAGMA table_info`, cached; views use their declared columns. Unknown → `IsolationError('unknown column "<c>"')`. This makes Bun and Node fail the same way (§3.3.3).
  - `PmDriver`, a per-plugin Kysely `Driver` whose connection's `executeQuery(compiled)`:
    1. derives `viewsUsed` from the `__pub_` table names in `compiled.query`, **from the node and not from shared state**;
    2. if the statement isn't DDL, checks `tablesTouched(compiled.sql)` ⊆ own physical tables ∪ base tables of `viewsUsed`, else `IsolationError('… may not use table "<t>"')`;
    3. if it is DDL, requires `migrating()`;
    4. runs it on the raw connection.

- [ ] **Step 1: Write failing tests.** Use fixture plugins `contracts` (tables `contract`, `party`) and `projects` (table `project`, published view `projects.project` with columns `id, code`).
  - **Allowed:**
    - select, where and order on `contract`
    - `countAll`/`sum`
    - a join `contract as c` ⋈ `party as p`
    - insert and update
    - a join of `contract` with `projects.project as pr`
  - **Rejected with `IsolationError`:**
    - `selectFrom("project")` (the message mentions `projects.project`)
    - a join with `project`
    - `updateTable("project")`
    - a sub-query on `project`
    - `updateTable("projects.project")` (read-only message)
    - `selectFrom("projects.secret")` (not published)
    - `sql\`SELECT * FROM projects_project\`.execute(db)` (layer 2)
    - `selectFrom("projects.project").select("internal_col")` (unknown column)
    - `schema.createTable("x")` outside a migration
  - **No leaking between queries:** a failing query using `projects.project` followed by raw SQL on `projects_project` → the second is rejected.
- [ ] **Step 2: Run** `bun test src/kernel/db/scope.test.ts` → FAIL.
- [ ] **Step 3: Implement.** The reference for the transformer shape is the verified scratch test `/tmp/claude-1000/-home-coder-project/a2acc2c5-67d8-4bad-bbe3-8e28d716b213/scratchpad/kysely-check/views.mjs`. Spreading `node.table` and replacing `identifier` keeps Kysely's node kinds valid.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** with `feat(kernel): scoped plugin query builder with two isolation layers`.

### Task 6: Migrations

**Files:**
- Create: `src/kernel/migrations.ts`
- Test: `src/kernel/migrations.test.ts`

**Interfaces:**
- Consumes: `KernelDb`, `TableAccess`, the table checker's `invalidate`
- Produces:
  - `type Migration = { id: string; up: (db: Kysely<any>) => Promise<void> }`
  - `class MigrationRunner`, constructed with `(kdb: KernelDb, paths: Paths)`:
    - `ensureKernelTables(): Promise<void>`: creates `kernel_plugin_migration(plugin, id, applied_at, PRIMARY KEY(plugin,id))`, `kernel_record_origin`, `kernel_change_set` and `kernel_change_set_op`
    - `pending(pluginId, migrations): Migration[]`
    - `backupIfNeeded(): void`: if the DB file existed with at least one applied migration and anything is pending, it copies the file once per boot to `pm.db.bak-v<N>`
    - `run(pluginId, migrations, external: boolean): Promise<void>`
  - Each migration runs in its own `BEGIN IMMEDIATE` transaction, with `migrating()` true for that plugin.
  - Afterwards the runner compares `sqlite_schema`: every new object must be named `<pluginId>_*`; external plugins may not add triggers. On violation it rolls back and throws `IsolationError`.
  - Applied rows are re-checked inside the transaction, so a concurrent process can't apply twice.

- [ ] **Step 1: Write failing tests.**
  - The first run applies `001` and `002`; a second run applies nothing.
  - A migration that throws leaves no table, and no row in `kernel_plugin_migration`.
  - An external migration creating a trigger rolls back with `IsolationError`.
  - The backup file `pm.db.bak-v2` exists after adding `003` to a DB with 2 applied.
  - **`concurrent first boot`:** two child processes (`Bun.spawn` of `tests/fixtures/migrate-child.ts`) boot against the same new DB at the same time. Both exit 0, and `kernel_plugin_migration` holds each id exactly once.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** with `feat(kernel): per-plugin migrations with schema checks and backup`.

### Task 7: Operation context, events, published views

**Files:**
- Create: `src/kernel/context.ts`, `src/kernel/events.ts`, `src/kernel/views.ts`
- Test: `src/kernel/views.test.ts`, `src/kernel/context.test.ts`

**Interfaces:**
- Produces:
  - `type Origin = { type: "inbox" | "meeting" | "changeset"; ref: string }`
  - `type OpContext = { actor: "me"; today: string; now: string; origin?: Origin }`
  - `runWithContext<T>(ctx: OpContext, fn: () => Promise<T>): Promise<T>` and `currentContext(): OpContext`, using `AsyncLocalStorage`. `currentContext` throws if none is set.
  - `class EventBus { on(event: string, fn: (p: any) => void): () => void; emit(event: string, payload: unknown): void }`: handler errors are caught and logged to stderr
  - `type ColumnType = "integer" | "text" | "real" | "boolean" | "date"`
  - `type ViewDef = { version: number; columns: Record<string, ColumnType>; query: (db: Kysely<any>) => { compile(): CompiledQuery }; assistant?: boolean }`
  - `class ViewRegistry`:
    - `publish(pluginId, name, def)`
    - `createAll(kdb)`: for each view, compile with the owner's scoped db; compiled parameters must be empty, else `ValidationError("view query may not use parameters")`. It runs `DROP VIEW IF EXISTS` + `CREATE VIEW <id>__pub_<name> AS <sql>`, compares `PRAGMA table_info` columns with the declared names (mismatch → error naming both lists), and stores `baseTables` via `tablesTouched("SELECT * FROM <view>")`
    - `forReader(pluginId): Map<…>` (the `views()` of `TableAccess`)
    - `remove(pluginId)`
  - Querying a view whose plugin isn't loaded throws `ViewUnavailableError("<plugin>.<view>")` from layer 1, instead of the generic "not published" message, when the name matches a declared `reads` entry.

- [ ] **Step 1: Write failing tests.**
  - `runWithContext` propagates through `await` and nested calls.
  - A published view `people.person` with a computed column (`max(note.date) as last_contact`) is readable from another plugin, and the joined result has the expected names.
  - A declared column missing from the query fails `createAll` with both column lists in the message.
  - A view query with a bound parameter is rejected.
  - Reading `people.person` when `people` is disabled but declared in `reads` → `ViewUnavailableError`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** with `feat(kernel): op context, events, published views`.

### Task 8: Operations, record types, provenance

**Files:**
- Create: `src/kernel/operations.ts`, `src/kernel/records.ts`, `src/kernel/provenance.ts`
- Test: `src/kernel/operations.test.ts`, `src/kernel/records.test.ts`

**Interfaces:**
- Consumes: `KernelDb.transaction`/`withWriteLock`, `currentContext`, `EventBus`, TypeBox `Value`
- Produces:
  - `type ReadOp = { input: TSchema; output: TSchema; run(input: any): Promise<any>; assistant?: boolean; toolDescription?: string }`
  - `type WriteOp = ReadOp & { describe(input: any): string | Promise<string> }`. The output **must** contain `ref: string` (the primary record's display ref); otherwise the call fails with an error naming the operation.
  - `type PluginApi = { read: Record<string, (input: any) => Promise<any>>; write: Record<string, (input: any) => Promise<any>> }`
  - `class OperationRegistry`:
    - `expose(pluginId, { read?, write? })`
    - `api(pluginId): PluginApi | undefined`
    - `describe(pluginId, op, input): Promise<string>`
    - `list(): Array<{ plugin, name, kind, input, output, assistant }>`, used by the assistant in phase 7
  - **Call semantics:**
    1. Validate the input with `Value.Check`; on failure throw `ValidationError` with `field` from the first error's `instancePath` (`/title` → `title`).
    2. A **read** runs `run`.
    3. A **write** runs inside `withWriteLock` (outermost call only) and `transaction`, then:
       - validates the output when `PM_TEST=1`;
       - if `currentContext().origin` is set, records provenance `(recordTypeOf(ref), id, origin.type, origin.ref)`;
       - emits `record.changed` `{ plugin, op, ref }`.
  - `type RecordTypeDef = { name: string; plugin: string; prefix: string; resolve(input: string): Promise<number | null>; label(id: number): Promise<string>; search(text: string, limit: number): Promise<Array<{ ref: string; label: string }>> }`
  - `class RecordTypeRegistry`:
    - `register(def)`; a duplicate name or prefix throws
    - `byName`, `byPrefix`, `typeOfRef(ref)` (longest prefix first, so `DE-` beats `D-`)
    - `resolveAny(ref)`
    - `label(ref)`
  - `class ProvenanceStore`:
    - `record(type, id, origin)`
    - `createdFrom(originType, originRef): Array<{ recordType: string; recordId: number; ref: string }>`

- [ ] **Step 1: Write failing tests.** Use a fixture plugin with `add` (write) and `count` (read).
  - Invalid input → `ValidationError` with `field === "title"`.
  - A write is atomic: `run` inserts and then throws → no row.
  - A write called inside another write uses a savepoint, and the outer commit keeps both.
  - With origin `{type:"inbox", ref:"I-3"}` → `createdFrom("inbox","I-3")` returns the new ref.
  - `record.changed` is emitted once per write.
  - `typeOfRef("DE-4")` is `decision`, not `deliverable`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** with `feat(kernel): typed operations, record types, provenance`.

### Task 9: Tags, change sets, reports, guide

**Files:**
- Create: `src/kernel/tags.ts`, `src/kernel/changesets.ts`, `src/kernel/reports.ts`, `src/kernel/guide.ts`
- Test: `src/kernel/tags.test.ts`, `src/kernel/changesets.test.ts`, `src/kernel/reports.test.ts`

**Interfaces:**
- Produces:
  - `type TagTypeDef = { prefix: "#" | "@" | string; recordType: string; resolve(token: string): Promise<number | null> }`
  - `parseTags(text: string): Array<{ prefix: string; token: string; raw: string }>`. A tag starts at the beginning of the text or after whitespace or `(`/`[`, is `[#@$][A-Za-z0-9][A-Za-z0-9-]*`, and drops trailing `.,;:!?)]`.
  - `class TagRegistry`:
    - `register(def)`; a duplicate prefix throws
    - `resolve(text): Promise<{ links: Array<{ recordType: string; recordId: number; raw: string }>; unresolved: string[] }>`: unknown prefixes and unknown tokens both go to `unresolved`
  - `type ChangeOp = { plugin: string; operation: string; input: unknown }`
  - `class ChangeSetService`:
    - `preview(ops): Promise<string[]>`: the `describe` lines
    - `apply(ops, origin?: Origin): Promise<{ id: number; refs: string[] }>`: one transaction; on the first failure it rolls back everything and throws `PmError` with `details: { index }`; it logs to `kernel_change_set(id, origin_type, origin_ref, created_at)` and `kernel_change_set_op(change_set_id, position, plugin, operation, input_json, description, result_ref)`
  - `type ReportSectionResult = { title: string; columns: string[]; rows: Array<Record<string, string | number | null>>; empty: string; note?: string }`
  - `type ReportDef = { id: string; cliName: string; title: string; params: TSchema; describe: string }`
  - `type ReportSectionDef = { id: string; order: number; run(params: any): Promise<ReportSectionResult | null> }`. `null` means "not applicable": skipped.
  - `class ReportRegistry`:
    - `report(def)`
    - `section(reportId, plugin, def)`
    - `run(reportId, params): Promise<{ title: string; sections: ReportSectionResult[] }>`: sections run in `order`; a throwing section becomes a section with `note: "error: <message>"` and the report continues
  - `renderReport(r, format: "md" | "text" | "json"): string`:
    - `md`: `# <title>`, then for each section `## <title>`, a Markdown table or `_<empty>_`, and the note in italics
    - `text`: the same structure without Markdown syntax, columns padded
    - `json`: `JSON.stringify(r, null, 2)`
  - `class GuideRegistry`:
    - `section(plugin, { title, markdown, order })`
    - `render(pmVersion): string`: the header `# pm: guide for agents` plus a short kernel section on conventions (`--json`, exit codes, dates, refs, `--from-inbox`, "ask the user when ambiguous"), then sections in plugin load order, then `order`

- [ ] **Step 1: Write failing tests.**
  - **`tag parsing`:**
    - `"Peter worried (#CRM), see @peter."` → tokens `CRM`, `peter`
    - `"mail anna@example.com about C# code"` → no tags
    - `"#crm"` resolves the same as `#CRM` (the resolver gets the raw token; the projects resolver normalises it in Task 14)
    - `"#CMR"` with no match → `unresolved: ["#CMR"]`
  - **Change sets:**
    - `apply` of two ops where the second throws → no rows from the first, and the error's `details.index === 1`
    - a successful apply writes 1 + 2 log rows and records provenance with origin `changeset`
  - **Reports:**
    - md rendering of a report with one table section and one empty section matches an inline expected string exactly
    - a throwing section shows its error note and the other sections still render
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** with `feat(kernel): tags, change sets, reports, guide`.

### Task 10: Plugin definition and host (`bootKernel`)

**Files:**
- Create: `src/kernel/plugin.ts`, `src/kernel/host.ts`, `src/kernel/api.ts`, `src/kernel/cli/commands.ts`, `tests/helpers.ts`, `tests/fixtures/` (fixture plugins as needed)
- Test: `src/kernel/host.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–9
- Produces:
  - `type PluginDef = { id: string; name: string; version: string; apiVersion: 1; requires?: Record<string, string>; reads?: Record<string, string>; activate(ctx: PluginContext): void | Promise<void> }`
  - `definePlugin(def: PluginDef): PluginDef`
  - In `src/kernel/cli/commands.ts`:
    - `type FlagDef = { type: "string" | "boolean" | "number" | "date" | "list"; description: string; required?: boolean; short?: string }`. `list` is comma-separated → `string[]`; `date` → parsed ISO.
    - `type CommandDef = { thing: string; verb: string; summary: string; args?: Array<{ name: string; required?: boolean; rest?: boolean }>; flags?: Record<string, FlagDef>; destructive?: boolean; run(input: { args: Record<string, string | string[] | undefined>; flags: Record<string, unknown>; readStdin(): Promise<string> }): Promise<{ json: unknown; text: string }> }`
    - `class CommandRegistry`: `register(plugin, def)` (a duplicate `thing verb` throws), `find(thing, verb)`, `things()`, `removePlugin(id)`
  - `interface PluginContext`:
    - fields: `id`, `data: Kysely<any>`, `config: Config`, `clock: Clock`
    - `migration(id: string, up: (db: Kysely<any>) => Promise<void>): void`
    - `publish(name: string, def: ViewDef): void`
    - `expose(ops: { read?: Record<string, ReadOp>; write?: Record<string, WriteOp> }): void`
    - `use(pluginId: string): PluginApi | undefined`: `undefined` unless the plugin is in `requires`; `self()` returns the plugin's own API
    - `self(): PluginApi`
    - `recordType(def: Omit<RecordTypeDef, "plugin">): void`
    - `records: { resolve(ref: string): Promise<{ type: string; id: number } | null>; label(ref: string): Promise<string> }`
    - `tagType(def: TagTypeDef): void`
    - `tags: { resolve(text: string): ReturnType<TagRegistry["resolve"]> }`
    - `command(def: CommandDef): void`
    - `report(def: ReportDef): void`
    - `reportSection(reportId: string, def: ReportSectionDef): void`
    - `guideSection(def: { title: string; markdown: string; order?: number }): void`
    - `provenance: { createdFrom(type: string, ref: string) }`
    - `on(event, fn)`, `emit(event, payload)`
  - `type Kernel`:
    - `paths: Paths`, `config: Config`, `clock: Clock`, `db: KernelDb`
    - `plugins: Array<{ id: string; version: string; source: "built-in"; status: "ok" | "failed" | "disabled"; error?: string }>`
    - `ops: OperationRegistry`, `records: RecordTypeRegistry`, `tags: TagRegistry`, `reports: ReportRegistry`, `guide: GuideRegistry`, `changeSets: ChangeSetService`, `commands: CommandRegistry`, `events: EventBus`
    - `context(origin?: Origin): OpContext`
    - `shutdown(): Promise<void>`
  - `bootKernel(opts: { env: Record<string,string|undefined>; flags?: { db?: string }; plugins: PluginDef[]; clock?: Clock }): Promise<Kernel>`:
    1. paths and config;
    2. open the DB and create the kernel tables;
    3. topologically sort by `requires` (a cycle, a missing or disabled requirement, or a failed `satisfies` → `status: "failed"`, with the reason naming the plugin and range);
    4. for each plugin: `activate`, `backupIfNeeded`, its migrations, then mark it ok;
    5. `views.createAll`;
    6. register `reads` for `ViewUnavailableError`.
  - **Any throw during step 4 isolates that plugin.** Everything it registered is removed (registries take a plugin id and support `removePlugin(id)`), its status is `failed` with the error message, and its dependants fail too, with `requires "<id>" which failed`.
  - `api.ts` re-exports `definePlugin`, `Type` (from typebox) and all public types. Plugins import only from `../../../kernel/api` in phase 1.
  - `tests/helpers.ts`: `makeTestKernel(opts?: { plugins?: PluginDef[]; today?: string; env?: Record<string,string> }): Promise<Kernel & { home: string; cleanup(): Promise<void> }>`. It uses a temp `PM_HOME`, `fixedClock(today ?? "2026-11-13")` and `PM_TEST=1`.

- [ ] **Step 1: Write failing tests.**
  - The load order respects `requires` regardless of array order.
  - A cycle `a→b→a` marks both failed with "cycle".
  - `requires: { a: "^2" }` with a at 1.0.0 → failed, message containing `^2`.
  - A plugin whose `activate` throws after registering a command and an op → the command and op are gone, the other plugins work, and its dependant is failed.
  - `config.plugins.disabled: ["a"]` → `status: "disabled"`, and its views are unavailable.
  - `use("x")` for a plugin not in `requires` → `undefined`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` → PASS. Then `bun typecheck`.
- [ ] **Step 5: Commit** with `feat(kernel): plugin host with ordering, version checks and failure isolation`.

### Task 11: CLI framework, entry point, shutdown

**Files:**
- Create: `src/kernel/cli/args.ts`, `src/kernel/cli/dispatch.ts`, `src/kernel/cli/output.ts`, `src/kernel/cli/kernel-commands.ts`, `src/kernel/shutdown.ts`, `src/bin/pm.ts`, `src/plugins/index.ts` (exports `builtinPlugins: PluginDef[] = []` for now)
- Modify: `scripts/build-node.mjs`: after compiling, prepend `#!/usr/bin/env -S node --experimental-ffi\n` to `dist-node/bin/pm.js` and `chmod 755` it
- Test: `src/kernel/cli/dispatch.test.ts`, `tests/shutdown.test.ts`

**Interfaces:**
- Consumes: `Kernel`, `CommandDef`/`CommandRegistry` (Task 10), `PmError`, `parseDate`, `renderReport`
- Produces:
  - Uses `FlagDef`, `CommandDef` and `CommandRegistry` from Task 10 (`src/kernel/cli/commands.ts`).
  - Global flags parsed by the dispatcher on every command:
    - `--json`
    - `--db <path>`: applied before boot
    - `--from-inbox <I-n>`: sets the origin `{type:"inbox"}`
    - `--yes`: required when `destructive`, else `ValidationError("… is destructive; add --yes")`
    - `--help`
  - `runCli(argv: string[], kernel: Kernel, io: { out(s: string): void; err(s: string): void; stdin(): Promise<string> }): Promise<number>`. `run` receives `readStdin = io.stdin`, and `bin/pm.ts` reads `process.stdin`:
    - returns the exit code;
    - wraps `run` in `runWithContext(kernel.context(origin))`;
    - maps a `PmError` to its exitCode and anything else to 1 (`code: "internal"`);
    - with `--json`, prints `json` on success and the error object on failure (to stdout, so agents read one stream); otherwise prints `text` to stdout and `error: <message>` + `hint: <hint>` to stderr.
  - Kernel commands:
    - `pm help`, `pm <thing> --help`, `pm <thing> <verb> --help`: generated from `CommandDef`s
    - `pm guide [--write <path>]`
    - `pm plugin list`: columns `id`, `version`, `source`, `status`, `error`
    - `pm report <cliName> [args…] [--format md|text|json]` (the default `md`; `--json` implies `json`). Report params come from the report's `params` schema: a positional `project` for `status`.
  - `src/bin/pm.ts`:
    - with no args, prints `pm help` plus the line `The terminal UI arrives in phase 2; run "bun start" for the preview.`;
    - otherwise boots with `builtinPlugins`, runs the CLI, shuts down, and exits with the code.
  - `installShutdownHandlers(kernel)`: on `SIGHUP`/`SIGTERM`, `await kernel.shutdown()` then `process.exit(0)`.

- [ ] **Step 1: Write failing tests.** Use a fixture plugin with `thing widget`, the verbs `add` (title arg, `--due` date flag), `delete` (destructive) and `fail` (throws `NotFoundError` with suggestions).
  - `["widget","add","x","--due","fri","--json"]` → exit 0, and the JSON `due` is `2026-11-20`.
  - `["widget","delete","1"]` → exit 1, with stderr containing `--yes`.
  - `["widget","fail","--json"]` → exit 2, and stdout parses to `{error:{code:"not_found", hint:'did you mean "anna"?'}}`.
  - An unknown thing → exit 1, with suggestions from the known things.
  - **`busy maps to exit 3`:** the fixture command throws `BusyError` → exit 3.
  - `pm help` lists `widget add`.
  - `--from-inbox I-2` sets the origin seen inside `run`.
  - **Shutdown** (`tests/shutdown.test.ts`):
    1. Spawn `bun tests/fixtures/hold-cli.ts`. It boots with a fixture whose write op inserts a row, prints `ready`, and awaits forever inside its transaction.
    2. Send `SIGHUP` after `ready`.
    3. Expect exit code 0, the row absent, and `PRAGMA integrity_check` returning `ok`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test && bun typecheck` → PASS, and `bun src/bin/pm.ts help` prints the kernel commands.
- [ ] **Step 5: Commit** with `feat(cli): dispatcher, conventions, kernel commands, entry point, shutdown`.

### Task 12: `people` plugin

**Files:**
- Create: `src/plugins/people/logic/{index,schema,views,ops,commands,report,guide}.ts`
- Modify: `src/plugins/index.ts` (add `people`)
- Test: `src/plugins/people/logic/people.test.ts`

**Interfaces:**
- Consumes: `PluginContext`, `makeHandle`, `parseDate`, `fixedClock` (tests)
- Produces (plugin id `people`, version `1.0.0`; the full list is in the plugin reference §1):
  - **Tables** (§4): `person`, `note`, `goal`, with exactly the fields and enums of the spec. `note.project_id` is a plain integer (a soft reference).
  - **Views:**
    - `people.person`: `id, handle, name, organisation, job_title, email, is_team, is_stakeholder, influence, interest, last_contact, archived`
    - `people.note`: `id, person_id, project_id, kind, date, text`
    - `people.goal`: `id, person_id, title, target_date, status`
  - **Record types:**
    - `person`: prefix `@`; `resolve` accepts a handle, `@handle` or a numeric id; `search` matches the name or handle
    - `note`: `N-`
    - `goal`: `G-`
  - **Tag type:** `@` → person, through `normalizeHandle`.
  - **Read op:** `staleStakeholders({ days, limit? })`. It returns active stakeholders whose `last_contact` is null or older than `today − days`. Order: influence high first, then oldest contact first (null first). Each row: `{ ref, name, influence, interest, last_contact, projects: string[] }`. `projects` comes from `projects.involvement` ⋈ `projects.project` when readable; on `ViewUnavailableError` it's `[]`. Declare `reads: { projects: "^1" }`.
  - **Write ops:** `addPerson`, `editPerson`, `archivePerson`, `restorePerson`, `addNote`, `editNote`, `deleteNote`, `addGoal`, `editGoal`, `setGoalStatus`. Inputs follow §4 (TypeBox). Outputs include `ref`. The `describe` lines follow the examples in the plugin reference §1. Writing to an archived person → `ValidationError` with hint `restore it first`.
  - **Commands:**
    - `pm person list [--team|--stakeholders] [--archived]`
    - `pm person show <ref>`
    - `pm person add <name> [--handle] [--team] [--stakeholder] [--org] [--title] [--email] [--phone] [--influence low|high] [--interest low|high]`
    - `pm person edit <ref> [same flags]`
    - `pm person archive|restore <ref>`
    - `pm note list [--person] [--project] [--kind]`
    - `pm note add <person> <text> (--1on1|--interaction) [--date] [--project]`
    - `pm note edit <N-n> <text>`
    - `pm note delete <N-n> --yes`
    - `pm goal list <person>`
    - `pm goal add <person> <title> [--target]`
    - `pm goal edit <G-n> …`
    - `pm goal done|drop <G-n>`
    - The commands read through `ctx.data` and the views, and write only through `ctx.self().write.*`.
  - **Report section** `stakeholders-to-contact` in the `overview` report, order 60, `days = config.staleContactDays`.
  - **Guide section** "People and stakeholders": when to use `--1on1` vs `--interaction`; record a stakeholder concern as an interaction note on that person, with `--project`.

- [ ] **Step 1: Write failing tests** through `runCli` on `makeTestKernel({ plugins: [people] })`.
  - `person add "Anna Peeters" --team --json` → `ref "@anna"`; then `person add "Anna Smith"` → `@anna2`.
  - **`handle generation`** end to end: `person add "Ségolène Royal"` → `@segolene`.
  - `note add peter "Worried about budget" --interaction` on an unknown person → exit 2 with hint `did you mean`.
  - **`archived person`:** after `person archive anna`, `note add anna x --1on1` → exit 1 with hint `restore it first`.
  - `staleStakeholders`, with today 2026-11-13 and days 30, over:
    - Marie: high, last 2026-10-03
    - Luc: high, no notes
    - Jan: low, 2026-10-01
    - Peter: high, 2026-11-11

    → refs `[@luc, @marie, @jan]`, with `projects: []` (projects isn't loaded yet).
  - `person list --stakeholders --json` returns `last_contact`.
- [ ] **Step 2: Run** `bun test src/plugins/people` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS, then `bun test` (all).
- [ ] **Step 5: Commit** with `feat(people): people plugin logic and CLI`.

### Task 13: `projects` plugin, part 1: projects, health, context, involvement

**Files:**
- Create: `src/plugins/projects/logic/{index,schema,views,ops-project,commands,guide}.ts`
- Modify: `src/plugins/index.ts` (add `projects` after `people`)
- Test: `src/plugins/projects/logic/projects.test.ts`

**Interfaces:**
- Consumes: the `people` views (`people.person`), and its record type for validating person refs
- Produces (plugin id `projects`, version `1.0.0`, `requires: { people: "^1" }`, `reads: { meetings: "^1" }`):
  - **All tables** from plugin reference §2: `project`, `health_update`, `milestone`, `deliverable` (incl. `status_changed_at`), `risk`, `decision`, `action`, `involvement`. All in one migration, `001`.
  - **Views in this task:**
    - `projects.project`: `id, code, name, description, status, start_date, end_date, effort_estimate_days, health, health_comment, health_date, next_milestone_title, next_milestone_due, open_actions, open_risks, archived`. `health` comes from the latest `health_update` by `date`, then `id`. `next_milestone_*` is the open milestone with the smallest `due_date`.
    - `projects.health_update`
    - `projects.involvement`: `project_id, person_id, role`
  - **Record type** `project`: prefix `#`; `resolve` accepts the code, `#code` (case-insensitive) or an id. **Tag type** `#` → project.
  - **Read op:** `getContext({ project }) → { ref, markdown, updatedAt }`.
  - **Write ops:**
    - `addProject({ code, name, description?, status?, startDate?, endDate?, effortDays?, effortNote? })`: a duplicate code → `ConflictError`; an invalid code → `ValidationError` with hint `2–8 letters or digits, e.g. CRM`
    - `editProject`
    - `archiveProject`, `restoreProject`
    - `setContext({ project, markdown })`: sets `context_updated_at`
    - `setHealth({ project, health, comment?, date? })`: inserts a `health_update`
    - `addInvolvement({ project, person, role })`, `removeInvolvement`
    - Person refs are validated through `ctx.records.resolve("@…")` → `NotFoundError` with suggestions taken from `people.person` handles.
  - **Commands:**
    - `pm project list [--status] [--health] [--archived]`: the text table columns: health dot, code, name, next milestone, due, actions, risks, effort
    - `pm project show <code>`
    - `pm project add <code> <name> [--description] [--start] [--end] [--effort] [--effort-note]`
    - `pm project edit <code> [--name …] [--health green|amber|red] [--health-comment]`: `--health` calls `setHealth`
    - `pm project archive|restore <code>`
    - `pm project context <code> [--set-file <path> | --stdin]`
    - `pm involve add|remove <code> <person> --role <role>`
  - **Guide section** "Projects": codes, health updates, context.

- [ ] **Step 1: Write failing tests.**
  - `project add crm "CRM replatforming"` → exit 1 (lowercase code is invalid, hint shown). `project add CRM …` → ref `#CRM`; repeating it → exit 3.
  - `project edit CRM --health amber --health-comment "Design slipping"` → the `projects.project` view shows `health amber`, with `health_date` 2026-11-13.
  - `project context CRM --stdin`, with "# Background" on stdin (inject stdin through the dispatcher's io), then `project show CRM --json` → `context` equals the input.
  - `involve add CRM marie --role sponsor` before Marie exists → exit 2.
  - Then `person add "Marie Dubois" --stakeholder --influence high` and the same `involve add` → exit 0, and people's `staleStakeholders` returns `projects: ["CRM"]` for `@marie`. This proves the `reads` path.
  - **`archived project`:** `project archive CRM`, then `involve add CRM anna --role x` → exit 1 with hint `restore it first`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** with `feat(projects): projects, health, context, involvement`.

### Task 14: `projects` plugin, part 2: milestones, deliverables, risks, decisions

**Files:**
- Create: `src/plugins/projects/logic/ops-items.ts`
- Modify: `views.ts`, `commands.ts`, `index.ts` in `src/plugins/projects/logic/`
- Test: `src/plugins/projects/logic/items.test.ts`

**Interfaces:**
- Produces:
  - **Views:**
    - `projects.milestone`: `id, project_id, title, due_date, done_date, late`. `late` = `done_date IS NULL AND due_date < date('now')`. Because views can't take the injected clock, `late` is computed by SQLite's `date('now')`. **Tests and reports needing the injected clock must filter with `due_date < :today` themselves; `late` is a display convenience.**
    - `projects.deliverable`: `id, project_id, title, owner_id, due_date, status, status_changed_at, milestone_id`
    - `projects.risk`: `id, project_id, type, title, severity, owner_id, status, closed_date`
    - `projects.decision`: `id, project_id, date, title, decided_by, meeting_id`
  - **Record types:** `milestone` `MS-`, `deliverable` `D-`, `risk` `R-`, `decision` `DE-`.
  - **Write ops:**
    - `addMilestone`, `editMilestone`, `completeMilestone({ ref, date? })`, `deleteMilestone`. Deleting a milestone sets `milestone_id = NULL` on its deliverables, in the same transaction.
    - `addDeliverable`, `editDeliverable`, `setDeliverableStatus({ ref, status })`: sets `status_changed_at` = now, and `delivered_date` = today when `delivered`. `deleteDeliverable`.
    - `addRisk({ project, title, type, severity, owner?, description?, mitigation? })`, `editRisk`, `closeRisk({ ref, date? })`, `deleteRisk`.
    - `addDecision({ project?, title, date?, description?, decidedBy?, meeting? })`, `editDecision`, `deleteDecision`. `meeting` is stored as a soft reference; it's validated only if the `meeting` record type exists.
    - All of them reject archived projects and archived owners (hint `restore it first`).
  - **Commands:** `pm milestone`, `pm deliverable`, `pm risk` and `pm decision`, with the verbs from the plugin reference §2. Flags mirror the op inputs (`--due`, `--owner`, `--severity`, `--type`, `--milestone`, `--date`, `--meeting`, `--decided-by`), and `delete` is `destructive`.

- [ ] **Step 1: Write failing tests.**
  - `risk add CRM "Vendor delay" --type risk --severity high --owner bob --json` → ref `R-1`.
  - `deliverable status D-1 delivered` → `delivered_date` 2026-11-13, and `status_changed_at` set.
  - **`milestone delete clears deliverables`:** a deliverable linked to `MS-1`; `milestone delete MS-1 --yes` → exit 0, and the deliverable's `milestone_id` is null.
  - `milestone add CRM "Design approved" --due 2026-02-30` → exit 1 with the date hint.
  - **`archived project`:** `risk add` on an archived project → exit 1, hint `restore it first`.
  - `decision add --meeting M-4 …` succeeds without the meetings plugin loaded (soft reference, not validated).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** with `feat(projects): milestones, deliverables, risks, decisions`.

### Task 15: `projects` plugin, part 3: actions, status report, overview sections

**Files:**
- Create: `src/plugins/projects/logic/ops-actions.ts`, `src/plugins/projects/logic/status.ts`, `src/plugins/projects/logic/report.ts`
- Modify: `views.ts`, `commands.ts`, `index.ts` in `src/plugins/projects/logic/`
- Test: `src/plugins/projects/logic/actions.test.ts`, `src/plugins/projects/logic/status.test.ts`

**Interfaces:**
- Produces:
  - **View** `projects.action`: `id, title, due_date, status, done_date, owner_id, project_id, for_person_id, meeting_id`. No `overdue` column; consumers compare with their own `today` (see the clock note in Task 14). **Update the plugin reference to match.**
  - **Record type** `action` `A-`.
  - **Write ops:**
    - `addAction({ title, due?, owner?, project?, forPerson?, meeting?, notes? })`: no `owner` means `owner_id NULL`, which means me
    - `editAction`
    - `completeAction({ ref, date? })`, `cancelAction`, `deleteAction`
  - **Read op** `projectStatus({ project, since, reference? })`. `reference` defaults to today. It returns the §8 prep data:
    ```ts
    { project: { ref, name, health, healthComment, healthDate, healthStale: boolean /* healthDate < since or null */ },
      milestones: { completed: Row[] /* done_date >= since */, upcoming: Row[] /* open, due <= reference+60, late flagged */ },
      deliverables: Row[] /* status_changed_at >= since OR (status != delivered AND due <= reference+30) */,
      risks: Row[] /* open, ordered high > medium > low, then id */,
      decisions: Row[] /* date >= since */,
      actions: { overdue: Row[] /* open, due < reference */, fromMeeting: Row[] /* open, meeting_id = previousMeeting; [] in phase 1 */ } }
    ```
    `previousMeeting?: string` is accepted, so phase 4 can pass it in.
  - **Report** `project-status` (cliName `status`, params `{ project: string, since?: string }`, `since` defaulting to `today − 30`). It has sections, in order: Health 10, Milestones 20, Deliverables 30, Risks & issues 40, Decisions 50, Actions 60. Each is built from `projectStatus`; the health section's `note` is `⚠ health not updated since <since>` when stale.
  - **Report** `overview` (cliName `overview`, no params, title `Overview`), registered by `projects`. Every plugin adds sections to it; the kernel doesn't own it. Sections added here:
    - Overdue actions (10): columns ID, Action, Project, Owner, Due
    - Due this week (20): today…`weekEnd`
    - Projects needing attention (30): red or amber, or `health_date` null or older than 30 days
    - Late milestones and next 14 days (40)
    - High risks & issues (50): open, severity high
    - Owner and for-person names come from joining `people.person`. A null owner shows as `me`.
  - **Commands:**
    - `pm action list [--open] [--overdue] [--owner <me|person>] [--project] [--for <person>] [--meeting]`, grouped in text output as Overdue / This week / Next week / Later / No date
    - `pm action add <title> [--due] [--owner] [--project] [--for] [--meeting] [--notes]`
    - `pm action edit|done|cancel <A-n>`
    - `pm action delete <A-n> --yes`
  - **Guide section:** turning notes into actions, decisions, risks, health and deliverable updates. These are the inbox rules from §6 "Agent guide", in imperative form.

- [ ] **Step 1: Write failing tests.** Seed through ops with today 2026-11-13.
  - `action list --overdue --json` returns only open actions due before 2026-11-13.
  - `action add "Send roadmap" --for peter --due fri --json` → `due_date` 2026-11-20, `owner_id` null; the text list shows owner `me`.
  - `projectStatus` with since 2026-10-14 over a fixed dataset → the exact ids in each bucket:
    - one milestone done 2026-10-14 (included) and one done 2026-10-13 (excluded);
    - a deliverable due 2026-12-13 (reference + 30, included) and one due 2026-12-14 (excluded);
    - risks ordered high, medium, low;
    - `healthStale` true when the last update was on 2026-10-01.
  - `report status CRM --format md` contains `## Risks & issues` and the stale-health note.
  - `report overview --json`, with people and projects loaded, has the section titles in order: Overdue actions, Due this week, Projects needing attention, Late milestones and next 14 days, High risks & issues, Stakeholders to contact.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** with `feat(projects): actions, project status report, overview sections`.

### Task 16: `inbox` plugin

**Files:**
- Create: `src/plugins/inbox/logic/{index,schema,views,ops,commands,report,guide}.ts`
- Modify: `src/plugins/index.ts` (add `inbox`)
- Test: `src/plugins/inbox/logic/inbox.test.ts`

**Interfaces:**
- Consumes: `ctx.tags.resolve`, `ctx.provenance.createdFrom` and `ctx.records.label` (all from Task 10).
- Produces (plugin id `inbox`, version `1.0.0`, no `requires`):
  - **Tables:**
    - `item`: `text, captured_at, status (new|processed|dismissed), summary, processed_at, processed_by (assistant|cli|you), unresolved_tags (JSON text)`
    - `link`: `item_id, record_type, record_id`
  - **View** `inbox.item`: `id, text, captured_at, status, summary, processed_at, processed_by`
  - **Record type** `inbox_item` `I-`.
  - **Read op:** `getItem({ ref }) → { ref, text, status, summary, links: [{ ref, label }], unresolved: string[], created: [{ ref, label }] }`. `created` comes from `provenance.createdFrom("inbox", ref)`.
  - **Write ops:**
    - `capture({ text, context?: string })`: `context` is a ref such as `#CRM` or `@anna`. It's appended as a tag when the text doesn't already contain it.
    - `editItem({ ref, text })`: re-resolves the tags
    - `markProcessed({ ref, summary, by })`
    - `dismiss`, `reopen`: `reopen` sets `new` and clears the summary
  - **Commands:**
    - `pm inbox add <text…>`: rest args are joined with spaces
    - `pm inbox list [--new] [--all]`: default `--new`
    - `pm inbox show <I-n>`
    - `pm inbox edit <I-n> <text…>`
    - `pm inbox done <I-n> --summary <s> [--by cli|you|assistant]`: default `cli`
    - `pm inbox dismiss|reopen <I-n>`
  - **Report section** `inbox` in `overview` (70): "Inbox", columns ID, Captured, Text (truncated to 60 characters), only `new` items, `empty: "Inbox is empty"`.
  - **Guide section** "Processing the inbox". This is the §6 rule list verbatim:
    > concern → stakeholder note, "X will do Y" → action, "decided" → decision, "finished" → deliverable status, health signals → health update, and ask the user when something is ambiguous instead of guessing.

    Add the command sequence: `pm inbox list --new --json` → create records with `--from-inbox I-n` → `pm inbox done I-n --summary "…"`.

- [ ] **Step 1: Write failing tests.** With all three plugins loaded:
  - `inbox add "Peter worried about budget (#CRM), update before board @peter."` → `show --json` has links `#CRM`, `@peter` and `unresolved: []`.
  - `inbox add "ask Marie #CMR"` → `unresolved: ["#CMR"]`. Then `inbox edit I-2 "ask Marie #CRM"` → resolved.
  - **`tag parsing`** end to end: `inbox add "mail anna@example.com about C# code"` → no links, no unresolved.
  - **Provenance:**
    1. `action add "Budget update for Peter" --for peter --from-inbox I-1 --json` → `A-1`;
    2. `note add peter "Worried about budget" --interaction --from-inbox I-1`;
    3. `inbox done I-1 --summary "note on @peter, A-1"`;
    4. `inbox show I-1 --json` → `created` refs `["A-1","N-1"]` and status `processed`.
  - `pm guide` output contains the headings "People and stakeholders", "Projects" and "Processing the inbox", in that order.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` → PASS (all).
- [ ] **Step 5: Commit** with `feat(inbox): inbox plugin with tags and provenance`.

### Task 17: Node 26 parity, isolation self-check, CI, docs

**Files:**
- Create: `src/kernel/isolation-selfcheck.ts`, `scripts/smoke-node.sh`, `tests/isolation-selfcheck.test.ts`
- Modify: `.gitlab-ci.yml`, `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-11-13-pm-plugins.md` (the `projects.action`/`projects.milestone` clock notes from Tasks 14–15)

**Interfaces:**
- Produces:
  - `runIsolationSelfCheck(): Promise<{ ok: boolean; results: Array<{ name: string; ok: boolean; message?: string }> }>`. It boots a kernel with two fixture plugins on a temp DB and repeats the Task 5 allowed and rejected cases. When run as a script (`import.meta.main` under Bun, or a check of `process.argv[1]` on Node), it prints each result and exits 0 or 1.
  - `scripts/smoke-node.sh`:
    1. `node scripts/build-node.mjs`;
    2. then, with a temp `PM_HOME` and `node` (no `--experimental-ffi` flag except through the shebang), run:
       - `node dist-node/kernel/db/savepoint-selfcheck.js` and `node dist-node/kernel/isolation-selfcheck.js`
       - the `dist-node/bin/pm.js` commands `person add "Anna Peeters" --team`, `project add CRM "CRM"`, `action add "Test" --project CRM --due fri --json`, `report overview --format text`, and `inbox add "x #CRM"`;
       - `node dist-node/bin/pm.js project show NOPE` → expect exit 2;
    3. `set -euo pipefail`; print `smoke ok`.
  - **CI**: a job `test` in stage `test`, image `oven/bun:1.3.14`, that runs `bun install --frozen-lockfile && bun typecheck && bun test`. A job `node-smoke`, image `node:26`, that runs `npm ci && bash scripts/smoke-node.sh`. Keep the SAST include.
  - `CLAUDE.md`: replace the "How it's wired" section with the kernel/plugin layout, the isolation rules, the "logic must not import UI" rule, the test helper, and the new commands (`bun run pm …`, `bash scripts/smoke-node.sh`). `README.md`: add the `pm` CLI usage and how to link it (`npm link` after the Node build, or `bun link`).

- [ ] **Step 1: Write the failing test** `tests/isolation-selfcheck.test.ts`: `expect((await runIsolationSelfCheck()).ok).toBe(true)`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the self-check and the smoke script. Fix any Node-only breakage the smoke run exposes, e.g. `import.meta.main`, bigint row ids, or `node:sqlite` returning null-prototype objects (normalise them in `sqlite.ts`).
- [ ] **Step 4: Run** `bun test && bun typecheck && bash scripts/smoke-node.sh` → all PASS, and the last line is `smoke ok`.
- [ ] **Step 5: Commit** with `chore: node smoke test, isolation self-check, CI, docs`.

---

## Spec coverage map (phase 1)

| Spec item | Task |
|---|---|
| `PM_HOME`, env paths, config (§2, §11.2.1) | 1 |
| Dates, refs, handles, codes (§4, §6) | 2 |
| SQLite adapter, WAL, busy_timeout, kernel transactions and savepoints (§2, §3.3.1) | 3 |
| Layer 2 EXPLAIN check (§3.3.1) | 4 |
| Layer 1 query check, aliases, views read-only, column check, DDL only in migrations (§3.3.1, §3.3.3) | 5 |
| Per-plugin migrations, schema diff, triggers, backup (§3.3.1, §10) | 6 |
| Published views, `ViewUnavailableError`, `reads` (§3.3.3) | 7 |
| Exposed operations, validation, provenance, events (§3.3.2, plugin reference "Kernel services") | 8 |
| Tags, change sets, reports, guide (§3.4, §3.5, §5, §6) | 9 |
| Plugin host, `requires` ranges, failure isolation, disabled plugins (§3.2) | 10 |
| CLI conventions, exit codes, `--json`, `--yes`, `--from-inbox`, help, guide, `plugin list`, `report` (§6) | 11 |
| Clean shutdown on SIGHUP/SIGTERM (§11.2.2) | 11 |
| `people` plugin (§4 People, plugin reference §1) | 12 |
| `projects` plugin (§4 Projects, plugin reference §2) | 13–15 |
| `pm report status`, `pm report overview` (§8) | 15 |
| `inbox` plugin, tags, provenance (§5, plugin reference §4) | 16 |
| Both runtimes, CI (§12) | 3, 17 |

**Deferred by the spec's phasing:**
- TUI, `tui` entry loading and `pm.tui` (phase 2);
- external plugin loading, `pm plugin build|add|…` and shims (phase 5);
- `PM_MODE=container` behaviour, `pm doctor` and the Dockerfile (phase 6);
- assistant tools generated from operations (phase 7). `OperationRegistry.list()` exists for it.
