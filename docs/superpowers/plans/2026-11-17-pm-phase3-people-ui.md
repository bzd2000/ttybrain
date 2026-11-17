# pm phase 3: the People UI. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are `pm-developer`, reviewers `pm-reviewer` (`.claude/agents/`).

**Goal:** screen `3` People in the TUI. It has:
- the All / Stakeholders / Team list with its sorts, filter and archived toggle;
- a detail panel for the selected person;
- a person record view with Summary, Notes, Goals, Projects & roles and Actions tabs;
- forms for people, notes and goals;
- "process by hand" from the Inbox into a note.

**Architecture:**
- **No new tables and no new operations.** Phase 1 already has every people write: `addPerson`, `editPerson`, `archivePerson`, `restorePerson`, `addNote`, `editNote`, `deleteNote`, `addGoal`, `editGoal` and `setGoalStatus`.
- **The people plugin's tui part** (`src/plugins/people/tui/`) adds:
  - the screen, the detail panel and its own record tabs;
  - its forms.
- **The projects plugin's tui part** adds the two person tabs it owns (plugin reference §2): Projects & roles, and Actions.
- **One kernel change:** an optional `when` on `recordTab`, so a tab can be hidden for some records. The Goals tab uses it to show only on team members.

**Tech Stack:** Bun ≥ 1.3.14 (CI 1.4.4) and Node ≥ 26.4, OpenTUI 0.8.4 + Solid 1.9, Kysely 0.28.18, TypeBox 1.4.3, `bun test` with `renderTui`.

**Spec:**
- `docs/superpowers/specs/2026-11-13-pm-design.md` ("spec"): §4 People, §9 (the People row of the screens table, keys, forms, long text) and §13 item 3;
- `docs/superpowers/specs/2026-11-13-pm-plugins.md` ("plugin reference"): §1 `people` and the person rows of §2 `projects` "UI and other contributions";
- `docs/superpowers/specs/2026-11-13-pm-screens.html`, section "3 People" (the mockup; where it differs from the spec, the spec wins);
- `docs/architecture.md`, "The TUI": the rules every task follows;
- the decisions agreed with the user on 2026-11-17, written into the tasks below and listed under "Rulings".

## Global Constraints

