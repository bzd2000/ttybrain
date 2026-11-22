# Meetings rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every meeting belongs to a person or a project, can be one-off or recurring, and runs from that subject's talk-list; the board is a project; screen 5 becomes an overview; the screens look exactly like the designs.

**Architecture:** First the data (subjects, kinds, series, occurrences) with a small kernel hook for recurring upkeep; then talk-lists; then the meeting flow (tick, close, auto-close, skip, move); then the TUI in two tasks (overviews, then the person/project/meeting views and quick capture); then docs. All inside the `meetings` plugin, plus two small kernel additions and two TUI extension points.

**Tech Stack:** TypeScript, Bun and Node 26, Kysely over SQLite, OpenTUI + Solid.

**Spec:** `docs/superpowers/specs/2026-11-20-ttybrain-meetings-actions-design.md` §5 (meetings), §1 goals and anti-goals, §3 look and feel, §6 constraints, §8 left to the builder. Screens: `docs/superpowers/specs/2026-11-20-ttybrain-meeting-screens.html` — screens `home`, `meetings`, `talk`, `oneonone`, `project`, `board`, `series`, `capture` (today in the mock: Fri 20 Nov 2026). Map of today's meetings code and a text transcription of every mock: `meetings-survey.md` in this plan's SDD workspace (read-only survey, 2026-11-22).

## Global Constraints

- Nothing is lost or renumbered: every existing meeting keeps its `M-n`, title, date, status, attendees, agenda, asks, notes, since date, and the actions and decisions linked to it (design anti-goal).
- A talk item never disappears unless the user ticks it in a meeting, drops it, or it is discussed at the other place it shows (§5.3); closing or auto-closing a meeting keeps unticked items open.
- Kinds: `one_on_one` (shown `1:1`), `project`, `board`. 1:1 needs a person subject; project and board need a project subject (§5.1). Existing `board` stays `board`; `steering` and `other` become `project` (or `one_on_one` when later given a person subject).
- Rhythms (§5.2), case-insensitive, day as full or 3-letter name: `weekly on <day>`, `every <n> weeks on <day>`, `monthly on the <1st|2nd|3rd|4th|last> <day>`, `monthly on day <n>`; the leading `every` may be omitted (`2 weeks on wed`, as the mock's CLI example). Dates only, no time.
- Occurrences are created for the next 8 weeks (56 days from today, inclusive). A meeting not closed 3 days after its date closes itself (§5.2); existing meetings without a subject never do.
- Plugin graph unchanged: meetings requires `projects ^2`, `people ^1`, `actions ^2`. Meetings becomes `2.0.0` (the kind values in its published view change); readers (`projects`, `actions`) move their `reads: meetings` range to `^2`.
- CLI conventions as today (`--json`, exit codes, hints). Existing `meeting list|show|add|edit|cancel|close|attendees|notes|agenda` and `report board|minutes` keep their flags; `--kind steering|other` stay accepted as aliases of `project`.
- Look and feel per `docs/architecture.md` "The TUI": the mocks are the spec (layout at 118×36, wording, keys, colours — codes cyan, people magenta, ids and secondary text muted, late red, attention amber, ✓ green); exact status bars (`hints(list, { exact, frame, globals })`); 80×24 drops columns and hints from the right, never cuts codes or names.
- Isolation (`docs/architecture.md`): meetings' own tables only; other plugins' data through views, exposed reads (`ctx.read`) and required writes (`ctx.use`); no ON DELETE actions on tables that may be rebuilt (rule 6); copy-back with explicit column lists.
- Bun and Node both green after every task: `bun test`, `bun typecheck`, `bash scripts/smoke-node.sh` (`smoke ok`). Fixed clock in tests; no `new Date()`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the model that wrote them).

## Plan rulings

