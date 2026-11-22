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
- If the `projects` or `actions` plugin was switched off during the upgrade, the move waits until both are on. Actions you add in the meantime get ids above 1,000,000 (`A-1000001`) so they cannot collide with the ones still to be moved; they keep those ids.
- External plugins: the `projects` plugin is now 2.0.0. A plugin that `requires` `projects ^1` fails to load, and one that reads `projects.project` at `^1` (it no longer has `open_actions`) sees that view as unavailable, until you update its ranges. The new `actions` plugin starts at 2.0.0: read `actions.action` and `actions.link` at `^2`. Stored change sets that name `projects.addAction` (and the other four action operations) no longer apply.

## Development

```bash
bun test                      # all tests
bun typecheck                 # type-check
bash scripts/smoke-node.sh    # build for Node 26 and run the self-checks and a CLI walk-through (includes "tui ok" twice, the fixture plugin walk and the scaffold step; ends with "smoke ok")
bun start                     # `ttybrain` with no arguments: the terminal UI (needs a TTY)
npm run start:node            # the same on Node: builds dist-node/, then runs node --experimental-ffi dist-node/bin/pm.js
```

The Node FFI warning on `start:node` is expected. The CLI itself needs no flag.
