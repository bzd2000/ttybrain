# Look and feel pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every existing ttybrain screen looks exactly like the screen designs: layout, wording, keys and colours.

**Architecture:** The shared TUI components (theme, Panel, Table, Tabs, frame, overlays) are brought to the designs first, so most screens inherit the look; then each screen is fixed against its design. Every difference to fix is already listed, with its source line, in the gap analysis.

**Tech Stack:** TypeScript, OpenTUI 0.8.4 + Solid, Bun and Node 26.

**Spec:** `docs/superpowers/specs/2026-11-20-ttybrain-meetings-actions-design.md` §3 (what "exactly" means) and §7 item 0. Designs: `docs/superpowers/specs/2026-11-13-pm-screens.html` (the reference for this pass). Gap analysis: `docs/superpowers/plans/2026-11-20-look-and-feel-gaps.md` — every row id below (F1, A2, P5 …) refers to it.

## Global Constraints

- Fix every row of the gap analysis in the task's sections **except** rows marked **FEATURE**, the "2026-11-20 additions (excluded)" rows, and the rulings below. A row left unfixed for another reason is reported in the task report with the reason.
- Colours only through `src/kernel/tui/theme.ts` tokens. New tokens, exactly: `cyan: "#7dcfff"` (project codes), `magenta: "#bb9af7"` (people names). The other mock colours already match theme tokens (gap analysis §12).
- Element colours, from the design: project codes cyan; people names magenta; ids, secondary text, column headers and unfocused panel titles muted; overdue red; attention / due-soon amber; done / ✓ green; focused border, focused panel title, active tab and selection text accent; selected row background `selectedBg`.
- Wording: titles, headers, group rows, footers, empty states and status-bar hints exactly as in the design. Status-bar keys and labels lowercase (`enter open`, `esc back`, `ctrl+s save`), 3 cells between pairs.
- Text entry keeps the architecture rule: Enter is a new line, Ctrl+S saves (design §3).
- The header reads `ttybrain · <chip>` (`ttybrain` bold accent, `·` muted, chip on `selectedBg` with 1-cell padding, `▾`, or `▴` while the switcher is open), then breadcrumbs, then the inbox badge (amber) and date (muted) on the right.
- Screen 1 is named `Attention`; a project's first tab is `Overview`.
- Behaviour, data and keys stay as they are, except where a gap row or ruling changes them. No schema changes.
- Both runtimes keep working: `bun test`, `bun typecheck`, `bash scripts/smoke-node.sh` (last line `smoke ok`) green after every task. Tests use a fixed clock, never the real one.
- Plugins import kernel things only from `@ttybrain/api` / `@ttybrain/api/tui`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Plan rulings

