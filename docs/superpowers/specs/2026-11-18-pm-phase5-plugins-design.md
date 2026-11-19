# ttybrain phase 5: the plugin system — design

> pm is now called ttybrain (2026-11-19); names below are updated.

Date: 2026-11-18. Implements spec §13 item 5 (`docs/superpowers/specs/2026-11-13-pm-design.md`, §3 for the plugin
model). Where this document and the main spec differ, this document wins for phase 5, and the main spec is updated
to match as part of the work.

## 1. Intent

ttybrain is a kernel plus plugins. Today only the four built-ins (`people`, `projects`, `meetings`, `inbox`) exist, and
they are wired in by static imports. Phase 5 finishes the plugin system so that:

- someone can write a plugin as its own package, build it with `ttybrain plugin build`, install it in `~/.ttybrain/plugins`
  (a folder, or `ttybrain plugin add` from npm), and it works in the CLI and the TUI like a built-in;
- **the built-ins are plugins in the same sense**: found by the same loader, described by the same manifest,
  importing only the public API (`@ttybrain/api`, `@ttybrain/api/tui`), and switchable off like any other plugin. The user's
  reason: someone who doesn't want a standard plugin can turn it off, and nothing in ttybrain assumes it is there.

### Goals

- One loader and one manifest format for built-in and external plugins.
- Built-ins import only `@ttybrain/api` and `@ttybrain/api/tui`; a test enforces it.
- `ttybrain plugin disable <id>` works for built-ins (any of the four); ttybrain starts and works with zero plugins.
- External plugins: loading from folders and the npm prefix, version checks, failure isolation, shared-module
  shims, `ttybrain plugin build|add|remove|list|enable|disable|new`.
- The `quickAction` extension point and the CLI side of extra fields (R22), both deferred to this phase.
- The four "Before phase 5" isolation items in `docs/superpowers/plans/2026-11-13-pm-phase1-followups.md`.
- The fixture-plugin test (spec §12) on Bun and Node.

### Non-goals

