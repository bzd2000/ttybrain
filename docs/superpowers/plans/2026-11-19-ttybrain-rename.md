# Rename pm to ttybrain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tool is called ttybrain everywhere a user or plugin author meets it: the command, the data folder, environment variables, the plugin API, messages and the TUI; existing `~/.pm` data moves over on first run.

**Architecture:** A mechanical rename in four slices (paths and env, user-facing texts and the command, the plugin API surface, docs), plus one new behaviour: a one-time move of the default data folder.

**Tech Stack:** TypeScript, Bun 1.4 and Node 26.4+, OpenTUI + Solid, SQLite.

**Spec:** the user approved this in chat on 2026-11-19 (memory `tool-name-ttybrain`): full rename, clean break for env vars, move `~/.pm` with a link back. This plan is the record.

## Global Constraints

- Both runtimes keep working: every task ends with `bun test`, `bun typecheck`, `bash scripts/smoke-node.sh` (last line `smoke ok`) green.
- Exact names:
  - command `ttybrain`, alias `tb` (both in `package.json` `bin`, both pointing at `dist-node/bin/pm.js` — the entry file name stays);
  - default data folder `~/.ttybrain`; database file `ttybrain.db`; backups `ttybrain.db.bak-v<N>`;
  - env vars: every `PM_<X>` becomes `TTYBRAIN_<X>` (`TTYBRAIN_HOME`, `TTYBRAIN_DB`, `TTYBRAIN_CONFIG`, `TTYBRAIN_CONFIG_JSON`, `TTYBRAIN_PLUGINS`, `TTYBRAIN_EXPORTS`, `TTYBRAIN_TEST`, `TTYBRAIN_MODE`, `TTYBRAIN_PLUGIN_INSTALLER`); the old names are not read (clean break);
  - plugin API module names `@ttybrain/api`, `@ttybrain/api/tui`; manifest key `"ttybrain"` (was `"pm"`); global `globalThis.__TTYBRAIN_MODULES__`; built-in package names `@ttybrain/plugin-<id>`; scaffolded package name `ttybrain-plugin-<id>`;
  - TUI header `ttybrain · <n> <Screen>`; command usage and hints say `ttybrain <thing> <verb>`.
- Unchanged: the repo, source file and directory names (`src/bin/pm.ts` etc.), historical plan/spec file names and their past-tense content, `docs/superpowers/plans/*` older than this plan.
- No `PM_` / `@pm/` / `__PM_MODULES__` / `"pm"` manifest key left in `src/`, `tests/`, `scripts/`, `.gitlab-ci.yml` after Task 3 (a test enforces it).
- CLI conventions and message style as in `docs/architecture.md`; tests use a fixed clock.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Existing user data:** a real `~/.pm` with `pm.db`, backups and plugins → after the first `ttybrain` run, everything is under `~/.ttybrain`, the database opens with all records, and an old `pm` build still finds the data through `~/.pm`. Test in Task 1.
2. **Both folders exist** (`~/.ttybrain` and `~/.pm`): nothing is moved or overwritten. Test in Task 1.
3. **A user who sets the folder** (`TTYBRAIN_HOME`, `TTYBRAIN_DB`): nothing is moved. Test in Task 1.
4. **An external plugin built before the rename** (imports `@pm/api`, manifest key `pm`): it is ignored or fails with a clear "rebuild" message, never crashes boot. Test in Task 3.
5. **A leftover `PM_HOME` in the user's shell:** ignored silently is acceptable; it must not change where data goes. Test in Task 1.

---

### Task 1: Paths, environment variables and the data move

**Files:**
- Modify: `src/kernel/paths.ts`, `src/kernel/migrations.ts` (backup name), `src/kernel/db/savepoint-selfcheck.ts`, `src/kernel/cli/args.ts` (`--db` description), every `env.PM_*` read in `src/`, `tests/helpers.ts`, `tests/tui.tsx`, every test and script that sets `PM_*` (including `scripts/smoke-node.sh`, `.gitlab-ci.yml` if it sets any)
- Create: `src/kernel/home-move.ts`, `src/kernel/home-move.test.ts`

**Interfaces:**
- Produces: `resolvePaths(env, flags)` reads only `TTYBRAIN_*`; default home `join(HOME, ".ttybrain")`, db `join(home, "ttybrain.db")`.
- `moveLegacyHome(env): string | undefined` in `src/kernel/home-move.ts` — returns the notice line when it moved something, else undefined. Called once from `src/bin/pm.ts` before `bootKernel`; the notice goes to stderr.

- [ ] **Step 1: Write the failing tests** (`home-move.test.ts`, temp `HOME`):

