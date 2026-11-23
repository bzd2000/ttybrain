// Seeds a local dev database with the screen designs' example data, to open the real TUI beside the designs:
//   bun scripts/seed-dev.ts [dir] [--set 11-20|11-13] [--fresh]      (default dir: .ttybrain-dev in the repo root)
// Sets: 11-20 (default) = the meetings designs (tests/design.ts seedMeetings, clock 2026-11-20); 11-13 = the first
// screen designs (seedDesign, clock 2026-11-12). The two clash (same people, projects and ids), so one set per database.
// Safety: refuses the real data folders (~/.ttybrain, ~/.pm) and a folder that already holds a database; --fresh
// deletes only that folder's database files first. Not for tests' kernels: this boots like src/bin/pm.ts does.
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { fixedClock } from "../src/kernel/clock"
import { bootKernel } from "../src/kernel/host"
import { resolvePaths } from "../src/kernel/paths"
import { seedDesign, seedMeetings } from "../tests/design"

export const defaultDevDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".ttybrain-dev")

const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

// The files of a database in `dir`: ttybrain.db, its -wal/-shm and the .bak-v<N> copies.
const dbFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^ttybrain\.db(-wal|-shm|\.bak-v\d+)?$/.test(f)) : [])

export async function seedDev(argv: string[], env: Record<string, string | undefined>, io: { out(s: string): void; err(s: string): void }): Promise<number> {
  let dir: string | undefined
  let set = "11-20"
  let fresh = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--fresh") fresh = true
    else if (a === "--set") set = argv[++i] ?? ""
    else if (a.startsWith("--")) {
      io.err(`unknown option ${a}\n`)
      return 2
    } else dir = a
  }
  if (set !== "11-20" && set !== "11-13") {
    io.err(`--set takes 11-20 or 11-13, got "${set}"\n`)
    return 2
  }
  const target = resolve(dir ?? defaultDevDir)
  const homes = [env.HOME, env.USERPROFILE, homedir()].filter((h): h is string => !!h).flatMap((h) => [join(h, ".ttybrain"), join(h, ".pm")])
  if (homes.some((h) => real(h) === real(target))) {
    io.err(`refusing to seed ${target}: it is your real data folder.\nhint: use a scratch folder, e.g. bun scripts/seed-dev.ts .ttybrain-dev\n`)
    return 2
  }
  const existing = dbFiles(target)
  if (existing.length > 0 && !fresh) {
    io.err(`refusing to seed ${target}: it already holds a database.\nhint: add --fresh to delete this folder's database files first\n`)
    return 2
  }
  for (const f of existing) rmSync(join(target, f), { force: true })
  mkdirSync(target, { recursive: true })

  const kernel = await bootKernel({
    env: { TTYBRAIN_HOME: target },
    discover: true,
    clock: fixedClock(set === "11-20" ? "2026-11-20" : "2026-11-12"),
  })
  try {
    await (set === "11-20" ? seedMeetings(kernel) : seedDesign(kernel))
  } finally {
    await kernel.shutdown()
  }
  const db = resolvePaths({ TTYBRAIN_HOME: target }).db
  io.out(`seeded the ${set} designs' data into ${db}\nopen it with: bun run start:dev   (CLI: bun run pm:dev project list)\n`)
  return 0
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  process.exit(await seedDev(process.argv.slice(2), process.env, { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }))
}
