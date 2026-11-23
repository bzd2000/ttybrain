# ttybrain: meetings on people and projects, talk-lists, and an actions plugin — design

Date: 2026-11-20. Screens: `docs/superpowers/specs/2026-11-20-ttybrain-meeting-screens.html` (also published as the
artifact "ttybrain Meeting Screens"). Builds on the main spec (`2026-11-13-pm-design.md`), the plugin system
(`2026-11-18-pm-phase5-plugins-design.md`) and the first screen designs (`2026-11-13-pm-screens.html`).

## 1. Intent

The user meets the same people and projects again and again: 1:1s with team members, project steering meetings, a
monthly board. During the week they think of things to raise ("ask Anna about the AWS training"), and when the
meeting comes they want those things in front of them, together with the actions they still owe that person or
project. Today a meeting is a one-off with a project agenda, and actions belong to the projects plugin.

This design makes three changes:

1. **Actions become their own plugin** and can be linked to anything: a person, a project, a meeting, several, or
   nothing (then they are the user's own to-dos).
2. **Every meeting belongs to a person or a project**, can be one-off or recurring, and the board is a project of
   its own. Meetings show on the person's and the project's view; screen 5 stays as an overview across all.
3. **Talk-lists**: every person (team member or stakeholder) and every project keeps a list of things to discuss.
   It is the agenda of the next meeting about them; items not discussed carry forward.

### Goals

- Add things to a talk-list in seconds, from anywhere (quick capture) or from the person/project view.
- Before a meeting, see at a glance: what to talk about, and your open actions linked to it (Attention panel).
- Run the meeting on one screen: tick items, take notes, agree actions; close and everything lands in the right place.
- Recurring 1:1s, project meetings and board meetings with a simple rhythm; an overview of what's coming.
- The TUI looks **exactly** like the screen designs (section 3).

### Non-goals

- Time of day, durations, reminders or notifications (dates only; user's decision).
- Calendar sync, invitations or attendee responses.
- Decisions linking to anything: decisions stay in the projects plugin, linked to a project and optionally the
  meeting they were taken in (user's decision).
- Changing what the board pack contains.

### Anti-goals (a failure even if it works)

- Existing actions or meetings are lost, renumbered, or end up unlinked after the upgrade.
- A talk item silently disappears (dropped without the user ticking or deleting it).
- The new screens look like a different app from the designs: other layout, colours, wording or keys.
- Actions or projects stop working when another plugin is switched off. *(My call on the plugin graph: actions
  requires nothing; meetings requires people, projects and actions, as it already requires people and projects
  today, because closing a meeting writes notes, decisions and actions into them. Switching one of those off
  switches meetings off with a message, as today.)*

## 2. Approaches

- **A. One meetings plugin with kinds, plus a separate actions plugin (chosen).** Meetings owns subjects, series,
  occurrences, talk-lists, notes, the board machinery and the overview; it adds tabs to person and project views
  through `recordTab`. Actions owns actions and their links and adds Actions tabs everywhere.
- **B. A separate board plugin next to a conversations plugin.** Rejected: schedule, occurrences, notes and export
  would exist twice, and the overview would have to merge two plugins.
- **C. Projects and people each own their meetings.** Rejected: duplicated logic, and the overview would need
  another plugin's private data, which the isolation rules forbid.

The user picked A.

## 3. Look and feel: the screens are the specification

The user wants the screens to look exactly like the designs, for **every screen of the app** (user's decision):
all screens in `2026-11-20-ttybrain-meeting-screens.html` and all screens in `2026-11-13-pm-screens.html` (switcher,
Attention, Projects, project detail and Context, People, Actions, Inbox, quick capture). Where the two designs show
the same screen, the 2026-11-20 one wins for what it changes.

**What "exactly" means**

- **Layout:** at 118×36 the same panels in the same places and proportions, the same panel titles on the top
  border and footers on the bottom border, the same columns in the same order with the same headers, the same
  group rows (e.g. "Overdue", "Next week · 23–27 Nov"), the same tab names and order.
- **Wording:** titles, column headers, empty states, footers, status-bar hints and messages as in the designs.
- **Keys:** the keys shown in each screen's key list and status bar do what the design says.
- **Colours:** the terminal palette in the designs is the app theme. Two colours the designs use are missing from
  `src/kernel/tui/theme.ts` and are added: `cyan #7dcfff` for project codes and `magenta #bb9af7` for people names.
  Every element uses the colour the design gives it: project codes cyan, people magenta, ids and secondary text
  muted, overdue red, due soon / attention amber, done and ✓ green, focused panel border and selection accent.
- **Frame:** the header reads `ttybrain · <chip>` with `ttybrain` in bold accent and the chip on the selected-row
  background with `▾`, breadcrumbs after `›`, the inbox badge and date on the right; the status bar lists
  `key label` pairs as in the designs.
- **Keys win over a drawing where they conflict with an architecture rule.** The quick-capture mock shows
  "enter save"; the rule that Enter is always a new line in text entry (browser terminals send Shift+Enter as
  Enter) stays, so capture saves with Ctrl+S as today and the design is corrected. *(My call.)*
- **Where the 2026-11-20 designs show part of a screen**, the rest of that screen stays as it is. Attention keeps
  its current panels (Due this week, Late milestones, High risks & issues …) and gains the Upcoming meetings panel
  on top; the new design only shows the panels it changes. *(My call.)*
- **Screen 1 is called "Attention"** in both sets of designs; the TUI currently calls it "Overview" and is renamed.

**How it is checked**

- Every screen in the designs gets a frame test at 118×36 seeded with the design's example data (today Fri 20 Nov
  2026), asserting the rows of text the design shows, in order (panel titles, headers, rows, status bar).
- A spans test per screen checks the colours of the elements listed above.
- At 80×24 the same screens degrade by dropping columns and status-bar hints from the right, never by cutting codes
  or names (existing rule).
- Before each merge request, the user compares the running TUI side by side with the designs; differences are
  fixed or written down as accepted.

## 4. The actions plugin

**Data** (`actions_*`):

- `action`: `id`, `title`, `due_date`, `status` (open / done / dropped), `done_date`, `owner_id` (soft reference to
  a person; null = you), `notes`, timestamps. Display ref `A-<id>`.
- `link`: `action_id` → action (no ON DELETE action), `record_type`, `record_id`, unique per triple. Any registered
  record type can be linked: `project`, `person`, `meeting`, and later others.

**Moving existing actions:** every `projects_action` row becomes an `actions_action` row with **the same id**, so
`A-27` stays `A-27`. Its `project_id`, `for_person_id` and `meeting_id` become links; `owner_id`, dates, status
and notes carry over; provenance (`kernel_record_origin`, change-set history) follows the same ref. The move is
one-time, atomic (all or nothing), idempotent (running it twice changes nothing) and leaves the projects plugin
without actions. Plugins cannot read each other's tables, so the projects plugin exposes the rows through an
operation and the actions plugin imports them; the exact mechanism (which plugin starts it, how the drop of
`projects_action` is sequenced, which kernel help is needed) is left to the builder within these rules.

**CLI:** `ttybrain action add|list|show|edit|done|drop|link|unlink`, same flags as today plus `--link <ref>`
(repeatable: `#CRM`, `@anna`, `M-12`). `list` filters: `--mine`, `--owner`, `--link`, `--due`.
*(My call, for Copilot and scripts:)* today's `--project`, `--for` and `--meeting` flags stay as shorthand for links,
and `show`/`list --json` keep today's `project`, `for` and `meeting` fields (derived from the first link of that
type) next to a new `links` array.

**TUI:**
- Screen 4 Actions moves to this plugin, with the "Linked to" column of the design.
- An Actions tab on every record type that has links (project, person, meeting).
- The Attention panels "Overdue actions" and "Due this week" move to this plugin.
- Projects' prep blocks, the board pack and the minutes get their actions from this plugin (published view or
  exposed read), and keep working when actions is off (sections simply empty).

## 5. Meetings

### 5.1 Subjects and kinds

Every meeting has one **subject**: a person or a project (a record ref). Its **kind** follows from it:

| Kind | Subject | Agenda | Prep |
|---|---|---|---|
| 1:1 | a person | that person's talk-list | their open actions, goals, last notes, projects |
| project | a project | that project's talk-list (+ project-tagged items from people's lists) | project status since the last meeting of the series |
| board | a board such as `#MB` (§5.7; was a project such as `BOARD`) | agenda items naming other projects, with asks; plus the board project's talk-list | one prep block per project, as today |

