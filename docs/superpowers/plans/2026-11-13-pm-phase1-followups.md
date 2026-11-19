# pm phase 1: follow-ups

Deferred findings from the phase 1 task reviews and the final review, plus the controller rulings made during execution. Triage the 'before phase 2' items first.

## Before phase 2 (TUI)

- Every invocation, even `pm help`, takes the write lock twice and recreates all views (ruling R20). Read-only commands then fail with exit 3 while another writer holds the lock, and the TUI's `data_version` live refresh would reload after every CLI read. Check the schema first and only open a transaction when something changed. — done in phase 2 Task 1
- `ctx.emit` inside a write fires before commit; defer it to after-commit before plugins emit typed events. — done in phase 2 Task 1
- Plugin-specific events are not emitted yet (R18); only `record.changed` is.

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

## Phase 2 (the TUI)

Collected from the phase 2 execution ledger (`.superpowers/sdd/2026-11-16-pm-phase2-tui/progress.md`). Task numbers refer to `docs/superpowers/plans/2026-11-16-pm-phase2-tui.md`.

### Open phase 2 items

- **Task 3, the web-terminal spike, was done afterwards** (2026-11-17, ttyd 1.7.7 driven from headless Chromium): see `docs/superpowers/spikes/2026-11-16-web-terminal.md`. Ctrl+J, Ctrl+S and Esc s all work in xterm.js; Shift+Enter arrives as Enter (it saves in quick capture, whose comment says it adds a line); the launcher needs `COLORTERM=truecolor`; OSC 52 does nothing under ttyd 1.7.7.
- **Terminal restore on quit was only checked through a pty script** (see the Task 16 walk-through in the report); in Task 8 `stdin.isRaw` stayed true after `renderer.destroy()` in a pty script. Check it in a real terminal.
- **Ctrl+J as a line feed on a real legacy terminal** and the Esc chord timing on a slow link are unverified (manual check).
- Task 8: **Alt+D in the editor discards edited text with no confirmation** (`Editor.tsx`): data loss on an emacs "delete word" keystroke. Recommended fix: confirm, or drop the binding.
- Task 7: **a busy save blocks the event loop for SQLite's `busy_timeout` (3 s) per attempt**, so the TUI freezes while retrying. Consider a shorter `busy_timeout` for the TUI connection.
- Plugin-specific events are still not emitted (R18); only `record.changed` is.

### Rulings made during phase 2 (and what each costs if wrong)

Plan rulings (R22 to R27, in the plan):
- **R22.** `field` gets its data and TUI side in phase 2; its CLI side (`show --json`, `edit --<flag>`) is phase 5. Cost: a plugin's extra field is invisible to Copilot until phase 5. No built-in plugin uses fields.
- **R23.** `overviewPanel` is data-driven (`load()` returns rows of cells with a ref), not a free component. Cost: no custom panel (a chart) until a `component` option is added, which is compatible.
- **R24.** `recordForm(recordType, def)` is a TUI registration the spec does not name; it is how `n`/`e` and Inbox `p` open forms without inbox requiring `projects`. Cost: one more extension point to keep stable in `apiVersion` 1.
- **R25.** Shift+Enter has `Ctrl+J`, and `Ctrl+S` has `Esc` `s`. The Task 3 spike confirmed both are enough in xterm.js.
- **R26.** The People TUI part holds only the "Stakeholders to contact" panel; the People screen is phase 3. Cost: none.
- **R27.** Closed (not archived) projects show in their own `Closed` group. Cost: the spec names only active, on-hold and archived.