- **Replacing** a built-in with an external plugin of the same id. Switching off is enough (user's decision). An
  external plugin whose id equals a built-in's fails with `plugin id "<id>" is taken by a built-in plugin`.
- Shipping any real external plugin; a plugin registry or marketplace; sandboxing; plugin settings screens
  (spec §14 unchanged).
- Moving the built-ins out of ttybrain's repository or publishing them to npm.

### Anti-goals (a failure even if it works)

- A broken, outdated or hostile-by-mistake external plugin stops ttybrain from starting, or corrupts another plugin's data.
- Built-ins keep a private path into the kernel that external plugins don't have (the alignment would be cosmetic).
- Bun and Node behave differently for any loading path.
- A second copy of Solid / OpenTUI gets loaded for a plugin (UIs that silently stop updating).

## 2. Approaches considered

- **A. One import name, built-ins stay statically imported.** Built-ins switch to `@ttybrain/api` but are still listed
  in `src/plugins/index.ts`. Cheapest; the built-ins would still be special to the loader.
- **B. Built-ins are real plugin packages, loaded by the same loader (chosen).** Each built-in has a
  `package.json` with the `ttybrain` manifest; the loader reads ttybrain's built-in folder, then `~/.ttybrain/plugins`. Built-ins
  are compiled with ttybrain itself (no shims; they already share ttybrain's module instances), so startup and Bun/Node
  parity stay as they are.
- **C. Keep relative imports, enforce by test only.** Rejected: nothing would prove the public API is enough.

The user picked B because someone may not want the standard plugins; switching off (not replacing) is the
requirement.

## 3. Design

### 3.1 The manifest

Every plugin, built-in or external, is a directory with a `package.json`:

```json
{
  "name": "ttybrain-plugin-contracts", "version": "0.1.0", "type": "module",
  "main": "dist/logic/index.js",
  "ttybrain": { "plugin": true, "id": "contracts", "tui": "dist/tui/index.js" }
}
```

- `main` (required) is the logic entry; its default export is a `PluginDef` (`definePlugin`). `ttybrain.tui`
  (optional) is the tui entry; its default export is a `TuiDef` (`defineTui`). A named export is not accepted.
- `id`, `version`, `apiVersion`, `requires` and `reads` come from the `PluginDef`. **`ttybrain.id` is required** (plan
  ruling R1) so a disabled plugin's id is known without importing it. The loader checks that `package.json`
  `version` equals `PluginDef.version` and `ttybrain.id` equals `PluginDef.id`, and fails the plugin otherwise.
- **Built-ins** use the same format with source entries: `src/plugins/<id>/package.json` has
  `"main": "logic/index.ts"`, `"ttybrain": { "plugin": true, "id": "<id>", "tui": "tui/index.tsx" }`. Under Node the build
  (`scripts/build-node.mjs`) writes the same `package.json` into `dist-node/plugins/<id>/` with `.js` entries.
  Built-ins carry `"private": true` and no peer dependencies.

### 3.2 The loader

A new kernel module (`src/kernel/loader.ts`) turns directories into plugin candidates. It runs before
`bootKernel`, which keeps taking `PluginDef`s (so `makeTestKernel({ plugins })` and the existing host tests stay
valid), now with a `source` per plugin.

1. **Built-in folder**: the directory of ttybrain's own plugins (`src/plugins` under Bun, `dist-node/plugins` under
   Node), resolved from the loader's own module URL. Every subdirectory with a `package.json` whose `ttybrain.plugin`
   is `true` is a candidate with source `built-in`.
2. **Plugin folders**: each subdirectory of `paths.plugins` (`~/.ttybrain/plugins`, `TTYBRAIN_PLUGINS`) other than
   `node_modules`, with a `package.json` marked `ttybrain.plugin`. Source `folder`.
3. **npm prefix**: the `dependencies` of `paths.plugins/package.json`, each resolved under
   `paths.plugins/node_modules/<name>/package.json` and marked `ttybrain.plugin`. Source `npm`.
4. Candidates are imported with dynamic `import()` of a `file://` URL. Each import is wrapped: an import error,
   a missing or invalid default export, a manifest mismatch (`version`, `ttybrain.id`), a duplicate id, or an external id taken by a
   built-in makes a **failed** entry (id from the `PluginDef` when it loaded, else the directory name) that
   `ttybrain plugin list` and Help show. Nothing a failed candidate did is kept.
5. **Disabled plugins are not imported** (their logic code doesn't run), but still listed with status
   `disabled`. The id of a disabled plugin is its `package.json` `ttybrain.id` (required, R1). Importing an external
   candidate and an external `activate` are each raced against 5000 ms (R2): on timeout the plugin fails with
   `<id>: timed out after 5000 ms while <importing|activating>`; built-ins have no timeout. Two plugins with the
   same id: the first loads, the later one fails as a duplicate.
   Accepted gaps (controller rulings, final review): an external migration's `up` has no timeout, so a migration
   that awaits forever hangs boot while holding the write lock; and the Node smoke checks only the external
   screen's title, not its reactivity (Bun's `build.test.ts` covers reactivity).
6. The existing host steps then apply unchanged: sort by `requires`, `apiVersion` check, activate, migrate,
   isolate on failure, cascade to dependants.
7. **TUI parts**: `runTui` loads the `ttybrain.tui` entry of each plugin whose logic is `ok`, in load order. A tui part
   whose import or `activate` fails is listed as failed in Help; a tui `activate` must be synchronous (R3): if it
   returns a thenable the part fails with `<id>: tui activate must be synchronous`, its registrations are removed
   and the rejection is swallowed; its
   logic stays loaded (spec §3.1). Built-in tui parts boot as built-in (screen slots 2–6); others as external
   (slots from 7).
8. `src/plugins/index.ts` and `src/plugins/tui.ts` go away; `src/bin/pm.ts` uses the loader. The TUI self-check
   and the smoke script exercise the loader path.

Startup cost: the CLI path imports only the logic entries, as today. The loader reads at most a handful of
small `package.json` files; no build step runs at startup.

### 3.3 `@ttybrain/api` and `@ttybrain/api/tui`

- These two names are the only way a plugin reaches the kernel. They map to `src/kernel/api.ts` and
  `src/kernel/tui/api.ts`.
- **Inside ttybrain** (built-ins): `tsconfig.json` `paths` for typecheck and for Bun at runtime; `build-node.mjs`
  rewrites them to relative paths for Node. Built-ins replace every `../../../kernel/api` and
  `../../../kernel/tui/api` import with the package name.
- **Enforcement**: a test scans `src/plugins/**` (non-test files) and fails on any import that reaches into
  `src/kernel` by path. Plugin test files may keep importing test helpers and kernel internals.
- Anything a built-in still needs that `api.ts` / `tui/api.ts` doesn't export (today `PluginDef` / `TuiDef` types
  from `kernel/tui/types`, used by the deleted list files) is added to the public API. No new private path.

### 3.4 Shared modules and `ttybrain plugin build`

As spec §3.6, with these decisions:

- At startup (CLI and TUI) the kernel sets `globalThis.__TTYBRAIN_MODULES__` with `@ttybrain/api`; the TUI adds
  `@ttybrain/api/tui`, `solid-js`, `solid-js/store`, `@opentui/solid`, `@opentui/core` before loading tui parts.
