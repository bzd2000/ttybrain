# ttybrain TUI vs screen designs: gap analysis

Baseline: branch `feature/meetings-actions-design` (main + docs), worktree `/home/coder/project/.claude/worktrees/pm-phase4`.
Designs: `docs/superpowers/specs/2026-11-13-pm-screens.html` (the reference here), with
`2026-11-20-ttybrain-meeting-screens.html` checked only for which of its screens exist. "Exactly" follows
`2026-11-20-ttybrain-meetings-actions-design.md` §3.

Method: a throwaway script (`scratchpad/dump.tsx`, not in the repo) boots `makeTestKernel` with the built-ins
(fixed clock **Thu 12 Nov 2026**), seeds data close to the mocks (ERP/CRM/HRP/DWH/IAM/SEC + BI2 on hold, 11 people,
milestones, deliverables, 4 risks, a decision, M-1 SteerCo 28 Oct held, M-2 Steering committee Q4 4 Dec with a
5-item agenda, 11 actions, contact notes, CRM context, 5 inbox items) and renders each screen at **118×36** with
`renderTui`, dumping `frame()` and `spans()` (fg/bg/attributes). The dumps are in `scratchpad/out/*.txt`. IDs differ
from the mocks (A-1… instead of A-27…) because the seed started at 1, and that isn't counted as a difference.

Legend: **FEATURE** means the design shows behaviour or data the code doesn't have at all, so it may be out of
scope for a look-and-feel pass. "src" paths are under `src/`.

---

## 0. Shared frame

### Matches
- Header and status bar each take one line on `#181b24` (theme.panel), and the main area sits on `#11131a`.
- The right side of the header shows the inbox badge and then the date, in the right format: `Thu 12 Nov 2026`, muted.
- The chip shows `<slot> <Title> ▾` in accent.
- Panel borders are `#2e3442` and turn accent `#7aa2f7` while the panel has focus. Titles sit on the top border and
  read `Title · n`.
- In the status bar, keys are accent and labels muted.
- Selected rows use `#283457`, and only the focused list shows its selection, as in the mocks.
- Tabs pad each title by 1 on each side with a 1-cell gap. The active tab gets the selected background and accent text.
- Theme hex values match the mock palette exactly for the 11 tokens that exist (see §12).

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| F1 | `ttybrain` is **bold accent** and the `·` is muted (§3 wording; the 2026-11-13 mock says `pm`) | `ttybrain · ` is one muted string with no bold | kernel/tui/frame.tsx:25 |
| F2 | The chip `.dd` sits on the selected-row bg `#283457` with 1-cell padding | Accent text with no background or padding | kernel/tui/frame.tsx:26 |
| F3 | The chip shows `▴` while the switcher is open | Always `▾` | kernel/tui/app.tsx:151 |
| F4 | Screen 1 is called "Attention" | "Overview" | kernel/tui/app.tsx:89 (also `OVERVIEW_ID`, nav.ts:35) |
| F5 | Breadcrumb `› CRM CRM replatforming`, with the code **cyan** and the record label after it; the People screen shows its tab (`› All`); a meeting shows `› M-4 Steering committee Q4 · Thu 4 Dec · 8 attendees` (the tail muted) | `› CRM` (the ref only, in text colour), and each record opened stacks another crumb (`› @peter › @anna`, `› M-2 › M-2 › M-2`); no tab crumb; no muted tail | kernel/tui/frame.tsx:27, kernel/tui/nav.ts:79-83 |
| F6 | Nothing between the header and the tabs | The record view adds its own line `› CRM CRM replatforming` under the header, so every record screen loses a row | kernel/tui/components/RecordView.tsx:56-58 |
| F7 | The inbox badge `● 3 new in inbox` is **amber** | Text colour `#c0caf5` | kernel/tui/frame.tsx:16 (Badge), plugins/inbox/tui/index.tsx:18-24 (the badge API has no tone) |
| F8 | The header chip names the screen the record belongs to (`2 Projects ▾ › CRM`) | The chip stays on whichever screen was current before the record opened (inbox, then a record → `6 Inbox ▾ › CRM`) | kernel/tui/app.tsx:151 + nav route |
| F9 | Status bar labels are lowercase (`tab panel`, `enter open`, `esc back`, `x done`, `i capture`) with **3** cells between pairs | Keys are capitalised (`Tab`, `Enter`, `Esc`, `Del`, `Ctrl+S`) with 2 cells between pairs | kernel/tui/frame.tsx:45 (HINT_GAP), each screen's HINTS (see the screens below) |
| F10 | Every screen's bar ends with `i capture` (Attention also has `g or 1-6 screens`, `? help`, `q quit`; Projects has `? help`) | `i capture` never shows. Every screen appends `g screens ? help q quit` (FRAME_HINTS), and `? help`/`q quit` are pinned | kernel/tui/keys.ts:39-43, kernel/tui/app.tsx:40, 99-103 |
| F11 | Lists start with `↑↓ select` (or `↑↓ move`) | The Table registers only `Enter open` (no ↑↓ hint) | kernel/tui/components/Table.tsx:164-166 |
| F12 | Unfocused panel titles are **muted** `#737aa2`. Focused titles are accent | Titles take the border colour (`#2e3442` when unfocused, so nearly invisible) because OpenTUI's `titleColor` defaults to `borderColor` | kernel/tui/components/Panel.tsx:12-13 (no `titleColor`) |
| F13 | The title has a space on each side (`─ Overdue actions · 3 ─`) | `┌─Overdue actions · 3──` with no padding | kernel/tui/components/Panel.tsx:8 |
| F14 | Borders are rounded (`border-radius: 6px`, so `╭╮╰╯`) | Square `┌┐└┘` | Panel.tsx:10-11 (no `borderStyle="rounded"`) |
| F15 | The footer (`.bt`) sits **on the bottom border, right-aligned**, muted | The footer is a text line inside the panel, left-aligned at the bottom, and costs a row | kernel/tui/components/Panel.tsx:23 |
| F16 | Selection is a row background only, with no marker | An accent `›` marker column (1 cell, plus a gap) on every row | kernel/tui/components/Table.tsx:40, 177-180 |
| F17 | Group rows inside lists have their own colour and wording per screen (Actions `Overdue` red, `This week`/`Next week` accent; People `Stakeholders · 20` accent) | Every group header is muted, and `· n` is always appended unless `count:false` | kernel/tui/components/Table.tsx:64, 236-239 (no tone or count option per group) |
| F18 | The active tab's whole label is one colour (accent `Milestones 5`) | The title is accent, but the count stays muted even on the active tab | kernel/tui/components/Tabs.tsx:78-81 |
| F19 | Overlays (switcher, capture) dim the screen behind them | No dimming | kernel/tui/app.tsx:166-172 |
| F20 | Overlays sit where each mock puts them: the switcher drops down under the chip at the left; capture is centred at about 44% height, 76 columns wide | Every overlay is horizontally centred at `top={2}` | kernel/tui/app.tsx:168 |

