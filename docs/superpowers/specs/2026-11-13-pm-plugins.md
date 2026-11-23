# ttybrain: built-in plugin reference

Companion to [`2026-11-13-pm-design.md`](2026-11-13-pm-design.md). That document defines the kernel and the plugin API (§3); field rules and enum values are in its §4. This document says, for each plugin in the current scope, what it owns, what it exposes and what it adds to the UI.

**Notation**
- Table names are the short names a plugin uses. Physically they're `<plugin>_<table>` (design §3.3.1).
- Every table also has `id`, `created_at` and `updated_at`.
- `→ x` marks a reference to a record of type `x`. **(soft)** means the record belongs to another plugin, and the reference is resolved through its record type, never joined.
- **Cross-plugin reads** mostly use **published views** (design §3.3.3), queried as `<plugin>.<view>` in `ctx.data`.
- **Read operations** are kept only for reads with logic. **Write operations** handle every change.
- Operations are called as `ctx.use("<plugin>").read.<op>(input)` or `.write.<op>(input)`.
- **Logic and TUI parts** (design §3.1). In each plugin below, *Data*, *Published views*, *Exposed operations*, *CLI* and the logic-side contributions (`tagType`, `report`, `reportSection`, `guideSection`, `assistantProvider`) belong to `src/plugins/<id>/logic/`. Screens, tabs, panels, columns, global actions, badges and quick-action menus belong to `src/plugins/<id>/tui/`.
- Every exposed operation and every published view is also an assistant tool (design §3.3.2–3.3.3), unless it's marked *no tool*.

## Overview

```
                   ┌──────────┐
                   │  people  │◄──────────────┐
                   └────▲─────┘               │ requires
                        │ requires            │
                   ┌────┴─────┐          ┌────┴─────┐
                   │ projects │◄─────────│ meetings │
                   └──────────┘ requires └──────────┘

   ┌──────────┐ requires ┌──────────┐
   │ actions  │◄─────────│ meetings │   (actions requires nothing; it reads
   └──────────┘          └──────────┘    people, projects, meetings softly)

   ┌──────────┐    ┌───────────┐    (no requires: both work through kernel
   │  inbox   │    │ assistant │     registries: tags, record types, tools,
   └──────────┘    └───────────┘     provenance)
```

| Plugin | Requires | Reads views of | Record types (display prefix) | Screens (key) |
|---|---|---|---|---|
| `people` | — | projects, actions | `person` (`@handle`), `note` (`N-`), `goal` (`G-`) | People (3) |
| `projects` | `people ^1` | people, meetings (`^2`), actions | `project` (`#CODE`), `milestone` (`MS-`), `deliverable` (`D-`), `risk` (`R-`), `decision` (`DE-`) | Projects (2) |
| `actions` | — | people, projects, meetings (`^2`) | `action` (`A-`) | Actions (4) |
| `meetings` | `projects ^2`, `people ^1`, `actions ^2` | people, projects, actions | `meeting` (`M-`), `series` (`S-`), `talk_item` (`T-`), `agenda_item` (no prefix) | Meetings (5) |
| `inbox` | — | — | `inbox_item` (`I-`) | Inbox (6) |
| `assistant` | — | all (as tools) | — | — (side pane) |

The **kernel** provides:
- the Overview screen (1), filled entirely by `overviewPanel`s;
- the frame, switcher, help overlay and change-set review;
- these registries: record types, tags, reports, provenance, tools and the guide;
- the `ttybrain plugin …` and `ttybrain guide` commands.

---

## 1. `people`

Who you work with: your team and your stakeholders, your notes about them, and your team members' goals.

### Data

| Table | Columns |
|---|---|
| `person` | `handle` (unique), `name`, `organisation`, `job_title`, `email`, `phone`, `is_team`, `is_stakeholder`, `influence` (low/high), `interest` (low/high), `archived_at` |
| `note` | `person_id → person`, `project_id → project` **(soft)**, `kind` (one_on_one/interaction), `date`, `text` (Markdown) |
| `goal` | `person_id → person`, `title`, `target_date`, `status` (open/achieved/dropped), `notes` |

### Published views

| View | Columns |
|---|---|
| `people.person` | id, handle, name, organisation, job_title, email, is_team, is_stakeholder, influence, interest, `last_contact` (computed from notes), archived |
| `people.note` | id, person_id, project_id, kind, date, text |
| `people.goal` | id, person_id, title, target_date, status |

It reads `projects.involvement` and `projects.project` (optional) for the **Projects** column on the People screen and on the "Stakeholders to contact" panel.

### Exposed operations

| Read (with logic) | Input | Returns |
|---|---|---|
| `staleStakeholders` | `days`, `limit?`, `influence?` | stakeholders with no note for `days` (only those of `influence` when given), high influence first, with their projects |

