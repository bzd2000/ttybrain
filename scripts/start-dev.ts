// Runs ttybrain on the dev database (see seed-dev.ts): the TUI with no arguments, else the CLI with the arguments.
// TTYBRAIN_HOME is set for the child process here, so it works in PowerShell too.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const home = join(root, ".ttybrain-dev")
if (!existsSync(join(home, "ttybrain.db"))) {
  process.stderr.write(`no dev database in ${home}\nhint: run bun run seed:dev first\n`)
  process.exit(2)
}
const r = spawnSync(process.execPath, [join(root, "src", "bin", "pm.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, TTYBRAIN_HOME: home },
})
process.exit(r.status ?? 1)
