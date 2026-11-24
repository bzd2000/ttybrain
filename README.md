# ttybrain

A personal project-portfolio tool: a CLI (`ttybrain <thing> <verb>`, also usable by an AI agent) and, from phase 2, a terminal UI built with [OpenTUI](https://opentui.com) and Solid. It is a small plugin kernel plus plugins (`people`, `projects`, `boards`, `actions`, `meetings` (meetings, series and talk-lists), `inbox`); the built-ins are ordinary plugins that can be switched off, and you can add your own. Data is one SQLite file under `TTYBRAIN_HOME` (default `~/.ttybrain`). It runs on Bun 1.3.14+ and Node.js 26.4+. See `docs/architecture.md`.

## CLI

`ttybrain` with no arguments (in a terminal) opens the terminal UI; `ttybrain <thing> <verb>` runs the CLI.

```bash
bun install
bun run pm help                                   # all commands
bun run pm person add "Anna Peeters" --team
bun run pm project add CRM "CRM"
bun run pm action add "Send offer" --project CRM --due fri
bun run pm report overview --format text
bun run pm inbox add "call the vendor #CRM"
bun run pm guide                                  # how the data model works
```

Every command supports `--json`. Exit codes: `0` OK, `1` validation, `2` not found, `3` conflict or busy. There are no prompts; destructive commands need `--yes`. `TTYBRAIN_HOME=<dir>` or `--db <file>` selects the database.

### Plugins

```bash
ttybrain plugin list                          # id, version, source (built-in/folder/npm), status
ttybrain plugin disable meetings              # also: enable; a disabled plugin keeps its data
ttybrain plugin new contracts                 # scaffold ./contracts (type-checking needs a git checkout of ttybrain)
ttybrain plugin build contracts               # compile src/ to dist/ (shared modules become shims)
ttybrain plugin add ./contracts               # install a folder, an npm name or a .tgz into ~/.ttybrain/plugins
ttybrain plugin remove contracts --yes        # delete/uninstall; add --purge-data to drop its data too
```

External plugins live in `~/.ttybrain/plugins` (`TTYBRAIN_PLUGINS`): plugin folders, or npm dependencies of its `package.json`. They run in ttybrain's process with full access; ttybrain warns on the first add. `ttybrain plugin add` uses `npm` (or `bun add` under Bun without npm; `TTYBRAIN_PLUGIN_INSTALLER=npm|bun` forces one). See `docs/superpowers/specs/2026-11-13-pm-plugins.md` ("Writing an external plugin").

### Linking `ttybrain` onto your PATH

- Node: `npm install && npm run build:node && npm link`, then `ttybrain ...` (the bin is `dist-node/bin/pm.js`; rebuild after changing `src/`).
- Bun: `bun link` in this directory, then `bun link ttybrain` elsewhere, or run `bun /path/to/src/bin/pm.ts`.

## Upgrading from pm

pm was renamed ttybrain (2026-11-19). On the first run, ttybrain moves `~/.pm` to `~/.ttybrain` and `pm.db` (with its `-wal`, `-shm` and `.bak-v<N>` files) to `ttybrain.db`, then leaves symlinks (`~/.pm`, `pm.db`) so an old build still finds the data. It renames and never copies or overwrites; a `pm.db` that is a symlink is renamed as a symlink. When `TTYBRAIN_HOME` is set, nothing is moved, but a `pm.db` in that folder with no `ttybrain.db` beside it is renamed the same way (`renamed …/pm.db to …/ttybrain.db`); the same goes for a `~/.ttybrain` you moved there by hand (also a symlinked one). Nothing is touched when `TTYBRAIN_DB` or `--db` names the database file.

- If the move fails, ttybrain stops with `could not move …` and a hint (exit 1; so does `--help`) instead of starting on an empty database. A half-done move is finished on the next run. If `~/.pm` still holds a database (also when `~/.pm` is a symlink, which is never moved) and `~/.ttybrain` has none, it stops with `your data is still in …`. Move the files by hand, or follow the hint: `set TTYBRAIN_DB=~/.pm/pm.db` (the exact path is printed) uses the old database where it is.
- The environment variables are renamed `PM_<X>` to `TTYBRAIN_<X>` (a clean break: the old names are not read). Update your shell profile, containers and scripts.
- External plugins must be rebuilt (`ttybrain plugin build`): the API is now `@ttybrain/api`, the manifest key is `"ttybrain"`. A plugin built for pm fails with `built for pm; rename "pm" to "ttybrain" in package.json and @pm/ imports to @ttybrain/, then run "ttybrain plugin build" (or update the plugin)`; `ttybrain plugin build` refuses it until both edits are made.
- The command is `ttybrain`, with `tb` as a short alias.

## Upgrading to the actions plugin

Actions are now their own plugin (`actions`), no longer part of `projects`. On the first start after upgrading, ttybrain moves every existing action out of the projects tables into the actions plugin, once and atomically: ids (`A-27` stays `A-27`), titles, dates, status, owners, notes, history and provenance are kept, and the project, person and meeting an action pointed at become links.

- Before the move, ttybrain copies the database to `ttybrain.db.bak-v<N>` next to it (N = the number of migrations applied so far). Keep that file until you are happy with the result.
- **Do not use an older build afterwards.** An older build opens the same database and sees no actions (its projects table is empty); don't add actions with it, they would not be seen by the new build either.
- If the `projects` or `actions` plugin was switched off during the upgrade, the move waits until both are on. Actions you add in the meantime (while only `actions` is on, so the old ones cannot be read) get ids above 1,000,000 (`A-1000001`) so they cannot collide with the ones still to be moved; they keep those ids. If `projects` is on but the move was skipped (another process held the database at that start), new actions simply continue after the highest existing id.
- External plugins: the `projects` plugin is now 2.0.0. A plugin that `requires` `projects ^1` fails to load, and one that reads `projects.project` at `^1` (it no longer has `open_actions`) sees that view as unavailable, until you update its ranges. The new `actions` plugin starts at 2.0.0: read `actions.action` and `actions.link` at `^2`. A new change set that names `projects.addAction` (or one of the other four action operations) is refused; name `actions.addAction` and the like instead. Change sets already applied stay in the history as they were.

## Upgrading to the meetings rework

Meetings are now about a person (a 1:1) or a project (a project meeting) (boards followed, see the next section), can recur as a series (`ttybrain meeting series add @karim "1:1 Karim" --every "2 weeks on wed"`), and every person and project has a talk-list (`ttybrain talk add @anna "AWS training budget"`, or `t` in the TUI). A meeting not closed 3 days after its date now closes itself.

- Every existing meeting keeps everything: its number (`M-4` stays `M-4`), title, date, status, attendees, agenda, asks, notes, since date, and the actions and decisions linked to it. The kinds `steering` and `other` become `project`; `board` stays `board` (the CLI still accepts `--kind steering|other` as aliases of `project`).
- Existing meetings have no subject yet: they show `—` where a subject goes, are listed under "No subject" on the Meetings screen, and never close themselves. Give one a subject with `ttybrain meeting subject M-4 #CRM`, or all of them at once with `ttybrain meeting subject --all-without #CRM` (the meetings that fit: board meetings take only a board, the others a project or person; the rest are skipped and counted, so also run `--all-without #BOARD` for the board meetings). A meeting that has a subject keeps its kind: giving it a subject of another kind needs `--kind` (`ttybrain meeting subject M-4 #CRM --kind project`). Once a meeting has a subject, it closes itself like a new one if it is dated today or later; past ones never do.
- `ttybrain meeting close` now prints the close message (for example `1:1 Anna closed · 2 discussed, 3 kept for next time · 2 actions created · notes saved`) instead of `M-4 held` and `logged: …`. `--json` keeps the old fields and adds `discussed`, `kept`, `actions`, `notesSaved` and `message`.
- `ttybrain meeting add` now needs `--about <@handle|#CODE>` (the person or project the meeting is about); `--kind` is optional and follows the subject.
- Occurrences of a series are created for the next 8 weeks whenever ttybrain starts for a command that writes, or the TUI opens (and each new day while it stays open). A read-only command may show yesterday's state until then.
- External plugins: `meetings` is now 2.0.0 (the kind values of its published `meeting` view changed, and the view gained `subject_type`, `subject_id` and `series_id`). A plugin that `requires` or reads `meetings` at `^1` sees it as unavailable until you update the range to `^2`; the built-in `projects` and `actions` already read `^2`.
- As with the actions upgrade, ttybrain copies the database to `ttybrain.db.bak-v<N>` before the first migration, and an older build should not be used on the upgraded database.

## Upgrading to boards

A board (`#MB`, "Management board") is now its own record in the `meetings` plugin, no longer a project such as `BOARD`: `ttybrain board add MB "Management board"`, then `ttybrain meeting series add #MB "Board" --every "monthly on the last fri"`. A board has a talk-list (`ttybrain talk add #MB "Office move"`, or `talk #MB …` in quick capture), its series and meetings, and the actions linked to it; in the TUI, screen 5 lists them under "Boards" and Enter opens one. A board's code is 2-16 letters or digits with at least one letter. Project and board codes share one namespace: adding or renaming either refuses a code the other uses, and `#MB` where a project is needed (`project show #MB`, `--project MB`) is refused as "a board, not a project". Kind `board` needs a board subject.

- On the first start after upgrading (`meetings` 2.1.0), every project that was the subject of a board meeting or series gets a new board with the project's name and the code `<CODE>B` (`BOARD` becomes `#BOARDB`; a number is added if that is taken). Those meetings and series move to it, with their numbers (`M-4`, `S-2`) and everything in them unchanged. The project keeps its code, actions and its own data; archive it by hand if it only existed for the board.
- The project's open talk items move to the board only if the project held nothing but board meetings (they were the board's talk-list). If it also had project meetings or series, they stay on the project. Discussed and dropped items, and people's items tagged with the project, always stay.
- `ttybrain plugin list` and the Help screen (`?`) name each new board until you edit it. Rename it with `ttybrain board edit #BOARDB --code MB` (also `--name`); the notice then goes away. Project and board codes share one namespace, so a board cannot take the code of an existing project (an archived one too): to call it `BOARD`, rename the project first (`ttybrain project edit BOARD --code OLDBOARD`), then `ttybrain board edit #BOARDB --code BOARD`.
- Board meetings that had no subject stay without one until you assign it: `ttybrain meeting subject M-4 #MB`, or `ttybrain meeting subject --all-without #MB` for the board meetings (and `--all-without #CRM` for the others). A meeting that already has a subject keeps its kind; to change both, use `--kind` (`meeting subject M-4 #MB --kind board`, and back with `--kind project`). For scripts: `meeting subject --all-without … --json` now returns `{ "meetings": [...], "skipped": n, "reason"? }` instead of a bare array; the array is under `meetings`.
- As with the earlier upgrades, ttybrain copies the database to `ttybrain.db.bak-v<N>` first, and an older build should not be used afterwards. `meetings` is now 2.1.0, additive: it publishes a new `meetings.board` view, and `meetings.meeting` (v2) can now have `subject_type` `board`.