| Write | Input | Change-set line |
|---|---|---|
| `addPerson` | name, `handle?`, flags, fields | `+ person @anna "Anna Peeters" (team)` |
| `editPerson` | `ref`, changed fields | `~ @peter influence low → high` |
| `archivePerson` / `restorePerson` | `ref` | `~ @peter archived` |
| `addNote` | `person`, `kind`, `text`, `date?`, `project?` | `+ note on @peter (interaction, CRM)` |
| `editNote` / `deleteNote` | `ref`, … | `~ N-12 text` / `- N-12` |
| `addGoal` / `editGoal` / `setGoalStatus` | … | `+ goal for @sofie "PM training 2027"` |

### CLI

```
ttybrain person list|show|add|edit|archive|restore
ttybrain note   list|add|edit|delete
ttybrain goal   list|add|edit|done|drop
```

### UI and other contributions

| Extension point | What |
|---|---|
| `screen` | **People** (3): All / Stakeholders / Team tabs (`a` `s` `t`), sorts (`o`), filter (`/`: `infl:`, `int:`, text), archived (`A`, Del, `r`), new person (`N`), new note (`n`); a detail panel from 110 columns (sections for team members) |
| `recordTab` on `person` | **Summary**, **Notes**, **Goals** (team members only, through the `when` option) |
| `recordForm` | `person`, `note`, `goal` |
| `overviewPanel` | **Stakeholders to contact** (high influence only, uses `staleContactDays`) |
| `tagType` | `@handle` → person |
| `listColumn` | — (People columns are its own) |
| `guideSection` | how to record 1:1s and stakeholder interactions |

**Events emitted:** `person.changed`, `note.added` (phase 2+; not emitted yet — use `record.changed`).

---

## 2. `projects`

