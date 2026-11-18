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
# The built-ins are discovered from dist-node/plugins/*/package.json (written by the build).
out="$(pm plugin list)"; echo "$out"
for p in people projects meetings inbox; do
  echo "$out" | grep -Eq "^$p +1\.0\.0 +built-in +ok" || fail "plugin list: expected \"$p 1.0.0 built-in ok\", got: $out"
done

set +e
pm project show NOPE
code=$?
set -e
[ "$code" -eq 2 ] || fail "project show NOPE: expected exit 2, got $code"

# The fixture plugin (tests/fixtures/plugin-contracts), built with `pm plugin build` and loaded on Node: first as a
# folder in PM_PLUGINS, then packed and installed with `pm plugin add <tgz>` through npm (offline: no dependencies).
cp -R tests/fixtures/plugin-contracts "$PM_HOME/src-contracts"
rm -rf "$PM_HOME/src-contracts/dist" "$PM_HOME/src-contracts/node_modules"
out="$(pm plugin build "$PM_HOME/src-contracts")"; echo "$out"
expect_in "plugin build" "built pm-plugin-contracts 0.1.0" "$out"

mkdir -p "$PM_HOME/folder-plugins"
cp -R "$PM_HOME/src-contracts" "$PM_HOME/folder-plugins/contracts"
out="$(PM_PLUGINS="$PM_HOME/folder-plugins" pm contract add CRM "Support")"; echo "$out"
expect_in "contract add (folder)" "C-1 Support" "$out"
out="$(PM_PLUGINS="$PM_HOME/folder-plugins" pm contract list)"; echo "$out"
echo "$out" | grep -Eq "^C-1 +#CRM +Support" || fail "contract list (folder): expected \"C-1 #CRM Support\", got: $out"
out="$(PM_PLUGINS="$PM_HOME/folder-plugins" pm plugin list)"; echo "$out"
echo "$out" | grep -Eq "^contracts +0\.1\.0 +folder +ok" || fail "plugin list: expected \"contracts 0.1.0 folder ok\", got: $out"

tgz="$(cd "$PM_HOME/src-contracts" && npm pack --silent --pack-destination "$PM_HOME")"
out="$(PM_PLUGINS="$PM_HOME/npm-plugins" PM_PLUGIN_INSTALLER=npm pm plugin add "$PM_HOME/$tgz")"; echo "$out"
expect_in "plugin add" "added contracts 0.1.0 (npm)" "$out"
# Same database: the folder copy's C-1 is still there, and the npm copy adds C-2.
out="$(PM_PLUGINS="$PM_HOME/npm-plugins" pm contract add CRM "Renewal")"; echo "$out"
expect_in "contract add (npm)" "C-2 Renewal" "$out"
out="$(PM_PLUGINS="$PM_HOME/npm-plugins" pm contract list)"; echo "$out"
echo "$out" | grep -Eq "^C-2 +#CRM +Renewal" || fail "contract list (npm): expected \"C-2 #CRM Renewal\", got: $out"
out="$(PM_PLUGINS="$PM_HOME/npm-plugins" pm plugin list)"; echo "$out"
echo "$out" | grep -Eq "^contracts +0\.1\.0 +npm +ok" || fail "plugin list: expected \"contracts 0.1.0 npm ok\", got: $out"

out="$(PM_PLUGINS="$PM_HOME/npm-plugins" node --experimental-ffi dist-node/kernel/tui/selfcheck.js --expect-screen Contracts 2>&1)" || fail "tui self-check (contracts): $out"; echo "$out"
expect_in "tui (contracts)" "tui ok" "$out"

echo "smoke ok"