### Code-only (not in the design)
- The `Help` overlay (`?`), which lists the keys, "Here" and "Plugin problems" (components/Help.tsx).
- The "Terminal too small (need 60×15)" fallback (app.tsx:153).
- The status bar's 5-second messages (frame.tsx:80).

---

## 1. Screen switcher (`g`)

### Matches
- Lists screens 1–6 as `slot title` with right-aligned counts.
- ↑↓/jk move, Enter goes, 1–9 jump, Esc closes.
- The selected row uses the selected-row bg with accent text.

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| S1 | A dropdown hanging under the chip (left about 4 columns, 26 columns wide), focused border, no title | A centred box 36 wide with the title `Screens`, on the `#181b24` bg | kernel/tui/components/Switcher.tsx:56, app.tsx:168 |
| S2 | Row `1  Attention   7`: the slot is muted, the selected row has no marker | `› 1 Overview`, with the slot in the same colour as the title and a `›` marker on the selected row | Switcher.tsx:60 |
| S3 | Count tones: Attention **red**, Inbox **amber**, the rest muted | All counts muted | Switcher.tsx:62 |
| S4 | Attention has a count (7) | Overview has no count | app.tsx:89 (no `count`) (**FEATURE**: a total of attention items) |
| S5 | The name is "Attention" | "Overview" (F4) | app.tsx:89 |
| S6 | Bar: `↑↓ move  1-6 jump  enter go  esc close` | `↑↓ move  Enter go  1–9 jump  Esc close` (different order, case and range) | Switcher.tsx:27-32 |

---

## 2. Screen 1: Attention (current "Overview")

### Matches
- Two equal columns. The panel order and placement match: left Overdue, Projects needing attention, High risks;
  right Due this week, Late milestones, Stakeholders.
- Titles `Overdue actions · 3`, `Due this week · n` and `High risks & issues · 3` match.
- No column headers. Overdue `-3d` is red, ids are muted, the project `—` is muted, and this week's due dates show as
  weekdays (`Fri`, `Sun`).
- The project dots are red/amber/muted; `upd 9d ago` is muted, and `Health not updated` is muted with an amber age.
- The milestone `-6d` is red and the future date `26 Nov` is plain. Risk `risk`/`issue` is red.
- Stakeholders: `high/high · CRM, HRP` is muted and the age is amber.
- `+N more` text. The first panel has focus and its first row is selected.

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| A1 | Name `Attention` (header chip and switcher) | `Overview` | app.tsx:89 |
| A2 | Project codes **cyan** `#7dcfff` | Accent `#7aa2f7` | plugins/projects/tui/panels.ts:9, 55, 73, 88 |
| A3 | Stakeholder names **magenta** `#bb9af7` | Text colour | plugins/people/tui/index.tsx:71 |
| A4 | `Projects needing attention` has no count in its title | `Projects needing attention · 5` (Panel always adds the count) | kernel/tui/components/OverviewScreen.tsx:100 |
| A5 | `Stakeholders to contact` has no count in its title | `Stakeholders to contact · 3` | OverviewScreen.tsx:100 |
| A6 | `Late milestones · 2` (counts only the late ones), then a muted sub-heading `Next 14 days`, then the upcoming ones | One list titled `Late milestones · next 14 days · 3`, with no sub-heading | plugins/projects/tui/panels.ts:63-79 (needs group support in overview panels) |
| A7 | The stakeholder footer reads `last contact over 30 days, high influence first`, as a muted last row | `last contact 30+ days ago, high influence first` (different wording) | plugins/people/tui/index.tsx:64 |
| A8 | Grid rows: each pair of panels shares a row and starts on the same line (CSS grid) | Each column is laid out on its own (masonry), so the right column's panels drift against the left ones (e.g. Stakeholders starts at line 11, High risks at 13) | kernel/tui/components/overviewLayout.ts:69-99 |
| A9 | Columns are fixed 5 / 1fr / 7 / 7 (id, title, code, due) | Every column but one fits its content (max 16); the widest one grows | OverviewScreen.tsx:89-96 |
| A10 | `○ IAM  Health not updated  31d ago`; on-hold projects aren't listed | Shows `never` for a project that was never updated (data), and **includes the on-hold project BI2** (only closed ones are excluded) | plugins/projects/logic/overview.ts:35-38 (`status != closed`) |
| A11 | Only high-influence stakeholders appear (Marie, Luc) | Also lists `Nadia El Amrani low/low never` (sorted last) | plugins/people/tui/index.tsx:61-75 / people logic `staleStakeholders` |
| A12 | Due this week includes **deliverables** (`D-8 Solution design v1 · Anna  CRM  Fri`) | Actions only | plugins/projects/logic/overview.ts:30-34 (**FEATURE**) |
| A13 | Bar: `tab panel  enter open  x done  i capture  g or 1-6 screens  ? help  q quit` | `Tab next panel  ↑↓ move  Enter open  g screens  ? help  q quit`: **no `x done`**, no `i capture` | OverviewScreen.tsx:66-72 |
| A14 | `x` marks the selected action done | `x` does nothing on the Overview | OverviewScreen.tsx:35-39 (**FEATURE**: panel row actions) |
| A15 | Selected row: background only | `›` marker as well (F16) | Table.tsx:179 |

