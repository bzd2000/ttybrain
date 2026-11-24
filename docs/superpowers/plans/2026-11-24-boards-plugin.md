# Boards plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boards move out of the meetings plugin into their own `boards` plugin, which owns the board records; meetings keeps board meetings and board talk-lists.

**Architecture:** As actions moved out of projects: a new plugin owns the table, record type, CLI and view, and a one-time handover (kernel data steps) moves the existing rows with the same ids. Meetings stops owning boards and reads them through the new plugin's view; projects checks the shared code namespace against the new view.

**Tech Stack:** TypeScript, Bun and Node 26, Kysely over SQLite, OpenTUI + Solid.

**Spec:** `docs/superpowers/specs/2026-11-20-ttybrain-meetings-actions-design.md` §5.7 (boards; this plan changes only who owns them — user's decision 2026-11-24: "a board is its own kind of record, so a separate plugin"). Precedent: the actions handover (`docs/superpowers/plans/2026-11-22-actions-plugin.md`, Task 2).

## Global Constraints

- Nothing lost or renumbered: every board keeps its id, code, name, note and archived state; meetings, series, talk items and action links that point at a board (by `record_type`/`subject_type` `board` and id) keep pointing at the same board.
- The handover is one-time, atomic, idempotent and survives either plugin being off (rows wait); exactly one copy is visible at any point.
- Plugin graph: `boards` requires nothing and reads `projects` (namespace check); `meetings` requires `boards ^1` (P1); `projects` reads `boards` (namespace check) instead of meetings' board view.
- Behaviour from the user's side unchanged: `#CODE`, `board add|list|show|edit|archive|restore` (same flags, output, JSON, exit codes), the board view, the Boards panel on screen 5, capture `talk #MB`, the shared code namespace.
- Versions: `meetings.board` view goes away → meetings 3.0.0 (readers' ranges updated); `boards` 1.0.0 publishes `boards.board` v1 with the same columns.
- Isolation, Bun + Node, CLI conventions, look and feel as before; `bun run test`, `bun typecheck`, `bash scripts/smoke-node.sh` green after every task.

## Plan rulings

- **P1. Who owns what.** `boards` owns the `board` table, the `board` record type and `#` tag type (shared prefix with projects), the CLI `board add|list|show|edit|archive|restore`, the `boards.board` view, and the board record view's crumb with a Summary tab (code, name, note, archived). `meetings` keeps board meetings and series (subject_type `board`), board talk-lists, the board view's Meetings and Talk tabs (`recordTab` on type `board`), the Boards panel on screen 5 (reading `boards.board`), capture `talk #MB`, and the `boards-from-projects` data step, which now creates its boards through boards' `addBoard` write op. So **meetings requires boards ^1**, as it already requires people, projects and actions: with boards off, meetings is off too, with a message.
- **P2. Handover** (like actions): meetings exposes read `legacyBoards()`; boards' step imports every row with the same id, code, name, note, archived_at and timestamps when meetings is loaded and it hasn't imported yet, and records the import; meetings' step empties its `board` table once boards reports `importedLegacy()`; the emptied table stays (no DDL in a step). Counters: the boards table is AUTOINCREMENT and its counter starts above the highest imported id.
- **P3. Kind rules and the namespace check** move with the data: meetings validates "kind board ⇔ board subject" by resolving through the registry (unchanged); the namespace check runs in boards (against `projects.project`) and in projects (against `boards.board`).

## Review Focus

1. **A database with boards, board meetings, series, talk items and links** upgraded: every board keeps its id and fields; everything that pointed at a board still does; `board list --json` identical; the next board id is max+1. Task 1.
2. **boards switched off at upgrade time**: meetings is off too (P1) and its board rows wait; enabling boards later moves them; nothing shown twice or lost. Task 1.
3. **Code clash after the move**: `board add CRM` with project CRM and `project add MB` with board MB still refused both ways. Task 1.
4. **The board view** shows Summary (boards) + Meetings + Talk (meetings) in that order; screen 5's Boards panel unchanged. Task 2.

---

### Task 1: The `boards` plugin and the handover (logic, CLI)

**Files:** create `src/plugins/boards/` (`package.json` manifest `ttybrain.id: "boards"`, `logic/`); move from `src/plugins/meetings/logic/boards.ts` the table, record/tag types, ops, CLI, view; meetings keeps a read `legacyBoards`, the emptying step, the `boards-from-projects` step (creating boards through `boards.write.addBoard`); meetings requires boards ^1, version 3.0.0, `meetings.board` view removed; projects reads `boards.board`; `tests/builtins.ts`, smoke script, guide sections (boards' own), tests moved.
- [ ] Failing tests: Review Focus 1–3; the moved board tests unchanged in their assertions.
- [ ] Implement, GREEN + full checks, commit `feat: boards are their own plugin`.

### Task 2: TUI

**Files:** `src/plugins/boards/tui/` (record crumb, Summary tab), meetings `tui/` keeps Meetings/Talk tabs and the Boards panel reading `boards.board`; design tests unchanged except the board view gaining Summary first (Review Focus 4).
- [ ] Failing design test for the board view's tabs; existing board tests green.
- [ ] Implement, GREEN + full checks, commit `feat(boards): own TUI part`.

### Task 3: Docs

Architecture ("Who owns what", plugin list), plugin reference (new boards section; meetings without boards), design §5.7 note, README (boards plugin; upgrade note), CLAUDE.md plugin list, follow-ups. Commit `docs: boards plugin`.