Pre-flight rulings:
- **F1.** `suggest(partial, limit)` is on `PluginContext.tags` too, so `PluginRuntime` stays a pure `Pick`. Cost: logic code can call it (read-only, harmless).
- **F2.** Screen-local keys (`h a d z u p E`) are not reserved. Dispatch: overlay, text field, focused screen's keys, global actions, global keys. Cost: an external plugin's global action could shadow a screen key in phase 5.
- **F3.** `bootTui` takes `{ builtin?, external? }`; `renderTui(kernel, { parts, external })` boots `parts` as built-in and `external` as not. Cost: a small signature change.
- **F4.** `provenance.originOf(recordType, ref)` (read-only) was added to the store and the `ctx.provenance` facade, so the Actions screen can show "For/from". Cost: one more kernel API in `apiVersion` 1.
- **F5.** Task 13 adds both the people and inbox parts to `builtinTuiParts`; Task 14 only extends inbox. Cost: none.
- `kernel.tuiErrors` was dropped; `registry.errors()` is the single source and Help reads it. Cost: add a getter later.
- Task 3 ran in a separate worktree; its probe was cherry-picked and the spike finished on the branch. Cost: none.

Execution rulings:
- The record prop is `recordRef`, not `ref` (Solid compiles `ref=` into an element ref). Cost: a rename back.
- `Table` keeps the selection visible (scrolling) though the brief did not name it. Cost: a little extra code.
- Missing RecordView/Table status-bar hints are a spec gap (the bar shows the keys valid right now). Cost: none.
- `openForm` returns `Promise<string | undefined>` (saved ref, or undefined on cancel); the plan said `void`. Cost: none, additive.
- Esc during an in-flight save closes the form but the save completes: treated as Important (silently creates a record the user cancelled) and fixed. Cost: a small extra fix.
- `act()` runs `fn` inside one outermost kernel write transaction, so multi-op saves are all-or-nothing and a busy retry is atomic. Cost: a long TUI action holds the write lock for its whole duration (hence: never await user interaction inside `act`).
- Task 9 minors elevated into the fix loop (edit forms send only changed fields, re-selection, hints dropped whole, messages leaking between tests). Cost: one extra round.
- The Actions `d` form starts empty with the current date as context; an empty submit writes nothing. Cost: a small UI change.
- Inbox `p` finds forms through the read-only `useRecordForms()` hook instead of importing `projects` (R24). Cost: one more export.
- Process-by-hand is a form save, then a separate `act` for `markProcessed`; if that fails the record stays, the item stays `new`, and an error notice shows. Cost: a rare orphan the user can re-process or dismiss.
- The newline-stripping bug was fixed in the kernel `Field` `longtext` kind (affects every long-text field). Cost: a Field rewrite touching every form.
- Every project-scoped item form shows a project field when not prefilled (risk, milestone, deliverable, like action). Cost: an extra field in the `p` flow.
- CLI `inbox dismiss` records `by` as "cli"; an absent `by` keeps the existing value. Cost: none.
- The kernel (Form plus `act`) saves a form's extra fields inside the plugin's own `act`; plugins no longer call `extra.save`. Cost: Form/act coupling through the session.

### Deferred minors and concerns

Kernel and runtime:
- Global key dispatch uses OpenTUI's internal `_internalKeyInput.onInternal`; add a loud-failure test and pin OpenTUI. Renderables focused at the first render run before the dispatcher (Task 4).
- `messages.ts` keeps module-level state shared across app instances; no tests for notice expiry or `installShutdownHandlers` before/error paths (Task 4).
- `format.ts` `weekday` duplicates a private helper in `dates.ts` (Task 4).
- `nav.go(unknownId)` pushes a route the header ignores; the `g` and `?` overlays open below 60x15 (Task 4).
- An async `activate` in a tui part is not caught (`boot.ts`); relevant for phase 5. The logic/UI-split test's regex can match across lines (fail-safe). The `runtime().data` identity test compares runtime to runtime (Task 2).
- Live refresh: a persistently failing query re-notifies on every change bump; `useQuery` with a changed `key` shows the old key's data while loading; the `key` option is untested; `act` keeps retrying after the app unmounts; a failed plugin gives a misleading `useRuntime()` message (Task 5).
- Task 1: fast-path view checks are not in one read snapshot (`views.ts`); no test that `verifyAll` runs on the unchanged path; no test that `emit` outside a write is synchronous; read-only boot was to be asserted on Node (done by the Task 4 self-check).
- The Node self-check does not exercise the Form-with-extras (AsyncLocalStorage) path (Task 15).
- Extra fields: the extras save does not check the ref's record type (multi-act submits); unclaimed extras linger after a failed submit (mark claimed in `finally`); a `FieldDef` is stored and handed out mutable and empty name/label/get/set are not rejected; `fieldEditor` with key-driven input is untested and the Form may claim keys first; the "project form edits extra field" test does not prove `editProject` was skipped (Task 15).

