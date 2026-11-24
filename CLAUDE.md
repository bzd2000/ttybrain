# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

A terminal UI built with [OpenTUI](https://opentui.com) (`@opentui/core`) and its Solid binding (`@opentui/solid`), running on **Bun** or **Node.js 26.4+**. Both runtimes must keep working. Bun is installed at `~/.bun/bin` and may not be on `PATH` in non-login shells. The system Node (`/usr/local/bin/node`) is 26.x.

## Architecture (read first)

ttybrain is being rebuilt as a **plugin kernel** (`src/kernel/`) plus plugins (`src/plugins/<id>/logic|tui/`). **Read `docs/architecture.md` before changing kernel or plugin code.** It holds the data-isolation rules, the operation and view conventions, the CLI conventions and a red-flags list.
- Design: `docs/superpowers/specs/2026-11-13-pm-design.md`
- Look and feel: the screen designs (`docs/superpowers/specs/2026-11-13-pm-screens.html`, `docs/superpowers/specs/2026-11-20-ttybrain-meetings-actions-design.md` §3) are the reference; `tests/design/` holds the conformance tests (see `docs/architecture.md`, "The TUI")
- Per-plugin reference: `docs/superpowers/specs/2026-11-13-pm-plugins.md`
- Plans: `docs/superpowers/plans/`

Project agents:
- `pm-developer` implements plan tasks.
- `pm-reviewer` reviews changes against the architecture (read-only).

## Commands

- `bun start`: run `ttybrain`. With no arguments in a terminal it opens the TUI; it needs a real TTY, so it can't be driven from a non-interactive shell (use tests, or drive it through a pty with `script -qfc`)
- `bun dev`: run with `--watch`
- `bun run test` (= `bun test --timeout 30000`; the TUI tests can need more than bun's default 5 s on a loaded machine or CI): run all tests. Run a single test with `bun test ./src/kernel/tui/app.test.tsx` (the `./` makes it a path) or `bun test -t "<name pattern>"`
- `bun typecheck`: type-check (`bun check`)
- `bun run pm <thing> <verb> …`: run the CLI (`bun src/bin/pm.ts`); `TTYBRAIN_HOME=<dir>` or `--db <file>` points it at a scratch database
- `bash scripts/smoke-node.sh`: build for Node, run the self-checks (including the TUI one, which prints `tui ok`), a CLI walk-through, the fixture plugin walk (build, load as a folder and via `npm pack` + `ttybrain plugin add`) and a `ttybrain plugin new` scaffold step on Node 26 (needs only node/npm); `tui ok` prints twice (built-ins, then with the fixture plugin's screen); the last line is `smoke ok`. Run it after touching SQLite, isolation, transactions, process handling or module loading
- `bun src/kernel/isolation-selfcheck.ts`: the isolation self-check on Bun (`node dist-node/kernel/isolation-selfcheck.js` on Node)
- `npm run start:node`: run on Node. It runs `build:node` (`scripts/build-node.mjs`, which compiles `src/` to `dist-node/` with Babel), then `node --experimental-ffi dist-node/bin/pm.js`; `npm run run:node` runs the existing `dist-node/` build without rebuilding

## How it's wired

- `src/kernel/` is the plugin kernel, `src/plugins/<id>/logic/` the built-in plugins (`people`, `projects`, `actions`, `meetings`, `inbox`), `src/bin/pm.ts` the CLI entry point; `src/kernel/loader.ts` discovers plugins from their `package.json` manifests (built-ins, `~/.ttybrain/plugins` folders, npm dependencies there); there is no static plugin list in `src/` (`tests/builtins.ts` lists the built-ins for tests, `tests/fixtures/plugin-contracts` is the external fixture). `ttybrain plugin build|add|remove|new|enable|disable` manage plugins; `TTYBRAIN_PLUGIN_INSTALLER=npm|bun` forces the installer. See `docs/architecture.md` for the file-by-file layout and the rules.
- Plugins import kernel things only from `@ttybrain/api` (`src/kernel/api.ts`) and `@ttybrain/api/tui` (`src/kernel/tui/api.ts`), never by relative path (`tsconfig.json` `paths`, Bun, and `build-node.mjs` resolve the names), and use only `ctx.*`. Only `src/kernel/db/sqlite.ts` touches `bun:sqlite`/`node:sqlite`. Logic and kernel code never import `solid-js` or `@opentui/*`, except the TUI kernel in `src/kernel/tui/` (and plugins' `tui/` parts).
- `bunfig.toml` preloads `@opentui/solid/preload` for both runs and tests. It compiles Solid JSX. Without it, `.tsx` files fail. `tsconfig.json` uses `"jsx": "preserve"` with `jsxImportSource: "@opentui/solid"`.
- Node has no runtime JSX transform, so `scripts/build-node.mjs` compiles `src/` to `dist-node/` ahead of time with Babel (`babel-preset-solid`, `generate: "universal"`, `moduleName: "@opentui/solid"`). It rewrites `solid-js` → `solid-js/dist/solid.js` (Node's `node` export condition would otherwise load the non-reactive server build) and adds `.js` to relative imports. Keep relative imports in `src/` extensionless. Use only ESM. `Bun.*` outside `sqlite.ts`, `@opentui/three` and runtime plugins would break the Node path.
- The TUI: `src/bin/pm.ts` with no arguments and a TTY stdout lazily imports `runTui` (`src/kernel/tui/run.tsx`) and each loaded plugin's `ttybrain.tui` entry. `src/kernel/tui/` is the kernel part; each plugin's screens, tabs, panels and forms are in `src/plugins/<id>/tui/`, which import kernel things only from `@ttybrain/api/tui`. Take keys only with `useScreenKeys`, write only through `act(...)`, read with `useQuery`, and use the record prop `recordRef`, never `ref`. Quitting means `renderer.destroy()` (`runTui` does it). `docs/architecture.md` ("The TUI") has the rules.

## OpenTUI/Solid gotchas

- JSX elements are lowercase intrinsics and multi-word ones use snake_case: `box`, `text`, `select`, `scrollbox`, `input`, `tab_select`, `ascii_font`. Inline modifiers (`span`, `b`, `i`, `u`) only work inside `<text>`.
- `<span>` typings don't accept `fg`. For differently colored pieces, use sibling `<text fg=…>` elements in a `flexDirection="row"` box.
- Solid rules: components run once. Read signals as calls (`focus()`), don't destructure `props`, and use `<For>`/`<Show>` for reactive lists and conditionals.
- Element prop types live in `node_modules/@opentui/solid/src/types/elements.d.ts`. Renderable option types are in `@opentui/core`. Docs are at https://opentui.com/docs.

## Testing

Kernel and plugin tests: `makeTestKernel({ plugins, today, seed })` from `tests/helpers.ts` gives a temp `TTYBRAIN_HOME`, `TTYBRAIN_TEST=1` and a fixed clock (default `2026-11-13`, a Friday); call `kernel.cleanup()` afterwards. With the built-in plugins (and no `env`, `discover` or `clock`) the home starts from a template database made once per test process (migrated, and seeded when `seed` is `seedDesign`/`seedMeetings` from `tests/design.ts`), so pass the seed as `seed` rather than calling it after boot. Drive commands with `runCli([...], kernel, io)` (`src/kernel/cli/dispatch.ts`) and assert on exact output and exit codes; never use the real clock. Run `bash scripts/smoke-node.sh` for anything runtime-sensitive.

TUI tests use `renderTui(kernel, { parts, external, width, height, refreshMs, draftMs })` from `tests/tui.tsx`. It returns `{ frame(), peek(), spans(), input, settle(), nav, renderer, destroy() }`: drive keys with `input`, wait with `await settle()` (or better, on a frame condition, never a fixed sleep; a condition that never holds silently costs the whole wait, so wait for text the frame really shows at that size), assert on `frame()` text (the screen as plain text) and on the database, and call `destroy()` in `finally` (it also stands in for quitting: drafts are flushed, so a later `renderTui` on the same kernel sees them under `TTYBRAIN_HOME/drafts`). Seed data through write ops inside `runWithContext(kernel.context())`. Working patterns: `src/kernel/tui/blocks.test.tsx`, `form.test.tsx`, `src/plugins/projects/tui/projects-screen.test.tsx`. `bash scripts/smoke-node.sh` also runs the TUI self-check on Node (`tui ok`, twice: built-ins, then the built fixture plugin).

## CI

GitLab CI (`.gitlab-ci.yml`), stage `test`: three parallel Bun jobs (`oven/bun:1.4.4`, the version that writes `bun.lock`; each starts with `bun install --frozen-lockfile`) that split the tests with `scripts/test-groups.ts`: `test-logic` (every `*.test.ts`; it also runs `bun scripts/test-groups.ts check` and `bun typecheck`), `test-tui` (`*.test.tsx` under `src/`) and `test-design` (`*.test.tsx` under `tests/`). Every test file must be in exactly one group, or the jobs fail; a new kind of test file needs a group there. `bun run test:logic|test:tui|test:design` runs one group locally. The same stage has job `node-smoke` (`node:26`: `npm ci && bash scripts/smoke-node.sh`) and GitLab's SAST template; `mirror-github` (stage `mirror`) runs only after they all pass. Keep `bun.lock` and `package-lock.json` in sync with `package.json`.
