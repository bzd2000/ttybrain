# opentui-app

A terminal UI starter built with [OpenTUI](https://opentui.com) and Solid. It runs on Bun or Node.js.

## Bun (1.3.14+)

```bash
bun install
bun start        # run the app
bun dev          # run with auto-restart on file changes
bun test         # run tests
bun typecheck    # type-check
```

## Node.js (26.4+)

```bash
npm install
npm run start:node   # compiles src/ to dist-node/, then runs: node --experimental-ffi dist-node/index.js
```

Node prints an `ExperimentalWarning` about FFI on startup. That's expected. Tests and type-checking use Bun.

Keys: `↑`/`↓` select or scroll, `tab` switch pane, `q` or `Ctrl+C` quit.
