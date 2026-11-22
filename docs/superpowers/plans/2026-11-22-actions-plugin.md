# Actions plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Actions move out of the projects plugin into their own `actions` plugin, keep their `A-n` numbers and history, and can be linked to any record (project, person, meeting); screens follow the designs.

**Architecture:** First a small kernel addition for one-time data steps between plugins; then the code moves as-is into `src/plugins/actions` with a one-time handover of the existing rows; then the fixed `project_id` / `for_person_id` / `meeting_id` columns become generic links; then the TUI gets the designed "Linked to" column and Actions tabs everywhere.

**Tech Stack:** TypeScript, Bun and Node 26, Kysely over SQLite, OpenTUI + Solid.

**Spec:** `docs/superpowers/specs/2026-11-20-ttybrain-meetings-actions-design.md` §4 (actions), §1 anti-goals, §6 constraints, and the plugin graph ruling in §1 (actions requires nothing; meetings requires people, projects, actions). Screens: `docs/superpowers/specs/2026-11-20-ttybrain-meeting-screens.html` ("4 Actions") and `2026-11-13-pm-screens.html`. Map of today's action code: the "actions touchpoints" list in this plan's Task 2 brief (from a read-only survey, 2026-11-22).

## Global Constraints

- Existing actions keep their ids (`A-27` stays `A-27`), title, dates, status, owner, notes, timestamps, provenance (`kernel_record_origin` rows with `record_type = "action"`) and change-set history. Nothing is renumbered or lost (design anti-goal).
- The handover is one-time, atomic (all or nothing), idempotent, and survives either plugin being switched off: if `actions` or `projects` is not loaded, the rows wait and move on a later start.
- Plugin graph: `actions` requires nothing and reads `people`, `projects`, `meetings` (soft); `meetings` requires `people`, `projects`, `actions`; `projects` and `people` read `actions` (soft).
- CLI compatibility for Copilot and scripts: `action list|add|edit|done|cancel|delete` keep their flags and exit codes; `--project`, `--for`, `--meeting` stay as shorthand for links; `--json` keeps today's `ActionRecord` fields (`ref id title due_date status done_date owner_id owner project_id project for_person_id for meeting_id meeting notes`), the three link fields derived from the first link of that type, plus a new `links` array. New verbs: `action show`, `action link`, `action unlink`, and `--link <ref>` (repeatable) on add/edit/list.
- Status values stay `open | done | cancelled` (the code's names; the design's "dropped" is the same state). *(Plan ruling.)*
- Look and feel per `docs/architecture.md` "The TUI": the designs are the spec; codes cyan, people magenta, ids muted, `me` muted; exact status bars; 80×24 keeps codes and names whole.
- Isolation rules (`docs/architecture.md`): each plugin its own tables; cross-plugin data through published views, exposed operations and links by id; no ON DELETE actions on tables that may be rebuilt (rule 6).
- Bun and Node both green after every task: `bun test`, `bun typecheck`, `bash scripts/smoke-node.sh` (`smoke ok`). Fixed clock in tests.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Plan rulings