Building blocks:
- Table: `Enter open` hint shows while typing; row cells are rebuilt per cell; the grow column is measured after the first layout (possible one-frame wobble); `displayWidth`'s wide-character table is partial (Tasks 6, 13).
- Overview has no Shift+Tab and initial focus can land on an empty panel; the grow column is picked by the widest text per reload, so the stakeholders panel can flip (let panels name it); `+N more` overflow and stakeholder `never` are untested in real panels (Tasks 6, 13).
- The selected RecordView tab is not written to `route.tab`; the header crumb and the RecordView breadcrumb both show `› T-1` (Task 6).
- Form: autocomplete may accept a stale suggestion while the new search loads; `openForm` pushes without a kind, so `nav.open` twice stacks two forms; `confirm()` never resolves if its overlay is removed another way; Esc then Ctrl+S within 1 s may leave the cancel timer armed during the save; general Field pre-fill appends on typing (consider select-all on focus) (Tasks 7, 12).
- Editor: no tests for the chord timeout, Alt+S/Alt+D or the saving guard; it overflows below about 8 rows; `suspend()` failure leaves the renderer un-resumed (`external.ts`) (Task 8).

Projects:
- The Projects screen's `want` stays set if the restored ref no longer exists; the panel title count follows the filter; tests clean up in `afterEach` rather than `finally` (Tasks 9, 10).
- The project edit form sends `null` when a date/effort is cleared and it is unverified how `editProject` treats that (empty string vs undefined may count as a change); the project form's own `number()` accepts `0x10` (Tasks 9, 15).
- `WithRecord` silently closes a form whose record fails to load; no tests for `e` without change or for risk/decision edits; an `any` count helper in `projects/tui/index.tsx` (Task 11).
- `E` is tested only in container mode; the `e` edit test checks the DB, not the reloaded tab; a `sleep(1100)` waits out the Esc window; tab titles with counts were to assert `Milestones 1` and `Risks & issues 1` (Tasks 10, 11).
- Actions: `originsOf` accepts any record type and its `IN (ids)` is unchunked; no test for two origins on one record ("earliest wins"); done/cancelled lists sort by id descending, not completion date; the meeting-title For/from path is untested until phase 4 (Task 12).

Inbox:
- Capture keys test types only `q 2 i` (not `n g ?` or other digits); person prefill and badge position untested; the whole text cell is amber for unresolved tags; `x#CMR` is also marked (not word-anchored) (Task 14).
- Esc-s from inside a long-text textarea is untested (Task 14).
- A health update made through `p` records project `#CRM` as "created from" I-n in provenance (for the final review) (Task 14).

Fields: the RecordFields label column is not aligned with the Summary facts (the brief literally says `Budget  12000`) (Task 15).

## Phase 3 (People UI)

Collected from the phase 3 execution ledger (`.superpowers/sdd/2026-11-17-pm-phase3-people-ui/progress.md`). Task numbers refer to `docs/superpowers/plans/2026-11-17-pm-phase3-people-ui.md`.

### Rulings made during phase 3 (and what each costs if wrong)

