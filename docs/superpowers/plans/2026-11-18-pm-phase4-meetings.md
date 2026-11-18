# pm phase 4: the meetings plugin. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are `pm-developer`, reviewers `pm-reviewer` (`.claude/agents/`).

**Goal:** the built-in `meetings` plugin, with three parts:
- **Logic.** Meetings with attendees, an agenda with an "ask" per item, the "since" rule, and the board and minutes reports built from the projects' `project-status` sections. The CLI covers `pm meeting …`, `pm meeting agenda …` and `pm report board|minutes`.
- **TUI.** Screen `5` Meetings, and a meeting's record view with the tabs Agenda · Prep · Notes · Export.
- **Logging.** From a meeting you can log actions and decisions linked to it, and close it.

**Architecture:**
- **The meetings plugin** (`src/plugins/meetings/logic|tui/`):
  - `requires` projects and people, and reads `projects.*` and `people.person`;
  - stores `meeting`, `attendee` and `agenda_item`;
  - logs actions and decisions only through `projects.write.addAction` / `addDecision` with `meeting: "M-n"`.
- **Kernel changes, small and additive.** Reports learn to be embedded:
  - a plugin can run and render another report (`ctx.reports`);
  - a section may return several sections, grouped under a heading;
  - rows can carry an icon and a tone (the "hints" agreed for the Prep tab);
  - a section can hold a paragraph of text;
  - a report title can depend on its params.
- **TUI kernel additions:**
  - `<ReportSections>`, which draws section results with their hints;
  - `writeExport` and `copyText` for the Export tab.

**Tech Stack:** Bun ≥ 1.3.14 (CI 1.4.4) and Node ≥ 26.4, OpenTUI 0.8.4 + Solid 1.9, Kysely 0.28.18, TypeBox 1.4.3, `bun test` with `makeTestKernel`, `runCli` and `renderTui`.

**Spec:**
- `docs/superpowers/specs/2026-11-13-pm-design.md` ("spec"):
  - §4 Meetings;
  - §6 (CLI pattern and examples);
  - §8 (meetings and reports);
  - §9 (the Meetings row, keys, forms, long text);
  - §13 item 4.
- `docs/superpowers/specs/2026-11-13-pm-plugins.md` ("plugin reference"): §3 `meetings`.
- `docs/superpowers/specs/2026-11-13-pm-screens.html`, section "5 Meeting prep" (the mockup; where it differs from the spec, the spec wins).
- `docs/architecture.md`: the rules every task follows.
- Decisions agreed with the user on 2026-11-18, written into the tasks and listed under "Rulings":
  - **Prep look, option C:** one generic drawing of the report sections, with optional per-row icon and tone hints.
  - **Export tab:** shows the board pack while the meeting is planned and the minutes once it is held; `m` switches.

## Global Constraints

- **Runtimes.** Both runtimes always.
  - Relative imports stay extensionless.
  - No `Bun.*` outside `src/kernel/db/sqlite.ts`.
  - File writes use `node:fs/promises`.
  - `bash scripts/smoke-node.sh` must still print `tui ok` and end with `smoke ok`.
- **Isolation** (`docs/architecture.md`):
  - meetings reads other plugins only through their views (`people.person`, `projects.project`, `projects.action`, `projects.decision`) and `ctx.use("projects").read`;
  - it writes to them only through `ctx.use("projects").write`;
  - it never touches their tables or imports their files.
  - Logic code never imports `solid-js`, `@opentui/*` or `src/kernel/tui/*`.
- **TUI rules:**
  - plugins' tui parts import kernel things only from `src/kernel/tui/api.ts`;
  - keys only through `useScreenKeys` (claim with `key.preventDefault()`);
  - writes only through `act(...)`;
  - record props are `recordRef`.
  - **Form keys:** Enter is a new line in multi-line fields and does nothing elsewhere; Tab / Shift+Tab change field; Ctrl+S or Esc `s` saves; Esc cancels.
- **No clock reads** (`new Date()`, `Date.now()`): use `currentContext().today` / `ui.clock.today()` / `useToday()`.
- **References.** Meetings are `M-n` (`formatRef("M-", id)`). An agenda item is addressed by its meeting and its position (`1`-based), never by its own id.
- **CLI conventions** (spec §6):
  - exit codes are `0` OK, `1` validation, `2` not found, `3` conflict/locked;
  - every write prints its change-set line;
  - `--json` gives the record.
- **Change-set lines.** Use these forms, from the plugin reference §3 (`describe`):

  | Change | Line |
  |---|---|
  | add | `+ meeting M-5 "SteerCo Q1" 2027-03-04` |
  | edit | `~ M-5 date 2027-03-04 → 2027-03-11` (field `before → after`, comma-separated) |
  | cancel | `~ M-5 cancelled` |
  | close | `~ M-4 held` |
  | attendees | `~ M-4 attendees +@tom −@luc` |
  | agenda add | `+ M-4 item 3 "Budget"` |
  | agenda edit | `~ M-4 item 2 ask: "Release contingency"` (each changed field `name: "value"`) |
  | agenda move | `~ M-4 item 4 → 2` |
  | agenda remove | `- M-4 item 2 "AOB"` |
  | notes | `~ M-4 notes` |

- **Dates.**
  - Inputs use `parseDate` (same as the CLI).
  - The TUI shows `shortDate` (`4 Dec`), and `Thu 4 Dec 2026` for a meeting's own date (`longDate`).
  - Reports use ISO dates.
- **Tests.**
  - Use `makeTestKernel` with the fixed clock **2026-11-13** (a Friday).
  - CLI tests assert exact output and exit codes.
  - TUI tests use `renderTui` and wait on frame or route conditions, never fixed sleeps. The established lone-Esc flush helper is the one exception.
  - Call `cleanup()` / `destroy()` in `finally`.
