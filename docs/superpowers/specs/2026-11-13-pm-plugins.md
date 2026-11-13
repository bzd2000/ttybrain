# pm: built-in plugin reference

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

   ┌──────────┐    ┌───────────┐    (no requires: both work through kernel
   │  inbox   │    │ assistant │     registries: tags, record types, tools,
   └──────────┘    └───────────┘     provenance)
```

| Plugin | Requires | Reads views of | Record types (display prefix) | Screens (key) |
|---|---|---|---|---|
| `people` | — | projects | `person` (`@handle`), `note` (`N-`), `goal` (`G-`) | People (3) |
| `projects` | `people ^1` | people, meetings | `project` (`#CODE`), `milestone` (`MS-`), `deliverable` (`D-`), `risk` (`R-`), `decision` (`DE-`), `action` (`A-`) | Projects (2), Actions (4) |
| `meetings` | `projects ^1`, `people ^1` | people, projects | `meeting` (`M-`), `agenda_item` (no prefix) | Meetings (5) |
| `inbox` | — | — | `inbox_item` (`I-`) | Inbox (6) |
| `assistant` | — | all (as tools) | — | — (side pane) |

The **kernel** provides:
- the Overview screen (1), filled entirely by `overviewPanel`s;
- the frame, switcher, help overlay and change-set review;
- these registries: record types, tags, reports, provenance, tools and the guide;
- the `pm plugin …` and `pm guide` commands.

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
| `staleStakeholders` | `days`, `limit?` | stakeholders with no note for `days`, high influence first, with their projects |

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
pm person list|show|add|edit|archive|restore
pm note   list|add|edit|delete
pm goal   list|add|edit|done|drop
```

### UI and other contributions

| Extension point | What |
|---|---|
| `screen` | **People** (3): All / Stakeholders / Team list, with a detail panel |
| `recordTab` on `person` | **Notes**, **Goals** (team members only) |
| `overviewPanel` | **Stakeholders to contact** (uses `staleContactDays`) |
| `tagType` | `@handle` → person |
| `listColumn` | — (People columns are its own) |
| `guideSection` | how to record 1:1s and stakeholder interactions |

**Events emitted:** `person.changed`, `note.added`.

---

## 2. `projects`

The portfolio, and everything you follow up per project: health, milestones, deliverables, risks and issues, decisions and actions. It also owns **involvement**, meaning who plays which role on which project.

### Data

| Table | Columns |
|---|---|
| `project` | `code` (unique), `name`, `description`, `context` (Markdown), `context_updated_at`, `status` (active/on_hold/closed), `start_date`, `end_date`, `effort_estimate_days`, `effort_note`, `archived_at` |
| `health_update` | `project_id → project`, `date`, `health` (green/amber/red), `comment` |
| `milestone` | `project_id → project`, `title`, `due_date`, `done_date` |
| `deliverable` | `project_id → project`, `title`, `owner_id → person` **(soft)**, `due_date`, `status` (not_started/in_progress/in_review/delivered), `milestone_id → milestone`, `delivered_date`, `status_changed_at` |
| `risk` | `project_id → project`, `type` (risk/issue), `title`, `description`, `severity` (low/medium/high), `owner_id → person` **(soft)**, `mitigation`, `status` (open/closed), `closed_date` |
| `decision` | `project_id → project` (optional), `date`, `title`, `description`, `decided_by`, `meeting_id → meeting` **(soft)** |
| `action` | `title`, `due_date`, `status` (open/done/cancelled), `done_date`, `owner_id → person` **(soft; empty = you)**, `project_id → project` (optional), `for_person_id → person` **(soft)**, `meeting_id → meeting` **(soft)**, `notes` |
| `involvement` | `project_id → project`, `person_id → person` **(soft)**, `role`; unique (project, person, role) |

`projects` requires `people` and stores person IDs as soft references. It validates them on every write and shows names by joining `people.person`, never the internal `person` table.

### Published views

| View | Columns |
|---|---|
| `projects.project` | id, code, name, description, status, start_date, end_date, effort_estimate_days, `health`, `health_comment`, `health_date` (latest update), `next_milestone_title`, `next_milestone_due`, `open_actions`, `open_risks`, archived |
| `projects.health_update` | id, project_id, date, health, comment |
| `projects.milestone` | id, project_id, title, due_date, done_date, `late` |
| `projects.deliverable` | id, project_id, title, owner_id, due_date, status, status_changed_at, milestone_id |
| `projects.risk` | id, project_id, type, title, severity, owner_id, status, closed_date |
| `projects.decision` | id, project_id, date, title, decided_by, meeting_id |
| `projects.action` | id, title, due_date, status, done_date, owner_id, project_id, for_person_id, meeting_id |
| `projects.involvement` | project_id, person_id, role |

Views take no injected clock, so nothing in them depends on "today": `projects.action` has no `overdue` column, and `late` on `projects.milestone` (computed with SQLite's `date('now')`) is a display convenience only. Logic (reports, `projectStatus`, the TUI's groupings) compares `due_date` with the context's `today` itself.

The project `context` Markdown is **not** in a view, because it's large. It's read with `getContext`.

It reads `people.person`, for owner, `for` and involvement names and for validating person references, and `meetings.meeting` (optional), for meeting titles on actions and decisions.

### Exposed operations

| Read (with logic) | Input | Returns |
|---|---|---|
| `getContext` | `project` | `{ markdown, updatedAt }` |
| `projectStatus` | `project`, `since`, `reference?` (default today), `previousMeeting?` | the structured data behind the prep block (health and "stale" warning, milestones, deliverables, risks, decisions, actions) |

| Write | Input | Change-set line |
|---|---|---|
| `addProject` / `editProject` / `archiveProject` | … | `+ project CRM "CRM replatforming"` |
| `setContext` | `project`, `markdown` | `~ CRM context (2.4 kB → 3.1 kB)` |
| `setHealth` | `project`, `health`, `comment?`, `date?` | `~ CRM health amber → red: "Budget overrun"` |
| `addMilestone` / `editMilestone` / `completeMilestone` / `deleteMilestone` | … | `~ MS-2 due 26 Nov → 10 Dec` |
| `addDeliverable` / `editDeliverable` / `setDeliverableStatus` / `deleteDeliverable` | … | `~ D-8 in_review → delivered` |
| `addRisk` / `editRisk` / `closeRisk` / `deleteRisk` | … | `+ risk R-13 "Vendor delay" (high)` |
| `addDecision` / `editDecision` / `deleteDecision` | … | `+ decision DE-14 "Select vendor B" (ERP, M-4)` |
| `addAction` / `editAction` / `completeAction` / `cancelAction` / `deleteAction` | … | `+ action A-41 "Tell Peter…" (me, Fri)` |
| `addInvolvement` / `removeInvolvement` | `project`, `person`, `role` | `+ @marie on CRM as key user` |

### CLI

```
pm project     list|show|add|edit|archive|context
pm milestone   list|add|edit|done|delete
pm deliverable list|add|edit|status|delete
pm risk        list|add|edit|close|delete
pm decision    list|add|edit|delete
pm action      list|add|edit|done|cancel|delete
pm involve     add|remove        # pm involve add CRM marie --role "key user"
pm report status <project>
```

### UI and other contributions

| Extension point | What |
|---|---|
| `screen` | **Projects** (2), **Actions** (4) |
| `recordTab` on `project` | **Summary**, Milestones, Deliverables, Risks & issues, Decisions, Actions, People, **Context** |
| `recordTab` on `person` | **Projects & roles**, **Actions** (owned by or for that person) |
| `overviewPanel` | Overdue actions · Due this week · Projects needing attention · Late milestones (+ next 14 days) · High risks & issues |
| `reportSection` in `project-status` | Health · Milestones · Deliverables · Risks & issues · Decisions · Actions (in that order) |
| `report` | `project-status` (the section slot that meetings also uses) |
| `tagType` | `#CODE` → project |
| `quickAction` on `project` | Update health (`h`) |
| `guideSection` | how to turn notes into actions, decisions, risks, health and deliverable updates |

