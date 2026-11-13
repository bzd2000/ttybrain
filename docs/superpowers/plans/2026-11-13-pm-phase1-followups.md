# pm phase 1: follow-ups

Deferred findings from the phase 1 task reviews and the final review, plus the controller rulings made during execution. Triage the 'before phase 2' items first.

## Before phase 2 (TUI)

- Every invocation, even `pm help`, takes the write lock twice and recreates all views (ruling R20). Read-only commands then fail with exit 3 while another writer holds the lock, and the TUI's `data_version` live refresh would reload after every CLI read. Check the schema first and only open a transaction when something changed.
- `ctx.emit` inside a write fires before commit; defer it to after-commit before plugins emit typed events.
- Plugin-specific events are not emitted yet (R18); only `record.changed` is.

## Before phase 5 (external plugins)

- Table-valued functions (`pragma_table_info`, `dbstat`) are invisible to the EXPLAIN check, so other plugins' schema metadata can be read through raw SQL.
- `ctx.config` is one shared mutable object; freeze it.
- Kernel provenance cleanup on delete only supports numeric refs (A-12); a `#`/`@` record delete would throw.
- The `--from-inbox` existence check is only in the CLI dispatcher.

## Deferred minors (from the task reviews)

- Task 1: minor (deferred): config merge assigns __proto__ keys from JSON (config.ts:318)
- Task 1: minor (deferred): non-ENOENT config read errors rethrown raw, not PmError (config.ts:341)
- Task 1: minor (deferred): Config not schema-validated (staleContactDays:"x" accepted)
- Task 1: minor (deferred): ValidationError.field not in details — CLI JSON serializer must read field (Task 11)
- Task 1: minor (deferred): Clock.now() returns local time without offset; ISO-8601 timestamps should be unambiguous (UTC toISOString) — controller note
- Task 2: minor (deferred): parseRef accepts "0" and > MAX_SAFE_INTEGER (refs.ts:167)
- Task 2: minor (deferred): makeHandle("- x") yields "-" (refs.ts:173)
- Task 2: minor (deferred): semver ^0.x treated as same-major; partial exact "1.2" matches 1.2.0
- Task 3: minor (deferred): integers > 2^53: node throws ERR_OUT_OF_RANGE, bun silently rounds (sqlite.ts header claims identical shapes)
- Task 3: minor (deferred): cleanup (ROLLBACK TO/RELEASE) failure masks original error (kernel-db.ts:94,109)
- Task 3: minor (deferred): closed-db errors are plain Error, not PmError (kernel-db.ts:80,118)
- Task 3: minor (deferred): withWriteLock passes previous result into fn (kernel-db.ts:130)
- Task 3: minor (deferred): selfcheck run-as-script guard fails silently via symlinked path — T17 smoke must grep "savepoints ok"
- Task 3: minor (deferred): openRaw leaks handle if a pragma throws (sqlite.ts:97)
- Task 4: minor (deferred): countPlaceholders counts ? in comments / ?1 repeats (fails closed)
- Task 4: minor (deferred): cached result array returned by reference (freeze)
- Task 4: minor (deferred): CreateBtree not collected (no gap today; DDL reports sqlite_schema)
- Task 5: minor (deferred): column check uses whole-tree union, not per-scope (Bun DQS parity gap remains in nested queries)
- Task 5: minor (deferred): CTE named like an own table accepted (contradicts R9; no leak)
- Task 5: minor (deferred): alias equal to own short name skips prefixing (fails closed)
- Task 5: minor (deferred): table-valued functions (pragma_table_info, dbstat) invisible to EXPLAIN → schema metadata of other plugins readable via raw sql; reject VOpen/VFilter
- Task 5: minor (deferred → T6 via R11): DDL keeps existing `<id>_*` tables → plugin foo could alter foo_bar_* if ids contained `_`
- Task 5: minor (deferred → T6 via R11): nested inner short name `x` re-prefixed when own short names include `contracts_x` (wrong own table read)
- Task 5: minor (deferred → T6 via R11): FK from own table to another plugin's view allowed in DDL
- Task 6: minor (deferred): AUTOINCREMENT first table rejected via sqlite_sequence (R9 says no AUTOINCREMENT — make error message say so)
- Task 6: minor (deferred): concurrent backup naming race (count vs VACUUM INTO) — unverified
- Task 6: minor (deferred): "stops later migrations" test uses bare rejects.toThrow()
- Task 6: minor (deferred → T7 via R12): TableAccess hooks ownsPhysical/afterSchemaChange optional → fail open for a future migration-mode caller
- Task 7: minor (deferred): forReader ignores reader/version ranges (→ T10); ColumnType not checked; spec example max("date") needs alias (→ T12 dispatch)
- Task 7: minor (deferred): failure() overwrites existing PmError details (views.ts:153)
- Task 7: minor (deferred): a single trailing ";" is rejected with no hint (explain.ts:89)
- Task 7: minor (deferred): gate IsolationError messages don't name the plugin (explain.ts:119)
- Task 7: minor (deferred → T11): raw SQLite errors surface as SQLiteError/Error, not PmError — CLI must map to internal (exit 1) cleanly
- Task 8: minor (deferred): reads on same connection see uncommitted data — document in architecture.md (T17)
- Task 8: minor (deferred): duplicate-expose/missing-describe are ValidationError (programmer errors); TypeBox objects allow extra props
- Task 8: minor (deferred): nested write awaiting a later sibling deadlocks (programmer error, unguarded)
- Task 9: minor (deferred → T10 via R17): malformed section result crashes the whole render
- Task 9: minor (deferred): #Café → #Caf partial tag; #CRM- keeps hyphen (spec regex)
- Task 9: minor (deferred): atIndex mutates plugin error details in place
- Task 9: minor (deferred): unreachable NotFound check in apply (changesets.ts:282)
- Task 9: minor (deferred): outer-origin provenance silently skipped when ref doesn't resolve
- Task 10: minor (deferred): disabled-requirement message omits range; reads declared after activate (document in architecture.md, T17)
- Task 10: minor (deferred): rename-to-__ test asserts no message; no hyphenated-id leftover test
- Task 11: minor (deferred → T15): report param names not reserved (json/format collide with global flags) — reject in ReportRegistry at registration
- Task 11: minor (deferred): repeated flag keeps last value silently; Number() accepts 0x10/1e3; '-5' positional hint lacks "--"; flag-before-command misleading error; bin uninstalls handlers before final shutdown; duplicated reserved-name lists
- Task 11: minor (deferred → final review): every command (even help) boots + takes a write tx → help fails busy (exit 3) while another writer holds the lock
- Task 12: minor (deferred → final review): ctx.emit inside a write fires before commit (should defer to after-commit)
- Task 12: minor (deferred): describe labels blindly prefix unparseable refs; archive/restore idempotent but still logs change; edits on archived person's notes rejected (design); untested flag combos; stakeholder list sort duplicated w/o name tiebreak
- Task 12: minor (deferred): NonBlank accepts zero-width-space-only names
- Task 13: minor (deferred): `project edit` fields+--health = two transactions (partial success practically unreachable)
- Task 13: minor (deferred): `project context --stdin` with empty input silently clears context
- Task 13: minor (deferred): conflict/not-found involvement errors lack hints
- Task 14: minor (deferred → T15 via R19): re-setting same deliverable status rewrites status_changed_at/delivered_date; closeRisk twice overwrites closed_date
- Task 14: minor (deferred): completeMilestone accepts future date; not_found hints null; add-describe lines lack id; M- prefix hardcoded (check in phase 4)
- Task 15: minor (deferred → final review): handle "me" shadowed by owner token — people should reserve handle `me` (makeHandle/addPerson/editPerson)
- Task 15: minor (deferred): action list shows archived projects' actions (overview excludes them); completeAction can't correct a done date; RESERVED_PARAMS duplicates GLOBAL_FLAG_NAMES; status memo relies on same params object
- Task 16: minor (deferred): clip() splits surrogate pairs (report.ts:643, ops.ts:468); capture context not validated as a tag; --from-inbox I-99 records dangling provenance (kernel)
- Task 17: minor (deferred): smoke uses loose substring checks; architecture.md mentions not-yet-existing meetings/assistant plugins

