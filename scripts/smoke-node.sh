#!/usr/bin/env bash
# Builds for Node and exercises the kernel, the CLI and a TUI frame on Node 26. Needs only node (no bun); the
# TUI self-check runs with --experimental-ffi, the rest without.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PM_HOME="$(mktemp -d)"
export PM_HOME
trap 'rm -rf "$PM_HOME"' EXIT

fail() { echo "smoke FAILED: $*" >&2; exit 1; }
expect_in() { # expect_in <name> <needle> <haystack>
  case "$3" in *"$2"*) ;; *) fail "$1: expected output to contain \"$2\", got: $3" ;; esac
}

node scripts/build-node.mjs

out="$(node dist-node/kernel/db/savepoint-selfcheck.js)"; echo "$out"
expect_in savepoints "savepoints ok" "$out"

out="$(node dist-node/kernel/isolation-selfcheck.js)"; echo "$out"
expect_in isolation "isolation ok" "$out"

out="$(node --experimental-ffi dist-node/kernel/tui/selfcheck.js 2>&1)" || fail "tui self-check: $out"; echo "$out"
expect_in tui "tui ok" "$out"

pm() { node dist-node/bin/pm.js "$@"; }

out="$(pm person add "Anna Peeters" --team)"; echo "$out"
expect_in "person add" "Anna Peeters" "$out"
out="$(pm project add CRM "CRM")"; echo "$out"
expect_in "project add" "CRM" "$out"
out="$(pm action add "Test" --project CRM --due fri --json)"; echo "$out"
expect_in "action add" '"ref"' "$out"
out="$(pm report overview --format text)"; echo "$out"
expect_in "report overview" "CRM" "$out"
out="$(pm inbox add "x #CRM")"; echo "$out"
expect_in "inbox add" "I-1" "$out"
out="$(pm plugin list)"; echo "$out"
for p in people projects inbox; do expect_in "plugin list" "$p" "$out"; done

set +e
pm project show NOPE
code=$?
set -e
[ "$code" -eq 2 ] || fail "project show NOPE: expected exit 2, got $code"

echo "smoke ok"
