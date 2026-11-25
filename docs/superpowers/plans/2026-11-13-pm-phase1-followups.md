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

## Look and feel pass (2026-11-20)

Collected from the execution ledger (`.superpowers/sdd/2026-11-20-look-and-feel-pass/progress.md`) and the task reports. Plan: `docs/superpowers/plans/2026-11-20-look-and-feel-pass.md`; gap analysis: `docs/superpowers/plans/2026-11-20-look-and-feel-gaps.md`. The screens follow the designs (`docs/superpowers/specs/2026-11-13-pm-screens.html`); `tests/design/` holds the conformance tests, `tests/design/small.test.tsx` the 80×24 checks. The architecture notes are in `docs/architecture.md` ("The TUI", Look and feel).

### Rulings made during the pass (and what each costs if wrong)

- Plan rulings R1-R5: scrolling lists keep scrolling (no `… n more` cap); code-only things stay (Help, the "terminal too small" fallback, status messages, `e edit` / `a archived`, Closed/Archived groups, the Inbox panel on Attention); one-line data filters the design shows are in scope (on-hold projects out of "Projects needing attention", only high-influence stakeholders in "Stakeholders to contact"); the screen behind an overlay is dimmed; test ids follow the seed, not the mock (A-1 for A-27).
- `fgAt`/`bgAt` search the whole frame top-down, so header text could shadow a lookup (a vacuous assert in `chrome.test.tsx`); the helpers take a line scope and the asserts were fixed. Cost: none.
- Task 3 made "Late milestones · 2" fit at 80×24 and dropped the `next 14 d…` expectation in `panels.test.tsx`. Cost: none.
- Switcher at column 10 (2 cells before the chip, as the mock's geometry), a two-cell crumb spacing, and a status bar that is not dimmed while it shows an overlay's keys. Cost: cosmetic.
- `Nav.crumbs()` stays as a deprecated alias returning `[crumb()]` (the API is additive within apiVersion 1); `HintOptions` is exported.
- Projects at 80×24: Table columns may declare `drop` (higher drops first) and the grow column a `minWidth`; Projects drops Effort, Risk, Act., then Next milestone with Due. Cost: a narrow terminal shows fewer columns.
- Task 5 folded the visible look defects into its fix round: `me` and `—` muted in the project Actions tab, loose list items in Context kept apart, and the header crumb giving way after the spacer (not before it).
- The compact "Overdue actions" of the meeting prep lists only open actions with `due_date < today` (the CLI and Markdown section keep every action due before the meeting). Cost: actions due before the meeting but not yet overdue show in Export and the CLI only (see M12 below).
- The prep's decisions heading says `since last meeting` only when the since date is the previous meeting's date, otherwise `since <date>`; one `ReportCompactSchema` (exported from `@ttybrain/api`) is the compact form's schema, validated by the kernel; a section with a compact form never falls back to its ISO note in the TUI.
- Inbox: refs of created records that the summary does not name are appended (`· N-1, G-1`), so the provenance stays visible and Enter's record is always on the line. Refs inside processed summaries are muted (the mock wins over gap row I8). Cost: one line differs from the mock for such items.
- Task 4's P3 ruling: a project's Risk shows red for an open high-severity risk or issue (DWH is red where the mock draws it plain).
- The user removed the influence/interest levels and the project codes from "Stakeholders to contact" (2026-11-20): rows show the name and the last contact only. This resolves the cut-code residual in that cell.

### Left as FEATURE (the design shows behaviour or data the code does not have)

- S4: a count on the switcher's Attention row (a total of attention items).
- A12: deliverables in Attention's "Due this week".
- A14: `x` marks the selected action done on the Attention panels (row actions on panels).
- D5: `Tab panel`, a selection and `n` / `e` / `x` on the project Overview's right-hand panels; the panels are drawn unfocused and the status bar omits `tab panel`, `n new`, `x done`.
- C2: the context footer's source (`via mcp`, the provenance of the last write).
- E14: a tabbed right-hand panel for a team member (`Projects & roles · Actions · 1:1 notes · Goals`).
- E15: groups of people as stakeholders (`Sales key users · group · 6 people`).
- T2: the collapsed `Later · 34   No date · 3` line on Actions.
- M11: a milestone's proposed new date (`26 Nov → 10 Dec?`) in the meeting prep.
- Out of scope of the pass (later projects): Upcoming meetings panel, Meetings overview with series, talk-lists, 1:1 flow, project Meetings tab, BOARD project, recurring-meeting form, capture to talk-list, an actions plugin with Linked to.

### Logic questions from the gap analysis (not look and feel)

- A10 and A11 were applied as R3 one-line filters (on-hold projects out of "Projects needing attention", low-influence stakeholders out of "Stakeholders to contact" in the TUI). The CLI `report overview` follows A10 (it shares the query) but still lists low-influence stakeholders.
- M12: the CLI board pack counts "overdue" as of the meeting date, the TUI prep as of today; intentional for now, decide which the CLI should use.
- M11 (second half): a done milestone before the prep's `since` is not shown; showing it changes `projectStatus`'s window and the CLI report.
- Item-tab.tsx: a done milestone shows `-29d` in the Milestones tab.
- D2: the tab counts are open-only while the panel counts are totals; the person Actions tab counts open actions while the project item tabs count totals (inconsistent).
- Recent decisions on the project Overview shows three rows where the mock shows one: does "recent" mean a time window?
- M5: attendee order in the prep is by name; no add-order is stored. The project team reads in name order, the mock has involvement order.
- Context tab: `e` / `E` (C8) and whether `e` should open `$VISUAL`/`$EDITOR` is undecided.

### Deferred minors and concerns

- Task 1: `isSelected` / `selectedText` do not prove a single selection; a Panel title can still vanish at width <= 9; there is no Node frame-text check of the footer position (verified on Bun only).
- Task 2: `capture.tsx` `CAPTURE_TITLE` spacing typo; one backdrop covers the whole overlay stack (the lower overlay is not dimmed under a confirm).
- Task 3: `OverviewPanelDef.columns` length is not checked against the cells; the grid/balanced layout switch remounts panels and resets their selection; fixed widths squeeze the title column at 80×24 (Attention shows `Send revised…`, `high…`, `Vendor B con`; codes and names stay whole, the titles do not); a domain example in the `types.ts` comment; sub-heading lines are reserved from the first rows, so a capped panel that drops all of a group's rows may keep up to two blank lines.
- Task 3: the stale-health dot is a muted `○` for green or amber projects older than 30 days (a visible change).
- Task 4: the Risk-high read is a second query that can lag (plain for one frame on first render); the Projects footer says `status=active` even when archived are shown; the first frame before measurement can show all columns at a narrow width.
- Task 5: `RecordFields.labelWidth` misaligns against longer extra-field labels; the crumb shows its full label (no `…`) for one frame before it is measured, and the clipped-text `…` overlay hides the last character; nested lists, code blocks and quotes in Context use OpenTUI's default rendering (a nested list still shows `-` bullets), and the footer percentage is briefly `0%` before layout.
- Task 6: the grow cell in the person panel shows its `…` one layout pass late; `Archived` is a string literal; `Other` people (neither team nor stakeholder) are accent like the other groups.
- Task 7: the meetings view read is untyped (`any`) and unfiltered (all meetings per refresh); the first frame before the Table's measurement can cut titles.
- Task 8: the `…` scroll marker sits on the last cell of the last visible line and hides its character.
- Task 9: the Inbox bar omits `? help` and `q quit`, as the mock does (inconsistent with the other screens); `@ma` suggests Tom Maes (substring people search); capture's `SyntaxStyle` highlighting is verified on Bun only (the Node self-check does not open capture); the New panel is capped at half the height and scrolls; `tagParts` matches unresolved tags against the raw text spelling.
- Task 10: the 80×24 checks assert that no code or name is cut, not that titles are whole; where titles lose characters (see Task 3) it is by design of the degradation rule.

## Actions plugin (2026-11-22)

Collected from the execution ledger (`.superpowers/sdd/2026-11-22-actions-plugin/progress.md`). Plan: `docs/superpowers/plans/2026-11-22-actions-plugin.md`; design: `docs/superpowers/specs/2026-11-20-ttybrain-meetings-actions-design.md` §4. Actions moved out of `projects` into their own plugin (`actions` 2.0.0), linked to any number of projects, people and meetings; the existing actions were handed over once, atomically, with ids, history and provenance kept.

### Rulings made during the actions plugin (and what each costs if wrong)

- **R1, amended: the break is wider than a view.** The plan said only `projects.project` loses `open_actions` (view version 2). Removing the action operations and view needs a major bump of `projects` (spec rule), and the break is: `projects` is 2.0.0; the `projects.action` view, the five action write operations (`addAction`, `editAction`, `completeAction`, `cancelAction`, `deleteAction`; `projects` now exposes only the read `legacyActions` for the handover) and `projectStatus.actions` are gone (`actions.projectActions` returns them now); a plugin that `requires: projects ^1` fails to load; a new change set that names `projects.*Action` is refused (applied change sets stay as history). `actions` is 2.0.0 as well: `actions.action` is version 2 (no `project_id`, `for_person_id`, `meeting_id`; the new `actions.link` view carries them), `actions` never shipped a 1.x outside this branch, so `^2` is its first published shape. Cost: external plugins must update their ranges (documented in the README's upgrade note); built-ins and the fixture plugin were updated.
- **R2: projects keeps its emptied legacy table** (`projects_action`) after the handover; a later projects migration may drop it. No DDL runs in a data step.
- **R3: "for" became a person link**; the owner stays a column (`owner_id`, null = you). JSON `for` / `for_person_id` = the first linked person.
- **R4: an old build** opening the database after the handover sees no actions (its projects table is empty). Accepted; the README's upgrade note says so, and names the backup `ttybrain.db.bak-v<N>`.
- `ctx.use(id)` stays `PluginApi | undefined` for `requires` only; a new `ctx.read(id)` gives the read operations of a plugin in `reads` or `requires` (the plan's "use for reads" would have changed a published return type). Additive; cost: one more context method.
- A backup is taken before the first data step a boot attempts, once per applied-migration count, outside any transaction (the "nothing lost" constraint). Cost: one backup file per pending-step series.
- A pending `"later"` data step takes the write lock briefly on every write-capable boot; read-only boots skip steps (documented in `docs/architecture.md`, "Data steps").
- The id collision is prevented, not advised away: while the legacy import is not done, actions created in `actions` get `max(own max id, projects' `legacyMaxId`) + 1`, or `max(id, 1000000) + 1` only when `projects` cannot be read; the collision path stays as a defensive error whose hint does not suggest deleting; `projects`' step deletes only rows matching an imported `(id, updated_at)` pair (`actions.importedLegacy`), and leftovers stay and are listed in the step's hint. Cost: actions added while `projects` was off during the upgrade get numbers like `A-1000001` for good.
- A data step's error hint is shown in the plugin list and in Help (not just logged).
- An action counts as archived (writes refused, hidden from Attention and the overview) only when it has project links and every one is archived; `unlinkAction` is always allowed; linking a new archived project is refused. Cost: an action with one live and one archived project stays editable.
- Screens match the mock exactly: a small generic kernel option (`hints(..., { globals: false })`) lets an exact status bar leave out the global actions' hints (the keys keep working). Cost: `?`, `i` and `enter` are not advertised on the Actions screen (Help lists them).
- On a person's Actions tab, Owner stays at 80 columns (Linked to is dropped first); the meeting tab's `n` passes `{ meeting }`; the tab's hints include `enter open`, registered after the Table's own so that on a narrow bar `enter open` gives way before `↑↓ select` (done in Task 5).

### Deferred minors and concerns

- Leftover legacy rows (not matching the imported pairs) keep an `actions-leftovers` error on every start, with no in-app fix. Follow-up: an `action import-leftovers` command.
- (Resolved in the final review: a busy first boot no longer puts new actions in the high range; projects' `legacyMaxId` read gives the floor, and the edit rollback has a regression test.)
- A fresh install with `projects` disabled from the first start keeps allocating ids above 1,000,000 forever (the import never completes). Follow-up: a kernel fact "database created this boot" so a new database counts the import as done.
- `actions_action` has `INTEGER PRIMARY KEY` without `AUTOINCREMENT`, so a deleted maximum id can be reused (provenance is forgotten on delete, which mitigates it).
- `action edit` help could say that the CLI cannot clear all links at once (`links: []` works through the operation).
- `repeatable` on a boolean flag is not rejected by the kernel (meaningless there).
- The compat fields (`project`, `for`, `meeting`, and their ids) can disagree with `links[].ref` for gone records and for projects outside the projects view's range (`—` versus `<type>:<id>`).
- Task 4 (resolved in the final review): the action form's edit writes the links and the field edit inside one `act`, so a failing `editAction` rolls the link writes back.
- Side-by-side review items (after the meetings rework): a board meeting gets a fifth tab `Actions` (the design says every meeting gets one, the mock draws four); the Linked-to meeting labels show the full title and date, the mock's short `steering 27 Oct` needs series names from the meetings rework. (9-character refs such as `A-1000001` staying whole at 80×24 is covered by tests/design/actions-links.test.tsx.)

## Meetings rework (2026-11-22)

Collected from the execution ledger (`.superpowers/sdd/2026-11-22-meetings-rework/progress.md`). Plan: `docs/superpowers/plans/2026-11-22-meetings-rework.md`; design: `docs/superpowers/specs/2026-11-20-ttybrain-meetings-actions-design.md` §5. Meetings are about a person or a project, recur as series, carry talk-lists, and close themselves; `meetings` is 2.0.0 (`projects` and `actions` read `meetings ^2`).

### Rulings made during the meetings rework (and what each costs if wrong)

Plan rulings:

- **M1. Upkeep hook.** `ctx.upkeep(id, run)`: like a data step but on every write-capable boot (before the first write of a process, at TUI start and on a day change), in its own write transaction, `noWait` (lock busy: skipped). Read-only commands may show yesterday's state until the next write-capable start. Cost: state can lag in read-only use.
- **M2. Migration 002 rebuilds `attendee` and `agenda_item` without `ON DELETE CASCADE`, then `meeting`** (rule 6), remapping kinds and adding the subject, series and `auto_close` columns; children are deleted explicitly where meetings are. Cost: every future delete path must remember the children.
- **M3. Skip = cancel the occurrence, move = change its date;** both keep `series_id`/`series_date`, so upkeep never recreates them.
- **M4. A subject-less meeting never auto-closes;** `meeting subject` sets `auto_close = 1` only for meetings dated today or later. Cost: meetings from before the rework stay open until given a subject.
- **M5. Ticking writes at once** (Space marks the item discussed in that meeting, Space again reopens it); a meeting's agenda is the subject's open items (a project's also the tagged person items) plus the items discussed in it.
- **M6. Closing a 1:1 copies its notes to the person** as a `one_on_one` note; project and board notes stay on the meeting; auto-close does the same.
- **M7. Subject-less meetings stay visible** in a last Meetings group "No subject · n".
- **M8. Board talk-list `A`** adds the item as an agenda item and marks it discussed in that meeting.
- **M9. `t`** on a person, project or upcoming meeting opens the talk-item form with the subject filled in; quick capture routes only `talk …` text with exactly one resolving person or project tag, the rest goes to the inbox.
- **M10. "Her actions · 3" is `<First name>'s actions · 3`** (the app does not know pronouns); an accepted difference from the mock.
- **M11. Non-board meetings open on the in-progress layout with no tab row;** the actions plugin's meeting Actions tab shows only on board meetings. Supersedes the actions plan's "Actions tab on every meeting".
- **M12. Record types:** series `S-n`, talk item `T-n`.

Rulings from the task reviews:

- **tests/design.ts `seedDesign`** gives its meetings a subject (M-1 and M-2 about `#CRM`) so the existing design frames stay unchanged; subject-less meetings are covered by the upgrade test.
- **Task 1, I-1:** migration 002 gives `meeting` `INTEGER PRIMARY KEY AUTOINCREMENT` so a deleted number is never reused (provenance, change-set history and drafts cannot attach to a new meeting); `removePlanned` counts a meeting's own origin rows as "holds something" and fails closed. Cost: deleted occurrence numbers leave gaps.
- **Task 1, I-2:** after a CLI command the dispatcher prints `warning: upkeep "<id>" failed: <message>` (and the hint) on stderr; the exit code is unchanged.
- **Task 1, folded:** series end/until edits delete only occurrences dated today or later; `meeting subject --all-without` is one op.
- **Task 2, I1:** talk numbers are the rank within the shown group (open 1..k, carried unnumbered with `↻`); `talk move --to n` ranks within its own group. Cost: carried items are reordered only among themselves.
- **Task 2, I2:** a talk item's display catches only `NotFoundError`/`ValidationError` (a gone subject shows `—`).
- **Task 2, folded:** `talk reopen`; `--project` rejected on a project subject; reopen restores the item near its last position (`last_position`); `talk list --json` has `carried`; skipping or cancelling a meeting reopens the items ticked in it (it did not take place); a gone person or project shows `—` on a meeting too. `discussTalk` without a meeting is accepted (the item came up elsewhere); per-meeting counts use `meeting_id = M`.
- **Task 3, folded into Task 4:** the "already held" error says the meeting closed itself and points to the minutes; `addMeeting` sets `auto_close = 1` only for dates today or later.
- **Task 4, I1:** a generic Overview `lead` panel takes a left column at the mock's proportion (1.35) and the next panels stack on its right while they fit. Cost: medium kernel work; all existing panels stay.
- **Task 4, I2:** on a meeting row the block's first action is the target and `x` completes it; Enter opens the meeting. Cost: other actions are reached through the meeting or person.
- **Task 4, I3:** a generic Form `look` (rounded panel, muted label column, only the focused field as an input, resolved values, a configurable Tab label), used only by the series form (the one drawn form); the series form defaults First date to the first rhythm date and Attendees to the subject person.
- **Task 4, I4:** one key handler per Overview routes to the focused panel (no `MaxListenersExceededWarning`). **I5:** the full home frame, the series form from Karim and the bars are pinned by design tests.
- **Task 4, NB1:** derived form values count as the form's start (drafts leave untouched derived fields out, a restore marks only differing fields as edited, and `baseline()` derives only fields untouched at start).
- **Task 4, folded:** the 11-20 home mock wins for the other panels it draws: actions' Overdue third column is the first link; projects' "needing attention" has no `upd` column. Past planned meetings that missed auto-close show under "Not closed".
- **Task 5, I1:** the project Prep panel is drawn as the mock (9-cell fact column, rows without headings, `Your actions for <code>`), the mock's non-home Prep data is seeded; R-9 `high · issue` is left out (it would change Attention's High risks panel and Task 4's home frame).
- **Task 5, I2:** when not planned, the in-progress crumb detail and Talk panel title show `held` or `cancelled`, and the bar shows only keys that work. **I3:** a generic kernel `recordKey` (per record type, after the active tab's keys); meetings registers `t` on person and project.
- **Task 5, folded:** a declined capture route does not stop later routes (its lines show only when none takes the text); With order is stakeholders first, then stored attendee order; board Agenda `a` action / `D` decision; new screens are in `tests/design/small.test.tsx`; the almost-talk preview says it goes to the inbox; `A` keeps the item's project tag. Ignored: the mock contradicts itself on an indent.

### Deferred minors and concerns

Resolved by documentation in the final task (done):

- Done: a rule-6 rebuild of an `AUTOINCREMENT` table resets its counter to the largest id left, and plugins cannot name `sqlite_sequence` (string literals naming it are refused): `docs/architecture.md`, data rules 2 and 6.
- Done: `editSeries --every` stays anchored to the series' original first date (plugin reference §3, "Rhythms and upkeep"; the in-app guide).
- Done: a TUI started while another process holds the write lock skips upkeep until the next day (architecture "Upkeep", "Busy"; plugin reference §3).
- Done: notes written after closing stay on the meeting (not copied to the person again) (plugin reference §3, "Closing"; the in-app guide).
- Done: one failing meeting blocks every auto-close of that run (residual, no known trigger) (plugin reference §3).
- Done: `editSeries` attendee changes also overwrite moved occurrences (plugin reference §3; no test).

Still open:

- Task 1: the upkeep CLI warning names only the upkeep id, not the plugin.
- Task 2: tagged items on a project's list carry their person-list rank as JSON `position`; `before()` in `registerTalk` catches everything (it only describes).
- Task 3: `Closed` is defined twice (TypeBox and TS type).
- Task 4: the default Form's 32-cell input scrolls the first character of a long value out of view (pre-existing); column gaps are 1 cell (the existing Table convention).
- Task 5: the prep drops sections without a compact form, so a failing project-status section's error shows nowhere; the Health row is cut at 80 columns without `…`; a cut PrepLine loses its colours; the `withParts` comment shows the mock's order, not the code's; board `a`/`D` and `A` keeping the tag are untested; the RecordView comment says `run` is in plugin scope; the prep finds the actions section by title (kernel results carry no section id).

### Side-by-side review (TUI against the designs)

The user asked for a side-by-side review of the TUI against the screen designs once the meetings rework is done. Items noted while building:

- CRM steering "Your act." shows `1 · 1 late` in amber; the mock's own Overdue A-27 contradicts its plain `1`.
- CRM talk-list count: the mocks conflict three ways (home and screen 5 say 3, the project mock's third row text differs: "Marie's request…"). The seed keeps 3: CRM's own two items plus Anna's CRM-tagged item.
- Empty Attention panels stay (the mock omits them).
- "Her actions · 3" is `<First name>'s actions · 3` (M10).
- Project Prep: "Solution outline approved" is omitted (14 Oct is before "since 27 Oct", the mock contradicts itself); the milestone shows `10 Dec`, not `26 Nov → 10 Dec?` (no forecast in the data); R-9 `high · issue` is not seeded.
- With order: Marie D. before Peter J. (no stored order; a sponsor-first rule is possible).
- `t to talk` appears only on tab bars the designs do not draw.
- The series form is the only form with the designed Form `look`; whether the other forms take it too.
- Notes written after closing stay on the meeting only (a 1:1's copy on the person is not updated).
- The actions plan's items (the board meeting's fifth `Actions` tab, Linked-to meeting labels `steering 27 Oct` against full title and date) are listed under "Actions plugin (2026-11-22)", last bullet of its deferred minors; M11 above now limits the Actions tab to board meetings.

## Boards (2026-11-23)

Collected from the execution ledger (`.superpowers/sdd/2026-11-23-boards/progress.md`) and the task reports. Plan: `docs/superpowers/plans/2026-11-23-boards.md`; design: `docs/superpowers/specs/2026-11-20-ttybrain-meetings-actions-design.md` §5.7. Meetings 2.1.0, additive (the new `meetings.board` view; `meetings.meeting` v2 can have `subject_type` `board`).

### Rulings made during boards (and what each costs if wrong)

Plan rulings:

- **B1. Shared prefix in the kernel** (`sharedPrefix: true` on every record and tag type of a prefix; `resolve(ref, { type })`, `typesOfRef`). Cost: a plugin that forgets the flag is isolated at registration.
- **B2. The namespace check lives in each owner** (meetings reads `projects.project`, projects reads `meetings.board`). Cost: with `meetings` switched off, projects skips the check, so a project code can later clash with a board's; `resolve` then reports `"#MB" is both a project and a board`.
- **B3. Data step `boards-from-projects`:** a board `<CODE>B` per project that hosted board meetings or series; nothing is renamed. Cost: few databases are touched (existing meetings are subject-less after the meetings rework); the user renames the board.
- **B4. Board view:** record view with two tabs, Meetings and Talk.
- **B5. Seeds:** `seedMeetings` has the board `#BOARD` "Management board" and `seedDesign` M-2 is about `#SC` "Steering committee".

Rulings during execution:

- **Task 1:** `resolve()` returns null for an unknown code (every caller relies on it); only `label()` throws the named `NotFoundError` (`no project or board "#X"`). Cost: callers that need a record handle null themselves, as before.
- **Task 2:** a board code needs at least one letter, and the board record type resolves by code only (no id fallback); an all-digit code would clash with a project's numeric id (`#12`). Cost: `board add 2027 …` is refused.
- **Task 2 (review I2):** B3 also moves the project's open talk items to the new board when the project hosts no other (non-board) meetings or series; otherwise they stay and the notice says "open talk items stay on #CODE". Cost: a pure board project ends with no talk items (they moved with the board).
- **Task 2:** the step moves by series (a board series moves with all its occurrences, set to kind board; a board occurrence outside a board series moves alone). The occurrences upkeep skips an archived board's series. The code is `<CODE cut to 15>B`, then `B2`, `B3` while taken (cutting to 16 would give the project's own code back).
- **Task 2:** kind board on a project subject stayed accepted for one task (the seeds used it); Task 3 refuses it (`a board meeting needs a board; #CRM is a project`).
- **Task 2:** the inbox's unknown-tag warning names the prefix's first type (`⚠ unknown project`), not both types, so the design frames and the 80x24 line stay unchanged. Cost: it says "project" for an unknown `#X`.
- **Task 2:** new kernel capability `ctx.notices` (a plugin's lines for `plugin list` and Help, computed at each boot), because nothing else could say "the step made this board" without showing as an error. Migration 006 also has `board.from_project_id` (drives the notice); 007 adds `board.talk_stayed`, so the "stay" clause is decided at step time.
- **Task 3 (review I1), superseded by the final review:** a meeting that has a subject keeps its kind: `meeting subject` with a subject of another kind is refused unless `--kind` is given (then both change, which is also the way back from a mistake; the TUI form's Kind follows About and passes it). A subject-less meeting takes the subject's kind as before (a board meeting stays board). `--all-without <ref>` assigns only the subject-less meetings whose kind fits (board meetings a board, the others a person or project), skips and counts the rest (`skipped` and `reason` in JSON, which is now `{meetings, skipped, reason?}`), and errors only when none fit.
- **Task 3:** new kernel capability `FieldSpec.when(values)` (a hidden field takes no focus and submits null); the talk form's Project field shows only for a person's item.
- **Task 3:** a quick-capture preview that would throw (the "is both" clash) shows as a declined reason; the text never goes silently to the inbox. The board preview uses `meetingName(next)` (`next Board Fri 27 Nov`).
- **Task 3:** "bare tabs" means tabs without counts; the board's Meetings tab has no Prep, its right column is "Your actions for #CODE".

### Deferred minor findings

- The ambiguity message says "a <type>" for every type name, so a type starting with a vowel reads badly ("a alpha"); fine for project and board.
- The inbox duplicates the kernel's `typeNames` join (not exported from `@ttybrain/api`).
- A `Form` `show: label` field resolves each `#` word twice.
- The talk-item edit form (`e` on a board's item) still offers an edit; the op refuses a project tag on a board's item.
- The Boards panel has no add form: boards are added by the CLI (`board add`); its empty state is `No boards yet.`
- Archived projects still take new meetings (only archived boards are refused).
- Two comment lines in `upcoming.ts` run past the usual width.
- At 80x24 the crumb cuts a long board name (`› BOARD Manageme…`), as it does a project's: the kernel's narrow-header rule. Panels and tables keep codes and names whole.

### For the side-by-side review

- The board view has no mock; it follows the project's Meetings and Talk tabs (§5.7). Check it against the project view at 118x36 and 80x24.
- Screen 5: the Series panel now ends under its last row (it used to have an empty row inside) and the Boards panel follows it; design §5.7 describes it but no mock draws it.
- Frames that changed because BOARD is a board now: `tests/design/board.test.tsx` and the "Board meeting" entry of `small.test.tsx` read `5 Meetings ▾` where they read `2 Projects ▾`.
- The board capture preview line (`→ Management board's talk-list · next Board Fri 27 Nov`) and the Help "Notices" section are drawn by no mock.

## Boards plugin (2026-11-24)

Plan: `docs/superpowers/plans/2026-11-24-boards-plugin.md` (ledger `.superpowers/sdd/2026-11-24-boards-plugin/progress.md`). Boards move out of meetings into their own plugin (`boards` 1.0.0, `meetings` 3.0.0); the earlier design and its rulings are under "Boards (2026-11-23)" above and are not repeated. Commits 10503bc, 0dfd99b, 147296a, then the archive-key fix and the docs.

### Rulings made during the boards plugin (and what each costs if wrong)

- **P1-P3 (plan).** Ownership (boards: table, record and `#` tag type, CLI, `boards.board` view, crumb and Summary; meetings keeps board meetings, talk-lists, Meetings/Talk tabs, Boards panel, capture, `boards-from-projects`, and requires `boards ^1`); the one-time, atomic, idempotent handover through meetings' `legacyBoards()` and boards' `importedLegacy()`; the namespace check in boards (against projects) and projects (against boards). Cost: with boards off, meetings is off.
- **Boards requires `projects ^2`** (the plan said nothing). Discovery loads built-ins by requires, so without it boards' `#` type registers before projects' and the user-visible order changes (`⚠ unknown board`, the label error, resolve order). Cost: with projects off, boards and meetings are off. The alternative is a kernel rule for shared-prefix order.
- **The notice data is split:** `from_project_id` in boards (`addBoard`'s `fromProject`, read `madeFromProjects`), `talk_stayed` in meetings' `board_talk_stayed` (migration 008). Cost: two tables for one notice.
- **The board view opens on Summary** (its first tab, like a project on Overview), so Enter on screen 7 and `#BOARD` land there, not on Meetings.
- **Screen 7 Boards** (2026-11-25, the boards plugin's; no mock draws it, laid out as Projects): it replaces the Boards panel on screen 5, which is back to the 11-20 `meetings` mock (Upcoming, Series to the bottom; Tab and Shift+Tab switch the two). Built-in slots are now 2-7 and external screens start at 8 (the fixture plugin's `Contracts` and the self-check's external screen moved from key 7 to 8). Accepted differences from the mocks, which predate screen 7: every bar shows `g or 1-7 screens` (was `1-6`) and the switcher `1-7 jump` with a `7  Boards` row; a board's view and a board meeting opened under it show `7 Boards ▾`, not the board mock's `5 Meetings ▾`. At 118 columns screen 7's bar leaves out `q quit` (it does not fit).
- **Counter seeding** looks only at meetings' references (`legacyMaxId`: its board table, the board `subject_id`s of meetings, series and talk items, and actions' board links): boards can't be deleted, only archived, so nothing else can hold a missing id. The counter is moved by inserting and deleting a placeholder row in the step (a plugin cannot write `sqlite_sequence`).
- **The import also refuses a code a project has taken** (nothing moves, a hint names both), and the id-clash hint says it should not happen and not to delete boards.
- **Archive key:** the Summary first used `A` with a confirm; it now follows the person's Summary: `Del` archives (confirm), `r` restores (no confirm). Projects' record view has no archive key in the TUI; its list's `a` toggles archived.

### Deferred minor findings

- Summary and the board form repeat the project Overview and form patterns (accepted).
- `help` command order changed: `inbox` moved from after `action` to after `board` (action, person, …, decision, board, inbox, talk, meeting); the README says so.
- The Summary frames were checked through frame dumps (118x36, 80x24), not in a real terminal; no mock draws the tab.
- The handover's two-step shape (copy in boards, empty in meetings) leaves meetings' emptied `board` table in place for good (no DDL in a step).

### For the side-by-side review

- Board view: Summary (new, no mock), Meetings, Talk. Check against a project's Overview and the tab row `Summary   Meetings   Talk`.
- Screen 7 Boards (no mock): check against the Projects screen.