## Upgrading to the boards plugin

Boards are now their own plugin (`boards` 1.0.0), and `meetings` is 3.0.0. On the first start after upgrading, every board moves from meetings to boards once, keeping its id, code, name, note, archived state and timestamps; its meetings, series, talk items and action links still point at it, and `#CODE`, `board add|list|show|edit|archive|restore` and the board view work as before (the board view gains a Summary tab: `e` edit, `Del` archive, `r` restore). Boards can't be deleted, only archived. Notes:

- `boards` needs `projects` (they share the code namespace), and `meetings` needs `boards`: with projects off, boards and meetings are off too (their data waits). Switching boards on later moves the boards then; nothing is shown twice or lost.
- If a project has taken a code a board used while boards was off, the move waits and `plugin list` says which code to change.
- `ttybrain help` lists the `board` commands right after the `project` ones (before `inbox`, `talk` and `meeting`), where they used to come with the meetings commands.
- As with the earlier upgrades, ttybrain copies the database to `ttybrain.db.bak-v<N>` first, and an older build should not be used afterwards.

## Development

```bash
bun test                      # all tests
bun typecheck                 # type-check
bash scripts/smoke-node.sh    # build for Node 26 and run the self-checks and a CLI walk-through (includes "tui ok" twice, the fixture plugin walk and the scaffold step; ends with "smoke ok")
bun start                     # `ttybrain` with no arguments: the terminal UI (needs a TTY)
npm run start:node            # the same on Node: builds dist-node/, then runs node --experimental-ffi dist-node/bin/pm.js
npm run run:node              # run the existing dist-node/ build without rebuilding (rebuild after pulling changes)
```

Arguments go after `--`, e.g. `npm run run:node -- project list`.

To compare the TUI with the screen designs (Linux or Windows PowerShell): `bun run seed:dev` fills `.ttybrain-dev/` with the designs' example data (`--set 11-13` for the first designs, `--fresh` to replace an existing dev database), then `bun run start:dev` opens the TUI on it (`bun run pm:dev project list` for the CLI).

The Node FFI warning on `start:node` is expected. The CLI itself needs no flag.

## License

Copyright (C) 2026 Filip Delperdange.

ttybrain is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.