The portfolio, and everything you follow up per project: health, milestones, deliverables, risks and issues and decisions. (Actions are the `actions` plugin's, §2a; they were part of `projects` until its 2.0.) It also owns **involvement**, meaning who plays which role on which project.

### Data

| Table | Columns |
|---|---|
| `project` | `code` (unique, 2–16 `A-Z`/`0-9`), `name`, `description`, `context` (Markdown), `context_updated_at`, `status` (active/on_hold/closed), `start_date`, `end_date`, `effort_estimate_days`, `effort_note`, `archived_at` |
| `health_update` | `project_id → project`, `date`, `health` (green/amber/red), `comment` |
| `milestone` | `project_id → project`, `title`, `due_date`, `done_date` |
| `deliverable` | `project_id → project`, `title`, `owner_id → person` **(soft)**, `due_date`, `status` (not_started/in_progress/in_review/delivered), `milestone_id → milestone`, `delivered_date`, `status_changed_at` |
| `risk` | `project_id → project`, `type` (risk/issue), `title`, `description`, `severity` (low/medium/high), `owner_id → person` **(soft)**, `mitigation`, `status` (open/closed), `closed_date` |
| `decision` | `project_id → project` (optional), `date`, `title`, `description`, `decided_by`, `meeting_id → meeting` **(soft)** |
| `involvement` | `project_id → project`, `person_id → person` **(soft)**, `role`; unique (project, person, role) |

`projects` requires `people` and stores person IDs as soft references. It validates them on every write and shows names by joining `people.person`, never the internal `person` table.

### Published views

| View | Columns |
|---|---|
| `projects.project` | id, code, name, description, status, start_date, end_date, effort_estimate_days, `health`, `health_comment`, `health_date` (latest update), `next_milestone_title`, `next_milestone_due`, `open_risks`, archived |
| `projects.health_update` | id, project_id, date, health, comment |
| `projects.milestone` | id, project_id, title, due_date, done_date, `late` |
| `projects.deliverable` | id, project_id, title, owner_id, due_date, status, status_changed_at, milestone_id |
| `projects.risk` | id, project_id, type, title, severity, owner_id, status, closed_date |
| `projects.decision` | id, project_id, date, title, decided_by, meeting_id |
| `projects.involvement` | project_id, person_id, role |

Views take no injected clock, so nothing in them depends on "today": `actions.action` has no `overdue` column, and `late` on `projects.milestone` (computed with SQLite's `date('now')`) is a display convenience only. Logic (reports, `projectStatus`, the TUI's groupings) compares `due_date` with the context's `today` itself.

The project `context` Markdown is **not** in a view, because it's large. It's read with `getContext`.

It reads `people.person`, for owner and involvement names and for validating person references, `meetings.meeting` (`^2`, optional), for meeting titles on decisions, and `actions.action` and `actions.link` (optional), for the open-action counts it shows (`open_actions` on a project record in the CLI and TUI; it is no longer a column of `projects.project`).

### Exposed operations

| Read (with logic) | Input | Returns |
|---|---|---|
| `getContext` | `project` | `{ markdown, updatedAt }` |
| `projectStatus` | `project`, `since`, `reference?` (default today), `previousMeeting?` | the structured data behind the prep block (health and "stale" warning, milestones, deliverables, risks, decisions) |

`projectStatus` no longer returns actions: the project's overdue and meeting actions come from `actions.projectActions`, which the actions plugin's `project-status` section uses.

| Write | Input | Change-set line |
|---|---|---|
| `addProject` / `editProject` / `archiveProject` | … (`editProject`'s optional `code` renames the project: same rules as add, a taken code is a conflict, the output `ref` is the new one) | `+ project CRM "CRM replatforming"`, `~ CRM code → CRM2027` |
| `setContext` | `project`, `markdown` | `~ CRM context (2.4 kB → 3.1 kB)` |
| `setHealth` | `project`, `health`, `comment?`, `date?` | `~ CRM health amber → red: "Budget overrun"` |
| `addMilestone` / `editMilestone` / `completeMilestone` / `deleteMilestone` | … | `~ MS-2 due 26 Nov → 10 Dec` |
| `addDeliverable` / `editDeliverable` / `setDeliverableStatus` / `deleteDeliverable` | … | `~ D-8 in_review → delivered` |
| `addRisk` / `editRisk` / `closeRisk` / `deleteRisk` | … | `+ risk R-13 "Vendor delay" (high)` |
| `addDecision` / `editDecision` / `deleteDecision` | … | `+ decision DE-14 "Select vendor B" (ERP, M-4)` |
| `addInvolvement` / `removeInvolvement` | `project`, `person`, `role` | `+ @marie on CRM as key user` |

### CLI

```
ttybrain project     list|show|add|edit|archive|context
ttybrain milestone   list|add|edit|done|delete
ttybrain deliverable list|add|edit|status|delete
ttybrain risk        list|add|edit|close|delete
ttybrain decision    list|add|edit|delete
ttybrain involve     add|remove        # ttybrain involve add CRM marie --role "key user"
ttybrain report status <project>
```

### UI and other contributions

| Extension point | What |
|---|---|
| `screen` | **Projects** (2) |
| `recordTab` on `project` | **Overview**, Milestones, Deliverables, Risks & issues, Decisions, Actions, People, **Context** (the item tabs' counts are all of their items, as the tabs list them) |
| `recordTab` on `person` | **Projects & roles** |
| `overviewPanel` | Projects needing attention · Late milestones (+ next 14 days) · High risks & issues |
| `reportSection` in `project-status` | Health · Milestones · Deliverables · Risks & issues · Decisions (in that order; the Actions section, order 60, is added by `actions`) |
| `report` | `project-status`, with params `project`, `since`, `reference` (the date the due-soon windows count from, default today: a meeting's date) and `previous-meeting` (an `M-n`: its open actions are listed too, by the actions plugin's section); the names are kebab-case because report params are CLI flags. Its sections mark rows: Health `●` in the health colour, Milestones `✓` / `○` (red when late), Deliverables `✓` / `◐` / `○`, Risks `▲` (red for high); the Actions section's `!` marks (red for overdue) come from `actions`. Meetings uses it as the section slot of its board pack |
| `tagType` | `#CODE` → project |
| `quickAction` on `project` | Update health (`h`) |
| `recordForm` `decision` | with `prefill.meeting` (`M-n`) a new decision is linked to that meeting (no field; the form's title names the meeting) |
| `guideSection` | how to turn notes into decisions, risks, health and deliverable updates |

**Events emitted:** `project.changed`, `health.changed` (phase 2+; not emitted yet — use `record.changed`).

---

## 2a. `actions`

What you or someone else has to do: an owner, an optional due date and links to the records the action concerns (projects, people, meetings). Split out of `projects` in the 2.0 releases of both; the actions the projects plugin held were handed over once, ids and history intact (see the follow-ups, "Actions plugin").

`actions` requires nothing. It reads `people.person` (owner and linked-person names), `projects.project` (codes) and `meetings.meeting` (`^2`: titles and dates), all optional: a link to a record whose plugin is not loaded shows as `<type>:<id>`, a gone record as `—`.

### Data

| Table | Columns |
|---|---|
| `action` | `title`, `due_date`, `status` (open/done/cancelled), `done_date`, `owner_id → person` **(soft; empty = you)**, `notes` |
| `link` | `action_id → action` (no `ON DELETE`), `record_type` (`project`, `person`, `meeting`), `record_id`; unique per (action, record); `id` gives the order the links were made in |
| `handover`, `handover_row` | bookkeeping of the one-time import of the legacy `projects` actions (internal; not published) |

### Published views

| View | Columns |
|---|---|
| `actions.action` (version 2) | id, title, due_date, status, done_date, owner_id (no link columns; no `overdue`, since views take no clock) |
| `actions.link` (version 1) | id, action_id, record_type, record_id |

Readers: `meetings` (minutes and notes), `people` (follow-ups) and `projects` (open-action counts) declare `reads: { actions: "^2" }`.

### Exposed operations

| Read (with logic) | Input | Returns |
|---|---|---|
| `projectActions` | `project`, `reference?`, `previousMeeting?` | a project's open actions overdue at `reference` (default today) and those from `previousMeeting`; behind the `project-status` section |
| `importedLegacy` | — | whether the legacy import is done, and each imported row's `(id, updated_at)`; used by `projects`' handover step |

| Write | Input | Change-set line |
|---|---|---|
| `addAction` | `title`, `owner?`, `due?`, `notes?`, `links?: string[]` (any refs), shorthands `project?`, `forPerson?`, `meeting?` | `+ action "Send the roadmap" (me, #CRM, due 2026-11-20)` |
| `editAction` | `ref`, the same fields; `links` replaces all links, an empty value clears a field | `~ A-41 due, links` (the changed fields) |
| `linkAction` / `unlinkAction` | `{ ref, to }`: one record ref; `unlinkAction` is always allowed (a gone link by `<type>:<id>`) | `~ A-41 link #ERP`, `~ A-41 unlink @peter` |
| `completeAction` / `cancelAction` | `ref`, `date?` | `~ A-41 done`, `~ A-41 cancelled` |
| `deleteAction` | `ref` | `- action A-41 "Send the roadmap"` |

An action counts as archived (writes refused, hidden from Attention and the overview) only when it has project links and every one of them is archived; linking to an archived project is refused. Until the legacy import is done, new actions get ids after the highest id still waiting in projects (`legacyMaxId`), or above 1,000,000 when projects cannot be read, so they cannot collide with the ids still to be moved.

### CLI

```
ttybrain action list|show|add|edit|link|unlink|done|cancel|delete
```

`list` groups Overdue / This week / Next week / Later / No date, with `--open --overdue --owner --project --for --meeting --link <ref>`. `add` and `edit` take `--owner` (empty = you), `--due`, `--notes`, `--project`, `--for`, `--meeting` (shorthand for links) and `--link <ref>` (repeatable). `--json` keeps the `ActionRecord` fields (`ref id title due_date status done_date owner_id owner project_id project for_person_id for meeting_id meeting notes`; the three link fields are the first link of that type) and adds `links: [{ type, id, ref }]`. Exit codes as everywhere.

### UI and other contributions

| Extension point | What |
|---|---|
| `screen` | **Actions** (4), exactly as the design draws it (its bar leaves out the global actions' hints) |
| `recordTab` on `project`, `person`, `meeting` | **Actions**: the actions linked to that record (a person's also the ones they own); columns ID, Action, Owner, Linked to (the record itself left out), Due |
| `recordForm` `action` | the full form, a due-date form (`d`) and a links form (`l`); the links field takes refs separated by spaces (`#CRM @anna M-4`) |
| `overviewPanel` | Overdue actions · Due this week |
| `reportSection` | in `project-status`: Actions (order 60); in `overview`: Overdue actions (10), Due this week (20) |
| `recordType` | `action` (`A-`) |
| `guideSection` | how to turn "X will do Y" into actions, link them and close them |

---

## 3. `meetings`

Every meeting is about a person (a 1:1) or a project (a project meeting or a board), either one-off or an occurrence of a recurring series. It covers the agenda with an "ask" per item, the generated prep, notes during the meeting, closing (also by itself), the talk-lists of people and projects, and the reports and export. Design: `docs/superpowers/specs/2026-11-20-ttybrain-meetings-actions-design.md` §5. Version 2.0.0 (the kinds in the published `meeting` view changed); it requires `projects ^2`, `people ^1`, `actions ^2`.

### Data

| Table | Columns |
|---|---|
| `meeting` | `title`, `date`, `kind` (`one_on_one`, `project`, `board`), `status` (planned/held/cancelled), `subject_type` (`person`/`project`) and `subject_id` **(soft)**, `series_id → series` and `series_date` (unique together: an occurrence is made once, even when skipped or moved), `auto_close` (1: it closes itself 3 days after its date), `closed_itself`, `since_date`, `notes` (Markdown). `id` is `AUTOINCREMENT`: a deleted meeting's number is never reused |
| `series` | `subject_type`, `subject_id` **(soft)**, `title`, `kind`, `rhythm` (as typed: `every 2 weeks on wed`), `first_date`, `end_date` (optional) |
| `series_attendee` | `series_id → series`, `person_id` **(soft)** |
| `talk_item` | `subject_type`, `subject_id` **(soft)**, `text`, `project_id` **(soft)** (the tag on a person's item), `added_date`, `position`, `last_position`, `status` (open/discussed/dropped), `meeting_id → meeting` (where it was ticked), `status_date`. `id` is `AUTOINCREMENT` |
| `talk_kept` | `meeting_id`, `talk_id`: the open items a closed meeting left for next time |
| `attendee` | `meeting_id → meeting`, `person_id → person` **(soft)** |
| `agenda_item` | `meeting_id → meeting`, `position`, `text`, `project_id → project` **(soft)**, `ask` |

`attendee` and `agenda_item` have no `ON DELETE` action (rule 6 of the data rules): where a meeting is deleted its children are deleted explicitly. Existing meetings are kept by migration 002: `steering` and `other` become `project`, `board` stays, every meeting keeps its number, title, date, status, attendees, agenda, asks, notes and since date, and none has a subject until `meeting subject` gives it one (it is then listed under "No subject" and never closes itself).

### Published views

| View | Columns |
|---|---|
| `meetings.meeting` (v2) | id, title, date, kind, status, subject_type, subject_id, series_id |
| `meetings.series` (v1) | id, subject_type, subject_id, title, kind, rhythm, first_date, end_date |
| `meetings.talk_item` (v1) | id, subject_type, subject_id, text, project_id, added_date, position, status, meeting_id, status_date |
| `meetings.agenda_item` (v1) | id, meeting_id, position, text, project_id, ask |
| `meetings.attendee` (v1) | meeting_id, person_id |

It reads `people.person` (attendee and subject names), `projects.project` (agenda project codes and names, subjects) and `actions.action` / `actions.link` (the actions linked to a meeting, for the minutes and the prep). `projects` and `actions` read `meetings.meeting` at `^2`.

Record types: `meeting` (`M-n`), `series` (`S-n`), `talk_item` (`T-n`); all resolvable and searchable (a talk item by its text). A meeting's, series' or talk item's subject that is gone (a deleted person, an archived or switched-off project) shows as `—`, never an error.

### Rhythms and upkeep

A series' rhythm is `weekly on <day>`, `every <n> weeks on <day>`, `monthly on the <1st|2nd|3rd|4th|last> <day>` or `monthly on day <n>` (case-insensitive, the day as a full or three-letter name, the leading `every` optional: `2 weeks on wed`). Dates only. `monthly on day 31` falls on the last day of a shorter month. `every n weeks` counts from the series' first date, and stays anchored to the original first date when `series edit --every` changes the interval.

Two upkeeps (`ctx.upkeep`, see the architecture primer) keep the data current with the date:

- `occurrences` creates the planned meetings of every open series for the next 8 weeks (today through today + 55 days), once per `(series, date)`, never back-filling past dates. A skipped occurrence is a cancelled meeting and a moved one has another date; both keep `series_id`/`series_date`, so they are never made again. Editing or ending a series removes only the planned occurrences dated today or later that hold nothing (no agenda items of their own, notes, ticked talk items or provenance); `series edit` attendee changes also overwrite moved occurrences.
- `auto-close` closes, as `meeting close` does, every planned meeting with `auto_close` 3 or more days past, so an app not opened for three weeks closes them all on the next write-capable start (their unticked talk items stay open). A meeting without a subject never closes itself (`auto_close` is set when a subject is given, only for a meeting dated today or later). One meeting that fails to close stops the rest of that run (no known trigger). A meeting that closed itself says so when you try to close it again. Read-only commands may show yesterday's state until the next write-capable start; a TUI started while another process holds the write lock skips upkeep until the next day.

### Exposed operations

| Read (with logic) | Input | Returns |
|---|---|---|
| `sinceDate` | `meeting`, `project` | `{ since, source, previous }`: the "since" date (design §8 rule), where it came from, and the previous held meeting that covered the project |
| `prep` | `meeting` | per agenda item: its project's `project-status` sections (with row marks) plus the ask |
| `report` | `meeting`, `kind` (board/minutes), `format` (md/text/json) | rendered report |
| `upcoming` | `from`, `to` | the planned meetings in the range with their subject, attendees, talk count, `closes_on` (date + 3 when it closes itself, else null) and the open actions linked to them |
| `talkList` | `about` | `{ open, carried, carriedFrom? }`: the open talk items of a person or project (a project's include open people's items tagged with it); the carried ones were added before the subject's last held meeting |
| `agendaFor` | `meeting` | a planned meeting's agenda: the subject's open items (a project's also the tagged people's items) and the items ticked in this meeting; a held meeting's: what was discussed in it and what was kept at close |
| `agreeLinks` | `meeting` | the refs an action agreed in the meeting links to: the meeting and what it is about |

| Write | Input | Change-set line |
|---|---|---|
| `addMeeting` | `about` (required), title, date, `kind?` (from the subject), `attendees?`, `projects?` (creates agenda items) | `+ meeting M-5 "SteerCo Q1" 2027-03-04` |
| `editMeeting` / `cancelMeeting` | … | `~ M-5 date 2027-03-04 → 2027-03-11`, `~ M-5 cancelled` |
| `skipMeeting` / `moveMeeting` | `ref` (, `to`) | `~ M-5 skipped`, `~ M-5 date 2027-03-04 → 2027-03-11` |
| `setSubject` | `meeting` or `allWithout`, `about` | `~ M-5 about @karim` |
| `closeMeeting` | `ref` | `~ M-4 held` (returns the closing summary, below) |
| `setAttendees` | `meeting`, `people[]` | `~ M-4 attendees +@tom −@luc` |
| `addAgendaItem` / `editAgendaItem` / `moveAgendaItem` / `removeAgendaItem` | … | `~ M-4 item 2 ask: "Release contingency"` (also `+ M-4 item 3 "Budget"`, `~ M-4 item 4 → 2`, `- M-4 item 2 "AOB"`) |
| `setNotes` | `meeting`, `markdown` | `~ M-4 notes` |
| `addSeries` / `editSeries` / `endSeries` | `about`, `title`, `every`, `from` (the CLI defaults it to today), `until?`, `kind?`, `attendees?`; `ref` and the same; `ref`, `on?` | `+ series S-2 "1:1 Karim" every 2 weeks on wed from …`, `~ S-2 ends 2027-03-04` |
| `addTalk` / `editTalk` / `moveTalk` / `dropTalk` | `about`, `text`, `project?`; `ref`, …; `ref`, `to`; `ref` | `+ talk @anna "AWS training budget"`, `~ T-7 position 3 → 1`, `~ T-7 dropped` |
| `discussTalk` / `reopenTalk` | `ref`, `meeting?`; `ref` | `~ T-7 discussed in M-4`, `~ T-7 reopened` |

Closing: `closeMeeting` marks the meeting held and returns the meeting record, what it logged, the counts discussed, kept and created, and one `message` (`1:1 Anna closed · 2 discussed, 3 kept for next time · 2 actions created · notes saved`). The unticked talk items stay open (recorded in `talk_kept`); a 1:1's notes are also added to the person as a `one_on_one` note (`people.addNote`, dated the meeting's date); the notes of project and board meetings stay on the meeting. Notes written after closing stay on the meeting only (they are not copied again). Auto-close does the same.

Actions logged during a meeting are created through `actions.write.addAction` (`meetings` requires `actions ^2`) with `meeting: "M-4"`, decisions through `projects.write.addDecision`. Meetings doesn't store them.

### CLI

```
ttybrain meeting list|show|add|edit|cancel|skip|move|subject|close|attendees|notes
ttybrain meeting series add|list|edit|end
ttybrain meeting agenda <M-n> add|edit|move|remove
ttybrain talk add|list|done|drop|move|reopen
ttybrain report board <M-n> | minutes <M-n>   [--format md|text|json]
```

`meeting add` needs `--about <@handle|#CODE>`; `--kind` is optional (a person subject makes a `one_on_one`, a project subject a `project`; `board` is chosen with `--kind board` on a project) and `--kind steering|other` stay accepted as aliases of `project`. `meeting subject <M-n> <about>` gives a meeting without a subject one, and `meeting subject --all-without <about>` gives all of them one (one transaction). `meeting skip <M-n>` and `meeting move <M-n> --to <date>` act on one planned meeting (of a series: that date only). `meeting series add <about> <title> --every <rhythm> [--from <date>] [--until <date>] [--kind] [--attendees a,b]` starts a series (the attendees default to the person it is about); `series edit <S-n>` takes `--title`, `--every`, `--attendees`, `--until` / `--no-until`; `series end <S-n> [--on <date>]` stops it. `talk add <about> <text> [--project <code>]` (a project tag only on a person's item), `talk list [<about>]` (open items numbered within their group, the carried ones marked `↻`), `talk done <T-n> [--meeting <M-n>]`, `talk drop|reopen <T-n>`, `talk move <T-n> --to <n>`. `meeting close` prints the closing message. Agenda items have no ref of their own: they are addressed by meeting and position (`ttybrain meeting agenda M-4 edit 2`). `--attendees` and `--projects` take comma-separated lists; the TUI form takes them as tag text (`@peter @marie`, `#CRM #ERP`). Held meetings stay writable (notes are often finished afterwards); cancelled ones are read-only, and nothing reopens a meeting. Commands print a short result line; the change-set lines above go to the change log. After a write command, an upkeep that failed in that process prints `warning: upkeep "<id>" failed: …` on stderr.

### UI and other contributions

| Extension point | What |
|---|---|
| `screen` | **Meetings** (5): Upcoming (by week), Held closes itself, Not closed, No subject (a last group, hint `meeting subject M-n <ref>`) and Series; keys `n` one-off, `N` series, `s` skip, `m` move date |
| `overviewPanel` | **Upcoming meetings · next 7 days** on Attention (the lead panel, with "Before …" and the highlighted first action: `x` completes it, `t` talks) |
| `recordTab` on `meeting` | A 1:1 or project meeting is one **Meeting** view (the in-progress layout, no tab row; its status shows once not planned). A board has **Agenda** (with the talk-list; `A` adds a talk item to the agenda and ticks it), **Prep**, **Notes**, **Export** (board pack while planned, minutes once held, `m` switches, `w` writes `<exportDir>/<date>-<slug>.md`, `y` copies by OSC 52) |
| `recordTab` on `person` / `project` | **Talk** (open items, ticked with Space, the carried ones marked `↻`) and **Meetings** (its series and meetings; a project's also the Prep panel and Past meetings) |
| `recordKey` on `person` / `project` | `t` opens the talk-item form with the subject filled in (`t` on an upcoming meeting does the same) |
| `recordForm` | meeting, agenda item, attendees, move date (on `meeting`); series; talk item |
| `recordCrumb` on `meeting` | `› <ref> <label>`; opened from a person or project: `› Anna Peeters › 1:1 Mon 23 Nov` |
| `captureRoute` | quick capture of `talk @anna …` or `talk #CRM …` with exactly one tag that resolves goes to that talk-list; anything else (`talk about lunch`, two tags, an unknown tag) goes to the inbox as before, and the preview says so |
| `recordTab` on `meeting` (from `actions`) | **Actions**: the actions linked to a board meeting (the other kinds show them in the Agreed actions panel) |
| `report` | `board` and `minutes`. The board embeds `project-status` per agenda project through `ctx.reports.run`, with `since` from `sinceDate`; its title is `<title> · <date>`, and the minutes' is `Minutes · <title> · <date>`. Sections of `board`: Attendees, Agenda, Projects (one block per agenda project, with its Ask); of `minutes`: Attendees, Notes, Discussed (the talk items ticked in the meeting), Decisions, Actions |
| keys | `x` (close) and `w` (write the export) are plain keys on the screen and tabs; `quickAction` is not used (phase 5) |
| `guideSection` | how to prepare a meeting, run a series, use talk-lists, close (and auto-close) and turn notes into actions and decisions |

---

## 4. `inbox`

Quick capture, tags, and keeping track of what each captured item became.

### Data

| Table | Columns |
|---|---|
| `item` | `text`, `captured_at`, `status` (new/processed/dismissed), `summary`, `processed_at`, `processed_by` (assistant/cli/you), `unresolved_tags` (JSON) |
| `link` | `item_id → item`, `record_type`, `record_id` **(soft, any type)** |

Inbox doesn't know projects or people. When an item is saved, it asks the kernel's **tag registry** to resolve `#…`, `@…` and any plugin-registered tag. It then stores the resulting `(record_type, record_id)` pairs.

### Published views

| View | Columns |
|---|---|
| `inbox.item` | id, text, captured_at, status, summary, processed_at, processed_by |

### Exposed operations

| Read (with logic) | Input | Returns |
|---|---|---|
| `getItem` | `ref` | item, with resolved links, unresolved tags and the **records created from it** (from kernel provenance, below) |

| Write | Input | Change-set line |
|---|---|---|
| `capture` | `text`, `context?` (current record, pre-filled as a tag) | `+ inbox I-20 "…"` |
| `editItem` | `ref`, `text` (re-resolves tags) | `~ I-19 #CMR → #CRM` |
| `markProcessed` | `ref`, `summary`, `by` | `~ I-17 processed: "note on @peter, A-41"` |
| `dismiss` | `ref`, `by?` (kept in `processed_by`) | `~ I-13 dismissed` |
| `reopen` | `ref` | `~ I-13 reopened` |

### CLI

```
ttybrain inbox add "<text>"
ttybrain inbox list [--new] | show <I-n> | edit <I-n> | done <I-n> --summary "…" | dismiss <I-n> | reopen <I-n>
```

Any write command, in any plugin, accepts `--from-inbox I-n`. That's a kernel flag that records provenance (below).

### UI and other contributions

| Extension point | What |
|---|---|
| `screen` | **Inbox** (6) |
| `globalAction` | `i`: the quick-capture overlay, on every screen |
| `statusBadge` | `● 3 new in inbox` in the header |
| `overviewPanel` | Inbox (new count and the latest items) |
| `quickAction` on `inbox_item` | Process by hand (`p`), Dismiss (`z`), Reopen (`u`) |
| `guideSection` | the inbox-processing rules for agents |

**Events emitted:** `inbox.captured` (phase 2+; not emitted yet — use `record.changed`).

---

## 5. `assistant`

The chat pane, change-set review, and AI providers. It has no tables; sessions live in memory.

### Exposed operations

None. It doesn't own data.

### What it uses

- **Tools:** the kernel's tool registry, i.e. every exposed operation of every plugin, plus extra `ctx.tool`s.
- **Guide:** the kernel's guide, made of every plugin's `guideSection`, as instructions.
- **Changes:** the kernel's change-set service for every write.

### UI and other contributions

| Extension point | What |
|---|---|
| `globalAction` | `c`: open or focus the chat pane (`Z` zoom, `C` hide) |
| `statusBadge` | `● assistant` while a session runs |
| `quickAction` on `inbox_item` | Process with assistant (`P`), one change set per item, then `inbox.write.markProcessed` |
| `assistantProvider` | its built-in provider, `copilot` (via `@github/copilot-sdk`, optional dependency) |

### Configuration

`assistant.provider` in `config.json`: `"copilot"` or `"none"`, or the ID of an `assistantProvider` registered by another plugin.

---

## Kernel services used by all plugins

| Service | Used for |
|---|---|
| **Record types** | display IDs, resolving `A-12`/`#CRM`/`@anna`, labels, autocomplete, "open this record". Used where a soft reference can point to *any* type (inbox links, provenance); for known types, plugins join the published view |
| **Tags** | `tagType` registry; `resolve(text)` → links plus unresolved tags (used by inbox and capture autocomplete) |
| **Provenance** | `kernel_record_origin(record_type, record_id, origin_type, origin_ref)`. The kernel records it whenever a write runs with an origin: `--from-inbox`, a change set from inbox processing, or a meeting quick-add. Inbox reads it to show "what this became", so other plugins' tables need no `inbox_item_id` column |
| **Reports** | `report` and `reportSection` registry; renders md/text/json |
| **Change sets** | review, one transaction, rollback, log |
| **Guide** | `ttybrain guide`, composed from `guideSection`s in dependency order |
| **Published views** | registry; creates the `__pub_` views at startup, checks columns, and turns each into an assistant read tool |
| **Events** | `ctx.on` / emit; the TUI's live refresh also listens to them |

---

## Writing an external plugin

The built-ins above are packages like any other (`src/plugins/<id>/package.json`), so an external plugin looks the same. Design: `2026-11-18-pm-phase5-plugins-design.md`.

**Steps.** `ttybrain plugin new contracts` scaffolds `./contracts` (`package.json`, `tsconfig.json`, `src/logic/index.ts` with a migration and a command, `src/logic/index.test.ts`, `src/tui/index.tsx` with a screen and a project `recordTab`). `ttybrain plugin build contracts` compiles `src/` to `dist/`. Then either copy the folder into `~/.ttybrain/plugins/` (`TTYBRAIN_PLUGINS`), or `ttybrain plugin add ./contracts` (a folder, an npm name or a `.tgz`; the first add prints the trust warning). `ttybrain plugin list` shows its source (`folder` or `npm`) and status; `ttybrain plugin remove contracts --yes` removes it (`--purge-data` drops its tables too).

**Manifest.** `package.json` with `"type": "module"`, `main` (the logic entry, default export a `definePlugin(...)`), and `"ttybrain": { "plugin": true, "id": "contracts", "tui": "dist/tui/index.js" }` (`tui` optional, default export a `defineTui(...)`). `ttybrain.id` must equal the `PluginDef` id and `version` the `PluginDef.version`, or the plugin fails to load. Ids may not equal a built-in's.

**Imports.** Only `@ttybrain/api` (logic) and `@ttybrain/api/tui` (tui part), plus `solid-js`, `solid-js/store`, `@opentui/solid` and `@opentui/core` in the tui part. These are ttybrain's own instances, provided at runtime through generated shims, so:
- use named imports only (`import * as` or `export *` of a shared module fails the build);
- no other `@opentui/*` package;
- the logic entry, directly or through its own files, must not import the UI modules or `@ttybrain/api/tui`;
- a plugin built against an older ttybrain that uses a since-removed export fails at load with `rebuild the plugin with this ttybrain`; rebuild it.

**Rules.** Everything in `docs/architecture.md` applies: data only through `ctx.data`, views and operations; schema changes only in migrations (external plugins may not create triggers); a tui `activate` must be synchronous; importing and `activate` each time out after 5 s. A failing plugin is isolated and shown by `ttybrain plugin list` and in Help; ttybrain keeps running.

**Type-checking** needs ttybrain's TypeScript sources (the scaffold's `tsconfig` points `@ttybrain/api*` at the running ttybrain's `src/kernel/api.ts` and `src/kernel/tui/api.ts`), so author from a git checkout of ttybrain. Building does not need them. There are no `.d.ts` files yet.

**Not supported yet (Part 2).** `quickAction`, the CLI side of extra fields (`CommandDef.record`) and tag types registered by an external plugin.