- **M1. Upkeep hook.** The kernel gets `ctx.upkeep(id, run: () => Promise<void>)`: like a data step, but it runs on **every** write-capable boot (CLI write commands and the TUI start; read-only boots skip it), after the data steps, in its own write transaction, with `noWait` (lock busy → skipped this boot). The TUI also runs upkeeps when the day changes while it is open. Meetings uses it to create occurrences ahead and to auto-close. Read-only commands may show yesterday's state until the next write-capable start (accepted).
- **M2. Migration 002 rebuilds `attendee` and `agenda_item` without ON DELETE CASCADE, then `meeting`** (rule 6), remapping kinds, and adds `subject_type`, `subject_id`, `series_id`, `series_date` (`unique(series_id, series_date)`), `auto_close` (0 for existing rows). Children are deleted explicitly where meetings are deleted (plugin purge already defers FKs).
- **M3. Skip = cancel the occurrence; move = change its date**; both keep `series_id`/`series_date`, so upkeep never recreates them.
- **M4. Auto-close of a subject-less meeting never happens**; `meeting subject` sets `auto_close = 1` only for meetings dated today or later.
- **M5. Ticking writes at once**: `Space` marks the item `discussed` in that meeting (`meeting_id`), `Space` again reopens it. A meeting's agenda (1:1, project) = the subject's open items (+ for project kind: open person items tagged with that project) + items discussed in this meeting.
- **M6. Closing a 1:1** with notes adds them to the person as a `one_on_one` note (`people.addNote`, date = meeting date). Project and board meetings keep their notes on the meeting. Auto-close does the same.
- **M7. Subject-less meetings stay visible**: screen 5 lists them in a last group "No subject · n" (hint `meeting subject M-n <ref>`), until assigned.
- **M8. Board talk-list → agenda** (`A`): adds the item as an agenda item and marks it discussed in that meeting.
- **M9. `t`** on a person, project or upcoming meeting opens the talk-item form with the subject filled in. Quick capture routes text that starts with `talk ` and carries exactly one person or project tag that resolves; anything else goes to the inbox as before.
- **M10. Pronouns:** the mock's "Her actions · 3" becomes `<First name>'s actions · 3` (the app can't know pronouns). Recorded as an accepted difference for the side-by-side review.
- **M11. Non-board meetings** open on the in-progress layout (the `oneonone` mock) with no tab row; the actions plugin's meeting Actions tab shows only on board meetings (the Agreed actions panel covers the others). Board meetings keep Agenda · Prep · Notes · Export (+ Actions, already accepted).
- **M12. Record types:** series `S-n`, talk item `T-n` (registered, resolvable, searchable by title/text).

## Review Focus

1. **A real database upgraded** (main's shape: board/steering/other meetings, attendees, agenda with asks, held and planned, actions and decisions linked): every meeting keeps everything, kinds are remapped, all are still listed (No subject group), none auto-closes; `meeting subject --all-without #BOARD` assigns them. Test in Task 1.
2. **Rhythm edges:** `monthly on day 31` in a 30-day month (→ last day), `monthly on the last fri`, `every 2 weeks` anchored to the first date, an end date in the middle of the window, a moved and a skipped occurrence not recreated. Test in Task 1.
3. **The app not opened for three weeks:** the next start closes every meeting more than 3 days past, keeps their unticked items, and creates only future occurrences (no back-filled past dates). Test in Task 3.
4. **A talk item's subject or tag goes away** (person deleted, project archived, a plugin switched off): the item stays listed (`talk list` shows the stored ref or `—`), never a crash. Test in Task 2.
5. **Quick capture that is almost a talk item** (`talk about lunch`, `talk @anna @bob …`, `talk @nobody …`): goes to the inbox, and the preview line says so before saving. Test in Task 5.

---

### Task 1: Subjects, kinds, series and occurrences (+ kernel upkeep)

**Files:** kernel `src/kernel/plugin.ts`, `host.ts`, `migrations.ts` (upkeep runner), `api.ts`, TUI day-change rerun in `src/kernel/tui/`; meetings `logic/schema.ts` (migration 002 + series tables), `logic/rhythm.ts` (new, pure), `logic/series.ts` (new), `logic/records.ts`, `logic/ops.ts`, `logic/commands.ts`, `logic/views.ts`, `logic/index.ts` (2.0.0), `package.json`; `projects` and `actions` manifests (`reads: meetings ^2`); docs `docs/architecture.md` (upkeep).

**Interfaces (produces):**
- `ctx.upkeep(id, run)` per M1.
- `parseRhythm(text: string): Rhythm` (ValidationError with the four forms in the hint); `rhythmDates(r: Rhythm, first: string, from: string, to: string, end?: string): string[]`; `rhythmLabel(r, "short" | "long")` → `every 2 wk Mon` / `every 2 weeks, Monday`, `monthly, 4th Tue`, `monthly, last Fri`, `weekly Mon` / `weekly, Monday`, `monthly, day 15`.
- Tables: `series(id, subject_type, subject_id, title, kind, rhythm, first_date, end_date, created_at, updated_at)`, `series_attendee(series_id, person_id)` (no ON DELETE); meeting columns per M2.
- Ops: `addSeries { about, title, kind?, every, from, until?, attendees? }`, `editSeries { ref, title?, every?, attendees?, until? }`, `endSeries { ref, on? }` (deletes its planned occurrences after that date), `addMeeting` gains required `about` (+ kind default from the subject: person → one_on_one, project → project), `setSubject { meeting, about }`, `skipMeeting { ref }`, `moveMeeting { ref, to }`; read `upcoming { from, to }`. Upkeep `occurrences` creates missing occurrences in [today, today+55].
- View `meetings.meeting` v2 adds `subject_type, subject_id, series_id`; new view `meetings.series` v1.
- CLI: `meeting series add|list|edit|end`, `meeting add … --about <ref>`, `meeting skip|move <M-n> [--to]`, `meeting subject <M-n|--all-without> <ref>`.

