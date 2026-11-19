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
| `overviewPanel` | **Stakeholders to contact** (uses `staleContactDays`) |
| `tagType` | `@handle` → person |
| `listColumn` | — (People columns are its own) |
| `guideSection` | how to record 1:1s and stakeholder interactions |

**Events emitted:** `person.changed`, `note.added` (phase 2+; not emitted yet — use `record.changed`).

---

## 2. `projects`

The portfolio, and everything you follow up per project: health, milestones, deliverables, risks and issues, decisions and actions. It also owns **involvement**, meaning who plays which role on which project.

### Data

| Table | Columns |
|---|---|
| `project` | `code` (unique, 2–16 `A-Z`/`0-9`), `name`, `description`, `context` (Markdown), `context_updated_at`, `status` (active/on_hold/closed), `start_date`, `end_date`, `effort_estimate_days`, `effort_note`, `archived_at` |
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
| `addProject` / `editProject` / `archiveProject` | … (`editProject`'s optional `code` renames the project: same rules as add, a taken code is a conflict, the output `ref` is the new one) | `+ project CRM "CRM replatforming"`, `~ CRM code → CRM2027` |
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
ttybrain project     list|show|add|edit|archive|context
ttybrain milestone   list|add|edit|done|delete
ttybrain deliverable list|add|edit|status|delete
ttybrain risk        list|add|edit|close|delete
ttybrain decision    list|add|edit|delete
ttybrain action      list|add|edit|done|cancel|delete
ttybrain involve     add|remove        # ttybrain involve add CRM marie --role "key user"
ttybrain report status <project>
```

### UI and other contributions

| Extension point | What |
|---|---|
| `screen` | **Projects** (2), **Actions** (4) |
| `recordTab` on `project` | **Summary**, Milestones, Deliverables, Risks & issues, Decisions, Actions, People, **Context** |
| `recordTab` on `person` | **Projects & roles**, **Actions** (every action owned by or for that person: open ones first, then done and cancelled; the tab count is the open ones) |
| `overviewPanel` | Overdue actions · Due this week · Projects needing attention · Late milestones (+ next 14 days) · High risks & issues |
| `reportSection` in `project-status` | Health · Milestones · Deliverables · Risks & issues · Decisions · Actions (in that order) |
| `report` | `project-status`, with params `project`, `since`, `reference` (the date the due-soon windows count from, default today: a meeting's date) and `previous-meeting` (an `M-n`: its open actions are listed too); the names are kebab-case because report params are CLI flags. Its sections mark rows: Health `●` in the health colour, Milestones `✓` / `○` (red when late), Deliverables `✓` / `◐` / `○`, Risks `▲` (red for high), Actions `!` (red for overdue). Meetings uses it as the section slot of its board pack |
| `tagType` | `#CODE` → project |
| `quickAction` on `project` | Update health (`h`) |
| `recordForm` `action`, `decision` | with `prefill.meeting` (`M-n`) a new action or decision is linked to that meeting (no field; the form's title names the meeting) |
| `guideSection` | how to turn notes into actions, decisions, risks, health and deliverable updates |

**Events emitted:** `project.changed`, `action.changed`, `health.changed` (phase 2+; not emitted yet — use `record.changed`).

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
| `sinceDate` | `meeting`, `project` | `{ since, source, previous }`: the "since" date (design §8 rule), where it came from, and the previous held meeting that covered the project |
| `prep` | `meeting` | per agenda item: its project's `project-status` sections (with row marks) plus the ask |
| `report` | `meeting`, `kind` (board/minutes), `format` (md/text/json) | rendered report |

| Write | Input | Change-set line |
|---|---|---|
| `addMeeting` | title, date, kind, `attendees?`, `projects?` (creates agenda items) | `+ meeting M-5 "SteerCo Q1" 2027-03-04` |
| `editMeeting` / `cancelMeeting` | … | `~ M-5 date 2027-03-04 → 2027-03-11`, `~ M-5 cancelled` |
| `closeMeeting` | `meeting` | `~ M-4 held` |
| `setAttendees` | `meeting`, `people[]` | `~ M-4 attendees +@tom −@luc` |
| `addAgendaItem` / `editAgendaItem` / `moveAgendaItem` / `removeAgendaItem` | … | `~ M-4 item 2 ask: "Release contingency"` (also `+ M-4 item 3 "Budget"`, `~ M-4 item 4 → 2`, `- M-4 item 2 "AOB"`) |
| `setNotes` | `meeting`, `markdown` | `~ M-4 notes` |

Actions and decisions logged during a meeting are created through `projects.write.addAction` and `projects.write.addDecision`, with `meeting: "M-4"`. Meetings doesn't store them.

### CLI

```
ttybrain meeting list|show|add|edit|cancel|close|attendees|notes
ttybrain meeting agenda <M-n> add|edit|move|remove
ttybrain report board <M-n> | minutes <M-n>   [--format md|text|json]
```

Agenda items have no ref of their own: they are addressed by meeting and position (`ttybrain meeting agenda M-4 edit 2`). `--kind` defaults to `other` on the CLI (the TUI form starts at `steering`). `--attendees` and `--projects` take comma-separated lists; the TUI form takes them as tag text (`@peter @marie`, `#CRM #ERP`). Held meetings stay writable (notes are often finished afterwards); cancelled ones are read-only, and nothing reopens a meeting. Commands print a short result line; the change-set lines above go to the change log.

### UI and other contributions

| Extension point | What |
|---|---|
| `screen` | **Meetings** (5) |
| `recordTab` on `meeting` | **Agenda**, **Prep**, **Notes**, **Export** (board pack while planned, minutes once held, `m` switches, `w` writes `<exportDir>/<date>-<slug>.md`, `y` copies by OSC 52) |
| `recordForm` on `meeting` | meeting, agenda item, attendees |
| `recordTab` on `project` | — (left out for now) |
| `report` | `board` and `minutes`. The board embeds `project-status` per agenda project through `ctx.reports.run`, with `since` from `sinceDate`; its title is `<title> · <date>`, and the minutes' is `Minutes · <title> · <date>` |
| keys | `x` (close) and `w` (write the export) are plain keys on the screen and tabs; `quickAction` is not used (phase 5) |
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