- **Commits.** Each task ends with one commit using the message given, followed by a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A meeting with no projects, or an agenda item without a project** (`1. Minutes & open actions`, `5. AOB`).
   - Prep shows `No project on this item.` and the ask, and does not throw.
   - The board pack has the attendees and the agenda but no project blocks.

   Owner: Task 6 `board pack of a meeting without projects`, Task 9 `prep of an item without a project`.
2. **"Since" across earlier meetings.**
   - Only an earlier *held* meeting with an agenda item for the same project counts. Cancelled, planned and later meetings never count.
   - Two meetings on the same date count only if the other one's id is lower.
   - The meeting's own `since_date` wins.

   Owner: Task 4 `sinceDate: own date, previous held meeting, default`, `sinceDate ignores cancelled, planned and later meetings`.
3. **Exporting the same meeting twice.**
   - The second `w` overwrites the same file.
   - A missing export folder is created.
   - A title with `/`, `:` or emoji gives a safe file name.

   Owner: Task 7 `writeExport creates the folder, overwrites, refuses separators`, Task 10 `export slug`.
4. **Closing twice, or writing to a cancelled meeting.**
   - `close` on a held meeting fails with `M-4 is already held`.
   - Any write on a cancelled meeting fails with `M-4 is cancelled`, exit 1.
   - The TUI shows the error in the status bar.

   Owner: Task 4 `close and cancel rules`.
5. **An 80×24 terminal.**
   - Prep and Notes, with their agenda list on the left, render without throwing.
   - Long asks and titles truncate with `…`.

   Owner: Task 9 `prep at 80x24`.

---

## File structure

```
src/kernel/
  reports.ts            group / marks / text on sections; array results; title(params); run+render for plugins  (Task 1)
  plugin.ts, host.ts    PluginContext.reports: { run, render }                                                   (Task 1)
  tui/components/ReportSections.tsx   draws section results with marks                                         (Task 7)
  tui/export.ts         writeExport(fileName, text), copyText(text)                                              (Task 7)
  tui/api.ts            exports the two above                                                                    (Task 7)
src/plugins/projects/
  logic/report.ts       project-status: reference/previousMeeting params; marks                                  (Task 2)
  tui/item-forms.tsx    prefill.meeting carried into addAction/addDecision                                       (Task 2)
src/plugins/meetings/
  logic/index.ts        definePlugin (requires projects, people)                                                 (Task 3)
  logic/schema.ts       tables, records                                                                          (Task 3)
  logic/records.ts      store, record type `meeting` (M-)                                                        (Task 3)
  logic/views.ts        meetings.meeting / agenda_item / attendee                                                (Task 3)
  logic/since.ts        sinceFor(meeting, projectId)                                                             (Task 4)
  logic/ops.ts          writes + sinceDate                                                                       (Task 4)
  logic/reports.ts      board, minutes, prep + report reads                                                      (Task 6)
  logic/commands.ts     pm meeting …, pm meeting agenda …                                                        (Task 5)
  logic/guide.ts        guideSection                                                                             (Task 5)
  tui/index.tsx         screen, forms, tabs                                                                      (Tasks 8–10)
  tui/forms.tsx         MeetingForm, AgendaItemForm, AttendeesForm                                              (Task 8)
  tui/meetings-screen.tsx                                                                                       (Task 8)
  tui/agenda-tab.tsx, prep-tab.tsx, notes-tab.tsx, export-tab.tsx                                               (Tasks 9–10)
  tui/agenda-list.tsx   the left-hand agenda list shared by Prep and Notes                                       (Task 9)
src/plugins/index.ts, src/plugins/tui.ts   add meetings                                                         (Tasks 3, 8)
```

---

### Task 1: Kernel: embeddable reports

**Files:**
- Modify: `src/kernel/reports.ts`, `src/kernel/plugin.ts`, `src/kernel/host.ts`, `src/kernel/api.ts`, `src/kernel/reports.test.ts`.

**Interfaces:**
- Produces, in `reports.ts`:
  - `type Mark = { icon?: string; tone?: "red" | "amber" | "green" | "muted" }`.
  - `ReportSectionResult` gains optional fields: `group?: string`, `marks?: Array<Mark | null>` (parallel to `rows`) and `text?: string` (a paragraph, Markdown).
  - `ReportSectionDef.run` may return `ReportSectionResult | ReportSectionResult[] | null`. An array is spliced in place.
  - `ReportDef.title` becomes `string | ((input: any) => string | Promise<string>)`. A function is called once with `prepare`'s output.
- Produces, in `plugin.ts`: `PluginContext.reports: { run(reportId: string, params: unknown): Promise<ReportResult>; render(r: ReportResult, format: "md" | "text" | "json"): string }`. `run` is the registry's `run`, and it runs in the caller's operation context. Add `"reports"` to the `PluginRuntime` pick.
- Produces, exported from `kernel/api.ts`: `Mark`, `ReportResult`.

Rendering rules:
- **Markdown:**
  - The first section of a `group`, and each later change of group, is preceded by `## <group>`.
  - A grouped section's heading is `### <title>`; an ungrouped one stays `## <title>`.
  - A row's mark icon goes before its first column's cell, with one space (`✓ MS-1`).
  - Tones are not rendered.
  - `text` is written as a paragraph after the table or the empty line.
- **Text:** the same grouping, with the group as its own line and a blank line, and icons prefixed the same way.
- **JSON:** the result object unchanged, with `group`, `marks` and `text` included.
- **Validation:** a section with `marks` whose length differs from `rows` is malformed, and becomes an error note as today. `wellFormed` checks it.