## Controller rulings

- Ruling R1: TableAccess gains `ownerOf(shortOrPhysical: string): string | undefined` (kernel-wide table→plugin lookup) — needed for the error message the plan specifies — cost if wrong: one extra method to remove.
- Ruling R2: ViewRegistry gets `declareReads(pluginId, pluginIds: string[])`; layer 1 throws ViewUnavailableError for `<X>.<view>` when X is in the reader's declared reads but not published; host (T10) calls it — cost if wrong: small refactor.
- Ruling R3: ReportRegistry accepts sections for a report id before/without the report being registered; `run()` of an unregistered report throws NotFoundError; sections whose report never registers are ignored — cost if wrong: overview could silently lack a section (covered by T15 test).
- Ruling R4: Global constraint "no Bun-only API" applies to src/ only; tests may use Bun APIs (bun test is the runner) — cost if wrong: none for the Node runtime.
- Ruling R5: T17 self-check uses a runtime-neutral "run as script" check (compare `process.argv[1]` with `fileURLToPath(import.meta.url)`), not `import.meta.main` — cost if wrong: none.
- Ruling R6: T3 creates `src/kernel/db/savepoint-selfcheck.ts` (listed in step 4) — part of T3's Files — cost if wrong: none.
- Ruling R7: suggest() uses min(Levenshtein(full), Levenshtein(same-length prefix)) ≤ 2 — plan example (ana→annie) was inconsistent with plain Levenshtein; prefix-aware matching serves did-you-mean better — cost if wrong: slightly looser suggestions.
- Ruling R8: plugin ids must match spec `[a-z][a-z0-9-]*` (no `_`), so `<id>_` prefixes can't collide — T10 host must validate ids — cost if wrong: prefix collision between plugins.
- Ruling R9: CTEs, rowid and AUTOINCREMENT (sqlite_sequence) stay rejected for plugins in phase 1; plugins use INTEGER PRIMARY KEY without AUTOINCREMENT — cost if wrong: a later plugin needing CTEs requires extending layer 1.
- Ruling R10: Task 5 Important 2 is routed to Task 6 (its scope is the migration sqlite_schema diff): T6 must reject (a) any removed or changed sqlite_schema object not named <pluginId>_*, (b) any trigger whose tbl_name is not the plugin's own (built-ins included), (c) any view whose base tables (tablesTouched on SELECT * FROM view) aren't own — with tests for DROP VIEW projects__pub_project, DROP TRIGGER, CREATE TRIGGER ON projects_project, CREATE VIEW over projects_project — cost if wrong: a gap between T5 and T6 if T6 misses it (re-checked in T6 review).
- Ruling R11: MigrationRunner (T6) enforces (a) plugin id matches /^[a-z][a-z0-9-]*$/, (b) no own short table name may start with `<pluginId>_`, (c) the post-migration diff rejects foreign keys (PRAGMA foreign_key_list) to tables/views not owned by the plugin — together with R10 — cost if wrong: one of these rules may be stricter than a future plugin needs.
- Ruling R12: T7 makes KernelDb.pluginDb throw if access.migrating can be true without ownsPhysical/afterSchemaChange hooks (fail closed) — cost if wrong: one extra guard.
- Ruling R13: createAll errors carry structured details { plugin, view } so T10 can isolate the failing plugin without string parsing — added to T7 fix round 1 since T10 depends on it — cost if wrong: small API addition.
- Ruling R14: after-commit hooks (record.changed handlers) run in an operation context WITHOUT origin (same actor/today/now), so a handler's own writes don't inherit the triggering write's provenance origin — cost if wrong: a handler wanting provenance must set it explicitly.
- Ruling R15: plugin DML (INSERT/UPDATE/DELETE/REPLACE) outside a kernel write scope and outside migrations is rejected (IsolationError "data changes must run inside a write operation"), so read ops / stray chains can't write into another write's open savepoint — assigned to T9 (kernel) — cost if wrong: a plugin wanting ad-hoc writes must expose a write op.
- Ruling R16: ChangeSetService.apply with an origin records provenance for both the caller's origin (e.g. inbox I-3) and {changeset, CS-<id>} — inbox needs "what this became" for assistant-processed items — cost if wrong: duplicate provenance rows.
- Ruling R17: T10 adds section-result shape validation in ReportRegistry.run (columns/rows arrays, title string; else error note) — load-bearing before plugins register sections — cost if wrong: none.
- Ruling R18: plugin-specific events (person.changed, note.added, …) are not emitted in phase 1; the kernel's after-commit record.changed covers every write. Plugin reference "Events emitted" lines become informational — cost if wrong: TUI phase 2 may want typed events.
- Ruling R19: T15 makes setDeliverableStatus a no-op (returns current record, no timestamp change) when the status is unchanged, and closeRisk on an already-closed risk a ValidationError ("already closed") — projectStatus's "changed since" logic depends on status_changed_at — cost if wrong: small behaviour change.
- Ruling R20: I4 deferred to phase 2 (must be fixed before the TUI's data_version live refresh) — phase 1 CLI-only use is correct, just slower/locking — cost if wrong: read-only commands fail with exit 3 while another writer holds the lock.
- Ruling R21: final fix wave covers I1, I2, I3, M1 (delete JSON shape via I1 convention), M2 (reserve handle "me"), M5 (no provenance when ref == origin.ref; guide wording), M6 (mark non-emitted events phase 2+ in plugin reference), M7 (projects reads people) — M3/M4/M8/M9 deferred as minors — cost if wrong: small polish left for later.