Plan rulings (P1 to P10, in the plan):
- **P1.** Groups dropped: the mockup's "Sales key users" row has no data model counterpart. Cost: a later phase adds a group record type.
- **P2.** The detail panel shows only at 110 columns and wider (`PANEL_MIN_WIDTH`); below that Enter gives the same information. Cost: one constant.
- **P3.** A team member's panel uses stacked sections (Open actions, 1:1 notes, Goals), not tabs as in the mockup. Cost: a focus model for the panel if real tabs are wanted.
- **P4.** `a` / `s` / `t` are the tabs, so archived is `A`; `n` adds a note, so a new person is `N`; Del archives after a confirmation and `r` restores. Cost: a key-letter change.
- **P5.** `staleStakeholders` changed from strictly-more to "`staleContactDays` or more", so the Overview panel and the screen agree. Cost: someone contacted exactly `staleContactDays` ago now appears in the panel.
- **P6.** "Role" is job title and organisation; project roles have their own tab. Cost: none.
- **P7.** Person type is one enum in the form (`stakeholder` / `team` / `both` / `other`); the CLI keeps its flags. Cost: none.
- **P8.** Note kinds show their raw values (`one_on_one`, `interaction`) in the form. Cost: cosmetic.
- **P9.** `recordTab.when` is a new, additive option in `apiVersion` 1, used by the Goals tab. Cost: one more option to keep stable for external plugins.
- **P10.** Goals: `x` toggles achieved / open and `d` drops; there is no goal delete because no operation exists. Cost: none.

Controller rulings:
- Tab counts ignore the filter while the panel title follows it, as on Projects. Cost: one changed count.
- The out-of-brief RecordView fix (memoise `recordType` and tabs so a live refresh does not remount the active tab) was accepted: a real phase 2 bug that Task 5's tests exposed, with its own test. Cost: a kernel diff outside the plan.

### Deferred minors and concerns

- Task 1: name sort case-insensitivity is untested (no mixed-case names); no `int:high` / `int:low` filter test.
- Task 2: emptying a required field on edit (note date, person name) sends `""` and gets the op's error; type `both` giving the `interaction` default, and an unresolved prefilled person, are untested; the `process.tsx` header comment line is too long; the tests were written after the code (no RED evidence).
- Task 3: Del on an archived person and `r` on a live one give no feedback; `want` is set after an edit even when the person is outside the tab or filter.
- Task 4: the panel shows the previous person's facts for one frame after the selection changes; `refOf` runs before the slice; the panel title is empty when nothing is selected; the `┌` line filter in the test helpers is blunt.
- Task 5: `archiveQuestion` lives in the screen module (better in `people-list` or a shared module); a stale `chosen` tab can return when its `when` later turns true; on an archived person's Notes and Goals, `e` / `x` / `d` / Del / Enter still run and the operation rejects them (only `n` is guarded).
- Task 6: an `(eb: any)` in the Actions count; the row-ref encoding `#CODE\nrole` is parsed inline with `split`; the Del test relies on the implicit first-row selection.
- Task 6: `n` on Projects & roles has no archived guard (`activePerson` rejects it with a hint); an archived project's row is muted but still shows its status.
- Final review: Esc from a record opened from a person tab comes back to Summary, not the tab you left (a kernel matter, as on Projects).
- Final review: the People filter is not kept across a record visit (the tab, the sort, the archived toggle and the selection are; Projects keeps only the selection).
- Final review: the MaxListeners warning in `capture.test.tsx` predates this branch (it is on origin/main too).
- Deferred to a later phase: a kernel `nav.replaceRecord(ref)`, so a record route follows a rename from any plugin or the CLI. The person Summary's `e` follows a handle edit itself (back, then open the new ref); the `#CODE` edit in Projects has the same gap and is not fixed.

## Phase 4 (Meetings)

Collected from the phase 4 execution ledger (`.superpowers/sdd/2026-11-18-pm-phase4-meetings/progress.md`). Task numbers refer to `docs/superpowers/plans/2026-11-18-pm-phase4-meetings.md`.

### Rulings made during phase 4 (and what each costs if wrong)