- [ ] **Step 1: Write the failing tests** in `reports.test.ts`:
  - `a section may return several sections, in place`;
  - `md groups sections under ## group with ### titles`: assert the exact Markdown for two groups of two sections plus one ungrouped section;
  - `marks prefix the first cell in md and text, and json keeps them`;
  - `marks of the wrong length make the section an error note`;
  - `a text paragraph renders after the table`;
  - `title may be a function of the prepared params`;
  - in `host.test.ts` (or a new kernel test): `a plugin runs another plugin's report through ctx.reports.run and renders it`.
- [ ] **Step 2: Run** `bun test ./src/kernel/reports.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass. This includes the existing CLI report tests, whose output must not change.
- [ ] **Step 5: Commit:** `feat(kernel): embeddable reports (grouped sections, row marks, text, dynamic title, ctx.reports)`

---

### Task 2: Projects: prep-ready `project-status` and meeting-linked forms

**Files:**
- Modify:
  - `src/plugins/projects/logic/report.ts`;
  - `src/plugins/projects/tui/item-forms.tsx`;
  - the tests next to them: `src/plugins/projects/logic/status.test.ts` or a report test, and `src/plugins/projects/tui/item-tabs.test.tsx` or a form test.

**Interfaces:**
- Produces: `project-status` params gain `reference?: string` (a date: the meeting date, which the "due within 60/30 days" windows count from) and `previousMeeting?: string` (`M-n`). `prepare` validates and passes both through to `projectStatus`, which already accepts them (`status.ts` `StatusInput`).
  - On the CLI they become `--reference <date>` and `--previous-meeting <M-n>`. The parameter names follow the CLI flag rules.
- Produces marks on the status sections, through the Task 1 `marks` field:

  | Section | Icon | Tone |
  |---|---|---|
  | Health | `●` | the health tone, `muted` when not set |
  | Milestones | `✓` done, `○` open | `red` when late |
  | Deliverables | `✓` delivered, `◐` in progress or in review, `○` not started | none |
  | Risks & issues | `▲` | `red` when the severity is high |
  | Actions | `!` | `red` when overdue |
- Produces, in the item forms: when `prefill.meeting` is given to the action or decision form, the add operation's input includes `meeting: <ref>`. There is no visible field, and the form title gets ` · M-n` appended (`New action · M-4`).

- [ ] **Step 1: Write the failing tests.**
  - `project-status takes reference and previousMeeting`: an open action linked to `M-1` appears with Why `previous meeting` only when `previousMeeting: "M-1"` is given. A milestone due 2027-01-20 is in the upcoming list with `reference: "2026-12-04"`, and not without it. Seed `meeting_id` directly through `addAction({ …, meeting })` with no meetings plugin loaded: it is a soft reference, unvalidated when meetings is absent.
  - `status sections carry marks`: the Markdown of `pm report status CRM` starts the milestone rows with `✓ ` or `○ ` and the risk rows with `▲ `. Update the existing report snapshot tests to the new output and say so in the report.
  - `action and decision forms carry a prefilled meeting`: with `prefill: { meeting: "M-1", project: "#CRM" }` the action form's title reads `New action · M-1`, and saving creates an action with `meeting_id` 1.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(projects): project-status for meeting prep (reference, previousMeeting, marks); forms carry a meeting`

---

### Task 3: Meetings plugin skeleton: tables, records, views

**Files:**
- Create: `src/plugins/meetings/logic/index.ts`, `schema.ts`, `records.ts`, `views.ts`, `meetings.test.ts`.
- Modify: `src/plugins/index.ts` (add `meetings` to `builtinPlugins`).

**Interfaces:**
- Produces: `meetings = definePlugin({ id: "meetings", name: "Meetings", version: "1.0.0", apiVersion: 1, requires: { projects: "^1", people: "^1" }, reads: { projects: "^1", people: "^1" }, activate })`.
- Produces tables (migration `"001"`):

  | Table | Columns |
  |---|---|
  | `meeting` | `id`, `title` text not null, `date` text not null, `kind` text not null check in (`board`, `steering`, `other`), `status` text not null default `planned` check in (`planned`, `held`, `cancelled`), `since_date` text null, `notes` text not null default `''`, `created_at`, `updated_at` |
  | `attendee` | (`meeting_id` → meeting on delete cascade, `person_id` integer, soft), primary key (`meeting_id`, `person_id`) |
  | `agenda_item` | `id`, `meeting_id` → meeting on delete cascade, `position` integer not null, `text` text not null, `project_id` integer null (soft), `ask` text null; unique (`meeting_id`, `position`) |
- Produces, in `schema.ts`:
  - `MeetingRecord = { ref, id, title, date, kind, status, since_date: string | null, notes: string, attendees: string[] /* @handles, by name */, agenda: AgendaItem[] }`;
  - `AgendaItem = { position, text, project: string | null /* #CODE */, project_id: number | null, ask: string | null }`;
  - `MEETING_KINDS` and `MEETING_STATUSES`.
- Produces, in `records.ts`: `makeStore(ctx: PluginRuntime)` with:
  - `meetingId(input)`;
  - `meeting(input): Promise<MeetingRecord>` (`NotFoundError` `unknown meeting "M-9"`);
  - `openMeeting(input)`: rejects a cancelled meeting with `M-4 is cancelled`, and a held one only where the caller says;
  - `personId(handle)` through `ctx.records.resolve("@…")`;
  - `projectId(code)` through `ctx.records.resolve("#…")`.
- Produces the record type `meeting`, prefix `M-`:
  - `label` is the title;
  - `search` matches titles, newest first.
- Produces three views, version 1, with the columns of the plugin reference §3:
  - `meetings.meeting` (id, title, date, kind, status);
  - `meetings.agenda_item` (id, meeting_id, position, text, project_id, ask);
  - `meetings.attendee` (meeting_id, person_id).