- [ ] **Step 1: Failing tests** — `logic/rhythm.test.ts`: each form's next dates from the mock (`every 2 weeks on wednesday` from Wed 25 Nov → `2026-11-25, 2026-12-09, 2026-12-23, 2027-01-06`; `monthly on the 4th tue` → 24 Nov, 22 Dec; `monthly on the last fri` → 27 Nov, 25 Dec) and Review Focus 2. `logic/upgrade.test.ts`: Review Focus 1 on a database written by main's migration 001 (rows inserted with the old shape). `logic/series.test.ts`: add a series → 8 weeks of occurrences with subject, kind, attendees; skip/move not recreated; end removes later planned ones; `upkeep` on a later boot tops up only future dates. `src/kernel/upkeep.test.ts`: runs every write boot, not on read-only boots, skipped when the lock is held, a throw rolls back and shows in `plugin list`.
- [ ] **Steps 2–5:** RED, implement, GREEN + full checks, commit `feat(meetings): subjects, kinds, series and occurrences`.

### Task 2: Talk-lists

**Files:** meetings `logic/schema.ts` (migration 003 `talk_item`), `logic/talk.ts` (new), `logic/records.ts` (`T-n`), `logic/ops.ts`, `logic/commands.ts` (`talk …`), `logic/views.ts` (`meetings.talk_item` v1), `logic/guide.ts`.