**Events emitted:** `project.changed`, `action.changed`, `health.changed`.

---

## 3. `meetings`

Boards, steering committees and other meetings. It covers the agenda with an "ask" per item, the generated prep, notes during the meeting, closing, and the reports and export.

### Data

| Table | Columns |
|---|---|
| `meeting` | `title`, `date`, `kind` (board/steering/other), `status` (planned/held/cancelled), `since_date`, `notes` (Markdown) |
| `attendee` | `meeting_id → meeting`, `person_id → person` **(soft)** |
| `agenda_item` | `meeting_id → meeting`, `position`, `text`, `project_id → project` **(soft)**, `ask` |

### Exposed operations

### Published views

| View | Columns |
|---|---|
| `meetings.meeting` | id, title, date, kind, status |
| `meetings.agenda_item` | id, meeting_id, position, text, project_id, ask |
| `meetings.attendee` | meeting_id, person_id |

It reads `people.person` (attendee names) and `projects.project` (agenda project codes and names).

### Exposed operations

| Read (with logic) | Input | Returns |
|---|---|---|
| `sinceDate` | `meeting`, `project` | the "since" date (design §8 rule) |
| `prep` | `meeting` | per agenda project: its `project-status` sections plus the ask |
| `report` | `meeting`, `kind` (board/minutes), `format` (md/text/json) | rendered report |

