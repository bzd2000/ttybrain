// The CI test groups: every test file bun would run belongs to exactly one of them, so the three parallel CI jobs
// together run the whole suite and a new test file cannot be skipped.
//   logic   *.test.ts anywhere (kernel, plugin logic, CLI, tests/bin.test.ts, scripts/)
//   tui     *.test.tsx under src/ (the TUI component tests)
//   design  *.test.tsx under tests/ (tests/design/ and the other TUI tests there)
// `bun scripts/test-groups.ts check` lists the groups' sizes and fails when a file is in no group or in two;
// `bun scripts/test-groups.ts <group> [bun test options…]` runs `bun test` on that group's files (after the same
// check). `bun run test` still runs everything.
import { readdirSync } from "node:fs"
import { join, relative } from "node:path"

const root = join(import.meta.dir, "..")

const GROUPS: Record<string, (file: string) => boolean> = {
  logic: (f) => f.endsWith(".test.ts"),
  tui: (f) => f.endsWith(".test.tsx") && f.startsWith("src/"),
  design: (f) => f.endsWith(".test.tsx") && f.startsWith("tests/"),
}

// The files bun test discovers: *.test, *_test and *.spec files with a JS/TS extension, outside node_modules,
// hidden folders and the Node build.
const TEST_FILE = /(\.test|_test|\.spec|_spec)\.(c|m)?[jt]sx?$/
const SKIP = new Set(["node_modules", "dist-node"])

function testFiles(dir = root): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue
    const path = join(dir, e.name)
    if (e.isDirectory()) out.push(...testFiles(path))
    else if (TEST_FILE.test(e.name)) out.push(relative(root, path).split("\\").join("/"))
  }
  return out.sort()
}

function grouped(): Record<string, string[]> {
  const groups: Record<string, string[]> = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, []]))
  const wrong: string[] = []
  for (const file of testFiles()) {
    const in_ = Object.keys(GROUPS).filter((g) => GROUPS[g]!(file))
    if (in_.length !== 1) wrong.push(`${file}: in ${in_.length === 0 ? "no group" : in_.join(" and ")}`)
    else groups[in_[0]!]!.push(file)
  }
  if (wrong.length > 0) {
    console.error(`test-groups: every test file must be in exactly one group (scripts/test-groups.ts):\n  ${wrong.join("\n  ")}`)
    process.exit(1)
  }
  return groups
}

const [what, ...args] = process.argv.slice(2)
const groups = grouped()
if (what === "check") {
  const total = Object.values(groups).reduce((n, files) => n + files.length, 0)
  console.log(`test-groups ok: ${Object.entries(groups).map(([g, files]) => `${g} ${files.length}`).join(", ")} (${total} files)`)
} else if (what !== undefined && what in groups) {
  // `./` makes each one a path to bun test, not a name filter.
  const proc = Bun.spawn([process.execPath, "test", ...args, ...groups[what]!.map((f) => `./${f}`)], { cwd: root, stdio: ["inherit", "inherit", "inherit"] })
  process.exit(await proc.exited)
} else {
  console.error(`usage: bun scripts/test-groups.ts check | ${Object.keys(GROUPS).join(" | ")} [bun test options…]`)
  process.exit(2)
}