Plan rulings (M1 to M11, in the plan):
- **M1.** Prep look: generic drawing with row hints. Reports gain optional per-row `marks` (icon and tone); projects marks its sections. Cost: one optional field in the report contract (`apiVersion` 1, additive).
- **M2.** The board pack embeds projects' `project-status` through `ctx.reports.run`, so other plugins' sections appear too. Needs a section returning several sections, `group` headings and a title that depends on the params. Cost: four small additive kernel changes.
- **M3.** The Export tab shows the board pack while the meeting is planned and the minutes once it is held; `m` switches. Cost: none.
- **M4.** The file name is fixed: `<exportDir>/<date>-<slug>.md`. A second export overwrites it. Cost: no way to keep two versions short of renaming the file.
- **M5.** Copy uses OSC 52 only. ttyd 1.7.7 ignores it, so `y` reports when the terminal refuses; container download is phase 6. Cost: `y` doesn't work in the browser terminal yet.
- **M6.** Attendees and projects in the meeting form are tag text (`@peter @marie`, `#CRM #ERP`), since the form has no multi-select. Cost: no autocomplete in those two fields.
- **M7.** Agenda items are addressed by meeting and position, with no record type or ref. Cost: a later plugin cannot link to one agenda item.
- **M8.** Held meetings stay writable, cancelled ones are read-only, there is no reopen. Cost: a meeting closed by mistake can't be reopened.
- **M9.** `quickAction` is not built; `x` and `w` are plain keys. Cost: none.
- **M10.** No Meetings tab on the project record. Cost: none.
- **M11.** The meeting kind defaults to `other` on the CLI and to `steering` in the TUI form. Cost: one default.

Controller rulings:
- `SinceResult` is the `sinceDate` output type `{ since, source, previous }`, exported from `meetings/logic/since.ts`. Cost: one type name.
- The `project-status` param key is `previous-meeting` (kebab-case), because report params become CLI flags verbatim; the plan said `previousMeeting`. Cost: one param name.
- The edit change line labels `sinceDate` as `since`, matching the CLI flag. Cost: one word in a change line.
- Meeting commands print short result lines like the people and projects commands; change-set lines stay in the change log. The plan's "every write prints its change-set line" was imprecise. Cost: one output line per command.
- Task 6's single overdue-and-linked action is impossible (`project-status` dedupes overdue first), so the seed's two actions (A-1 overdue, A-2 from M-1) stand; they pin both paths. Cost: none.
- `SubmitResult.field` (an optional field on a failed submit) was accepted as an out-of-plan kernel addition: `NotFoundError` has no field and a `ValidationError` would change the CLI exit code 2 to 1. It is documented and tested. Cost: one optional field in the form contract.
- Task 9's deviations were accepted: the weekday comes from the date (2026-12-04 is a Friday), the ask is pinned below the Prep scrollbox so it stays visible at 80x24, PgUp/PgDn scroll the prep, `p` is guarded on cancelled meetings, and an item without a project is titled `Prep · <item text>`. Cost: layout tweaks.
- Decisions show as `DE-n` (the real ref from `refOf`), not the plan's `D-n`. Cost: none.

### Deferred minors and concerns