- **R1. Scrolling lists stay scrolling.** Where a mock shows `… n more` at the end of a long list (Projects P7, People, Actions), the list keeps scrolling; the design's line is a snapshot, not a cap. Overview panels that already cap with `+N more` keep doing so.
- **R2. Code-only things stay** unless a row says otherwise: the Help overlay, the "terminal too small" fallback, status messages, `e edit` / `a archived` hints, Closed/Archived groups, the Inbox panel on Attention (placed after the design's panels).
- **R3. Visible data rules the design shows are in scope** when they are one-line filters: on-hold projects are not in "Projects needing attention" (A10); only high-influence stakeholders are in "Stakeholders to contact" (A11). Other logic questions in the gap analysis go to the follow-ups doc, not this pass.
- **R4. Overlay dimming (F19):** the screen behind an overlay is drawn with muted colours (emulated: a dim flag that maps every token to a darker variant, or an overlay backdrop); the exact technique is the implementer's, the result is that the background reads clearly dimmer, as in the mocks.
- **R5. Ids in tests** follow the seed, not the mock (A-1 instead of A-27); everything else in the asserted lines matches the mock.

## Review Focus

1. **80×24:** the redesigned frame and panels still fit; columns and hints drop from the right, codes and names are never cut (existing `fitWidth`/`joinFit` rules). Test in Task 10.
2. **Long names and 16-char codes** in the redesigned columns (fixed widths from the mocks): they still show whole. Test in the owning screen task where the mock fixes a code column width.
3. **Empty states** after the chrome changes (footer on the border, no `›` marker): every screen with no data still shows its empty text, readable. Test per screen task.
4. **Focus and selection** after removing the `›` marker: the selected row is still visible in the focused list only. Test in Task 1.
5. **Plugins' own tones:** external plugins that passed `tone` values keep working (the Tone type only grows). Test in Task 1.

---

### Task 1: Theme tokens and the shared components

**Files:**
- Modify: `src/kernel/tui/theme.ts`, `src/kernel/tui/types.ts` (Tone), `src/kernel/tui/components/Panel.tsx`, `Table.tsx`, `Tabs.tsx`, `OverviewScreen.tsx` (panel titles without forced count), affected tests
- Create: `tests/design.ts` (shared design-data seed and span helpers)

**Interfaces:**
- Produces: `theme.cyan`, `theme.magenta`; `Tone` gains `"cyan" | "magenta" | "muted" | "accent"`; Panel props `footer` drawn on the bottom border, right-aligned, muted; Panel title muted when unfocused, accent when focused, with one space each side; rounded borders; Table without the `›` marker column, with per-group `tone` and `count` options and an `↑↓ select` hint; Tabs with the whole active label (title and count) in accent; overview panels may opt out of the title count (`count: false`).
- `tests/design.ts`: `seedDesign(kernel): Promise<void>` seeding the 2026-11-13 example data (today Thu 12 Nov 2026 — use `makeTestKernel({ today: "2026-11-12" })`): projects ERP, CRM, HRP, DWH, IAM, SEC, WMS active and BI2 on hold with the mock's health, milestones, deliverables, risks, decisions and actions; people Marie Dubois, Luc Vermeulen, Ingrid Claes, Tom Maes, Peter Janssens, Nadia El Amrani, Jan De Smet (stakeholders) and Anna Peeters, Bob Willems, Karim Haddad, Mathias Wouters, Sofie Lambert (team) with the mock's influence/interest and contact notes; meeting M-1 "SteerCo" held 28 Oct and "Steering committee Q4" on 4 Dec with the mock's agenda and asks; 3 new inbox items. Plus `fgAt(spans, text): string | undefined` and `bgAt(spans, text)` returning the colour of the first cell of `text`, and `line(frame, i): string`. The gap analysis's throwaway seed (`dump.tsx`, quoted in its header) is a starting point.

- [ ] **Step 1: Write the failing tests** (`src/kernel/tui/components/chrome.test.tsx`):

```ts
test("unfocused panel title is muted with a space each side; focused is accent") // frame contains "╭─ Due this week · 5 ─"; fgAt(title) === theme.muted; focused panel's title fg === theme.accent
test("panel footer sits on the bottom border, right-aligned, muted") // last panel line ends with " status:open ─╯" style; no footer line inside the panel
test("borders are rounded") // ╭ ╮ ╰ ╯ present, ┌ absent
test("selected row has a background and no › marker") // no "›" at the row start; bgAt(selected text) === theme.selectedBg; unfocused list shows no selection background
test("group rows take their tone and optional count") // a group { title: "Overdue", tone: "red", count: false } renders "Overdue" in theme.red without "· n"
test("active tab label is accent including its count") // fgAt("Milestones 5") and fgAt("5") === theme.accent
test("cyan and magenta tones") // a cell with tone "cyan" → theme.cyan; "magenta" → theme.magenta
test("old tone values still work") // red/amber/green unchanged (Review Focus 5)
```

- [ ] **Step 2: RED.** **Step 3: Implement** (OpenTUI has `borderStyle="rounded"`, `titleColor`, `bottomTitle` with alignment — gap analysis §13). Update every existing test whose frame text changes because of the chrome (expected; keep assertions meaningful). **Step 4: GREEN** + full checks. **Step 5: Commit** `feat(tui): theme tokens and component chrome as designed`.

### Task 2: Frame, status bar, switcher, overlays, and the Attention name

**Files:** `src/kernel/tui/frame.tsx`, `app.tsx`, `nav.ts`, `keys.ts`, `components/RecordView.tsx`, `components/Switcher.tsx`, the inbox badge (`src/plugins/inbox/tui/index.tsx`) and the badge API (tone), tests.

Fix gap rows **F1–F3, F5–F11, F19, F20** and **S1–S3, S5, S6**, and **F4/A1** (rename `Overview` → `Attention` everywhere the user sees it, including Help; the internal id may stay).

- [ ] **Step 1: Failing tests** (`src/kernel/tui/frame-design.test.tsx`, using `seedDesign`):

```ts
test("header as designed") // line 0 starts "ttybrain · " with "ttybrain" bold accent; chip " 1 Attention ▾ " on selectedBg; "● 3 new in inbox" amber; "Thu 12 Nov 2026" muted at the right
test("record breadcrumbs: screen chip, code cyan, label; no extra line") // open CRM: line 0 contains "2 Projects ▾ › CRM CRM replatforming", "CRM" cyan; line 1 is the tab row (no "› CRM" line between); opening a second record replaces the crumb, never "› @peter › @anna"
test("status bar as designed") // Attention bar, exact: "tab panel   enter open   i capture   g or 1-6 screens   ? help   q quit" (the mock's "x done" is FEATURE A14, so it is left out)
test("switcher drops down under the chip") // after g: chip shows ▴; a 26-wide focused box at column ~4 under the header, no title; rows "1  Attention", "6  Inbox  3" with Inbox count amber; background dimmed (fgAt of a background row text is not theme.text)
test("capture overlay centred at ~44% height, 76 wide, background dimmed")
```

- [ ] **Step 2–5:** RED, implement, GREEN + full checks, commit `feat(tui): frame, switcher and overlays as designed; screen 1 is Attention`.

### Task 3: Attention (screen 1)

Fix **A2–A11, A13, A15** (A12, A14, S4 are FEATURE; R3 covers A10/A11). Files per the gap rows (`src/plugins/projects/tui/panels.ts`, `src/plugins/people/tui/index.tsx`, `src/plugins/projects/logic/overview.ts`, `src/kernel/tui/components/OverviewScreen.tsx`, `overviewLayout.ts`), test `tests/design/attention.test.tsx`.

- [ ] **Step 1: Failing test:** with `seedDesign`, at 118×36 assert the mock's lines for each panel in order (titles `Overdue actions · 3`, `Due this week · 5`, `Projects needing attention`, `Late milestones · 2` with the muted `Next 14 days` sub-heading, `High risks & issues · 3`, `Stakeholders to contact` with the footer row `last contact over 30 days, high influence first`), paired panels starting on the same line (A8), fixed column widths (A9), codes cyan, names magenta, BI2 and Nadia absent, and the status bar of Task 2.
- [ ] **Step 2–5:** RED, implement, GREEN + full checks, commit `feat(tui): Attention as designed`.

### Task 4: Projects (screen 2)

Fix **P1–P6, P8** (P7 per R1; P3: red when the project has an open high-severity risk or issue — the mock is inconsistent, ruling here). Test `tests/design/projects.test.tsx`: the mock's header row and rows with the mock's column widths (P5), codes cyan, effort muted, on-hold row all muted with `◌`, footer `filter: status=active` on the bottom border, status bar `↑↓ select   enter open   n new   h health   / filter   i capture   ? help` (plus R2's kept hints after it). A 16-char code shows whole (Review Focus 2). Commit `feat(tui): Projects as designed`.

### Task 5: Project detail and Context

Fix every non-FEATURE row of gap §4 and §5, including the first tab renamed `Overview` and the right-hand lists in bordered panels (where focus on them is FEATURE, draw them as bordered, unfocused panels). Test `tests/design/project-detail.test.tsx` and `project-context.test.tsx` against the mocks "Project detail" and "Project context". Commit `feat(tui): project detail and context as designed`.

### Task 6: People (screen 3)

Fix every non-FEATURE row of gap §6 (tabs with counts, group rows `Stakeholders · 20` / `Team · 11` accent, names magenta, codes cyan, the right-hand detail panel layout, the footer `sort: influence, then last contact` on the border, the status bar). Test `tests/design/people.test.tsx` against the mock "People". Commit `feat(tui): People as designed`.

### Task 7: Actions (screen 4)

Fix every non-FEATURE row of gap §7 (columns ID, Action, Proj., Owner, For / from, Due with the mock widths; group rows Overdue red, This week / Next week accent; `me` muted; people magenta; codes cyan; footer `status:open`; status bar). The 2026-11-20 "Linked to" column is a later project. Test `tests/design/actions.test.tsx`. Commit `feat(tui): Actions as designed`.

### Task 8: Meeting prep (the meeting record)

Fix every non-FEATURE row of gap §9: header crumb `5 Meetings ▾ › M-n Steering committee Q4 · Thu 4 Dec · 8 attendees` (tail muted), tabs, the agenda panel (34 cols, numbered, code column), the prep panel's columns with symbols (✓ ○ ◐ ▲ ! ·), formatted dates instead of ISO, readable labels instead of raw enums, sub-headings, the "Ask for this meeting (your text)" block, the footer `generated from data · since SteerCo 28 Oct`, the status bar. Test `tests/design/meeting-prep.test.tsx`. Commit `feat(tui): meeting prep as designed`.

### Task 9: Inbox (screen 6) and quick capture

Fix every non-FEATURE row of gap §10 and §11 (two panels, inline `#tag` cyan / `@tag` magenta, capture overlay title `Capture to inbox`, footer `ctrl+s save · esc cancel` on the border, suggestion list, the "added because you're on …" line). Test `tests/design/inbox.test.tsx` and `capture.test.tsx`. Commit `feat(tui): Inbox and quick capture as designed`.

### Task 10: 80×24, docs and follow-ups

- [ ] **Step 1:** a test per designed screen at 80×24 (`tests/design/small.test.tsx`) asserting that every project code and person name in view appears whole (never cut with …), the header still shows chip and date, and the status bar keeps its first hints (Review Focus 1).
- [ ] **Step 2:** `docs/architecture.md` ("The TUI": the tokens, the chrome rules, status-bar format, the design files as the look-and-feel reference), `CLAUDE.md` (one line: the designs are the reference; `tests/design/` holds the conformance tests), and a "Look and feel pass" section in `docs/superpowers/plans/2026-11-13-pm-phase1-followups.md` listing the FEATURE rows, the logic questions from the gap analysis and anything left unfixed.
- [ ] **Step 3:** full checks; commit `docs: look and feel pass`.
