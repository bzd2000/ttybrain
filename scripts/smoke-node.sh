#!/usr/bin/env bash
# Builds for Node and exercises the kernel, the CLI and a TUI frame on Node 26. Needs only node (no bun); the
# TUI self-check runs with --experimental-ffi, the rest without.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

TTYBRAIN_HOME="$(mktemp -d)"
export TTYBRAIN_HOME
trap 'rm -rf "$TTYBRAIN_HOME"' EXIT

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

ttybrain() { node dist-node/bin/pm.js "$@"; }

out="$(ttybrain person add "Anna Peeters" --team)"; echo "$out"
expect_in "person add" "Anna Peeters" "$out"
out="$(ttybrain project add CRM "CRM")"; echo "$out"
expect_in "project add" "CRM" "$out"
out="$(ttybrain action add "Test" --project CRM --due fri --json)"; echo "$out"
expect_in "action add" '"ref"' "$out"
out="$(ttybrain report overview --format text)"; echo "$out"
expect_in "report overview" "CRM" "$out"
out="$(ttybrain inbox add "x #CRM")"; echo "$out"
expect_in "inbox add" "I-1" "$out"
# The built-ins are discovered from dist-node/plugins/*/package.json (written by the build).
out="$(ttybrain plugin list)"; echo "$out"
for p in people inbox; do
  echo "$out" | grep -Eq "^$p +1\.0\.0 +built-in +ok" || fail "plugin list: expected \"$p 1.0.0 built-in ok\", got: $out"
done
for p in projects actions meetings; do
  echo "$out" | grep -Eq "^$p +2\.0\.0 +built-in +ok" || fail "plugin list: expected \"$p 2.0.0 built-in ok\", got: $out"
done
# A series makes its occurrences ahead; a later write's upkeep makes none twice.
out="$(ttybrain meeting series add @anna "1:1 Anna" --every "2 weeks on wed" --from wed)"; echo "$out"
expect_in "meeting series add" "S-1 1:1 Anna: every 2 weeks on wed, next " "$out"
out="$(ttybrain meeting skip M-1)"; echo "$out"
expect_in "meeting skip" "M-1 skipped" "$out"
ttybrain person add "Bob Willems" >/dev/null
out="$(ttybrain meeting list --all --json)"
expect_in "meeting list (series)" '"series": "S-1"' "$out"
count="$(echo "$out" | grep -c '"ref": "M-')"
[ "$count" -eq 4 ] || fail "meeting list: expected 4 occurrences, got $count: $out"
# Links: --link is repeatable, show lists them, link adds one.
out="$(ttybrain action add "Linked" --link "#CRM" --link @anna)"; echo "$out"
out="$(ttybrain action link A-2 A-1)"; echo "$out"
expect_in "action link" "A-2 linked to A-1" "$out"
out="$(ttybrain action show A-2)"; echo "$out"
expect_in "action show links" "  links: #CRM, @anna, A-1" "$out"

set +e
ttybrain project show NOPE
code=$?
set -e
[ "$code" -eq 2 ] || fail "project show NOPE: expected exit 2, got $code"

# The handover of actions from projects on Node: a database with actions left in projects_action (as an older build
# wrote them, with actions disabled), then a start with actions: they move with their ids, and projects' copy is gone.
handover_home="$TTYBRAIN_HOME/handover-home"
mkdir -p "$handover_home"
TTYBRAIN_HOME="$handover_home" TTYBRAIN_CONFIG_JSON='{"plugins":{"disabled":["actions"]}}' ttybrain project add CRM "CRM" >/dev/null
# db_eval runs a fixed JavaScript expression from this script against the scratch database (no outside input).
db_eval() { node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1]); const r = eval(process.argv[2]); if (r !== undefined) console.log(JSON.stringify(r))' "$handover_home/ttybrain.db" "$1"; }
db_eval 'db.exec(`INSERT INTO projects_action (id, title, status, project_id, created_at, updated_at) VALUES (7, '"'"'Legacy seven'"'"', '"'"'open'"'"', 1, '"'"'2026-01-01T00:00:00'"'"', '"'"'2026-01-02T00:00:00'"'"'), (42, '"'"'Legacy 42'"'"', '"'"'done'"'"', NULL, '"'"'2026-01-03T00:00:00'"'"', '"'"'2026-01-04T00:00:00'"'"')`)'
out="$(TTYBRAIN_HOME="$handover_home" ttybrain action list --json)"; echo "$out"
expect_in "handover A-7" '"ref": "A-7"' "$out"
expect_in "handover A-42" '"ref": "A-42"' "$out"
out="$(TTYBRAIN_HOME="$handover_home" ttybrain action add "After the move" --json)"
expect_in "handover next id" '"ref": "A-43"' "$out"
out="$(db_eval '[db.prepare("SELECT count(*) AS n FROM projects_action").get().n, db.prepare("SELECT id, created_at, updated_at FROM actions_action WHERE id IN (7, 42) ORDER BY id").all()]')"; echo "$out"
expect_in "handover projects emptied, timestamps kept" '[0,[{"id":7,"created_at":"2026-01-01T00:00:00","updated_at":"2026-01-02T00:00:00"},{"id":42,"created_at":"2026-01-03T00:00:00","updated_at":"2026-01-04T00:00:00"}]]' "$out"
out="$(db_eval 'db.prepare("SELECT action_id, record_type, record_id FROM actions_link").all()')"; echo "$out"
expect_in "handover project link" '[{"action_id":7,"record_type":"project","record_id":1}]' "$out"