- Task 1: `wellFormed` doesn't check a mark's contents (icon type, tone enum, arrays); the host test uses today 2026-11-20; a report that runs itself has no recursion guard; the order in the grouping test differs from the brief (covered elsewhere); Markdown doesn't escape icons and text widths use `.length` (wide emoji).
- Task 2: `prepare` duplicates `projectStatus`'s meeting-ref check (for a correct field name); a decision-form test depends on field order.
- Task 3: the builtins test does not assert status (`bin.test` covers it).
- Task 4: the agenda edit line shows the project as a bare code (`"ERP"`), not `#ERP`; `editAgendaItem` bumps `updated_at` on a no-op; the `(no change)` lines aren't documented; the MaxListeners warning is pre-existing.
- Task 5: agenda add computes the printed position itself, not from the op; agenda text can't start with `-` (dispatcher); `--file` errors drop the reason.
- Task 6: one failed `project-status` run blanks every project block and makes prep reject (no per-project catch; near-unreachable); the minutes queries skip `unlessUnavailable`.
- Task 6: the `SectionSchema` mirror in `src/plugins/meetings/logic/reports.ts` must be kept in step with the kernel's `ReportSectionResult`.
- Task 7: the clipboard spy is never restored; a bold group heading is untested.
- Task 8: the unknown-project to field mapping is untested and matches error text (add a test, comment `records.ts`); the cancelled-meeting negative check reads the frame without `settle`; `x` / Del are claimed even with nothing planned selected; a long comment line in `Form.tsx`.
- Task 9: the tests' `until` returns quietly on timeout, so the selection-follows steps aren't asserted directly; a weak `—` assertion; `x` on a held meeting shows "already held" in the tabs while the screen ignores it; `a` / `D` on an item without a project are untested; `e` in Prep opens the full form focused on its first field.
- Task 6 (deferred): the board pack is not fail-soft: `ctx.reports.run("project-status", …)` in the per-project loop (`src/plugins/meetings/logic/reports.ts:91`) has no try/catch, so one failing project fails the whole pack instead of showing that project's error in its block.
- Task 10: done in the final fix wave: `RecordView` gives its outer box `minHeight 0` and the tab box a zero basis with `minHeight 0`, so a tall tab scrolls inside itself and the record header stays; Export's local `flexBasis 0` is gone. The Notes tab's Logged panel shows at most 6 lines (fewer on a short screen, the Notes panel keeps 5 rows), then `+n more`. Still open: `E` ($EDITOR) on Notes has no positive test; the export slug cut at 40 can end in `-`; after `m` the choice sticks, so a later close doesn't switch to the minutes; the Notes scroll ref is detached when the notes are empty; `Lines` is imported from `prep-tab` (better in a shared module).

## Phase 5 part 1 (plugin loading)

Collected from the execution ledger (`.superpowers/sdd/2026-11-18-pm-phase5-part1-plugin-loading/progress.md`). Task numbers refer to `docs/superpowers/plans/2026-11-18-pm-phase5-part1-plugin-loading.md`.

### Rulings made during phase 5 part 1 (and what each costs if wrong)

Plan rulings (R1 to R7, in the plan):
- **R1.** `pm.id` is required in every manifest, so a disabled plugin's id is known without importing it; the loader fails a candidate whose `pm.id` differs from `PluginDef.id`. Cost: one more manifest field.
- **R2.** Importing an external candidate and an external `activate` each time out after 5000 ms (`<id>: timed out after 5000 ms while <importing|activating>`); built-ins have none. Cost: a slow plugin must do its work after boot.
- **R3.** A tui `activate` must be synchronous; a thenable fails the part (`<id>: tui activate must be synchronous`). Cost: no async tui setup.
- **R4.** Shims are generated from what the plugin imports; the build never imports UI modules. A missing export fails at load with `rebuild the plugin with this pm`; `import * as` or `export *` of a shared module fails the build. Cost: named imports only.
- **R5.** `pm plugin remove` is destructive (`--yes`); `--purge-data` also drops the plugin's data. Cost: one more flag.
- **R6.** Installer: `npm` if it runs, else `bun add --cwd` under Bun, else an error; `PM_PLUGIN_INSTALLER=npm|bun` forces one. Cost: none.
- **R7.** The test-only built-in lists moved to `tests/builtins.ts`; `src/plugins/index.ts` and `tui.ts` are deleted. Cost: none.

