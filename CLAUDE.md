# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

A terminal UI built with [OpenTUI](https://opentui.com) (`@opentui/core`) and its Solid binding (`@opentui/solid`), running on **Bun** or **Node.js 26.4+**. Both runtimes must keep working. Bun is installed at `~/.bun/bin` and may not be on `PATH` in non-login shells. The system Node (`/usr/local/bin/node`) is 26.x.

## Commands

- `bun start`: run the app (it needs a real TTY, so it can't be driven from a non-interactive shell; use tests instead)
- `bun dev`: run with `--watch`
- `bun test`: run all tests. Run a single test with `bun test ./src/App.test.tsx` (the `./` makes it a path) or `bun test -t "<name pattern>"`
- `bun typecheck`: type-check (`bun check`)
- `npm run start:node`: run on Node. It runs `build:node` (`scripts/build-node.mjs`, which compiles `src/` to `dist-node/` with Babel), then `node --experimental-ffi dist-node/index.js`

## How it's wired

- `bunfig.toml` preloads `@opentui/solid/preload` for both runs and tests. It compiles Solid JSX. Without it, `.tsx` files fail. `tsconfig.json` uses `"jsx": "preserve"` with `jsxImportSource: "@opentui/solid"`.
- Node has no runtime JSX transform (`@opentui/solid/preload` throws on Node), so `scripts/build-node.mjs` compiles ahead of time. It uses `babel-preset-solid` with `generate: "universal"` and `moduleName: "@opentui/solid"`, the same settings as the package's internal transform. It also rewrites imports: `solid-js` → `solid-js/dist/solid.js`, because Node's `node` export condition would otherwise load Solid's non-reactive server build, and extensionless relative imports get `.js`. Keep using extensionless relative imports in `src/`. Use only ESM. Bun-only APIs (`Bun.*`, `@opentui/three`, runtime plugins) would break the Node path.
- `src/index.tsx` calls `render()`, which creates the renderer. Components get it with `useRenderer()`. Quitting means calling `renderer.destroy()`, which also disposes the Solid root.
- `src/App.tsx` owns app state (selected section, focused pane) and the global keys (`q`, `tab`). Arrow keys go to whichever `select`/`scrollbox` has `focused={true}`. Focus is a prop driven by the `focus` signal, not imperative `.focus()` calls. If you add an `input`/`textarea`, guard the global `q` handler so typing doesn't quit.
- `src/sections.tsx` is the registry of screens. Each entry gives a sidebar item plus a `view()` for the main panel. Add screens there.
- `src/theme.ts` holds all colors.

## OpenTUI/Solid gotchas

- JSX elements are lowercase intrinsics and multi-word ones use snake_case: `box`, `text`, `select`, `scrollbox`, `input`, `tab_select`, `ascii_font`. Inline modifiers (`span`, `b`, `i`, `u`) only work inside `<text>`.
- `<span>` typings don't accept `fg`. For differently colored pieces, use sibling `<text fg=…>` elements in a `flexDirection="row"` box.
- Solid rules: components run once. Read signals as calls (`focus()`), don't destructure `props`, and use `<For>`/`<Show>` for reactive lists and conditionals.
- Element prop types live in `node_modules/@opentui/solid/src/types/elements.d.ts`. Renderable option types are in `@opentui/core`. Docs are at https://opentui.com/docs.

## Testing

Tests use `testRender(() => <App />, { width, height })` from `@opentui/solid`. Drive input with `mockInput.pressArrow/pressTab/pressKey/typeText`. Call `await renderOnce()` before `captureCharFrame()`, which returns the screen as plain text. Always call `renderer.destroy()` in `finally`. Printing `captureCharFrame()` is the easiest way to see the layout without a TTY.

## CI

GitLab CI (`.gitlab-ci.yml`) runs only GitLab's SAST template in the `test` stage. It doesn't run the tests or the type-check.