```ts
test("moves ~/.pm to ~/.ttybrain, renames the db and backups, links back")
// HOME/.pm with pm.db (a real SQLite file with one row), pm.db.bak-v3, config.json, plugins/x/package.json
// → returns "moved your data from <HOME>/.pm to <HOME>/.ttybrain"
// → <HOME>/.ttybrain/ttybrain.db opens and has the row; ttybrain.db.bak-v3; config.json; plugins/x
// → <HOME>/.pm is a symlink to <HOME>/.ttybrain; <HOME>/.ttybrain/pm.db is a symlink to ttybrain.db (old builds open the same file)
test("does nothing when ~/.ttybrain exists") // both exist → undefined; neither touched
test("does nothing when TTYBRAIN_HOME or TTYBRAIN_DB is set") // → undefined; ~/.pm untouched
test("ignores a leftover PM_HOME") // env { HOME, PM_HOME: "/elsewhere" } → resolvePaths gives <HOME>/.ttybrain
test("does nothing when there is no ~/.pm") // → undefined, nothing created
test("a db with -wal/-shm files moves them too")
```

- [ ] **Step 2: Run them (RED).**
- [ ] **Step 3: Implement.** `renameSync` the folder (same filesystem; if it throws `EXDEV`, return undefined and leave everything — do not copy), then rename `pm.db` / `pm.db-wal` / `pm.db-shm` / `pm.db.bak-v*` to the `ttybrain.db…` names, then create the two symlinks. Rename all `PM_*` reads to `TTYBRAIN_*` and every test/script that sets them.
- [ ] **Step 4: Verify** — all checks green.
- [ ] **Step 5: Commit** — `feat: ttybrain data folder and TTYBRAIN_* variables, move ~/.pm on first run`

### Task 2: The command and user-facing texts

**Files:**
- Modify: `package.json` (`name: "ttybrain"`, `bin: { "ttybrain": …, "tb": … }`), `src/kernel/cli/args.ts` (usage), `src/kernel/cli/**` and plugin files with `pm <thing>` hints/messages, `src/kernel/tui/frame.tsx` (header), `src/kernel/tui/selfcheck.tsx`, `src/kernel/guide.ts` and plugin guide sections (the agent guide's command examples), `src/kernel/plugins/install.ts` / `scaffold.ts` messages (`ttybrain plugin add needs npm on the PATH`, etc.), all affected tests, `scripts/smoke-node.sh` (`pm()` helper calls the same entry; its assertions on texts)
- Rename `PM_VERSION` → `VERSION` (or `TTYBRAIN_VERSION`).

- [ ] **Step 1:** Add a test `tests/name.test.ts`: `ttybrain help` text starts with `ttybrain`; a usage line reads `ttybrain project add <code> <name>`; the TUI header (renderTui) shows `ttybrain · 1 Overview`; `package.json` bin has `ttybrain` and `tb`.
- [ ] **Step 2: RED.** **Step 3:** rename texts (grep `"pm `, `` `pm ``, `run "pm`, `pm · `). **Step 4:** verify. **Step 5: Commit** — `feat: the command is ttybrain (alias tb)`

### Task 3: The plugin API surface

**Files:**
- Modify: `tsconfig.json` paths, `scripts/build-node.mjs` (rewrite of the module names), every `@pm/api` import in `src/plugins/**`, `src/kernel/loader.ts` and `install.ts` (manifest key `ttybrain`), `__PM_MODULES__` users (`loader.ts`, `tui/load.ts`, `plugins/build.ts` shims and messages), `src/kernel/plugins/build.ts` shared-name list, `scaffold.ts` templates, `src/plugins/*/package.json` (key and names), `tests/fixtures/plugin-contracts/`, `tests/plugin-imports.test.ts`, `tests/logic-ui-split.test.ts`, build/install/scaffold/external-plugin tests.

- [ ] **Step 1: Write the failing tests:**

```ts
test("no old names left") // scan src/, tests/, scripts/, .gitlab-ci.yml (non-binary): no /\bPM_[A-Z]/, no "@pm/", no "__PM_MODULES__", no `"pm": {` manifest key → offenders []
test("a plugin built before the rename is reported, not fatal") // plugins/old/package.json with "pm": { "plugin": true, "id": "old" } and no "ttybrain" key → listed failed with 'built for pm; rebuild it with "ttybrain plugin build"'; the four built-ins still ok; its code is never imported
```

- [ ] **Step 2: RED.** **Step 3:** rename; the loader recognises a legacy `"pm": { "plugin": true }` manifest only to report the rebuild message above. **Step 4:** verify (smoke builds and loads the fixture and scaffold under the new names). **Step 5: Commit** — `feat: plugin API is @ttybrain/api`

### Task 4: Docs

**Files:** `README.md`, `CLAUDE.md`, `docs/architecture.md`, `docs/superpowers/specs/2026-11-13-pm-plugins.md` ("Writing an external plugin"), the living parts of `docs/superpowers/specs/2026-11-13-pm-design.md` and `2026-11-18-pm-phase5-plugins-design.md` (a note at the top: "pm is now called ttybrain (2026-11-19); names below are updated" and the names updated), `docs/superpowers/plans/2026-11-13-pm-phase1-followups.md` (a short "Rename to ttybrain" section: the data move, the clean env break, the legacy-manifest message).

- [ ] **Step 1:** update; **Step 2:** `grep -rn "PM_HOME\|@pm/api\|~/.pm\b" README.md CLAUDE.md docs/architecture.md docs/superpowers/specs` shows only lines that explain the move/legacy; `bun test` green. **Step 3: Commit** — `docs: pm is now ttybrain`