- **Runtimes.** Both runtimes always. Relative imports stay extensionless. `bash scripts/smoke-node.sh` must still print `tui ok` and end with `smoke ok`.
- **UI imports.** Only `src/kernel/tui/` and `src/plugins/*/tui/` may import `solid-js` or `@opentui/*`. Plugins' tui parts import kernel things only from `src/kernel/tui/api.ts`, and logic things only from their own plugin's `logic/`.
- **TUI data access.** Reads go only through `rt.data` (the plugin's own tables plus published views) and `rt.self().read` / `rt.use(x).read`. Writes go only through `act(() => rt.self().write.*)`. People reads projects data only through the `projects.*` views, never projects' tables or files. A missing view (`ViewUnavailableError`) means "nothing to show", not an error. Use the existing `unlessUnavailable` in `people/logic/records.ts`.
- **Keys.**
  - Take keys only with `useScreenKeys`, and claim one with `key.preventDefault()`.
  - Single-letter keys are off while a text field has focus.
  - Forms: Enter is a new line in a multi-line field and does nothing elsewhere; Tab / Shift+Tab change field; Ctrl+S or Esc `s` saves; Esc alone cancels.
  - Record props are `recordRef`, never `ref`.
- **No clock reads** (`new Date()`, `Date.now()`) in TUI or logic code: use `useToday()` / `rt.clock.today()`.
- **Colours** come only from `theme` / `toneColor`. The "last contact" warning is `amber`, overdue is `red`, muted text is `muted`.
- **Dates in the TUI:** `shortDate` (`10 Nov`), `dueLabel` (`Fri`, `13 Nov`, `-3d` overdue), ISO in forms. Days since contact show as `<n>d`, or `never` (muted) when a person has no notes.
- **Tests.**
  - TUI tests use `renderTui(kernel, { parts, width, height, … })` on `makeTestKernel` with the fixed clock **2026-11-13** (a Friday).
  - Seed data through write ops inside `runWithContext(kernel.context())`.
  - Assert on `frame()` text and on database state, wait on frame conditions rather than fixed sleeps, and call `destroy()` in `finally`.
  - Working patterns: `src/plugins/projects/tui/projects-screen.test.tsx` and `project-detail.test.tsx`.
- **Commits.** Each task ends with one commit using the message given, followed by a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A person who is both team and stakeholder.**
   - All tab: they appear once, in the Stakeholders group.
   - Team tab: they appear as well.
   - Both tab counts include them.
   - Their record view shows the Goals tab.

   Owner: Task 3 `a person who is both shows once in All and in both other tabs`; Task 5 `Goals tab only for team members`.
2. **A stakeholder with no notes yet.**
   - Last shows `never`.
   - They count as not contacted: amber when their influence is high.
   - They sort before every dated contact of the same influence.
   - The Overview's "Stakeholders to contact" panel agrees with the screen.

   Owner: Task 1 `never-contacted sorts first and is stale`, and `stale boundary is staleContactDays or more`.
3. **An 80×24 terminal.**
   - The People screen shows the list without the detail panel and does not throw.
   - At 120×30 the panel is there.
   - Long names and roles truncate with `…`.

   Owner: Task 4 `panel hidden below 110 columns`.
4. **An archived person.**
   - Hidden from all three tabs until `A`; then in an `Archived · n` group.
   - Their record view says `archived`.
   - `n` (note) on them shows `@x is archived — press r to restore` in the status bar and opens no form.
   - `r` restores them.

   Owner: Task 3 `archived people only after A, r restores`.
5. **Turning a stakeholder into a team member** in the person form.
   - Changing Type from `stakeholder` to `team` while Influence still says `high` saves, and influence and interest end up cleared: `editPerson` clears them, and the form does not resend the unchanged values.
   - Setting Influence on a `team` person shows `influence and interest are for stakeholders only` under the Influence field.

   Owner: Task 2 `type change to team clears influence`, `influence on a team member shows under the field`.

---

## File structure

```
src/kernel/tui/
  types.ts                    RecordTabDef + when?(recordRef): Promise<boolean>         (Task 5)
  components/RecordView.tsx   leaves out tabs whose `when` resolves false               (Task 5)
src/plugins/people/
  logic/records.ts            makeStore(ctx: PluginRuntime) (was PluginContext)         (Task 1)
  logic/ops.ts                staleStakeholders uses isStale (≥ days)                   (Task 1)
  logic/stale.ts              isStale(lastContact, today, days)                         (Task 1)
  tui/index.tsx               screen, forms, tabs, the existing overview panel          (Tasks 2–6)
  tui/people-list.ts          rows, sorts, filter, tab groups (no Solid)                (Task 1)
  tui/people-list.test.ts                                                               (Task 1)
  tui/forms.tsx               PersonForm, NoteForm, GoalForm                            (Task 2)
  tui/forms.test.tsx                                                                    (Task 2)
  tui/people-screen.tsx       the People screen (slot 3)                                (Task 3)
  tui/people-screen.test.tsx                                                            (Tasks 3, 4)
  tui/person-detail.tsx       <PersonDetail>: the panel and the Summary tab's body       (Task 4)
  tui/person-tabs.tsx         Summary, Notes, Goals tabs                                (Task 5)
  tui/person-tabs.test.tsx                                                              (Task 5)
src/plugins/projects/tui/
  person-projects.tsx         person tab "Projects & roles"                             (Task 6)
  person-actions.tsx          person tab "Actions"                                      (Task 6)
  person-tabs.test.tsx                                                                  (Task 6)
  index.tsx                   registers the two person tabs                             (Task 6)
src/plugins/inbox/tui/process.tsx   note prefill: text and person                       (Task 2)
```

---

### Task 1: List logic: rows, sorts, filter, groups, and one stale rule

**Files:**
- Create: `src/plugins/people/logic/stale.ts`, `src/plugins/people/tui/people-list.ts`, `src/plugins/people/tui/people-list.test.ts`
- Modify: `src/plugins/people/logic/records.ts` (`makeStore` parameter type), `src/plugins/people/logic/ops.ts` (`staleStakeholders`), `src/plugins/people/logic/people.test.ts`

**Interfaces:**
- Produces, in `logic/stale.ts`, re-exported from nowhere else (tui imports it from `../logic/stale`):
  `isStale(lastContact: string | null, today: string, days: number): boolean`. True when `lastContact` is null, or when `daysBetween(lastContact, today) >= days`.
- Produces, in `tui/people-list.ts`:
  - `type PersonRow = PersonRecord & { projects: string[] }`, where `projects` is the sorted project codes from `store.projectsOfPeople`;
  - `type PeopleTab = "all" | "stakeholders" | "team"`;
  - `type SortMode = "influence" | "contact" | "name"`;
  - `SORTS: SortMode[] = ["influence", "contact", "name"]` (the order `o` cycles through);
  - `SORT_LABELS: Record<SortMode, string>`:

    | Mode | Label |
    |---|---|
    | `influence` | `"influence, then last contact"` |
    | `contact` | `"last contact"` |
    | `name` | `"name"` |

  - `roleText(p: PersonRow): string`: `[job_title, organisation]` without the empty ones, joined with `", "`;
  - `lastText(p: PersonRow, today: string): string`: `"never"` or `"<n>d"`;
  - `lastTone(p: PersonRow, today: string, days: number): Tone`:
    - `"amber"` when `p.is_stakeholder && p.influence === "high" && isStale(p.last_contact, today, days)`;
    - `"muted"` when `never`;
    - otherwise undefined;
  - `matchesFilter(p: PersonRow, filter: string): boolean`;
  - `sortPeople(rows: PersonRow[], mode: SortMode, group: "stakeholders" | "team" | "other"): PersonRow[]`;
  - `peopleGroups(rows: PersonRow[], tab: PeopleTab, mode: SortMode, archived: boolean): Array<{ title: string | undefined; rows: PersonRow[] }>`;
  - `tabCounts(rows: PersonRow[]): Record<PeopleTab, number>` (non-archived only).
- Consumes: `PersonRecord` (`people/logic/schema.ts`), `daysBetween` (`kernel/dates`; the tui file gets it from `kernel/tui/api`, while `logic/stale.ts` imports it from `kernel/api`). If `kernel/api` does not export `daysBetween`, add the export there.

Rules the tests pin:
- **Sort `influence`.**
  - Stakeholders group: high, then low, then not set. Within that, oldest contact first, with `never` before any date. Then by name.
  - Team and other groups: by name.
- **Sort `contact`:** every group oldest contact first (`never` first), then by name.
- **Sort `name`:** by name, case-insensitive (`localeCompare` with `sensitivity: "base"`).
- **Filter.** Whitespace-separated terms, all of which must match, case-insensitive:
  - `infl:high|low|none` and `int:high|low|none`;
  - any other term matches as a substring of the name, the handle, `roleText` or a project code.
- **`peopleGroups`:**
  - **`all` tab:** groups `Stakeholders` (everyone with `is_stakeholder`, team members included), `Team` (team members who are not stakeholders) and `Other` (neither). Empty groups are left out.
  - **`stakeholders` and `team` tabs:** one untitled group (title `undefined`) holding the people with that flag.
  - **Archived people** are left out unless `archived` is true. Then a final `Archived` group holds the archived people the tab would otherwise show. On the `all` tab that is every archived person, sorted by name.

- [ ] **Step 1: Write the failing tests** in `people-list.test.ts`. They are pure: build `PersonRow` objects with a small `person({...})` helper and need no kernel. Each test asserts exact arrays of `handle`s.
  - `sort influence: high before low before unset, then oldest contact, never first`: stakeholders marie (high, 2026-10-03), luc (high, never), peter (high, 2026-11-11), nadia (low, 2026-09-14) and ingrid (not set, 2026-11-01). Expect `["luc", "marie", "peter", "nadia", "ingrid"]`.
  - `sort contact and sort name`: the same rows give `["luc","nadia","marie","ingrid","peter"]` and `["ingrid","luc","marie","nadia","peter"]`.
  - `team group sorts by name under influence`.
  - `a person who is both shows once in All and in both other tabs`: anna is team and stakeholder; bob is team only. Expect:
    - `all` groups: `[["Stakeholders",["anna"]],["Team",["bob"]]]`;
    - `team` tab: `[[undefined,["anna","bob"]]]`;
    - `tabCounts`: `{ all: 2, stakeholders: 1, team: 2 }`.
  - `archived only with the flag, in a last Archived group`.
  - `filter`: `infl:high` keeps only high; `int:none` keeps the unset ones; `crm` matches a project code; `cfo` matches a job title; `infl:high crm` needs both.
  - `lastText and lastTone`, with today `2026-11-13` and days `30`:
    - a high-influence stakeholder last seen `2026-10-14` (30 days) → `"30d"`, `"amber"`;
    - last seen `2026-10-15` → `"29d"`, undefined;
    - `never` → `"never"`, `"amber"` for a high-influence stakeholder and `"muted"` for a team member;
    - a low-influence stakeholder 60 days ago → undefined.
  - `roleText`: `"CFO, Finance"`, `"CFO"`, `""`.
- [ ] **Step 2: Add to `people.test.ts`.**
  - `never-contacted sorts first and is stale`: `staleStakeholders({ days: 30 })` lists a never-contacted high-influence stakeholder before a dated one.
  - `stale boundary is staleContactDays or more`: a note exactly 30 days before today is included at `days: 30`, and one 29 days before is not.

  Update any existing assertion in the `staleStakeholders` test that sits on the old strict boundary, and say which one in the report.
- [ ] **Step 3: Run** `bun test ./src/plugins/people/`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement.**
  - `isStale` in `logic/stale.ts`.
  - `staleStakeholders` filters with `isStale(p.last_contact, today(), i.days)` instead of its `cutoff` comparison, and keeps its sort.
  - `makeStore(ctx: PluginRuntime)` in `records.ts`: import the `PluginRuntime` type from `kernel/api`, and export it there if it isn't exported yet. Projects' `makeStore` already takes it.
  - Then `people-list.ts`.
- [ ] **Step 5: Run** `bun test` and `bun typecheck`. Expected: all pass, typecheck clean.
- [ ] **Step 6: Commit:** `feat(people-tui): list rows, sorts, filter and groups; one stale rule (≥ staleContactDays)`

---

### Task 2: Person, note and goal forms, and Inbox processing into a note

**Files:**
- Create: `src/plugins/people/tui/forms.tsx`, `src/plugins/people/tui/forms.test.tsx`
- Modify: `src/plugins/people/tui/index.tsx` (register the forms), `src/plugins/inbox/tui/process.tsx` (prefill), `src/plugins/inbox/tui/` tests for process

**Interfaces:**
- Produces three record forms, registered in this order inside `peopleTui.activate`. Each component takes `RecordFormProps`.
  - `ui.recordForm("person", { id: "person", label: "Person", component: PersonForm })`;
  - `ui.recordForm("note", { id: "note", label: "Note", component: NoteForm })`;
  - `ui.recordForm("goal", { id: "goal", label: "Goal", component: GoalForm })`.
- Later tasks open them with:
  - `overlay.openForm("person", "person", {})` (new) or `{ recordRef: "@peter" }` (edit);
  - `overlay.openForm("note", "note", { prefill: { person: "@peter" } })` (new) or `{ recordRef: "N-3" }` (edit);
  - `overlay.openForm("goal", "goal", { prefill: { person: "@anna" } })` or `{ recordRef: "G-2" }`.
- Consumes: `Form`, `FieldSpec`, `act`, `useQuery` and `useRuntime` from `kernel/tui/api`, plus `makeStore` (Task 1 signature). Follow `projects/tui/forms.tsx`:
  - a `With<Record>` loader;
  - `save()` → `SubmitResult` with `ok: "added <ref>"` / `"saved <ref>"`;
  - **an edit sends only the fields that changed**, and closes without a write when nothing changed;
  - `prefill` sets initial values by field name;
  - `origin` goes to `act`.

Fields. A field's `name` is the operation's input name, so a `ValidationError.field` lands under it.

| Form | Fields |
|---|---|
| **Person** (title `New person` / `Edit @handle`) | `name` text required · `handle` text (new: optional, empty lets `addPerson` make one; edit: initial is the handle) · `type` enum, required, values `stakeholder`, `team`, `both`, `other` (new: initial `stakeholder`) · `influence` enum `low`, `high` · `interest` enum `low`, `high` · `job_title` text · `organisation` text · `email` text · `phone` text. Pass `recordType="person"` (and `recordRef` on edit) so extra fields show. |
| **Note** (title `New note · @handle` when `prefill.person` is given, else `New note`; edit `Edit N-n`) | `person` record (person), required; left out when `prefill.person` is given or when editing · `kind` enum, required, values `interaction`, `one_on_one`; a new note's initial is `one_on_one` when the person is team and not a stakeholder, else `interaction` · `date` date, initial today · `project` record (project), initial from `prefill.project` · `text` longtext, required, initial from `prefill.text`. |
| **Goal** (title `New goal · @handle` / `Edit G-n`) | `person` record, required, left out as for notes · `title` text required · `target_date` date · `notes` longtext. |

Mapping to the operations:
- **Person type:** `stakeholder` → `{is_team:false,is_stakeholder:true}`, `team` → `{true,false}`, `both` → `{true,true}`, `other` → `{false,false}`. On edit, only a changed `type` sends the two flags.
- **Empty optional fields:** an emptied `influence`, `interest`, `job_title`, `organisation`, `email` or `phone` sends `null`. On add, empty ones are left out.
- **Note on add:** `addNote({ person, kind, text, date?, project? })`; on edit, `editNote({ ref, …changed })`, where an emptied project sends `project: null`.
- **Goal:** `addGoal({ person, title, target_date?, notes? })` / `editGoal({ ref, …changed })`. The goal status is not in the form (Task 5's keys set it).

Inbox (`process.tsx`): the prefill becomes `{ title, comment: title, text: title, project?, person? }`, where `person` is the item's first `@` link. The note form is then the menu's `n` choice. It already exists in `CHOICES` and picks up the new form through `useRecordForms("note")`.

- [ ] **Step 1: Write the failing tests** in `forms.test.tsx`. Open each form the way `src/kernel/tui/form.test.tsx` does (a test screen that captures `useOverlay()` and calls `overlay.openForm(…)`). Assert on the database after saving with Ctrl+S.
  - `new person: handle made from name, type stakeholder, influence high` → `@peter` exists with `is_stakeholder` 1 and influence `high`; the status bar shows `added @peter`.
  - `edit person sends only the changed fields`: change the job title only. The change line or op input has only `job_title`; check with a spy on `write.editPerson` or by asserting the `change_set` line `~ @peter job_title …`.
  - `type change to team clears influence`: a stakeholder with influence `high`, Type set to `team`, then save. Expect `is_team` 1, `is_stakeholder` 0, influence null, interest null.
  - `influence on a team member shows under the field`: a new person with Type `team` and Influence `high`. The frame shows `influence and interest are for stakeholders only` under Influence, the form stays open, and no row is added.
  - `new note for a prefilled person defaults kind by type`: for a team-only member the initial kind is `one_on_one`; for a stakeholder it is `interaction`. Typing text with Enter for a new line and saving gives a note dated `2026-11-13` with that multi-line text.
  - `edit note clears its project`.
  - `new goal and edit goal`.
  - In the inbox process test file, `process an item into a note prefills person and text`: item `@peter worried about #CRM budget`, then `p`, then `n`. The note form shows `worried about budget`, has no person field (the title says `@peter`) and has project `#CRM`. Saving creates the note, and the item is processed with summary `Note N-1`.
- [ ] **Step 2: Run** `bun test ./src/plugins/people/tui/forms.test.tsx`. Expected: FAIL (no forms).
- [ ] **Step 3: Implement** `forms.tsx` and the registrations, then the `process.tsx` prefill.
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(people-tui): person, note and goal forms; process an inbox item into a note`

---

### Task 3: The People screen (slot 3): tabs, list, keys

**Files:**
- Create: `src/plugins/people/tui/people-screen.tsx`, `src/plugins/people/tui/people-screen.test.tsx`
- Modify: `src/plugins/people/tui/index.tsx` (register the screen)

**Interfaces:**
- Produces: `ui.screen({ id: "people", title: "People", slot: 3, component: PeopleScreen, count })`. `count` is the number of non-archived people.
- Produces: `export const EMPTY = "No people yet. Press N to add one."` and `export const NO_MATCH = "No people match the filter."`.
- Consumes:
  - Task 1: `PersonRow`, `peopleGroups`, `tabCounts`, `SORTS`, `SORT_LABELS`, `roleText`, `lastText`, `lastTone`, `matchesFilter`;
  - Task 2: the forms;
  - `Tabs`, `Panel`, `Table` (`groups`, `listId`), `useNav`, `useOverlay`, `useQuery`, `useToday`, `useKeys`, `useScreenKeys`, `printable` and `act`.
- The rows load in one `useQuery`: `store.personQuery()` → `toPerson`, then `store.projectsOfPeople`.
- The stale threshold is `rt.config.staleContactDays`.

Screen:
- **Tabs row:** `All <n>`, `Stakeholders <n>`, `Team <n>` (from `tabCounts`). Switch with ←→ (the `Tabs` component) and with `a`, `s`, `t`.
- **Panel:** title `People · <n>`, where n is the rows shown in the current tab, archived excluded. Footer `sort: <SORT_LABELS[mode]>`. Under a filter the footer is `sort: … · filter: <text>`.
- **Table columns:**

  | id | Title | Width | Content |
  |---|---|---|---|
  | `name` | Name | 18 | |
  | `role` | Role | grow | `roleText` |
  | `projects` | Projects | 9 | codes joined by a space |
  | `infl` | Infl. | 5 | `high` / `low` / `—`; `low` muted |
  | `int` | Int. | 5 | as Infl. |
  | `last` | Last | 6 | `lastText`, tone `lastTone` |

  Then `listId="people"` for other plugins' columns. Group headers come from `peopleGroups` as `Stakeholders · n`, `Team · n`, `Other · n`, `Archived · n`.
- **Keys** (status bar hints in this order):

  | Key | Action |
  |---|---|
  | Enter | open the person (`nav.open(ref)`) |
  | `n` | note on the selected person |
  | `N` | new person |
  | `e` | edit the selected person |
  | `o` | next sort in `SORTS` |
  | `/` | filter (as on the Projects screen: Enter applies, Esc clears) |
  | `a` / `s` / `t` | tabs |
  | `A` | archived |
  | `Del` | archive the selected person after `overlay.confirm("Archive @x? They stay in the history and can be restored.")` |
  | `r` | restore the selected archived person (no confirmation) |
- The selection survives a reload and a return from the record view through the route's `selected` param, as on the Projects screen.
- A new person saved from `N` becomes the selection.
- `n` and `e` on an archived person open nothing and show `notify("@x is archived — press r to restore", "error")`.

- [ ] **Step 1: Write the failing tests** in `people-screen.test.tsx` at 120×30 unless stated. Seed with ops: three stakeholders (`marie` high/high with a note on 2026-10-03, `luc` high/low and `nadia` low/low with no notes), two team members (`anna`, who is also a stakeholder with no levels set, and `bob`), an involvement of marie on `#CRM` as `sponsor`, and `staleContactDays` 30 (the default).
  - `opens on 3 and lists stakeholders then team`: press `3`. The frame has `All 5`, `Stakeholders 4`, `Team 2`, `Stakeholders · 4` before `Team · 1`, and rows in the order luc, marie, nadia, anna (anna's influence is not set, so last), then bob. Assert the exact order of names in the frame.
  - `last contact shows days, never and amber`: marie's row has `41d`, and `spans()` gives it the amber colour. luc has `never`.
  - `o cycles the sort and the footer says which`.
  - `t and s switch tabs; a person who is both shows in both`.
  - `filter infl:high`.
  - `archived people only after A, r restores`: archive nadia with Del and confirm. She is gone and `All 4`. `A` shows `Archived · 1`. `n` on her shows `@nadia is archived — press r to restore`. `r` restores her. `restorePerson` ran, and the DB has `archived_at` null.
  - `N adds a person and selects it`; `e edits the selected person`.
  - `Enter opens the person and Esc comes back to the same row`: the breadcrumb shows `› @marie Marie Dubois`.
  - `empty database shows EMPTY`.
- [ ] **Step 2: Run** `bun test ./src/plugins/people/tui/people-screen.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `people-screen.tsx` and register it.
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(people-tui): People screen with tabs, sorts, filter and archived`

---

### Task 4: The detail panel: `<PersonDetail>`, next to the list

**Files:**
- Create: `src/plugins/people/tui/person-detail.tsx`
- Modify: `src/plugins/people/tui/people-screen.tsx`, `src/plugins/people/tui/people-screen.test.tsx`

**Interfaces:**
- Produces: `PersonDetail(props: { recordRef: string; rows?: number })`. It renders the person's sections with up to `rows` entries each (default 3); Task 5's Summary tab passes `rows={5}`. It takes no keys.
- Produces: `export const PANEL_MIN_WIDTH = 110`.
- Consumes: `store.person`, `rt.data` on the views `projects.involvement`, `projects.project` and `projects.action`, and on the plugin's own `note` and `goal` tables, all through `unlessUnavailable`. It also uses `useTerminalDimensions` from `@opentui/solid`.

What it shows (mockup "3 People", right-hand panel), as `Label  value` facts and then short lists. Each short list has a header in the accent colour and `—` when empty:
- **Facts:**
  - `Role`: `roleText`;
  - `Projects`: `CRM sponsor · ERP steerco`, as each involvement's code and role joined with ` · `;
  - `Influence`: `high · interest high`, stakeholders only, `—` for an unset level;
  - `Email`, `Phone`: only when set;
  - `Archived`: `yes`, only when archived.
- **Lists for a stakeholder:**
  - **Open follow-ups:** open actions with `for_person_id` = the person, by due date (no date last). Each shows the ref, the title and `dueLabel`, red when overdue.
  - **Interactions:** the latest notes of any kind, newest first, as `shortDate` and the text's first line.
- **Lists for a team member who is not a stakeholder:**
  - **Open actions:** open actions they own (`owner_id`);
  - **1:1 notes:** the latest `one_on_one` notes;
  - **Goals:** open goals by target date, each with the target as `dueLabel`.

  A person who is both gets the stakeholder sections and then Goals.

On the People screen:
- **Wide terminal** (`width >= PANEL_MIN_WIDTH`): the main area is a row. The list panel takes `flexGrow` 1.7 and a `Panel` titled with the selected person's name takes 1, holding `<PersonDetail recordRef={selected} />`.
- **Narrow terminal:** no panel.
- **Nothing selected:** the panel shows `Select a person.` (muted).

- [ ] **Step 1: Write the failing tests** in `people-screen.test.tsx`, with the Task 3 seed plus:
  - an open action `Send revised budget` for marie, due 2026-11-10;
  - a team note for bob (`one_on_one`, 2026-11-12, `Talked about training`);
  - an open goal for bob, `PM training 2027`.

  Tests:
  - `panel shows a stakeholder's facts, follow-ups and interactions` (120×30, marie selected):
    - the frame contains `CRM sponsor`, `high · interest high`, `Open follow-ups`, `Send revised budget` and `-3d` (red), `Interactions` and `3 Oct`.
  - `panel shows a team member's actions, 1:1 notes and goals` (select bob).
  - `panel hidden below 110 columns`:
    - at 80×24 the frame has the list (`Stakeholders · 4`) but not `Open follow-ups`, and a 40-character name is cut with `…`;
    - at 110×30 the panel is there.
  - `panel follows the selection` (↓ moves to the next person's facts).
- [ ] **Step 2: Run** the file. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `person-detail.tsx` and the split layout.
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(people-tui): detail panel for the selected person`

---

### Task 5: The person record view: Summary, Notes and Goals tabs; `recordTab.when`

**Files:**
- Modify: `src/kernel/tui/types.ts` (`RecordTabDef.when`), `src/kernel/tui/components/RecordView.tsx`, a kernel test next to the existing RecordView tests (`src/kernel/tui/blocks.test.tsx` or wherever `tabsFor` rendering is tested)
- Create: `src/plugins/people/tui/person-tabs.tsx`, `src/plugins/people/tui/person-tabs.test.tsx`
- Modify: `src/plugins/people/tui/index.tsx`

**Interfaces:**
- Produces (kernel): `RecordTabDef.when?: (recordRef: string) => Promise<boolean>`.
  - `RecordView` resolves every tab's `when` in the same query as the counts, and leaves out the tabs that resolve `false`.
  - A `when` that throws keeps the tab, so a broken check never hides data.
  - Until the first load, the tabs without `when` show.
  - A `route.tab` naming a hidden tab falls back to the first tab.
- Produces (people), as `ui.recordTab("person", …)`:

  | id | Title | Order | Count | Other |
  |---|---|---|---|---|
  | `summary` | Summary | 10 | | |
  | `notes` | Notes | 20 | number of notes | |
  | `goals` | Goals | 30 | open goals | `when`: the person `is_team` |

  Task 6 adds orders 40 and 50.
- Consumes: `PersonDetail` (Task 4), the forms (Task 2), `Table`, `Panel`, `overlay.openEditor({ title, initial, save, draftKey })`, `overlay.confirm`, `act`.

The tabs:
- **Summary:**
  - the header line `@handle · Team · Stakeholder` (the types the person has, `· archived` when archived);
  - then `<RecordFields recordType="person" recordRef>`;
  - then `<PersonDetail recordRef rows={5} />`.

  | Key | Action |
  |---|---|
  | `e` | person form |
  | `n` | note form |
  | `Del` | archive (same confirm text as Task 3) |
  | `r` | restore |
- **Notes:** a table with columns:

  | id | Title | Width | Content |
  |---|---|---|---|
  | `ref` | Ref | 6 | |
  | `date` | Date | 6 | `shortDate` |
  | `kind` | Kind | 11 | `1:1` / `interaction` |
  | `project` | Project | 8 | code |
  | `text` | Note | grow | first line |

  Rows are newest first, then by id descending. Empty text: `No notes yet. Press n to add one.`

  | Key | Action |
  |---|---|
  | `n` | new note (prefill person) |
  | `e` | note form |
  | Enter | the note's text in the built-in editor (`title: "Note N-n"`, `draftKey: "note:N-n"`), saving through `editNote({ ref, text })` |
  | `Del` | `overlay.confirm("Delete N-n?")`, then `deleteNote` |
- **Goals:** a table with columns `ref` (Ref, 6), `title` (Goal, grow), `target` (Target, 6, `dueLabel`, red when past and open) and `status` (Status, 9). Open goals come first by target date, then achieved, then dropped. Empty text: `No goals yet. Press n to add one.`

  | Key | Action |
  |---|---|
  | `n` | new goal |
  | `e` | edit |
  | `x` | `setGoalStatus` `achieved` on an open goal, `open` on an achieved or dropped one |
  | `d` | `dropped` |

- [ ] **Step 1: Write the failing tests.**
  - Kernel: `a tab whose when resolves false is left out, a throwing when keeps it`. Use the fixture plugin in `tests/fixtures/tui-fixture.ts` or a local `defineTui`.
  - `person-tabs.test.tsx`, seeded as in Task 4:
    - `Goals tab only for team members`: `@bob` shows `Goals 1`; `@marie` shows no `Goals`.
    - `summary shows the person and e edits`.
    - `notes tab lists newest first; n adds; Del deletes after confirm`.
    - `Enter edits a note's text in the editor and Ctrl+S saves it`.
    - `goals: x achieves, x again reopens, d drops`: assert `status` in the DB after each.
    - `archived person's summary says archived; r restores`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the kernel `when`, then `person-tabs.tsx` and the registrations.
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(people-tui): person record view with Summary, Notes and Goals; recordTab when`

---

### Task 6: Projects' person tabs: Projects & roles, and Actions

**Files:**
- Create: `src/plugins/projects/tui/person-projects.tsx`, `src/plugins/projects/tui/person-actions.tsx`, `src/plugins/projects/tui/person-tabs.test.tsx`
- Modify: `src/plugins/projects/tui/index.tsx`

**Interfaces:**
- Produces: `ui.recordTab("person", { id: "projects", title: "Projects & roles", order: 40, count, component: PersonProjects })` and `ui.recordTab("person", { id: "actions", title: "Actions", order: 50, count, component: PersonActions })`.
  - The Projects & roles count is the number of involvements.
  - The Actions count is the open actions owned by or for the person.
- Consumes:
  - projects' own `involvement`, `project` and `action` tables (through `makeStore` / `makeItems`), and `people.person` to turn `recordRef` (`@handle`) into the person id;
  - `InvolvementForm` (it already asks for the project when it has no `recordRef`, and takes `prefill.person`);
  - the action form (`openForm("action", "action", { prefill })`) and the existing action ops.

The tabs:
- **Projects & roles:** columns `code` (Project, 8), `name` (Name, grow), `role` (Role, 20) and `status` (Status, 8). Rows are ordered by code, then role. Archived projects show muted. Empty text: `No projects yet. Press n to add one.`

  | Key | Action |
  |---|---|
  | Enter | open the project |
  | `n` | `openForm("project", "involvement", { prefill: { person: recordRef } })` |
  | `Del` | `confirm("Remove @x as <role> from <CODE>?")`, then `removeInvolvement` |
- **Actions:** the actions where `owner_id` or `for_person_id` is the person. Open ones come first by due date (no date last); done and cancelled follow, newest `done_date` first.

  | id | Title | Width | Content |
  |---|---|---|---|
  | `ref` | Ref | 6 | |
  | `title` | Action | grow | |
  | `project` | Proj. | 6 | |
  | `as` | As | 5 | `owner` or `for` (both: `owner`) |
  | `due` | Due | 6 | `dueLabel`, red when overdue and open |

  Empty text: `No actions yet. Press n to add one.`

  | Key | Action |
  |---|---|
  | `n` | new action, prefilled `forPerson: recordRef` for a stakeholder, else `owner: recordRef` |
  | `e` | edit |
  | `x` | done, through the same op the project Actions tab uses for `x` |
  | Enter | open the action's project, when it has one |

- [ ] **Step 1: Write the failing tests** in `person-tabs.test.tsx`, with people and projects seeded.
  - `Projects & roles lists involvements; n adds one; Del removes it`.
  - `Actions lists owned and for, open first; x completes; n prefills for`: for stakeholder marie, the new action form shows `For` = `@marie`.
  - `tab order on a team member who is also a stakeholder`: the tabs row reads `Summary`, `Notes`, `Goals`, `Projects & roles`, `Actions`, in that order.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** both tabs and register them.
- [ ] **Step 4: Run** `bun test` and `bun typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(projects-tui): person tabs Projects & roles and Actions`

---

### Task 7: Docs and final checks

**Files:**
- Modify:
  - `docs/architecture.md` ("The TUI": `recordTab.when`; the People screen in the screens list);
  - spec §9 (the People row: the `o` sorts, `A` archived, `N` new, the panel below 110 columns, and the team-member panel as stacked sections, per ruling P3);
  - plugin reference §1 "UI and other contributions" (the screen, the tabs and `when`);
  - `docs/superpowers/plans/2026-11-13-pm-phase1-followups.md` (a "Phase 3 (People UI)" section with this plan's rulings and the deferred minors from the task reviews);
  - `CLAUDE.md`, only if a command or test pattern changed;
  - the comment at the top of `src/plugins/people/tui/index.tsx` ("Phase 2 has only…").

- [ ] **Step 1:** Update the docs above. Spec changes describe behaviour as built, in the spec's own style.
- [ ] **Step 2: Run** `bun test`, `bun typecheck` and `bash scripts/smoke-node.sh`. Expected: all pass, `tui ok`, last line `smoke ok`.
- [ ] **Step 3: Walk through by hand** in a pty (`script -qfc "bun start" /dev/null` with `PM_HOME` set to a scratch dir seeded with the CLI) at 120×30 and at 80×24. Check `3`, the tabs, `o`, `/`, Enter, the tabs of a team member, `n` then Ctrl+S, `Esc` and `q`. Note anything odd in the report.
- [ ] **Step 4: Commit:** `docs: People UI (phase 3)`

---

## Rulings made in this plan (review these)

- **P1. Groups dropped.** The mockup's "Sales key users · group · 6 people" row has no counterpart in the data model, so groups are not added. Cost if wrong: a later phase adds a group record type.
- **P2. Panel width.** The detail panel shows only at 110 columns and wider (`PANEL_MIN_WIDTH`). Below that, Enter on a person gives the same information. Cost: one constant to tune.
- **P3. Team members' panel uses sections, not tabs.** The mockup gives team members tabs inside the right-hand panel. Here it is stacked sections (Open actions, 1:1 notes, Goals), because:
  - the list has the keyboard;
  - ←→ already switch the All / Stakeholders / Team tabs;
  - Enter opens the record view, which has the same tabs.

  **This differs from the mockup you approved. Say so if you want real tabs in the panel.** Cost if wrong: a focus model for the panel (Tab to move into it).
- **P4. Keys on the People screen.**
  - `a` / `s` / `t` are the tabs (mockup), so archived moves to `A`.
  - `n` adds a note (mockup), so a new person moves to `N`.
  - Del archives after a confirmation, and `r` restores, because people are archived, never deleted (spec §4).

  Cost: a key-letter change.
- **P5. One stale rule, "staleContactDays or more"** (spec §9 "turns amber at staleContactDays", Overview "no note for staleContactDays or more"). `staleStakeholders` changes from strictly-more to `≥`, so the Overview panel and the screen agree. Cost: someone contacted exactly `staleContactDays` ago now appears in the panel.
- **P6. "Role" is the job title and organisation** (`CFO, Finance`), not the project roles, which have their own `Projects` fact and tab. Cost: none.
- **P7. Person type as one enum.** The form has `stakeholder` / `team` / `both` / `other` instead of two yes/no fields, because the form has no checkbox kind. Cost: none; the CLI keeps its flags.
- **P8. Note kinds show their raw values** (`one_on_one`, `interaction`) in the form, as on the CLI. Tables show `1:1`. Cost: cosmetic.
- **P9. `recordTab.when` is a new, additive extension-point option** in `apiVersion` 1, used by the Goals tab (plugin reference: "Goals (team members only)"). Cost: one more option to keep stable for external plugins.
- **P10. Goal status keys.** `x` toggles achieved / open and `d` drops. There is no goal delete, because no operation exists for it. Cost: none.