- **R1. The `projects.project` view loses `open_actions`** (it was computed from projects' own action table, which no longer holds actions). The view goes to version 2; built-in readers update their `reads` range; the fixture plugin is updated; projects' own screens and CLI get the count from the `actions.action` view. Cost: an external plugin that reads `projects.project` at `^1` sees it unavailable until it updates its range. Recorded in the follow-ups as an API break of a published view.
- **R2. Projects keeps its emptied legacy table** (`projects_action`) after the handover; a later projects migration may drop it. No DDL runs in a data step.
- **R3. "For" becomes a person link**; the owner stays a column (`owner_id`, null = you). JSON `for`/`for_person_id` = the first linked person.
- **R4. An old `pm` build** opening the database after the handover sees no actions (its projects table is empty). Accepted; the README's upgrade note says so.

## Review Focus

1. **A real database upgraded:** hundreds of actions with gaps in ids, some with origins from inbox and change sets → after the first start every action has the same id, fields and origins; the next new action gets max(id)+1; `action list --json` output is identical except for the added `links`. Test in Task 2.
2. **Actions switched off at upgrade time** (`ttybrain plugin disable actions` before upgrading): projects' rows stay; enabling actions later moves them; nothing is shown twice or lost. Test in Task 2.
3. **A failure in the middle of the handover** (a row that violates a constraint): nothing is moved, the step retries next start, projects' rows intact. Test in Task 2.
4. **Deleting a record that actions link to** (a meeting, a project archived/deleted): the action stays and its link shows the ref (or `—` when unresolvable), never a crash. Test in Task 3.
5. **80×24 Actions screen with long link lists:** links are cut whole (codes and names never cut), the title stays readable. Test in Task 4.

---

### Task 1: Kernel — one-time data steps and read access for `reads`

**Files:** `src/kernel/plugin.ts`, `src/kernel/host.ts`, `src/kernel/migrations.ts` (tracking), `src/kernel/api.ts`, tests `src/kernel/upgrade.test.ts`, docs `docs/architecture.md` (plugin API section).

**Interfaces (produces):**
- `ctx.upgrade(id: string, run: () => Promise<"done" | "later">): void` — registered in `activate`. After every plugin's migrations and views are in place at boot, the kernel runs each pending step in load order, each in its own write transaction. `"done"` records it (in `kernel_plugin_migration` as `upgrade:<id>`) so it never runs again; `"later"` commits nothing and leaves it pending. Steps that returned `"later"` get one more pass in the same boot after the others (so two plugins' steps can hand data over in either load order). A throw rolls the step back, keeps it pending, and shows the error in `plugin list` and Help (the plugin stays loaded — a failed data step is not a failed plugin).
- `ctx.use(id)` for a plugin listed in `reads` (not `requires`) returns `{ read }` only (its read operations); `undefined` when that plugin isn't loaded. Writes still need `requires`.

- [ ] **Step 1: Failing tests** (`src/kernel/upgrade.test.ts`, two tiny test plugins):

```ts
test("a step runs once and is recorded") // "done" → second boot doesn't run it; kernel_plugin_migration has upgrade:<id>
test("later leaves it pending and it runs on a later boot")
test("two plugins hand data over in either load order") // A's step waits for B's read op to report ready; both done in one boot whichever loads first
test("a throwing step rolls back, stays pending, plugin stays ok, error listed")
test("use() of a reads-only plugin gives read ops, not write") // .write undefined; unloaded → undefined
```

- [ ] **Steps 2–5:** RED, implement, GREEN + full checks, commit `feat(kernel): one-time data steps; read access for reads`.

### Task 2: Move actions into the `actions` plugin (same behaviour, new home)

**Files:** create `src/plugins/actions/` (`package.json` manifest with `ttybrain.id: "actions"`, `logic/`, `tui/`), and move the action code from `src/plugins/projects/` (the survey's §1–§5: `items.ts` action parts, `ops-actions.ts`, `commands-actions.ts`, `views.ts` action view, `status.ts`/`report.ts` actions section, `overview.ts` + `panels.ts` action panels, `tui/actions-screen.tsx`, `action-filter.ts`, `due-form.tsx`, the `action` record form, the project and person Actions tabs). Update meetings (`requires` actions; reads `actions.action` instead of `projects.action`), people (reads `actions.action`), inbox (unchanged form id), `tests/builtins.ts`, `tests/design.ts` seeds (`w("actions").addAction`; `seedLongRefs` updates `actions_action`), the smoke script, and every test listed in the survey's §7.

**Behaviour:** identical to today from the user's side — same screens, keys, CLI, JSON, reports, guide text (moved to the actions guide section) — except: (a) projects' "Act." column and `project show/list` open-action counts read the `actions.action` view (R1); (b) the project-status "actions" section and the overview "overdue-actions"/"due-this-week" sections are registered by actions on those reports (`ctx.reportSection`), with the same order numbers.

**Data:** `actions_action` has today's columns (`project_id`, `for_person_id`, `meeting_id` as plain integers for now). Handover (Task 1 steps): projects exposes read `legacyActions()` (all rows, all columns) and runs a step that deletes its rows once `actions` reports `read.importedLegacy() === true` (else `"later"`); actions runs a step that, when `projects` is loaded and its own table has no imported rows, inserts every legacy row with the same id and timestamps, records that it imported, and returns `"done"` (or `"later"` when projects isn't loaded). Provenance rows need no change (same record type name).