# Meetings 1.0.0 data on Node: the tables of its migration 001 (as it created them) with a steering meeting, its
# attendee and its agenda, then a start with meetings 2.0.0: migration 002 rebuilds them without ON DELETE CASCADE and
# remaps the kind; the meeting keeps everything and has no subject until `meeting subject` gives it one.
meetings_home="$TTYBRAIN_HOME/meetings-home"
mkdir -p "$meetings_home"
TTYBRAIN_HOME="$meetings_home" TTYBRAIN_CONFIG_JSON='{"plugins":{"disabled":["meetings"]}}' ttybrain project add BOARD "Management board" >/dev/null
TTYBRAIN_HOME="$meetings_home" TTYBRAIN_CONFIG_JSON='{"plugins":{"disabled":["meetings"]}}' ttybrain person add "Peter Janssens" >/dev/null
meetings_eval() { node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1]); const r = eval(process.argv[2]); if (r !== undefined) console.log(JSON.stringify(r))' "$meetings_home/ttybrain.db" "$1"; }
meetings_eval 'db.exec(`
  CREATE TABLE "meetings_meeting" ("id" integer primary key, "title" text not null, "date" text not null, "kind" text not null check (kind in ('"'"'board'"'"', '"'"'steering'"'"', '"'"'other'"'"')), "status" text default '"'"'planned'"'"' not null check (status in ('"'"'planned'"'"', '"'"'held'"'"', '"'"'cancelled'"'"')), "since_date" text, "notes" text default '"'"''"'"' not null, "created_at" text not null, "updated_at" text not null);
  CREATE INDEX "meetings_meeting_date" on "meetings_meeting" ("date");
  CREATE TABLE "meetings_attendee" ("meeting_id" integer not null references "meetings_meeting" ("id") on delete cascade, "person_id" integer not null, constraint "meetings_attendee_pk" primary key ("meeting_id", "person_id"));
  CREATE TABLE "meetings_agenda_item" ("id" integer primary key, "meeting_id" integer not null references "meetings_meeting" ("id") on delete cascade, "position" integer not null, "text" text not null, "project_id" integer, "ask" text, constraint "meetings_agenda_item_position" unique ("meeting_id", "position"));
  INSERT INTO kernel_plugin_migration (plugin, id, applied_at) VALUES ('"'"'meetings'"'"', '"'"'001'"'"', '"'"'2026-01-01T00:00:00'"'"');
  INSERT INTO meetings_meeting (id, title, date, kind, status, notes, created_at, updated_at) VALUES (3, '"'"'SteerCo'"'"', '"'"'2026-01-10'"'"', '"'"'steering'"'"', '"'"'held'"'"', '"'"'minutes'"'"', '"'"'2026-01-01T00:00:00'"'"', '"'"'2026-01-01T00:00:00'"'"');
  INSERT INTO meetings_attendee (meeting_id, person_id) VALUES (3, 1);
  INSERT INTO meetings_agenda_item (id, meeting_id, position, text, project_id, ask) VALUES (5, 3, 1, '"'"'Budget'"'"', 1, '"'"'Approve'"'"');