- [ ] **Step 1: Write the failing tests** in `meetings.test.ts`, using `makeTestKernel({ plugins: [people, projects, meetings] })`:
  - `meetings loads after projects and people and publishes its views`: a projects query on `meetings.meeting` works;
  - `the built-in plugin list includes meetings`: `builtinPlugins` contains it, and a kernel booted with the built-ins activates it without errors.

  The record type gets its test in Task 4, once meetings can be added.
- [ ] **Step 2: Run** `bun test ./src/plugins/meetings/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test`, `bun typecheck`, `bun src/kernel/isolation-selfcheck.ts` and `bash scripts/smoke-node.sh`. Expected: all pass. A new plugin's tables go through the isolation layers.
- [ ] **Step 5: Commit:** `feat(meetings): plugin skeleton with tables, M- records and views`

---

### Task 4: Meetings operations and the "since" rule

**Files:**
- Create: `src/plugins/meetings/logic/since.ts`, `src/plugins/meetings/logic/ops.ts`.
- Modify: `src/plugins/meetings/logic/index.ts`, `src/plugins/meetings/logic/meetings.test.ts`.

**Interfaces:**
- **Write operations** (exposed). Each returns the `MeetingRecord`. Field names are the input names, so a `ValidationError.field` lands under the form field.

  | Op | Input | Rules |
  |---|---|---|
  | `addMeeting` | `title`, `date`, `kind?` (default `other`), `attendees?: string[]` (handles), `projects?: string[]` (codes), `sinceDate?` | Each project adds an agenda item `<project name> status` with an empty ask, in the given order. Unknown people or projects throw `NotFoundError`, with suggestions from the tags. |
  | `editMeeting` | `ref`, `title?`, `date?`, `kind?`, `sinceDate?` (null clears) | Not on a cancelled meeting. |
  | `cancelMeeting` | `ref` | Not on a held meeting (`M-4 is held`). |
  | `closeMeeting` | `ref` | Sets `held`. A held one fails with `M-4 is already held`, a cancelled one with `M-4 is cancelled`. Output: `MeetingRecord & { logged: { actions: number; decisions: number } }`, counted through the `projects.action` / `projects.decision` views by `meeting_id`. |
  | `setAttendees` | `meeting`, `people: string[]` | Replaces the set. Describe shows `+@x` / `−@y` in handle order. |
  | `addAgendaItem` | `meeting`, `text`, `project?`, `ask?`, `position?` | Default: at the end. A given position shifts the later ones down. |
  | `editAgendaItem` | `meeting`, `item: number`, `text?`, `project?` (null clears), `ask?` (null clears) | |
  | `moveAgendaItem` | `meeting`, `item`, `to` | Positions stay `1..n` without gaps. Out of range: `ValidationError` field `to`. |
  | `removeAgendaItem` | `meeting`, `item` | Positions are renumbered. |
  | `setNotes` | `meeting`, `markdown` | |

  Every write except `closeMeeting` and `cancelMeeting` refuses a cancelled meeting. Writes to a held meeting are allowed: notes are often finished after the meeting.
- **Read operation:** `sinceDate({ meeting, project }) → { since: string; source: "meeting" | "previous" | "default"; previous: { ref: string; title: string; date: string } | null }`. It is computed by `sinceFor(store, meeting, projectId)` in `since.ts`, following spec §8:
  1. the meeting's `since_date`;
  2. the date of the most recent earlier meeting with status `held` and an agenda item for that project. "Earlier" means a date before this meeting's, or the same date with a lower id;
  3. the meeting date minus 30 days.

  `previous` is filled whenever such a meeting exists, even when rule 1 wins. Task 6 uses it for `previousMeeting`.