### Code-only
- An **Inbox · 3** panel (left column, last). The design doesn't have it. plugins/inbox/tui/index.tsx:27-40. Keep or drop?
- Empty texts per panel ("No overdue actions." …): the design shows no empty state.

### 2026-11-20 additions (excluded, later projects)
The `Upcoming meetings · next 7 days` panel (with `Before 1:1 Anna · your actions` and the `t to talk` key) doesn't
exist.

---

## 3. Screen 2: Projects

### Matches
- One focused grow panel titled `Projects · <n> active`.
- Columns in the design's order: dot, Code, Name, Next milestone, Due, Act., Risk, Effort, with the same muted headers.
- Rows sort by health and then next milestone. Overdue due dates (`-6d`, `-1d`) are red. Future dates read `26 Nov`/`8 Dec`/`15 Jan`.
- A muted `On hold · n` group header. Effort reads `60pd`.
- Keys n, h, /, a and Enter exist.

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| P1 | Code **cyan** | Text colour | plugins/projects/tui/projects-screen.tsx:78 |
| P2 | Effort muted | Text colour | projects-screen.tsx:84 |
| P3 | The Risk count is red for some projects (ERP 3, CRM 2 are red; HRP 1 and DWH 2 aren't), apparently when a high-severity item is open. The mock isn't consistent here (DWH has a high risk), so this needs confirming | Plain | projects-screen.tsx:83 |
| P4 | On-hold rows: the symbol is `◌` muted, and **every cell is muted** | `○` muted dot (no health), other cells in text colour | projects-screen.tsx:77-85 |
| P5 | Widths: dot 2, Code 5, Name 1fr, Next milestone 21, Due 7, Act. 6, Risk 6, Effort 7, plus a 2-cell gap | Marker 1, dot 1, Code fit (4–16), Name grow, Next 20, Due 6, Act. 4, Risk 4, Effort 6, plus a 1-cell gap | projects-screen.tsx:140-149, Table.tsx:41 |
| P6 | The bottom-border footer `filter: status=active` is **always shown** | The footer shows only while a free-text filter is set (`filter: <text>`), inside the panel | projects-screen.tsx:197 |
| P7 | A long list collapses to `  … 17 more` (muted), with On hold below it | The list scrolls (Table) | Table.tsx (design choice: probably keep scrolling) |
| P8 | Bar: `↑↓ select  enter open  n new  h health  / filter  i capture  ? help` | `Enter open  n new  e edit  h health  / filter  a archived  g screens  ? help  q quit` | projects-screen.tsx:33-40 |

### Code-only
- `e edit` and `a archived` in the bar. The screen description in the design lists `a show archived` but the bar
  doesn't, so this is fine to keep.
- A `Closed · n` group and `Archived · n` (after `a`).

---

## 4. Project detail (record view, first tab)

### Matches
- Tab order: first tab, Milestones, Deliverables, Risks & issues, Decisions, Actions, People, Context.
- The left side has the Health/Status/Dates/Effort/Sponsor/Team facts, with muted labels and the same wording
  (`1 Sep 2026 → 30 Jun 2027`, `220 person-days (incl. vendor)`, team as first names), then the description.
- The right side has the short lists Milestones (`✓` green, `○`), Deliverables, Open risks & issues (`R-n` muted, `high` red, `medium` amber, type muted) and Recent decisions (date muted).
- Keys `h` (health) and `e` (edit) work.

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| D1 | The first tab is called `Overview` | `Summary` | plugins/projects/tui/index.tsx:59 |
| D2 | Tab counts are totals (`Milestones 5`, `Deliverables 6`, `Risks & issues 4`) | Counts are open items only (`Milestones 2` while the tab's panel says `Milestones · 3`; deliverables exclude delivered) | plugins/projects/tui/index.tsx:75-79 (the design isn't explicit, so this needs confirming) |
| D3 | There's a blank line, then the tabs straight under the header | An extra `› CRM CRM replatforming` line comes first (F6) | RecordView.tsx:56-58 |
| D4 | **Bordered panels**: `Overview` on the left; `Milestones` (focused), `Deliverables`, `Open risks & issues`, `Recent decisions` stacked on the right. The column ratio is 1 : 1.25 | No panels: plain headings in **accent** with unbordered rows, and equal columns | plugins/projects/tui/project-summary.tsx:57-80, 155-210 |
| D5 | `Tab panel` moves focus between the right-hand panels; the focused panel shows a selection (`Design approved`); `n new`, `e edit` and `x done` act on the selected row | The Summary takes no list keys and has no focus or selection | project-summary.tsx:142-148 (**FEATURE**) |
| D6 | Health: `● amber` amber, then ` · 10 Nov` **muted** | The whole `● amber · 10 Nov` is amber | project-summary.tsx:157-159 |
| D7 | The health comment is **muted** and indented under the value (16 columns) | Text colour, at column 0 | project-summary.tsx:160 |
| D8 | Fact labels are 14 columns wide with a 2-column gap (values at 16) | 9 columns | project-summary.tsx:49 |
| D9 | `(incl. vendor)` muted | Text colour | project-summary.tsx:169 |
| D10 | Sponsor in **magenta** | Text colour | project-summary.tsx:171 |
| D11 | The description is **muted** | Text colour | project-summary.tsx:178 |
| D12 | Milestones: the done one's title and date are muted; open dates use the text colour | Done titles use the text colour; **all** dates are muted | project-summary.tsx:135-139 |
| D13 | Deliverables include **delivered** ones (`Solution outline Anna delivered 10 Oct`) | Delivered ones are filtered out | project-summary.tsx:119 |
| D14 | Deliverable owner as a first name (`Anna`) in text colour | The handle (`anna`), muted | project-summary.tsx:189 |
| D15 | Deliverable status coloured: delivered **green**, in review **cyan**, in progress **amber** | Muted | project-summary.tsx:190 |
| D16 | Deliverable due date: `Fri` (a weekday within the week) in text colour, past dates muted | `13 Nov`, muted (or red when late) | project-summary.tsx:191 |
| D17 | Risk severity `med` (6-column cell) | `medium` | project-summary.tsx:199 |
| D18 | Bar: `←→ tabs  tab panel  n new  e edit  x done  h health  esc back  i capture` | `←→ tabs  Esc back  h health  e edit  g screens  ? help  q quit` | RecordView.tsx:18-21, project-summary.tsx:29-32 |

### Other tabs (not drawn in the design, observed)
- Milestones tab: the panel title is `Milestones · 3` while the tab says `Milestones 2` (D2). `MS-n` refs use the text
  colour instead of muted. `✓` uses the text colour instead of green. A **done** milestone shows its due date as
  `-29d` (relative, as if overdue): plugins/projects/tui/item-tab.tsx:57-63 (`dueLabel` used for done items).
- Item tabs use the generic Table with a `Ref` column. The design has no list-tab mock, so only the colour rules apply
  (refs muted, codes cyan, people magenta).

---

## 5. Project context (Context tab)

### Matches
- Title text `Context · markdown`. The footer has `updated <d> · <n>%`.
- Headings are accent and bold (attribute 1). ↑↓ scrolls and `e` edits.
- The empty state matches the design word for word: plugins/projects/tui/project-context.tsx:23.

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| C1 | A **focused bordered panel** titled `Context · markdown`, with the footer `updated 6 Nov · via mcp · 38%` on the bottom border, right | No panel: the title is a plain text line, and the info sits at the right of that line at the **top** | project-context.tsx:106-115 |
| C2 | The footer names the source (`via mcp`) | No source | project-context.tsx:100-103 (**FEATURE**: provenance of the context's last write) |
| C3 | Heading markers stay visible (`# Background`, `## Scope phase 1`) | Markers are hidden (OpenTUI conceal on by default) | project-context.tsx:124 (`<markdown>` without `conceal={false}`) |
| C4 | Bullets `•` muted | `-` in accent | project-context.tsx:44 (`markup.list`) |
| C5 | Tables are plain columns with a muted header row and no borders | A boxed grid with grey `#888888` borders (an OpenTUI default, not a theme colour) and **accent bold** header cells | project-context.tsx:124 (no `tableOptions={{ style: "columns" }}`/`borderColor`) |
| C6 | `**Out of scope:**` is bold in the text colour | Bold, `#ffffff` (no fg on `markup.strong`) | project-context.tsx:39 |
| C7 | Link text **cyan**, then ` · url` muted | Link text in text colour, then `(` and `)` underlined in accent, with the url muted | project-context.tsx:42-43 |
| C8 | Bar: `↑↓ scroll  e edit in $EDITOR  ←→ tabs  esc back  i capture` | `←→ tabs  Esc back  ↑↓ scroll  e edit  E edit in $EDITOR  g screens  ? help  q quit` | project-context.tsx:24-28 |

### Code-only
- `e` opens the built-in editor, and `E` (not `e`) opens `$EDITOR`. The design binds `e` to `$EDITOR`. Keep both?

---

## 6. Screen 3: People

### Matches
- Tabs `All n  Stakeholders n  Team n` in the right order and form.
- Left `People · n` (focused, ratio 1.7) and right panel titled with the selected person's name.
- Footer text `sort: influence, then last contact`.
- Headers `Name Role Projects Infl. Int. Last`.
- Groups: Stakeholders, then Team. `low` is muted. A stale high-influence `41d`/`35d` is amber.
- The right panel has the Role/Projects/Influence/Email facts (10-column labels), then Open follow-ups and Interactions (date muted).
- Keys o, /, a/s/t, n and Enter exist, and so does the `infl:high` filter (people-list.ts:33).

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| E1 | Header crumb `› All` (the active tab) | None | kernel/tui/frame.tsx:27 (screens can't set crumbs) |
| E2 | A blank line before the tabs | The tabs sit on the first line | plugins/people/tui/people-screen.tsx:222 |
| E3 | Group rows `Stakeholders · 20`/`Team · 11` in **accent** | Muted | Table.tsx:237 |
| E4 | Stakeholder names **magenta**; team names text colour | All text colour | people-screen.tsx:75 |
| E5 | Project codes **cyan** | Text colour | people-screen.tsx:77 |
| E6 | Team `—` in Infl./Int. muted | Text colour | people-screen.tsx:69 (`level(null)` has no tone) |
| E7 | Last contact: muted for low-influence people (`60d`, `20d`, `14d`) | Text colour unless never (muted) or stale-high (amber) | plugins/people/tui/people-list.ts:24-27 |
| E8 | Widths: Name 16, Role 1fr, Projects 9, 5/5/5, plus a 2-cell gap | Name 18, Role grow, Projects 9–18, 5/5/6, plus a marker and a 1-cell gap | people-screen.tsx:60-67 |
| E9 | The footer is on the bottom border, right | Inside, as the last line (F15) | people-screen.tsx:145, Panel.tsx:23 |
| E10 | Right panel `Projects`: codes cyan, `CRM sponsor · ERP steerco` | Plain text (and it wraps when long) | plugins/people/tui/person-detail.tsx:142 |
| E11 | Right panel `Influence high · interest high`: the ` · interest` is muted | All text colour | person-detail.tsx:144 |
| E12 | The sub-headings `Open follow-ups` and `Interactions` are **muted** (`.row.h`) | Accent | person-detail.tsx:39 |
| E13 | Follow-up columns 5 / 1fr / 5; overdue `-3d` red | Same tones, with a 6-column due | person-detail.tsx:123-128 |
| E14 | A team member's right panel uses **tabs**: `Projects & roles · Actions · 1:1 notes · Goals` (design note) | Short lists `Open actions / 1:1 notes / Goals`, with no tabs | person-detail.tsx:155-166 (**FEATURE**/layout) |
| E15 | Groups of people as stakeholders (`Sales key users · group · 6 people`) | Not modelled | (**FEATURE**) |
| E16 | Long groups collapse to `  … 12 more` | Scrolls (P7) | Table.tsx |
| E17 | Bar: `↑↓ select  enter open  o sort  / filter  a all  n note  s stakeholders  t team  i capture` | `Enter open  n note  N new  e edit  o sort  / filter  a s t tabs  A archived  Del archive  r restore  ? help  q quit` (`g screens` already dropped for width) | people-screen.tsx:41-52 |

### Code-only
- `N new`, `e edit`, `A archived`, `Del archive`, `r restore`; the `Archived` group.
- The person **record view** (Enter): tabs `Summary, Notes, Goals, Projects & roles, Actions`, a line
  `@peter · Stakeholder`, unbordered short lists. The design has no full-screen person view. It only describes the
  right-hand panel. plugins/people/tui/index.tsx:108-130, person-tabs.tsx.

---

## 7. Screen 4: Actions

### Matches
- One focused panel `Actions · n open`.
- Headers `ID Action Proj. Owner For / from Due` in the design's order, with ID 5, Owner 9 and For/from 16 wide.
- Groups Overdue / This week / Next week / Later / No date, in that order.
- Overdue due dates are red, and this week shows weekdays (`Fri`, `Sun`).
- Owner shows `me` or a first name. For/from shows the person name, else the meeting, else `inbox I-n`, else `—`.
- The footer text `status:open`. Keys x, d, e, n, / and Enter.

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| T1 | Group rows: `Overdue` **red**, `This week`/`Next week` **accent**, **no counts** | All muted, with `· n` | plugins/projects/tui/actions-screen.tsx:151-154, Table.tsx:64, 237 |
| T2 | `Later` and `No date` collapse into one muted line `Later · 34   No date · 3` | Both list every row | actions-screen.tsx:144-155 (**FEATURE**: collapsed groups) |
| T3 | IDs muted | Text colour | actions-screen.tsx:136 |
| T4 | Proj. code **cyan**; no project is `—` muted | Text colour; no project is blank | actions-screen.tsx:138 |
| T5 | Owner `me` muted; names in text colour | `me` in text colour | actions-screen.tsx:139 |
| T6 | For/from: a person is **magenta**; a meeting or source is **muted** and includes the date (`SteerCo 28 Oct`, `SteerCo 4 Dec`, `1:1 Sofie`, `inbox I-14`) | Everything in text colour; a meeting shows its title only (`SteerCo`, `Steering commit…`) | actions-screen.tsx:106-109, 140 |
| T7 | Next week's due dates show as weekdays (`Mon`, `Tue`, `Wed`) | `16 Nov` (`dueLabel` uses weekdays only up to the end of this week) | actions-screen.tsx:141, kernel/tui/format.ts:119 |
| T8 | Due column 7 wide, plus a 2-cell gap | 6 wide, plus the marker and a 1-cell gap | actions-screen.tsx:174 |
| T9 | Footer `status:open` on the bottom border, right | Inside, at the bottom left (F15) | actions-screen.tsx:225 |
| T10 | Bar: `↑↓ select  x done  d due  e edit  / filter  n new  i capture` | `Enter open  x done  d due  e edit  n new  / filter  g screens  ? help  q quit` (n and / swapped, no i) | actions-screen.tsx:37-44 |

### 2026-11-20 additions (excluded, later projects)
The actions plugin with a `Linked to` column (`ID Action Owner Linked to Due`) and `Next week · 23–27 Nov` group
titles doesn't exist. Actions still live in the projects plugin.

---

## 8. Screen 5: Meetings list (no 2026-11-13 mock; only the 2026-11-20 one, which is out of scope)

The current screen is one panel `Meetings · n` with `Upcoming · n` and `Past · n` groups and the columns
`Ref Date Title Kind Status Att. Projects` (plugins/meetings/tui/meetings-screen.tsx:47-53, 84-90, 167). The
2026-11-13 designs have no list mock, so there's nothing to compare. The 2026-11-20 "Meetings" overview (Upcoming by
week + `Series · 7` with a rhythm, the `n`/`N`/`s` keys) **doesn't exist** (later project). Colour rules would still
apply: refs muted, codes cyan.

---

## 9. Meeting prep (meeting record, Prep tab)

### Matches
- Tabs `Agenda Prep Notes Export` in the right order.
- An Agenda panel on the left (32 columns against the design's 34), with numbered items `1. …` and codes on the right.
- A `Prep · <project name>` panel on the right.
- Sections in the design's order: Health, Milestones, Deliverables, Risks & issues, Decisions, Actions, then `Ask for this meeting` with the text.
- `◐` for deliverables, `▲` red for high risks, `!` red for overdue actions.
- The footer says `since SteerCo 28 Oct`.
- Keys ↑↓ item, e edit ask, a action, D decision.

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| M1 | Breadcrumb `› M-4 Steering committee Q4 · Thu 4 Dec · 8 attendees` (the tail muted) | `› M-2` in the header, plus an extra line `› M-2 Steering committee Q4` | frame.tsx:27, RecordView.tsx:56-58 |
| M2 | Tabs have no counts (`Agenda`, `Notes`) | `Agenda 5`, `Notes 1` | plugins/meetings/tui/index.tsx:72, 75 |
| M3 | The **Prep panel has focus** (accent border); the agenda keeps a visible selection | The Agenda panel has focus; the Prep panel never does | plugins/meetings/tui/agenda-list.tsx:80, prep-tab.tsx:135 |
| M4 | Agenda: unselected numbers (`1.`) muted; codes **cyan** | The number is part of the item text (text colour); codes muted | agenda-list.tsx:72 |
| M5 | **Attendees inside the Agenda panel**: a muted `Attendees` heading, then short names (`Peter J., Marie D., Luc V., Tom M., Anna, Bob +2`) with stakeholders in magenta, team as first names, `+2` muted | Below the panel; heading in accent; full names in alphabetical order (`Anna Peeters, Bob Willems, Karim Haddad +5`) in text colour | agenda-list.tsx:76, 90-97 |
| M6 | Section headings muted (`.row.h`) | Accent | kernel/tui/components/ReportSections.tsx:47 |
| M7 | Section titles `Decisions since last meeting`, `Overdue actions` | `Decisions`, `Actions` | plugins/meetings/logic/reports.ts:166, plugins/projects/logic/report.ts:91, 110 |
| M8 | Health as one fact line: `Health  ● amber  Design slipping…` (the dot and word amber, the comment in text colour) | A `Health` heading, then `● amber · 2026-11-10 · Design slipping…`, all amber, truncated | ReportSections.tsx:12-19, projects/logic/report.ts:62 |
| M9 | Rows in three columns (icon 2 / text 1fr / right 16): `✓ Solution outline approved   14 Oct` | One line of `·`-joined cells: `○ MS-2 · Design approved · 2026-11-26 · late` | ReportSections.tsx:12-19, 52 |
| M10 | Short dates (`14 Oct`, `26 Nov`), first names (`Anna`), enum labels (`in review`, `high · issue`), `me · -3d` | ISO dates, handles `@anna`, raw enums `in_review`/`in_progress`, `· medium ·`, `· overdue` | projects/logic/report.ts:62-110, meetings/logic/reports.ts:150-191 (the CLI/export share these rows) |
| M11 | Milestones include the **done** one (`✓` green with its date); the slipping one is amber: `26 Nov → 10 Dec?` | Open ones only; the late one is red with the word `late` | projects/logic/report.ts:70-72 (**FEATURE**: a proposed new date) |
| M12 | Only actions overdue **today** (`A-27 … me · -3d`) | Every action due before the meeting date counts as `overdue` (A-4, A-7, A-8 here, all due after today) | projects/logic/report.ts:101-110 (as-of the meeting date: confirm which is intended) |
| M13 | `Ask for this meeting` muted, followed by `(your text)` muted | Accent, no suffix | prep-tab.tsx:160 |
| M14 | Footer `generated from data · since SteerCo 28 Oct` on the bottom border, right | `since SteerCo 28 Oct` inside the panel | prep-tab.tsx:41-46, 100-103 |
| M15 | Bar: `←→ tabs  ↑↓ agenda item  J/K reorder  e edit ask  a action  D decision  i capture` | `←→ tabs  Esc back  ↑↓ item  e edit ask  a action  D decision  x close  PgUp/PgDn scroll  g screens  ? help  q quit`; **J/K don't reorder on the Prep tab** (only on Agenda) | prep-tab.tsx:28-35 |
| M16 | `No project on this item.` (no mock) | Shown for items without a project | prep-tab.tsx:36 |

### Other meeting tabs (only described in the design notes)
- Notes tab: a free-text area plus a/D (as the note says), and `Logged in this meeting` (code-only).
- Export tab: a Markdown preview with `w` (matches the note). Code-only: `m board/minutes`, `y copy`.
- Agenda tab (not drawn): a fact line `Fri 4 Dec 2026 · steering · planned · 8 attendees`, then a table `# Item Project Ask`
  with codes in text colour.

### 2026-11-20 meeting screens: existence
| Screen | Exists? |
|---|---|
| 1 Attention · Upcoming meetings panel | No |
| 5 Meetings overview (Upcoming by week + Series) | No (a flat Upcoming/Past list exists) |
| Person · Talk (talk-list tab) | No |
| 1:1 in progress | No (no person-subject meetings, no talk-list agenda) |
| Project · Meetings tab | No (project tabs end at People, Context) |
| Board meeting (BOARD as a project) | Partly: the meeting record (Agenda/Prep/Notes/Export, asks, board pack) exists, but the board isn't a project |
| New recurring meeting form | No (no series or rhythm) |
| Quick capture to a talk-list | No |
| 4 Actions (actions plugin, Linked to) | No |

---

## 10. Screen 6: Inbox

### Matches
- `New · 3` first (oldest first), then `Processed · last 7 days`.
- Columns ref 5 / time 12 / text, with ref and time muted.
- `today 09:00` and `yesterday` formats. Processed item text is muted. A second line under each processed item gives the outcome (`✓ … → …` in green, `✗ dismissed by you` muted).
- `⚠` after an unknown tag. Keys Enter, p, z, e.

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| I1 | **Two panels**: `New · 3` (focused, sized to its content) and `Processed · last 7 days` (grow) | One panel `Inbox` with two muted group headers | plugins/inbox/tui/inbox-screen.tsx:109-113, 149 |
| I2 | Inline tag colours: `#CRM` **cyan**, `@peter` **magenta** | The whole text is one colour | inbox-screen.tsx:103 (a cell has one tone) |
| I3 | Unknown tag: `#CMR` stays cyan and is followed by **`⚠ unknown project`** in amber; the rest of the line is normal | `#CMR ⚠`, and the **whole line is amber** | inbox-screen.tsx:59-63, 103 |
| I4 | Outcome line: `✓ copilot` green in the time column, then `→ decision DE-12 … · health note added` muted in the text column | One green string `✓ assistant → decision …`, starting at the time column | inbox-screen.tsx:64-70, Table.tsx:192-201 |
| I5 | The processor is named `copilot` | `assistant` (processed_by value) | inbox-screen.tsx:69 |
| I6 | Dismissed: `✗ dismissed` then `by you` in the text column, both muted | `✗ dismissed by you` (one string) | inbox-screen.tsx:67 |
| I7 | A blank line between processed items | None | Table.tsx (no spacing option) |
| I8 | Processed rows: the record refs it created (`DE-12`, `A-36`) show in normal text (`.tt`) inside the muted summary | All one tone | inbox-screen.tsx:69 |
| I9 | Bar: `↑↓ select  enter open  p process  z dismiss  e edit  i capture` | `Enter open  p process  z dismiss  u reopen  e edit  g screens  ? help  q quit` | inbox-screen.tsx:35-41 |

### Code-only
- `u reopen` in the bar (the design lists it in the key list but not the bar). Keep.

---

## 11. Quick capture (`i`)

### Matches
- Title text `Capture to inbox`. Accent border.
- The prefilled `#CRM` with the muted line `#CRM added because you're on the CRM project`, word for word.
- `@` autocomplete with Tab to accept; the selected suggestion is on the selected-row bg.
- Esc cancels. Ctrl+S saves (per §3 of the design doc, Ctrl+S stays, so the design's "enter save" is the part to correct).

### Differences
| # | Design | Current | Source |
|---|---|---|---|
| Q1 | Overlay 76 columns wide, centred at about 44% height; the screen behind it is dimmed | 80% wide, at `top=2`; no dimming | plugins/inbox/tui/capture.tsx:190, app.tsx:168 |
| Q2 | Title `Capture to inbox`; footer `enter save · esc cancel` on the bottom border, right (with §3 it becomes `ctrl+s save · esc cancel`) | All in the title: `Capture to inbox · ctrl+s save · esc cancel` | capture.tsx:28, 190 |
| Q3 | The input is its own box with an accent border and the panel bg | A textarea on the selected-row bg `#283457`, no border, 3 lines | capture.tsx:194-204 |
| Q4 | Tags inside the input are coloured (`#CRM` cyan, `@ma` magenta) | Plain text | capture.tsx:194 (textarea has no inline highlighting; needs a syntax style or overlay) |
| Q5 | Suggestions in a **bordered** 46-column box; the row reads `@marie` (magenta, 10 columns) then `Marie Dubois · Head of Sales` (role muted, or `· team`) | No border; `@marie  Marie Dubois`, with the selected row all accent and others in text colour; no role/team hint | capture.tsx:206-210 |
| Q6 | A blank line, then the prefill note, with `#CRM` cyan | No blank line; the note is all muted | capture.tsx:212 |
| Q7 | Bar: `enter save  tab accept suggestion  esc cancel` (§3: Ctrl+S) | `Enter new line  Tab accept suggestion  Ctrl+S save  Esc cancel` | capture.tsx:145-150 |

---

## 12. Theme tokens

| Design (`.term` vars) | Hex | theme.ts | Status |
|---|---|---|---|
| `--tb` background | `#11131a` | `bg` | match |
| `--tp` bars / panel | `#181b24` | `panel` | match |
| `--tbo` border | `#2e3442` | `border` | match |
| `--tbf` focused border | `#7aa2f7` | `borderFocused` | match (but Panel.tsx:12 uses `theme.accent`, not `borderFocused`) |
| `--tt` text | `#c0caf5` | `text` | match |
| `--tm` muted | `#737aa2` | `muted` | match |
| `--ta` accent | `#7aa2f7` | `accent` | match |
| `--tsel` selection | `#283457` | `selectedBg` | match |
| `--red` | `#f7768e` | `red` | match |
| `--amb` | `#e0af68` | `amber` | match |
| `--grn` | `#9ece6a` | `green` | match |
| `--cy` project codes, `#tags`, links, "in review" | `#7dcfff` | — | **missing** (§3 adds `cyan`) |
| `--mag` people, `@tags` | `#bb9af7` | — | **missing** (§3 adds `magenta`) |
| `.b` bold | weight 600 | — | not a token; used for the `ttybrain` wordmark and Markdown headings/strong |

Also:
- `Tone` (kernel/tui/types.ts:7) only allows `red | amber | green | muted | accent`, so plugins can't ask for
  cyan or magenta through `Cell` until it's extended. `toneColor` is at theme.ts:19.
- There's no per-group tone and no inline span list in a `Cell`. Inbox tags (I2) and the Projects line in the People
  detail panel (E10) need mixed colours within one cell.
- Colours outside the theme appear on screen: OpenTUI's Markdown defaults put `#888888` on table borders and `#ffffff`
  on bold text (Context tab, C5/C6). The only hard-coded hex in `src/` outside theme.ts is selfcheck.tsx:62.

## 13. Renderer capabilities (OpenTUI 0.8.4)

- **Exact hex colours: yes.** OpenTUI renders 24-bit RGB, and `captureSpans()` shows the exact theme hex on every
  span. A real terminal needs truecolor (most do; COLORTERM). Adding `#7dcfff`/`#bb9af7` is just two tokens.
- **Bold: yes.** `TextAttributes.BOLD` (attribute 1 seen on the Context headings). The JSX `<b>` inside `<text>` and
  `SyntaxStyle { bold: true }` both work. DIM, ITALIC and UNDERLINE are also available.
- **Background chips: yes.** `backgroundColor` on `box`/`text` (already used for the bars, tabs and selection), so the
  header chip `.dd` (F2) is a one-line change.
- **Panel chrome:** `borderStyle: "single" | "double" | "rounded" | "heavy"` (rounded gives the mock's corners).
  `titleColor` gives muted titles (F12). `bottomTitle` + `bottomTitleAlignment: "right"` puts footers on the bottom
  border (F15). One caveat: titleColor defaults to borderColor and there's **no separate bottomTitleColor**
  (chunk-bun `titleColor: options.titleColor ?? options.borderColor`). So a focused panel's footer would be accent
  unless it's drawn some other way (for example an absolutely positioned `<text>` on the border row).
- **Markdown:** `<markdown conceal={false}>` keeps the `#` markers (C3). `tableOptions={{ style: "columns", borders:
  false }}` gives borderless tables (C5). `renderNode` can replace bullets with `•` (C4).
- **Dimming behind overlays (F19):** there's no CSS-style filter. It would have to be emulated, for example with a
  full-screen box whose background has alpha (OpenTUI blends RGBA backgrounds; check it looks right in a real
  terminal) or by re-rendering in muted tones. Not verified here.
- Inline tag colours inside the capture textarea (Q4) need the textarea's syntax-highlight support or a custom
  renderable. Not verified.

## 14. Summary counts (differences, excluding FEATURE-only rows)

| Screen | Differences | FEATURE rows |
|---|---|---|
| Frame | 20 | 0 |
| Switcher | 5 | 1 (S4) |
| Attention | 13 | 2 (A12, A14) |
| Projects | 8 | 0 |
| Project detail | 17 (+1 bug in Milestones tab) | 1 (D5) |
| Project context | 7 | 1 (C2) |
| People | 15 | 2 (E14, E15) |
| Actions | 9 | 1 (T2) |
| Meeting prep | 15 | 1 (M11) |
| Inbox | 9 | 0 |
| Quick capture | 7 | 0 |

**FEATURE list:** Attention count in the switcher (S4); deliverables in "Due this week" (A12); `x done` and row
actions on Attention panels (A14); Tab between panels, selection and n/e/x on the project Overview panels (D5);
context provenance `via mcp` (C2); a tabbed right-hand panel for team members (E14); stakeholder groups (E15);
collapsed `Later · n  No date · n` line (T2); a milestone's proposed new date `26 Nov → 10 Dec?` in prep (M11). Out of
scope (2026-11-20, later projects): Upcoming meetings panel, Meetings overview with series, talk-lists, 1:1 flow,
project Meetings tab, BOARD project, recurring-meeting form, capture to talk-list, actions plugin with Linked to.

**Logic questions found on the way** (not look and feel, but visible): Projects needing attention includes on-hold
projects (A10); low-influence stakeholders appear in "Stakeholders to contact" (A11); prep counts actions due before
the meeting date as "overdue" (M12); a done milestone shows `-29d` in the Milestones tab (item-tab.tsx:62); tab
counts are open-only while the panel counts are totals (D2).

**Not checked:** the 80×24 degradation rule from §3.