- `ttybrain plugin build [dir]` compiles `<dir>/src/` to `<dir>/dist/` with Babel (TypeScript preset; Solid preset in
  universal mode with `moduleName: "@opentui/solid"` for `.tsx`), adds `.js` to relative imports, and rewrites
  each shared-module import to a generated shim in `dist/__pm/<name>.js`. **Shims are generated from what the
  plugin imports** (R4), not from the host's export list, so the build never imports UI modules. A shim
  re-exports those names from `globalThis.__TTYBRAIN_MODULES__[name]`, and throws
  `"<name>" is provided by ttybrain; load this plugin from ttybrain` when that global is missing.
- At load, each shim checks that every imported name exists on the host module; a missing one fails with
  `rebuild the plugin with this ttybrain (missing export "<x>" from "<name>")`; failure isolation handles it.
- **Only named imports** of shared modules are allowed: `import * as x` or `export *` fails the build with
  `<file>: use named imports from "<name>"`. An `@opentui/*` package other than the two shared ones
  (`@opentui/solid`, `@opentui/core`) fails the build. A computed `import()` of a shared module is not caught
  (accepted); a plugin's own npm dependencies that import Solid load their own copy (known limit).
- The build fails when the logic entry, directly or through its own files, imports `solid-js`, `@opentui/*` or
  `@ttybrain/api/tui` (spec §3.1).
- **Supported author setup** *(my call)*: a git checkout of ttybrain (run with Bun, or built for Node from that checkout).
  Type-checking a plugin needs ttybrain's TypeScript sources; a Node-only install without `src/` can still build
  plugins (Babel strips types) but the scaffold's `tsconfig` has nothing to point at. No `.d.ts` output in phase 5.
- The Babel packages `ttybrain plugin build` needs move from `devDependencies` to `dependencies`.
  *(My call: needed so the command works outside a dev checkout, e.g. in the phase 6 container.)*

### 3.5 `ttybrain plugin` commands

`list` exists. New:

| Command | Behaviour |
|---|---|
| `ttybrain plugin add <npm-name\|path\|tgz>` | `npm install` in `paths.plugins` (creates its `package.json` if missing); with no `npm`, under Bun, `bun add --cwd`. A first add of a non-built-in source prints the trust warning (spec §3.7). A path to a plugin **folder** is installed through npm too (a `file:` dependency) |
| `ttybrain plugin remove <id>` | **Destructive: needs `--yes`** (R5; it deletes a folder or uninstalls a package). npm uninstall, or delete the folder for source `folder`. An id used by more than one plugin is refused (remove by hand). Built-in: error `"<id>" is built in; use "ttybrain plugin disable <id>"`. Tables stay unless `--purge-data --yes`, which drops the plugin's tables and its kernel rows (migrations, provenance) |
| `ttybrain plugin enable\|disable <id>` | edit `plugins.disabled` in the config file. Works for built-ins. `disable` lists the plugins that require it and will be skipped too. Unknown id: not-found error A disabled plugin's tables and data stay untouched, and `enable` brings them back as they were; there is no way to purge a built-in's data (user's decision) |
| `ttybrain plugin build [dir]` | §3.4 |
| `ttybrain plugin new <id>` | scaffold `<id>/` (in the current directory) with `package.json`, `src/logic/index.ts` (a migration, a command), `src/tui/index.tsx` (a screen, a project `recordTab`), a test, and a `tsconfig.json` whose `paths` point `@ttybrain/api*` at the running ttybrain's API source files (`src/kernel/api.ts`, `src/kernel/tui/api.ts`). `ttybrain plugin build <id>` then works on it without edits |

All follow the CLI conventions in `docs/architecture.md` (`--json`, exit codes, error hints).

- **Trust warning** *(my call)*: printed, not blocking (the spec says ttybrain warns; there is no sandbox to gate).
  It is printed the first time a given package name is added; the name is then appended to `plugins.allow` in
  the config file, which only means "already warned". `plugins.allow` does **not** gate loading: a folder copied
  into `~/.ttybrain/plugins` by hand loads without it.

### 3.6 Working without some or all built-ins

- ttybrain starts with any subset of plugins, including none: the CLI shows `help`, `guide`, `plugin`, `report`; the
  TUI shows Overview (empty-state text when no panels), the switcher and Help.
- The kernel's global key hints come from what is registered: `i capture` appears only when a plugin registers
  that global action (today it is a hard-coded line in `keys.ts`).
- `--from-inbox` when no plugin registers the `I-` record type fails with
  `--from-inbox needs the inbox plugin, which is not loaded`.
- Built-ins that softly depend on each other (`reads`, `ctx.records.hasType`) keep working when the other is off;
  the hard `requires` chain (`meetings` → `projects` → `people`) skips dependants with a message.
- A test boots each built-in disabled in turn, and with all four disabled, and runs the CLI and the TUI
  self-check.

### 3.7 `quickAction` (tui part)

`ui.quickAction(recordType, def)` with `def = { id, label, key?, when?(ref), run(ref, ui) }` or, for a confirmed
action, `{ …, confirm: true, plan(ref) → ChangeSetOp[] }`.

- `.` on a record view (and on a list row whose record type has actions) opens the action menu; Enter runs the
  selected action; `key` runs it directly from the record view. A `key` that clashes with the record view's own
  keys or another action skips that action with a message in Help (same rule as `globalAction`).
- A `confirm` action shows its change set (the ops' `describe` lines) and applies it in one transaction on
  accept, logged with origin `quickaction`; an error is shown next to the failing line (spec §3.5).
- The built-ins don't need to register one; the fixture plugin does.

### 3.8 Extra fields on the CLI (R22)

A command may declare the record type it shows or edits: `CommandDef.record?: { type, role: "show" | "edit" }`.
For `show`, the kernel adds `fields: { <name>: value }` to the `--json` output and a line per field to the text;
for `edit`, it adds a `--<name>` flag per field of that type and saves changed fields through the field's `set`
operation inside the same act, after the plugin's own write (as the TUI form does). The built-ins' `show`/`edit`
commands declare their record types.

*(My calls)* The kernel finds the record from the command's first positional argument, resolved through the
record type registry **before** `run` (so a bad ref fails before any write). On `edit`, when only field flags are
given, the kernel skips the plugin's own write and saves just the fields; when both are given it runs the
plugin's write first and then the fields, in one act. A field name that clashes with an existing flag fails that field's
registration with a message.

### 3.9 `tagType` for external plugins

Already in the logic API. Phase 5 checks it from outside: a prefix must be one non-alphanumeric, non-space
character other than `#` and `@` unless registered by the record type's own plugin; a taken prefix fails that
registration with a message. Quick capture's suggestions use any registered prefix (the fixture plugin registers
`$`).

### 3.10 Isolation hardening (followups "Before phase 5")

1. Reject table-valued functions in plugin SQL (`pragma_*`, `dbstat`; EXPLAIN opcodes `VOpen`/`VFilter`), so
   other plugins' schema can't be read.
2. Freeze `ctx.config` (deep).
3. Provenance cleanup on delete supports `#`/`@` refs.
4. Move the `--from-inbox` existence check from the CLI dispatcher into the kernel's context, so every caller
   gets it.

### 3.11 The fixture plugin and tests

- `tests/fixtures/plugin-contracts/` (source; never imported by ttybrain): a migration, a published view, a command,
  a `recordTab` on projects, a screen, a `quickAction` with `confirm`, a `field` on projects, a `$` tag type.
- A test builds it with `ttybrain plugin build` into a temp copy and loads it (a) as a folder in `TTYBRAIN_PLUGINS`, (b)
  through `npm pack` + `ttybrain plugin add <tgz>`. It exercises the command, the field via `show --json` / `edit`,
  the migration, and in the TUI the screen, the tab and the quick action.
- Failure cases, each with ttybrain still starting and the error in `ttybrain plugin list`: a throwing import, a throwing
  `activate`, a failing migration (rolled back), a newer `apiVersion`, a missing shim export, a duplicate id, an
  id taken by a built-in, a tui part whose async `activate` rejects.
- `scripts/smoke-node.sh` runs the fixture build-and-load on Node 26, including `npm pack` + `ttybrain plugin add <tgz>`
  through npm. The tarball has no dependencies, so no network is needed.
- *(My call)* The Bun `test` job (`oven/bun`, no npm) runs the folder case and the `<tgz>` case through the
  `bun add --cwd` fallback, so both installers are tested; `bun ttybrain pack` makes the tarball there.

## 4. Delivery

One design, two plans and two merge requests, in this order:

1. **Part 1, loading and alignment:** §3.1–3.6, §3.10, the fixture plugin without quick action and field, and
   the docs (`docs/architecture.md`, spec §3, plugin reference, CLAUDE.md, README).
2. **Part 2, extension points:** §3.7–3.9 and the rest of the fixture plugin.

*(My call: Part 1 is already the largest change so far; splitting keeps each review readable.)*

## 5. Left to the builder (settled in the build)

- How the loader knows a disabled plugin's id without importing it: settled by R1, `ttybrain.id` is required (§3.1).
- The exact `__TTYBRAIN_MODULES__` shape and shim file names.
- The internal layout of the loader and build modules, and how `ttybrain plugin new`'s template files are stored.
- The text of new messages not fixed above, following existing message style.