- [ ] **Step 1: Write the failing tests** in `meetings.test.ts`, calling the ops through `kernel.ops` or `runCli` once Task 5 exists. Ops calls are fine here.
  - `addMeeting with attendees and projects creates agenda items`: the agenda is `[{position:1,text:"CRM replatforming status",project:"#CRM",ask:null}, …]` and the describe line is `+ meeting M-1 "Steering committee Q4" 2026-12-04`.
  - `edit, attendees and agenda change lines`: assert each exact change-set line from the Global Constraints table.
  - `agenda positions stay dense on add at a position, move and remove`.
  - `close and cancel rules`: close returns `logged: { actions: 1, decisions: 0 }` after one `projects.write.addAction({ title, meeting: "M-1" })`. Closing again fails with `M-1 is already held`. A cancelled meeting rejects `setNotes` with `M-2 is cancelled`, and cancelling a held one fails.
  - `the M- record type resolves and labels`: `ctx.records.resolve("M-1")` finds the meeting and its label is the title.
  - `sinceDate: own date, previous held meeting, default`.
  - `sinceDate ignores cancelled, planned and later meetings`, including the same-date, lower-id case.
  - `unknown attendee or project suggests`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(meetings): operations and the since rule`

---

### Task 5: `pm meeting …` CLI and the guide section

**Files:**
- Create: `src/plugins/meetings/logic/commands.ts`, `src/plugins/meetings/logic/guide.ts`, `src/plugins/meetings/logic/commands.test.ts`.
- Modify: `src/plugins/meetings/logic/index.ts`.

**Interfaces:**
- Produces these commands, following `people/logic/commands.ts` (flags, `formatTable`, `--json`):

  | Command | Notes |
  |---|---|
  | `pm meeting list [--all]` | Default: planned meetings and those held or cancelled in the last 30 days. Columns `ref date title kind status attendees projects`. |
  | `pm meeting show <M-n>` | Header, attendees, then the agenda as `1. text [CRM] — ask: …`, then the notes. |
  | `pm meeting add "<title>" --date <d> [--kind board\|steering\|other] [--attendees a,b] [--projects CRM,ERP] [--since <d>]` | Comma-separated lists, as in the spec example. |
  | `pm meeting edit <M-n> [--title] [--date] [--kind] [--since <d>\|--no-since]` | |
  | `pm meeting cancel <M-n>` | |
  | `pm meeting close <M-n>` | Prints the change line, then `logged: 3 actions, 1 decision`, with singulars for 1. |
  | `pm meeting attendees <M-n> <a,b,…>` | Replaces the set. |
  | `pm meeting notes <M-n> [--file <path>\|-]` | Without a file: prints the notes. With `-`: reads stdin. |
  | `pm meeting agenda <M-n> add "<text>" [--project CRM] [--ask "…"] [--at <n>]` | |
  | `pm meeting agenda <M-n> edit <n> [--text] [--project\|--no-project] [--ask\|--no-ask]` | |
  | `pm meeting agenda <M-n> move <n> <to>` | |
  | `pm meeting agenda <M-n> remove <n>` | |
- Produces a `guideSection`: how to prepare a meeting (add it with `--projects`, set asks, `pm report board`) and how to turn meeting notes into actions and decisions (`pm action add … --meeting M-n`, `pm decision add … --meeting M-n`, then `pm meeting close`). Follow the tone of the existing sections.

Read `src/kernel/cli/` for how a nested verb (`agenda <M-n> add`) is registered. If the dispatcher has no nested verbs, register `agenda` as one command whose first positional is the meeting and second the sub-verb, and say so in the report.

- [ ] **Step 1: Write the failing tests** in `commands.test.ts`, with exact stdout and exit codes:
  - `meeting add, show and list`, using the spec §6 example `pm meeting add "Steering committee Q4" --date 2026-12-04 --kind steering --attendees peter,marie --projects CRM,ERP`;
  - `agenda add with project and ask, edit, move, remove`, including `pm meeting agenda M-1 add "Budget" --project CRM --ask "Release contingency"`;
  - `close prints what was logged`;
  - `cancelled meeting: writes exit 1 with the message`;
  - `notes from stdin`;
  - `pm guide includes the meetings section`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(meetings): pm meeting commands and guide section`

---

### Task 6: Board and minutes reports, and the `prep` / `report` reads

**Files:**
- Create: `src/plugins/meetings/logic/reports.ts`, `src/plugins/meetings/logic/reports.test.ts`.
- Modify: `src/plugins/meetings/logic/index.ts`.

**Interfaces:**
- Consumes: Task 1 `ctx.reports.run`, groups, text and dynamic titles; Task 2 `project-status` with `reference` / `previousMeeting`; Task 4 `sinceFor`.
- Produces `ctx.report({ id: "board", cliName: "board", params: { meeting }, title: (m) => \`${m.title} · ${m.date}\` })`. `prepare` resolves the meeting, which lets an unknown one exit 2. Its sections, in order:
  1. `Attendees`: columns `Name`, `Handle`. Empty: `No attendees.`
  2. `Agenda`: columns `#`, `Item`, `Project`, `Ask`. Empty: `No agenda yet.`
  3. One section `projects` returning an array. For each project the agenda covers, in agenda order and without repeats, it returns:
     - the sections of `ctx.reports.run("project-status", { project: code, since, reference: meeting.date, previousMeeting? })`, each with `group: "<CODE> <name> · since <since>"`;
     - an `Ask` section in the same group: columns `#` and `Ask`, one row per agenda item of that project with an ask. It is left out when there are none.
- Produces `ctx.report({ id: "minutes", cliName: "minutes", params: { meeting }, title: (m) => \`Minutes · ${m.title} · ${m.date}\` })`. Its sections:
  - `Attendees`;
  - `Notes`: `text` = the notes; empty: `No notes.`;
  - `Decisions`: columns `ID`, `Decision`, `Project`, `Date`;
  - `Actions`: columns `ID`, `Action`, `Owner` (`me` when empty), `Due`, `Project`.

  Decisions and actions are those whose `meeting_id` is the meeting, from the `projects.*` views, by id.
- Produces read operations:
  - `prep({ meeting }) → Array<{ position: number; text: string; project: string | null; ask: string | null; since: SinceResult | null; sections: ReportSectionResult[] }>`, one entry per agenda item, in order. Items without a project have `sections: []` and `since: null`. Items of the same project share one run.
  - `report({ meeting, kind: "board" | "minutes", format: "md" | "text" | "json" }) → { text: string; title: string }`. It renders through `ctx.reports.render`.