**Interfaces (produces):** table `talk_item(id, subject_type, subject_id, text, project_id, added_date, position, status open|discussed|dropped, meeting_id, status_date, created_at, updated_at)`; ops `addTalk { about, text, project? }`, `editTalk { ref, text?, project? }`, `moveTalk { ref, to }`, `dropTalk { ref }`, `discussTalk { ref, meeting }`, `reopenTalk { ref }`; reads `talkList { about }` → `{ open: TalkRecord[], carried: TalkRecord[], carriedFrom?: string }` (carried = open items added before the subject's last held meeting), `agendaFor { meeting }` per M5. CLI `talk add <ref> <text> [--project]`, `talk list [<ref>]`, `talk done <T-n> [--meeting M-n]`, `talk drop <T-n>`, `talk move <T-n> --to <n>`.

- [ ] **Step 1: Failing tests** (`logic/talk.test.ts`): add/list/reorder/drop with exact JSON; a person item tagged `#ERP` is on Anna's list and on the ERP project meeting's agenda; discussed in either place → off both; carried group from the last held meeting; Review Focus 4.
- [ ] **Steps 2–5:** RED, implement, GREEN + full checks, commit `feat(meetings): talk-lists`.

### Task 3: The meeting flow — tick, agree, close, auto-close

**Files:** meetings `logic/ops.ts` (`closeMeeting`), `logic/close.ts` (new), upkeep `auto-close`, `logic/commands.ts` (close message), `logic/reports.ts` (minutes include discussed items).

**Interfaces (produces):** `closeMeeting { ref }` → `{ meeting, discussed, kept, actions, notesSaved }`; the close message `1:1 Anna closed · 2 discussed, 3 kept for next time · 2 actions created · notes saved` (each part only when non-zero; "notes saved" only when M6 saved them); upkeep `auto-close` closes meetings with `auto_close = 1`, status planned, date ≤ today − 3, the same way. Agreed actions are made with `actions.addAction` linked to the meeting and its subject (+ a project picked in the form).

- [ ] **Step 1: Failing tests** (`logic/close.test.ts`): the mock's close message exactly; notes land on Anna as a 1:1 note; unticked items stay open, ticked ones discussed in M-n; Review Focus 3; a held-not-closed meeting is "closes itself <day>" in `upcoming`.
- [ ] **Steps 2–5:** RED, implement, GREEN + full checks, commit `feat(meetings): close and auto-close`.

### Task 4: TUI — Attention panel, screen 5, series form

**Files:** meetings `tui/meetings-screen.tsx` (rewrite), `tui/panels.ts` (new), `tui/series-form.tsx` (new), `tui/forms.tsx` (meeting form: About, Kind `1:1 (project · board)`); kernel `OverviewPanelDef` additions if needed (a selected-row detail block and row keys: Enter, `x`, `t` — check `src/kernel/tui/components/OverviewScreen.tsx` first); `tests/design.ts` new `seedMeetings(kernel)` with the mock's data and clock `2026-11-20`; design tests `tests/design/meetings.test.tsx`, `attention.test.tsx`, `small.test.tsx`, `tones.test.tsx`.

**Screens (mocks `home`, `meetings`, `series`):** Attention gains "Upcoming meetings · next 7 days" first (priority 5; columns Date · Meeting · About · To talk · Your act.; series rows end with muted `r`; board shows `<n> items`; Your act. amber `2 · 1 late`; detail block "Before <meeting> · your actions"; footer `r recurring`; "To talk" = open items on the subject's talk-list (board: its agenda length); "Your act." = your open actions (owner me) linked to the meeting's subject or to an earlier meeting of its series, read from the `actions.action`/`actions.link` views; bar `tab panel   enter open   x done   t to talk   i capture   g or 1-6 screens   ? help`). Screen 5: Upcoming (week groups "Next week · 23–27 Nov", "Week after · 30 Nov–4 Dec", "Held, closes itself Sat · 1", then M7's "No subject · n") and "Series · 7" (Series · About · Rhythm short); bar `tab panel   enter open   n one-off   N series   s skip date   m move date   i capture`. Series form: About, Title, Kind, Rhythm with the live `→ Wed 25 Nov, 9 Dec, 23 Dec, 6 Jan …` line, First date, Attendees, Ends `never`; footer `ctrl+s save · esc cancel`.

- [ ] **Step 1: Failing design tests** at 118×36 asserting the mock rows in order and their colours; 80×24 in `small.test.tsx`.
- [ ] **Steps 2–5:** RED, implement, GREEN + full checks, commit `feat(meetings): Attention panel, screen 5 and series form as designed`.

### Task 5: TUI — person and project tabs, meeting in progress, board, quick capture

**Files:** meetings `tui/person-talk.tsx`, `tui/person-meetings.tsx`, `tui/project-meetings.tsx`, `tui/project-talk.tsx`, `tui/meeting-view.tsx` (in progress), `tui/agenda-tab.tsx` (board talk-list panel, `A`), `tui/talk-form.tsx`, `tui/index.tsx` (tab orders person Talk 12, Meetings 15; project Meetings 72, Talk 75; M11); actions `tui/index.tsx` (meeting tab `when` board); inbox `tui/capture.tsx` + kernel TUI extension point `ui.captureRoute({ id, preview(text) → Promise<lines | null>, submit(text) → Promise<string> })` (first route whose preview is non-null wins; documented with the other extension points); design tests `tests/design/talk.test.tsx`, `meeting-progress.test.tsx`, `project-meetings.test.tsx`, `board.test.tsx`, `capture.test.tsx`, `meeting-prep.test.tsx`.

**Screens (mocks `talk`, `oneonone`, `project`, `board`, `capture`):** exactly as transcribed in the survey, with M10 and M11. Keys per the mocks' bars: Talk tab `←→ tabs   n add   e edit   J/K reorder   del drop   enter next meeting   esc back`; in progress `space discussed   tab panel   e notes   a action   D decision   x close   esc back`; project Meetings `←→ tabs   tab panel   t to talk   enter open   N series   n one-off   esc back`; board `←→ tabs   n agenda item   J/K reorder   A talk-list → agenda   e edit ask   esc back`; capture preview lines `→ Anna Peeters' talk-list · next 1:1 Mon 23 Nov`, `linked to #CRM, so it also shows at CRM steering until discussed`, `without "talk" it goes to the inbox as before`.

- [ ] **Step 1: Failing design tests** for each mock at 118×36 (rows, colours, bars) and 80×24; Review Focus 5; an agreed action created in the in-progress view appears on screen 4 at once.
- [ ] **Steps 2–5:** RED, implement, GREEN + full checks, commit `feat(meetings): talk tabs, meeting in progress, board talk-list, capture to talk`.

### Task 6: Docs and follow-ups

`docs/architecture.md` (upkeep, `captureRoute`, meetings in "Who owns what"), the plugin reference (`docs/superpowers/specs/2026-11-13-pm-plugins.md`: meetings section rewritten; projects/actions read ranges), the main spec where it describes meetings, `README.md` (upgrade note: existing meetings get "—" until `meeting subject`; `meeting add` now needs `--about`), the in-app guide sections, CLAUDE.md if the plugin list changes, and a "Meetings rework" section in `docs/superpowers/plans/2026-11-13-pm-phase1-followups.md` (rulings M1–M12, deferred minors, the side-by-side review list). Commit `docs: meetings rework`.