A stakeholder can be the subject of a meeting too (kind 1:1). *(My calls:)* the kind is chosen on the series or
one-off meeting (the form's Kind field): 1:1 needs a person, project and board need a project; any project can host
board meetings. Existing meetings keep their kind when they get a subject: `board` stays board, `steering` and
`other` become project, or 1:1 when the subject is a person.

### 5.2 Series and occurrences

- A **series** has a subject, title, kind, rhythm, first date, optional end date and default attendees.
- **Rhythm** is a short phrase: `weekly on <day>`, `every <n> weeks on <day>`, `monthly on the <1st|2nd|3rd|4th|last>
  <day>`, `monthly on day <n>`. The form shows the next dates it produces. Dates only, no time.
- **Occurrences** are ordinary meetings created ahead (the next 8 weeks), so one date can be moved or skipped
  without changing the series. A one-off meeting is an occurrence without a series.
- **Auto-close:** a meeting not closed 3 days after its date closes itself (notes kept, unticked items carried).
  Until then it shows under "Held, closes itself <day>". *(My call:)* existing meetings without a subject never
  close themselves; auto-close applies once they have one, and only to dates after the upgrade.

### 5.3 Talk-lists

- A **talk item** has a subject (person or project), text, an optional project tag, the date added, its position,
  and a status: open, discussed (with the meeting it was discussed in) or dropped.
- A person-subject item tagged with a project also appears on that project's next meeting until it's discussed in
  either place (user's decision).
- **Agreed actions are real actions at once** (`A-n`, linked to the meeting and its subject), so they show on
  screen 4 during the meeting; the close message says how many were agreed. *(My call: no pending rows.)*
- In a meeting, `Space` ticks an item discussed. Closing the meeting keeps unticked items open for the next one.
- Adding: `n` on the Talk tab, `t` on a person or project or on an upcoming meeting, and quick capture: a capture
  that starts with `talk` and tags a person or project goes onto that talk-list instead of the inbox. This needs a
  small new extension point so the inbox's capture overlay can hand such text to the meetings plugin; it is added to
  the plugin API (`captureRoute` or similar; name and shape are the builder's call, documented with the other
  extension points).

### 5.4 Screens (see the designs)

- **Attention (1):** "Upcoming meetings · next 7 days" panel with To talk and Your act. counts; your actions for the
  selected meeting.
- **Meetings (5):** Upcoming by week, Series with rhythm, Held, closes itself.
- **Person:** Talk and Meetings tabs (team members and stakeholders).
- **Project:** Meetings and Talk tabs; a board project's meetings have the Agenda · Prep · Notes · Export tabs.
- **Meeting in progress:** Talk (tick), Agreed actions, Notes; close.
- **New recurring meeting** form; **quick capture to a talk-list**.

### 5.5 Existing meetings

Today's meetings have no subject. They are kept as they are and listed with subject "—" until the user assigns one;
`ttybrain meeting subject <M-n|--all-without> <ref>` assigns it (for example all of them to `#BOARD`). New
meetings always need a subject. *(My call; avoids the meetings migration creating projects in another plugin.)*

### 5.6 CLI

`ttybrain meeting series add|list|edit|end`, `ttybrain meeting add` (one-off, `--about <ref>`), `ttybrain meeting
skip|move <M-n>`, `ttybrain talk add|list|done|drop|move <ref> …`, existing `report board|minutes` unchanged.

### 5.7 Boards (amendment, 2026-11-23)

*User's decision:* a board meeting does not belong to a project. Boards are their own records in the meetings plugin, and replace the "board is a project such as `BOARD`" rule of §5.1.

- **A board** has a code (2–16 letters or digits, upper-cased like project codes), a name and an optional note, e.g. `#MB` "Management board". It is written with `#`, like a project: `talk add #MB …`, `meeting series add #MB "Board" --every "monthly on the last fri"`, `action add … --link #MB`, quick capture `talk #MB …`. Project and board codes share one namespace: `#MB` is either a project or a board, and adding either one refuses a code the other already uses.
- **Subjects:** a meeting's subject is a person, a project or a board. Kind `board` needs a board subject, and a board subject always means kind `board`. Kind `project` needs a project; `1:1` a person.
- **What a board has:** its series and one-off meetings, its talk-list (the "Board talk-list" in a board meeting; `A` adds an item to the agenda), and the actions linked to it. Board meetings keep the board machinery: agenda items naming projects with asks, a prep block per project, the board pack and the minutes.
- **TUI:** screen 5 gets a "Boards · n" panel under Series (code cyan, name); Enter opens the board's view with two tabs, Meetings and Talk, laid out like a project's Meetings and Talk tabs. A board meeting's crumb runs under its board (`5 Meetings ▾ › #MB Management board › Board Fri 27 Nov`). Boards show as `About` on Attention and screen 5 like project codes (cyan).
- **CLI:** `ttybrain board add <CODE> <name> [--note]`, `board list`, `board show <#CODE>`, `board edit <#CODE> [--name] [--code] [--note]`, `board archive|restore <#CODE>`.
- **Existing data:** a project that is the subject of board-kind meetings or series gets a board with its name and the code `<CODE>B` (codes can't be shared); those meetings and series move to it, and a notice names the new board so it can be renamed. The project, its talk items and its other data stay as they are (it can be archived by hand). Subject-less board meetings stay subject-less until `meeting subject … #MB`.

## 6. Constraints

- Plugin isolation: each plugin keeps its own tables; cross-plugin links are soft refs by id; reads through published
  views and exposed operations only; each plugin works with the others switched off.
- Bun and Node 26 both work; CLI conventions (`--json`, exit codes, hints) as today.
- Dates come from the kernel clock (tests use a fixed clock).
- Migrations follow architecture rule 6 (no ON DELETE actions on tables that may be rebuilt).

## 7. Delivery

Three projects, each with its own plan and merge request:

0. **Look and feel pass** (first, user's decision): bring every existing screen up to the designs (section 3): theme
   colours, header and status bar, screen 1 renamed Attention, tab names (a project's first tab is "Overview"),
   panels, columns, wording and keys, with a frame and a spans test per designed screen. No data changes.
1. **Actions plugin**: the plugin, the move of existing actions, the screen-4 and Actions-tab screens as designed.
2. **Meetings rework**: subjects, series, occurrences, talk-lists, quick-capture route, the new and changed screens,
   existing meetings' subject command.

## 8. Left to the builder

- The mechanism of the one-time action move (section 4), within its rules.
- The capture-route extension point's name and shape (section 5.3).
- Table layouts beyond the fields named here; how occurrences are generated (at boot, on read, or by command).