- [ ] **Step 1: Write the failing tests** in `reports.test.ts`.
  - **Board pack for the mockup meeting.** Seed the "Steering committee Q4" meeting on 2026-12-04 with:
    - attendees peter and marie;
    - agenda items `Minutes & open actions` (no project), `CRM status` (CRM, ask `Approve 2-week shift of design milestone`) and `AOB`;
    - an earlier held meeting `SteerCo Q3` on 2026-10-28 covering CRM;
    - CRM's health, one milestone, one high risk, and one overdue action linked to the earlier meeting.

    Assert the exact Markdown of `pm report board M-2`:
    - `# Steering committee Q4 · 2026-12-04`;
    - the attendees and agenda tables;
    - `## CRM CRM replatforming · since 2026-10-28`;
    - `### Health` … `### Actions` (the action with Why `previous meeting`);
    - `### Ask`.
  - `board pack of a meeting without projects`: only Attendees and Agenda.
  - `minutes list notes, decisions and actions linked to the meeting`.
  - `prep gives one entry per agenda item; items of one project share the sections`.
  - `report board --format json keeps groups and marks`.
  - `unknown meeting exits 2`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(meetings): board and minutes reports from project-status sections; prep and report reads`

---

### Task 7: TUI kernel: `<ReportSections>`, `writeExport`, `copyText`

**Files:**
- Create: `src/kernel/tui/components/ReportSections.tsx`, `src/kernel/tui/export.ts`, `src/kernel/tui/report-sections.test.tsx`, `src/kernel/tui/export.test.ts`.
- Modify: `src/kernel/tui/api.ts`.

**Interfaces:**
- Produces `ReportSections(props: { sections: ReportSectionResult[]; skipColumns?: string[] })`. It renders each section as:
  - its title in `theme.accent`;
  - one line per row: `<icon> ` (when the mark has one) followed by the row's cells in column order without the `skipColumns`, empty cells left out, joined with ` · `, coloured with `toneColor(mark.tone)`;
  - the `empty` text muted when there are no rows;
  - `text` as plain lines;
  - `note` muted.

  Lines truncate by display width with `…`. A section with a `group` gets the group as a bold line once, before its first section. The component takes no keys and sits in a `scrollbox` the caller provides.
- Produces, in `export.ts`:
  - `writeExport(fileName: string, text: string): Promise<string>`. It writes to `runtime.config.exportDir` (create the folder recursively) and returns the absolute path. `fileName` must match `/^[A-Za-z0-9._-]+$/`; otherwise it throws `ValidationError("invalid export file name")`. It overwrites.
  - `copyText(text: string): boolean`. It calls the renderer's `copyToClipboardOSC52(text)` and returns its result. Get the renderer the way `Editor.tsx` / `external.ts` reach it. If it is only reachable inside components, make it a hook `useCopyText(): (text) => boolean`, and name that in the report.
- Exports from `api.ts`: `ReportSections`, `writeExport` (or `useWriteExport`), `copyText` (or `useCopyText`), and the types `ReportSectionResult` and `Mark`.

- [ ] **Step 1: Write the failing tests.**
  - `ReportSections draws marks, tones, groups and empty texts`: assert `frame()` lines such as `✓ MS-1 · Solution outline approved · 2026-10-14`, and the colours through `spans()`.
  - `writeExport creates the folder, overwrites, refuses separators`: use a temp `PM_HOME`, write twice and read the file back; `a/b.md` and `../x.md` throw.
  - `copyText calls OSC 52`: spy on the renderer method.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test`, `bun typecheck` and `bash scripts/smoke-node.sh`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(tui): ReportSections, writeExport and copyText for plugins`

---

### Task 8: Meetings screen (5) and the meeting forms

**Files:**
- Create: `src/plugins/meetings/tui/index.tsx`, `forms.tsx`, `meetings-screen.tsx`, `meetings-screen.test.tsx`, `forms.test.tsx`.
- Modify: `src/plugins/tui.ts` (add `meetingsTui`).

**Interfaces:**
- Produces `ui.screen({ id: "meetings", title: "Meetings", slot: 5, component: MeetingsScreen, count })`. `count` is the number of planned meetings.
- Produces record forms, all following `people/tui/forms.tsx` (loader, `save()` → SubmitResult, edits send only changed fields):
  - **`("meeting","meeting")` MeetingForm**, titled `New meeting` / `Edit M-n`. Fields:
    - `title` text, required;
    - `date` date, required, initial today;
    - `kind` enum `steering`, `board`, `other`, required, initial `steering`;
    - `sinceDate` date;
    - `attendees` text, as space- or comma-separated `@handles`; initial: the current handles;
    - `projects` text (`#CRM #ERP`), new meetings only.

    On save:
    - the tags are split, and the `@` and `#` stripped, before `addMeeting`;
    - on edit, a changed `attendees` calls `setAttendees` after `editMeeting`, in the same `act`;
    - an unknown handle's error shows under `attendees`.
  - **`("meeting","agenda-item")` AgendaItemForm**, titled `New agenda item · M-n` / `Edit item n · M-n`. Fields: `text` text required, `project` record (project), `ask` longtext. It takes `recordRef: "M-n"` and, for an edit, `prefill.item: "<n>"`.
  - **`("meeting","attendees")` AttendeesForm**: one field, `attendees`, as above.

  Register MeetingForm first, so `nav.open` on a meeting without tabs falls back to it.
- **Screen.**
  - **Groups:**
    - `Upcoming · n`: status `planned`, by date then id. A planned meeting dated before today shows its date in red.
    - `Past · n`: held and cancelled, newest first, cancelled rows muted.
  - **Columns:**

    | id | Title | Width | Content |
    |---|---|---|---|
    | `ref` | Ref | 5 | |
    | `date` | Date | 10 | `Thu 4 Dec`: the weekday, then `shortDate` |
    | `title` | Title | grow | |
    | `kind` | Kind | 8 | |
    | `status` | Status | 9 | |
    | `att` | Att. | 4 | |
    | `projects` | Projects | 12 | codes joined by a space |

    Then `listId="meetings"`.
  - **Keys** (hints in this order):

    | Key | Action |
    |---|---|
    | Enter | open |
    | `n` | new |
    | `e` | edit |
    | `x` | close the selected planned meeting, after `confirm("Close M-n as held?")`; the status bar then shows `closed M-n: 3 actions, 1 decision` |
    | `Del` | cancel the selected planned meeting, after `confirm("Cancel M-n? It stays in the list as cancelled.")` |

  - **Selection** survives reloads and a return from the record, through the route's `selected` param, as in People.
  - **Empty state:** `No meetings yet. Press n to add one.`

- [ ] **Step 1: Write the failing tests.**
  - `opens on 5 with upcoming then past, cancelled muted`;
  - `a planned meeting in the past shows its date red`;
  - `n adds a meeting with attendees and projects; the agenda is created`;
  - `edit changes attendees through setAttendees`;
  - `unknown attendee shows under the field`;
  - `x closes after confirm and says what was logged`;
  - `Del cancels after confirm`;
  - `empty state`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test`, `bun typecheck` and `bash scripts/smoke-node.sh`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(meetings-tui): Meetings screen and meeting, agenda item and attendees forms`