`)'
out="$(TTYBRAIN_HOME="$meetings_home" ttybrain meeting show M-3)"; echo "$out"
expect_in "meetings 002: kind" "  kind: project" "$out"
expect_in "meetings 002: attendee" "  attendees: @peter" "$out"
expect_in "meetings 002: agenda" "1. Budget [BOARD] — ask: Approve" "$out"
expect_in "meetings 002: notes" "minutes" "$out"
out="$(meetings_eval '[db.prepare("PRAGMA foreign_key_check").all(), db.prepare("SELECT on_delete FROM pragma_foreign_key_list('"'"'meetings_attendee'"'"')").all()]')"; echo "$out"
expect_in "meetings 002: keys" '[[],[{"on_delete":"NO ACTION"}]]' "$out"
out="$(TTYBRAIN_HOME="$meetings_home" ttybrain meeting subject --all-without "#BOARD")"; echo "$out"
expect_in "meeting subject --all-without" "M-3 about #BOARD (project)" "$out"

# The fixture plugin (tests/fixtures/plugin-contracts), built with `ttybrain plugin build` and loaded on Node: first as a
# folder in TTYBRAIN_PLUGINS, then packed and installed with `ttybrain plugin add <tgz>` through npm (offline: no dependencies).
cp -R tests/fixtures/plugin-contracts "$TTYBRAIN_HOME/src-contracts"
rm -rf "$TTYBRAIN_HOME/src-contracts/dist" "$TTYBRAIN_HOME/src-contracts/node_modules"
out="$(ttybrain plugin build "$TTYBRAIN_HOME/src-contracts")"; echo "$out"
expect_in "plugin build" "built ttybrain-plugin-contracts 0.1.0" "$out"

mkdir -p "$TTYBRAIN_HOME/folder-plugins"
cp -R "$TTYBRAIN_HOME/src-contracts" "$TTYBRAIN_HOME/folder-plugins/contracts"
out="$(TTYBRAIN_PLUGINS="$TTYBRAIN_HOME/folder-plugins" ttybrain contract add CRM "Support")"; echo "$out"
expect_in "contract add (folder)" "C-1 Support" "$out"
out="$(TTYBRAIN_PLUGINS="$TTYBRAIN_HOME/folder-plugins" ttybrain contract list)"; echo "$out"
echo "$out" | grep -Eq "^C-1 +#CRM +Support" || fail "contract list (folder): expected \"C-1 #CRM Support\", got: $out"
out="$(TTYBRAIN_PLUGINS="$TTYBRAIN_HOME/folder-plugins" ttybrain plugin list)"; echo "$out"
echo "$out" | grep -Eq "^contracts +0\.1\.0 +folder +ok" || fail "plugin list: expected \"contracts 0.1.0 folder ok\", got: $out"

tgz="$(cd "$TTYBRAIN_HOME/src-contracts" && npm pack --silent --pack-destination "$TTYBRAIN_HOME")"
out="$(TTYBRAIN_PLUGINS="$TTYBRAIN_HOME/npm-plugins" TTYBRAIN_PLUGIN_INSTALLER=npm ttybrain plugin add "$TTYBRAIN_HOME/$tgz")"; echo "$out"
expect_in "plugin add" "added contracts 0.1.0 (npm)" "$out"
# Same database: the folder copy's C-1 is still there, and the npm copy adds C-2.
out="$(TTYBRAIN_PLUGINS="$TTYBRAIN_HOME/npm-plugins" ttybrain contract add CRM "Renewal")"; echo "$out"
expect_in "contract add (npm)" "C-2 Renewal" "$out"
out="$(TTYBRAIN_PLUGINS="$TTYBRAIN_HOME/npm-plugins" ttybrain contract list)"; echo "$out"
echo "$out" | grep -Eq "^C-2 +#CRM +Renewal" || fail "contract list (npm): expected \"C-2 #CRM Renewal\", got: $out"
out="$(TTYBRAIN_PLUGINS="$TTYBRAIN_HOME/npm-plugins" ttybrain plugin list)"; echo "$out"
echo "$out" | grep -Eq "^contracts +0\.1\.0 +npm +ok" || fail "plugin list: expected \"contracts 0.1.0 npm ok\", got: $out"

# ttybrain plugin new: scaffold, build and load a plugin on Node.
mkdir -p "$TTYBRAIN_HOME/new-src" "$TTYBRAIN_HOME/new-plugins"
out="$(cd "$TTYBRAIN_HOME/new-src" && node "$OLDPWD/dist-node/bin/pm.js" plugin new demo)"; echo "$out"
expect_in "plugin new" "next: ttybrain plugin build demo" "$out"
ttybrain plugin build "$TTYBRAIN_HOME/new-src/demo" >/dev/null
cp -R "$TTYBRAIN_HOME/new-src/demo" "$TTYBRAIN_HOME/new-plugins/demo"
out="$(TTYBRAIN_PLUGINS="$TTYBRAIN_HOME/new-plugins" ttybrain demo list)"; echo "$out"
expect_in "demo list" "no items" "$out"

out="$(TTYBRAIN_PLUGINS="$TTYBRAIN_HOME/npm-plugins" node --experimental-ffi dist-node/kernel/tui/selfcheck.js --expect-screen Contracts 2>&1)" || fail "tui self-check (contracts): $out"; echo "$out"
expect_in "tui (contracts)" "tui ok" "$out"

# The one-time move of ~/.pm to ~/.ttybrain on Node: a HOME with this run's database as .pm/pm.db.
legacy="$TTYBRAIN_HOME/legacy-home"
mkdir -p "$legacy/.pm"
cp "$TTYBRAIN_HOME/ttybrain.db" "$legacy/.pm/pm.db"
err="$(env -u TTYBRAIN_HOME HOME="$legacy" node dist-node/bin/pm.js person list 2>&1 >"$legacy/out")" || fail "move: $err"
cat "$legacy/out"; echo "$err"
[ "$err" = "moved your data from $legacy/.pm to $legacy/.ttybrain" ] || fail "move: expected the notice, got: $err"
expect_in "person list (moved)" "Anna Peeters" "$(cat "$legacy/out")"
[ -L "$legacy/.pm" ] && [ -L "$legacy/.ttybrain/pm.db" ] && [ -f "$legacy/.ttybrain/ttybrain.db" ] || fail "move: links or ttybrain.db missing"

echo "smoke ok"