Controller rulings:
- Built-in load order is `inbox`, `people`, `projects`, `meetings` (directory name, then the `requires` sort). Panels sort by priority and screens use fixed slots, so nothing visible changes. Cost: none visible.
- Task 2's minors M1 (`installApiModule` mutates `__PM_MODULES__` in place) and M4 (the disabled check comes before the installed check for an npm dependency) were folded into Task 3; Task 3's exact candidate discriminator (instead of duck-typing a `PluginDef`) into Task 4; an atomic config write (temp file and rename) into Task 6, since a truncated config would stop every boot. Cost: a few lines each.
- Task 10 also fixed the untested "no pm sources" branch of the scaffold note (a brief requirement). Cost: one test.
- Final review, accepted gap: an external migration's `up` has no timeout, so a migration that awaits forever hangs boot while holding the write lock. Cost if wrong: a hung boot needs the plugin disabled by hand (`PM_CONFIG_JSON` or the config file).
- Final review, accepted gap: the Node smoke checks the external screen's title only, not its reactivity (Bun's `src/kernel/plugins/build.test.ts` covers reactivity). Cost if wrong: a Node-only reactivity break in shimmed plugins goes unnoticed by CI.

### Fixed in the final-review fix wave

- Task 4: the polling loops in `app.test.tsx` ("q quits") and `boot.test.ts` (Plugin problems) now wait on the frame condition for about 10 s and throw a descriptive timeout error instead of falling through.
- Task 5: `enable` of an id that `PM_CONFIG_JSON` still disables prints `enabled <id>; note: PM_CONFIG_JSON still disables it` (JSON: `stillDisabledBy: "PM_CONFIG_JSON"`).
- Task 6: the config merge drops `__proto__`, `constructor` and `prototype` keys; the atomic config write goes through a symlinked config (the link stays) and keeps the file's mode.
- Task 7: `plugin build` without a name or version prints `built <dirname>: …`.
- Task 8: removing a symlinked folder entry unlinks the link only, wherever it points (an outside-root link is now removed, not refused); `remove` with no installer says `pm plugin remove needs npm on the PATH`; a failed upgrade to a non-plugin version reinstalls the previous dependency spec.

### Deferred minors and concerns

- Task 1: a bare `src/kernel` path import is not flagged by the plugin-imports test; `default === named` export is not asserted.
- Task 2: untested built-in no-timeout and disabled built-in; the EACCES message text.
- Task 3: a disabled npm plugin is matched by package name only; a failed candidate shadows a later one with the same id.
- Task 4: (polling bounds: fixed, see above) the "q quits" test loads zero tui parts; `withTimeout` is duplicated in `host.ts` and `loader.ts`; the Help capture hint is padded (`i         capture`) and the test uses a regex.
- Task 5: `enable` of a non-disabled id still writes the config; (the `PM_CONFIG_JSON` note: fixed, see above) the single-plugin without-builtins cases assert only the header line; the unknown-id JSON output and suggestions are untested.
- Task 6 (security, for the final review): (`__proto__` merge and the symlinked/mode config write: fixed, see above) the origin check runs before the write lock (an accepted, undocumented gap); the inbox-missing error names `--from-inbox` on non-CLI paths (verbatim text).
- Task 7: a plugin's own npm dependencies that import Solid or OpenTUI load their own copies (documented as a known limit); a computed ``import(`solid-${x}`)`` is not caught (accepted, documented); logic reachability ignores a dynamic relative `import()`; (the "undefined undefined" build text: fixed, see above) the babel-options parity test misses the test-file filter and the `toJs` pattern differs; non-source files in `src/` are not copied to `dist/`.
- Task 8 (destructive, for the final review): (the symlinked folder entry, the no-installer remove message and the non-plugin upgrade undo: fixed, see above) provenance rows with the plugin's type as origin type are left dangling by a purge; no test purges a disabled or failed external plugin; a bare npm name is treated as a path when a same-named directory exists in the cwd; the `..` prefix check refuses `..foo` (fails safe).
- Task 9: a fixed 20 ms sleep before the unhandled-rejection check (`tests/external-plugin.test.ts` ~528); the failing-migration case doesn't assert that no `kernel_plugin_migration` row exists, and the no-tables assertion is trivial in five cases; the selfcheck's `checkExternalScreen` duplicates the `checkLoaderPath` sequence.
- Task 10: `plugin new --json` omits the no-sources note; the scaffold test uses `process.chdir`; the README template hard-codes `~/.pm/plugins`; the scaffold's devDependencies are unproven by a real `npm install` (the test symlinks `node_modules`).