---

### Task 9: Meeting record view: Agenda and Prep tabs

**Files:**
- Create: `src/plugins/meetings/tui/agenda-tab.tsx`, `agenda-list.tsx`, `prep-tab.tsx`, `meeting-tabs.test.tsx`.
- Modify: `src/plugins/meetings/tui/index.tsx`.

**Interfaces:**
- Produces `ui.recordTab("meeting", …)` for:
  - `agenda` "Agenda", order 10, count: agenda items;
  - `prep` "Prep", order 20.

  Task 10 adds `notes` (30) and `export` (40).
- Produces `AgendaList(props: { recordRef: string; onSelect(position: number | undefined): void; width?: number })`: the left-hand list used by Prep and Notes.
  - Rows `n. text`, then the project code muted.
  - Width 32 by default, or 24 when the terminal is narrower than 100 columns.
  - Below it: `Attendees` and the names, wrapped, then `+n` when they don't fit in two lines.
- Consumes:
  - Task 6 `prep` and `sinceDate`, through `rt.self().read`;
  - Task 7 `<ReportSections>`;
  - Task 8 forms;
  - projects' `ActionForm` / `DecisionForm`, through `overlay.openForm("action","action",{ prefill: { project, meeting } })` and `("decision","decision", …)` (Task 2 carries `meeting`).

**Agenda tab:**
- A header line: `Thu 4 Dec 2026 · steering · planned · 8 attendees`.
- A table:

  | id | Title | Width | Content |
  |---|---|---|---|
  | `pos` | # | 3 | |
  | `text` | Item | grow | |
  | `project` | Project | 8 | |
  | `ask` | Ask | grow | first line |

  Empty text: `No agenda yet. Press n to add an item.`
- Then the attendees.
- Keys:

  | Key | Action |
  |---|---|
  | `n` | add an item |
  | `e` | edit the selected item |
  | `J` / `K` | move it down / up (`moveAgendaItem`), the selection following it |
  | `Del` | remove it, after `confirm("Remove item n \"text\"?")` |
  | `p` | attendees form |
  | `x` | close the meeting, as on the screen |

**Prep tab:**
- `AgendaList` on the left, and a panel on the right titled `Prep · <project name>`.
  - The panel footer is the since text:
    - `since <previous title> <shortDate>` when the source is `previous`;
    - `since <shortDate> (set on the meeting)` for `meeting`;
    - `since <shortDate> (30 days before)` for `default`.
  - The panel body is `<ReportSections sections skipColumns={["Project","Name"]} />` in a scrollbox, then `Ask for this meeting` (accent) with the ask, or `—`.
  - An item without a project shows `No project on this item.` (muted), then the ask.
- Keys:

  | Key | Action |
  |---|---|
  | ↑↓ | select the item, in the list |
  | `e` | edit the selected item's ask, through AgendaItemForm |
  | `a` | add an action |
  | `D` | add a decision |
  | `x` | close |

  `a` and `D` pass the selected item's project (when it has one) and the meeting.
- Writes on a cancelled meeting are not offered: `n`, `e`, `a`, `D`, `J`/`K`, `Del` and `x` show `M-n is cancelled` and open nothing.

