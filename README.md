# pm

A personal project-portfolio tool: a CLI (`pm <thing> <verb>`, also usable by an AI agent) and, from phase 2, a terminal UI built with [OpenTUI](https://opentui.com) and Solid. It is a small plugin kernel plus plugins (`people`, `projects`, `meetings`, `inbox`); the built-ins are ordinary plugins that can be switched off, and you can add your own. Data is one SQLite file under `PM_HOME` (default `~/.pm`). It runs on Bun 1.3.14+ and Node.js 26.4+. See `docs/architecture.md`.

## CLI

`pm` with no arguments (in a terminal) opens the terminal UI; `pm <thing> <verb>` runs the CLI.

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

Every command supports `--json`. Exit codes: `0` OK, `1` validation, `2` not found, `3` conflict or busy. There are no prompts; destructive commands need `--yes`. `PM_HOME=<dir>` or `--db <file>` selects the database.

### Plugins

```bash
pm plugin list                          # id, version, source (built-in/folder/npm), status
pm plugin disable meetings              # also: enable; a disabled plugin keeps its data
pm plugin new contracts                 # scaffold ./contracts (type-checking needs a git checkout of pm)
pm plugin build contracts               # compile src/ to dist/ (shared modules become shims)
pm plugin add ./contracts               # install a folder, an npm name or a .tgz into ~/.pm/plugins
pm plugin remove contracts --yes        # delete/uninstall; add --purge-data to drop its data too
```

External plugins live in `~/.pm/plugins` (`PM_PLUGINS`): plugin folders, or npm dependencies of its `package.json`. They run in pm's process with full access; pm warns on the first add. `pm plugin add` uses `npm` (or `bun add` under Bun without npm; `PM_PLUGIN_INSTALLER=npm|bun` forces one). See `docs/superpowers/specs/2026-11-13-pm-plugins.md` ("Writing an external plugin").

### Linking `pm` onto your PATH

- Node: `npm install && npm run build:node && npm link`, then `pm ...` (the bin is `dist-node/bin/pm.js`; rebuild after changing `src/`).
- Bun: `bun link` in this directory, then `bun link opentui-app` elsewhere, or run `bun /path/to/src/bin/pm.ts`.

## Development

```bash
bun test                      # all tests
bun typecheck                 # type-check
bash scripts/smoke-node.sh    # build for Node 26 and run the self-checks and a CLI walk-through (includes "tui ok" twice, the fixture plugin walk and the scaffold step; ends with "smoke ok")
bun start                     # `pm` with no arguments: the terminal UI (needs a TTY)
npm run start:node            # the same on Node: builds dist-node/, then runs node --experimental-ffi dist-node/bin/pm.js
```

The Node FFI warning on `start:node` is expected. The CLI itself needs no flag.