## Rename to ttybrain (2026-11-19)

Collected from the execution ledger (`.superpowers/sdd/2026-11-19-ttybrain-rename/progress.md`). Plan: `docs/superpowers/plans/2026-11-19-ttybrain-rename.md`. The command is `ttybrain` (alias `tb`), the data folder `~/.ttybrain` with `ttybrain.db`, the environment variables `TTYBRAIN_*` (the old `PM_*` names are not read: a clean break), the plugin API `@ttybrain/api` and `@ttybrain/api/tui`, the manifest key `"ttybrain"` and `globalThis.__TTYBRAIN_MODULES__`. A plugin manifest with the old `"pm"` key fails with `built for pm; rebuild it with "ttybrain plugin build"`. Source file and directory names (`src/bin/pm.ts`) and older plans and specs keep their names; `tests/name.test.ts` keeps old names out of `src/`, `tests/`, `scripts/` and CI.

### Rulings made during the rename (and what each costs if wrong)

- The data move (`src/kernel/home-move.ts`) never starts ttybrain on an empty database while the data sits under the old name. This overturns the plan's "EXDEV: return silently" and the controller's "continue on failure": a failed or incomplete move stops with `could not move <from> to <to>: <reason>` and a hint (exit 1), a half-done move is resumed on the next run, and `~/.pm` with `pm.db` but no `~/.ttybrain/ttybrain.db` is reported on every run (`your data is still in <from>; move it to <to> by hand, or set TTYBRAIN_HOME=<from>`). Cost if wrong: ttybrain refuses to start until the user moves the folder by hand or sets `TTYBRAIN_HOME`.
- The move renames and never copies; `pm.db`, `-wal` and `-shm` move as one set, and only a real directory is moved. `~/.pm` and `pm.db` are left as symlinks so an old build still opens the same file. When both folders hold a database, ttybrain uses the new one and prints a note. Nothing moves when `TTYBRAIN_HOME` or `TTYBRAIN_DB` is set.
- Task 3 owns the remaining app-name prose in `build.ts`, `install.ts`, `dispatch.ts`, `scaffold.ts` and `babel-options.ts`, because it sits next to the manifest and module names Task 3 changes. Cost: none.

### Deferred minors and concerns

- Task 1: two simultaneous first runs print a spurious `could not move` line.
- Task 1 (data): a double failure in the rollback of the db set can split `pm.db` from its `-wal`; the next run then moves without the WAL (renaming `-wal` and `-shm` before `pm.db` would fix it).
- Task 1: `readdirSync` for the backups in `renameDb` is outside the `try`, so the rollback is incomplete on that path.
- Task 1 (data): a `~/.pm/pm.db` that is itself a symlink makes a fresh move skip the db set, so the first run starts empty.
- Task 1: a blocked move state also makes `--help` exit 1 (documented in the README).
- Task 3: the old-name scan's allow-list is per file, not per line, has no stale-exemption check, and misses `pkg["pm"]` and `pm: {plugin`.
- Task 3: a disabled legacy plugin is listed as `failed (rebuild)`, not `disabled`.
- Task 3: the `dist/__pm/` shim folder and the `__pm<n>` shim locals keep the old internal names.

## Draft recovery (2026-11-17)

Forms, quick capture and the Context editor keep unsaved values as drafts in `PM_HOME/drafts/` (`src/kernel/tui/drafts.ts`). Deferred minors:
- Draft keys use the record ref exactly as the caller passed it: the same record opened as `#CRM` and as `CRM` gets two drafts. All callers pass canonical refs today.
- The restore prompt shows no year (`from 12 Nov 10:42`); with the 30-day prune that only matters around New Year.
- A `<Form>` rendered outside `openForm` keeps no draft (its key comes from `openForm`).