- [ ] **Step 1: Failing tests** (`src/plugins/actions/logic/handover.test.ts`): Review Focus 1–3 exactly; plus `action list --json` before/after the move equal (minus nothing — links come in Task 3); `A-n` refs resolve; next id is max+1.
- [ ] **Step 2: Move the existing action tests** into `src/plugins/actions/` and keep them green; projects/meetings/people/inbox/design tests updated to the new home.
- [ ] **Steps 3–5:** implement, full checks (smoke builds the new plugin on Node), commit `feat: actions are their own plugin` (more commits fine).

### Task 3: Generic links

**Files:** `src/plugins/actions/logic/` (schema migration 002, records, ops, commands, views, guide), readers in meetings (minutes, notes "logged", close count, prep's from-meeting actions) and people (follow-ups).

**Data:** migration `002` creates `link(action_id → action.id, record_type, record_id, unique(action_id, record_type, record_id))` (no ON DELETE action), copies `project_id` → `("project", id)`, `for_person_id` → `("person", id)`, `meeting_id` → `("meeting", id)`, then rebuilds `action` without those three columns (rule 6 order: no child has an ON DELETE action, so drop-and-recreate is allowed). The `actions.action` view drops the three columns (version 2) and a new view `actions.link` (`action_id`, `record_type`, `record_id`) is published; meetings and people read them.

**Ops and CLI:** add/edit take `links?: string[]` (refs resolved through the record registry; unknown ref → validation error with hint) and keep `project`, `forPerson`, `meeting` as shorthand; new ops `linkAction { ref, to }`, `unlinkAction { ref, to }`; `action show <A-n>`; `action link|unlink <A-n> <ref>`; `--link` repeatable on add/edit/list (list filters on any linked record). JSON per Global Constraints. A linked record that no longer resolves shows its stored ref (`M-4`) or `—` (Review Focus 4).

- [ ] **Step 1: Failing tests:** migration test (seed on the Task 2 shape, run 002: every link present, rows/ids intact, `foreign_key_check` empty); ops/CLI tests for links, shorthand equivalence, JSON compatibility fields, `show`, `link`/`unlink`, `--link` filter, unresolvable link; meetings minutes and notes still list the meeting's actions; person follow-ups still list "for" actions.
- [ ] **Steps 2–5:** RED, implement, full checks, commit `feat(actions): link an action to any record`.

### Task 4: TUI as designed

**Files:** `src/plugins/actions/tui/` (screen 4, Actions tabs, forms), tests `tests/design/actions.test.tsx` (update), new `tests/design/actions-links.test.tsx`.

- Screen 4 per the 2026-11-20 mock "4 Actions": columns `ID · Action · Owner · Linked to · Due`, "Linked to" shows each link as code (cyan) / `@handle` (magenta) / meeting title + date (muted), joined, cut whole with `…` (Table `Cell.parts`, never cutting a code or name); groups and keys as the mock (`l` edits links). The 2026-11-13 "For / from" column is replaced by "Linked to" (the 2026-11-20 mock wins).
- An Actions tab on every linkable record type: project, person, meeting (new: the meeting record gets an Actions tab listing actions linked to it).
- A links editor form (`l`): add/remove links with the same autocomplete as quick capture (`#`, `@`, `M-`).
- Attention panels and the inbox "process as action" form keep working (the form gains the links field; its prefill still works).
- 80×24 per Review Focus 5.

- [ ] **Steps 1–5:** failing design tests (exact lines, colours, status bar per the mock; 80×24), implement, full checks, commit `feat(actions): Linked to column and Actions tabs as designed`.

### Task 5: Docs and follow-ups

`docs/architecture.md` (plugin list, data steps, read access for `reads`), the plugin reference (`docs/superpowers/specs/2026-11-13-pm-plugins.md`: new actions section, projects section without actions), the main spec where it says actions belong to projects, `README.md` (upgrade note for R4), the agent guide sections, CLAUDE.md (plugin list), and a "Actions plugin" section in `docs/superpowers/plans/2026-11-13-pm-phase1-followups.md` (rulings R1–R4, the view API break, deferred minors). Commit `docs: actions plugin`.