| Write | Input | Change-set line |
|---|---|---|
| `addMeeting` | title, date, kind, `attendees?`, `projects?` (creates agenda items) | `+ meeting M-5 "SteerCo Q1" 2027-03-04` |
| `editMeeting` / `cancelMeeting` | … | `~ M-5 date 4 Mar → 11 Mar` |
| `closeMeeting` | `meeting` | `~ M-4 held` |
| `setAttendees` | `meeting`, `people[]` | `~ M-4 attendees +@tom −@luc` |
| `addAgendaItem` / `editAgendaItem` / `moveAgendaItem` / `removeAgendaItem` | … | `~ M-4 item 2 ask: "Release contingency"` |
| `setNotes` | `meeting`, `markdown` | `~ M-4 notes` |

Actions and decisions logged during a meeting are created through `projects.write.addAction` and `projects.write.addDecision`, with `meeting: "M-4"`. Meetings doesn't store them.

### CLI

```
pm meeting list|show|add|edit|cancel|close|attendees|notes
pm meeting agenda <M-n> add|edit|move|remove
pm report board <M-n> | minutes <M-n>   [--format md|text|json]
```

### UI and other contributions

| Extension point | What |
|---|---|
| `screen` | **Meetings** (5) |
| `recordTab` on `meeting` | **Agenda**, **Prep**, **Notes**, **Export** |
| `recordTab` on `project` | — (left out for now) |
| `report` | `board` and `minutes`. Both embed `project-status` per agenda project, with "since" from `sinceDate` |
| `quickAction` on `meeting` | Close meeting (`x`), Export (`w`) |
| `guideSection` | how to prepare a meeting and turn notes into actions and decisions |

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
| `dismiss` / `reopen` | `ref` | `~ I-13 dismissed` |

### CLI

```
pm inbox add "<text>"
pm inbox list [--new] | show <I-n> | edit <I-n> | done <I-n> --summary "…" | dismiss <I-n> | reopen <I-n>
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

**Events emitted:** `inbox.captured`.

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
| **Guide** | `pm guide`, composed from `guideSection`s in dependency order |
| **Published views** | registry; creates the `__pub_` views at startup, checks columns, and turns each into an assistant read tool |
| **Events** | `ctx.on` / emit; the TUI's live refresh also listens to them |
