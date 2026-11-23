# ttybrain

A personal project-portfolio tool: a CLI (`ttybrain <thing> <verb>`, also usable by an AI agent) and, from phase 2, a terminal UI built with [OpenTUI](https://opentui.com) and Solid. It is a small plugin kernel plus plugins (`people`, `projects`, `actions`, `meetings`, `inbox`); the built-ins are ordinary plugins that can be switched off, and you can add your own. Data is one SQLite file under `TTYBRAIN_HOME` (default `~/.ttybrain`). It runs on Bun 1.3.14+ and Node.js 26.4+. See `docs/architecture.md`.

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

Meetings are now about a person (a 1:1) or a project (a project meeting or a board), can recur as a series (`ttybrain meeting series add @karim "1:1 Karim" --every "2 weeks on wed"`), and every person and project has a talk-list (`ttybrain talk add @anna "AWS training budget"`, or `t` in the TUI). A meeting not closed 3 days after its date now closes itself.

- Every existing meeting keeps everything: its number (`M-4` stays `M-4`), title, date, status, attendees, agenda, asks, notes, since date, and the actions and decisions linked to it. The kinds `steering` and `other` become `project`; `board` stays `board` (the CLI still accepts `--kind steering|other` as aliases of `project`).
- Existing meetings have no subject yet: they show `—` where a subject goes, are listed under "No subject" on the Meetings screen, and never close themselves. Give one a subject with `ttybrain meeting subject M-4 #CRM`, or all of them at once with `ttybrain meeting subject --all-without #BOARD`. Once a meeting has a subject, it closes itself like a new one if it is dated today or later; past ones never do.
- `ttybrain meeting close` now prints the close message (for example `1:1 Anna closed · 2 discussed, 3 kept for next time · 2 actions created · notes saved`) instead of `M-4 held` and `logged: …`. `--json` keeps the old fields and adds `discussed`, `kept`, `actions`, `notesSaved` and `message`.
- `ttybrain meeting add` now needs `--about <@handle|#CODE>` (the person or project the meeting is about); `--kind` is optional and follows the subject.
- Occurrences of a series are created for the next 8 weeks whenever ttybrain starts for a command that writes, or the TUI opens (and each new day while it stays open). A read-only command may show yesterday's state until then.
- External plugins: `meetings` is now 2.0.0 (the kind values of its published `meeting` view changed, and the view gained `subject_type`, `subject_id` and `series_id`). A plugin that `requires` or reads `meetings` at `^1` sees it as unavailable until you update the range to `^2`; the built-in `projects` and `actions` already read `^2`.
- As with the actions upgrade, ttybrain copies the database to `ttybrain.db.bak-v<N>` before the first migration, and an older build should not be used on the upgraded database.

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