- [ ] **Step 1: Write the failing tests** in `meeting-tabs.test.tsx`, with the Task 6 seed:
  - `agenda tab lists items and attendees; n adds, e edits, J/K move, Del removes`, asserting positions in the DB;
  - `prep shows the selected project's sections with marks and the ask`: the frame contains `● amber`, `✓ ` or `○ ` milestone lines, `▲ R-`, `! A-` in red, `Ask for this meeting` and `since SteerCo Q3 28 Oct`;
  - `prep of an item without a project`;
  - `a in prep logs an action linked to the meeting and project`, checking `meeting_id` and `project_id` in the DB;
  - `D logs a decision`;
  - `prep at 80x24`: no throw; the agenda list and `Prep ·` are both visible; a long ask is cut with `…`;
  - `cancelled meeting: keys say so and open nothing`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(meetings-tui): meeting Agenda and Prep tabs`

---

### Task 10: Notes and Export tabs

**Files:**
- Create: `src/plugins/meetings/tui/notes-tab.tsx`, `src/plugins/meetings/tui/export-tab.tsx`.
- Modify: `src/plugins/meetings/tui/index.tsx`, `src/plugins/meetings/tui/meeting-tabs.test.tsx`, `src/plugins/projects/tui/actions-screen.test.tsx`.

**Interfaces:**
- Produces:
  - `ui.recordTab("meeting", { id: "notes", title: "Notes", order: 30, count })`, where the count is the actions plus decisions logged against the meeting;
  - `ui.recordTab("meeting", { id: "export", title: "Export", order: 40 })`.
- Produces `exportFileName(m: { date: string; title: string }, kind: "board" | "minutes"): string`, in `export-tab.tsx`. It returns `<date>-<slug>.md` for the board pack and `<date>-<slug>-minutes.md` for the minutes. The slug is:
  - the title lowercased;
  - with each run of characters other than `a-z0-9` replaced by `-`;
  - trimmed of `-`;
  - cut to 40 characters;
  - `meeting` when empty.

**Notes tab:**
- `AgendaList` on the left.
- On the right, a `Notes` panel with the notes as plain text in a scrollbox. Empty: `No notes yet. Press e to write them.`
- Below it, a `Logged in this meeting` panel: the actions (`A-n title · owner · due`) and decisions (`D-n title`) with this `meeting_id`, read through the `projects.action` / `projects.decision` views.
- Keys:

  | Key | Action |
  |---|---|
  | `e` | the built-in editor (`overlay.openEditor({ title: "Notes · M-n", initial, save: setNotes, draftKey: "notes:M-n" })`) |
  | `E` | `$EDITOR`, through `useEditExternal`, as the Context tab does |
  | `a` / `D` | as on Prep |
  | `x` | close |

**Export tab:**
- A header line: `Board pack` or `Minutes`, then the file name it will write, muted.
- The Markdown from `read.report({ meeting, kind, format: "md" })`, as plain lines in a focused scrollbox (↑↓ / PgUp / PgDn scroll).
- **Which document:**
  - the default kind is `board` while the meeting is `planned`, and `minutes` once it is `held` or `cancelled`;
  - `m` switches between them.
- Keys:
  - **`w`:** `writeExport(exportFileName(…), text)`, then `notify("wrote <path>")`.
  - **`y`:** `copyText(text)`. The status bar then shows `copied to clipboard` when it returns true, or `the terminal did not accept the copy (OSC 52)` (error) when it returns false.

**Projects:** the Actions screen's For / from column shows the meeting title for an action linked to a meeting. It has done so since phase 2, once `meetings.meeting` exists. Pin it with a test.

- [ ] **Step 1: Write the failing tests.**
  - `notes tab shows notes and what was logged; e edits through the editor and saves`;
  - `export tab shows the board pack before and the minutes after closing; m switches`;
  - `w writes <date>-<slug>.md under exportDir and says where`, read back from disk;
  - `export slug`: `exportFileName({ date: "2026-12-04", title: "SteerCo Q4: CRM/ERP 🚀" }, "board")` is `2026-12-04-steerco-q4-crm-erp.md`; the minutes variant ends `-minutes.md`; a title of only emoji gives `2026-12-04-meeting.md`;
  - `y copies through OSC 52 and says so`, with a spy;
  - in `actions-screen.test.tsx`: `an action from a meeting shows the meeting title`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test`, `bun typecheck` and `bash scripts/smoke-node.sh`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(meetings-tui): Notes and Export tabs`

---

### Task 11: Docs and final checks

**Files:**
- Modify:
  - `docs/architecture.md`: the meetings plugin in the layout, embeddable reports, `ReportSections`, `writeExport` and `copyText`;
  - spec §8 and §9: the Meetings row and the Export tab, as built (board pack before, minutes after, `m`);
  - plugin reference §3 (as built) and §2 (project-status params and marks);
  - `CLAUDE.md` ("How it's wired": meetings in the built-in list);
  - `README.md`, if it lists the plugins or commands;
  - `docs/superpowers/plans/2026-11-13-pm-phase1-followups.md`: a "Phase 4 (Meetings)" section with this plan's rulings and the deferred minors from the task reviews.

- [ ] **Step 1:** Update the docs above, describing behaviour as built.
- [ ] **Step 2: Run** `bun test`, `bun typecheck` and `bash scripts/smoke-node.sh`. Expected: all pass; `tui ok`; last line `smoke ok`.
- [ ] **Step 3: Walk through by hand** in a pty, at 120×30 and 80×24, with a scratch `PM_HOME` seeded through the CLI:
  1. `pm meeting add … --projects`;
  2. `pm report board M-1`;
  3. then in the TUI: `5`, Enter, the four tabs, `a` in Prep, `x`, Export `m`, `w`, `q`.

  Report what was seen, and what could not be checked.
- [ ] **Step 4: Commit:** `docs: meetings (phase 4)`

---

## Rulings made in this plan (review these)

- **M1. Prep look: generic drawing with row hints** (agreed with the user, option C). Reports gain optional per-row `marks` (icon and tone). Projects marks its sections, so the Prep tab looks like the mockup, and a later plugin's sections still show. Cost: one optional field in the report contract (`apiVersion` 1, additive).
- **M2. The board pack embeds projects' `project-status` report through `ctx.reports.run`**, instead of meetings formatting projects data itself, so other plugins' sections appear too (spec §8 "assembled from reportSections"). This needs:
  - a section that returns several sections;
  - `group` headings;
  - a title that depends on the params.

  Cost: four small additive kernel changes.
- **M3. Export tab** (agreed with the user): it shows the board pack while the meeting is planned and the minutes once it is held, and `m` switches.
- **M4. The file name is fixed.** It is `<exportDir>/<date>-<slug>.md` (spec §8), not "a file you choose" (mockup). A second export overwrites it. Cost: no way to keep two versions, short of renaming the file by hand.
- **M5. Copy uses OSC 52 only.** The web-terminal spike found that ttyd 1.7.7 ignores OSC 52, so `y` reports when the terminal refuses. Container download is phase 6. Cost: `y` doesn't work in the browser terminal yet.
- **M6. Attendees and projects in the meeting form are tag text** (`@peter @marie`, `#CRM #ERP`), because the form has no multi-select. The CLI takes comma-separated lists. Cost: there is no autocomplete in those two fields.
- **M7. Agenda items are addressed by meeting and position** (`pm meeting agenda M-4 edit 2`), as in the spec's CLI. They get no record type or ref. Cost: a later plugin cannot link to one agenda item.
- **M8. Held meetings stay writable** (notes are often finished afterwards), and cancelled ones are read-only. There is no reopen. Cost: a meeting closed by mistake can't be reopened in this phase.
- **M9. `quickAction` is not built.** The plugin reference's `x` and `w` are plain keys on the meeting screen and tabs. The `quickAction` extension point remains phase 5's. Cost: none for the user.
- **M10. No Meetings tab on the project record**, as in the plugin reference ("left out for now").
- **M11. The meeting kind defaults to `other` on the CLI** and to `steering` in the TUI form, the most common case in the mockup. Cost: one default to change.
