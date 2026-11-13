// How the CLI prints: text tables for plugins' list output, JSON on success, and errors in one shape.
// Under --json everything (errors included) goes to stdout, so an agent reads a single stream.
import { PmError, ValidationError } from "../errors"

export type CliIo = { out(s: string): void; err(s: string): void; stdin(): Promise<string> }
export type CommandResult = { json: unknown; text: string }

const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\r?\n/g, " "))

// Left-aligned columns separated by two spaces, header first, trailing spaces trimmed. No trailing newline.
export function formatTable(columns: string[], rows: Array<Record<string, unknown>>): string {
  const table = [columns, ...rows.map((r) => columns.map((c) => cell(r[c])))]
  const widths = columns.map((_, i) => Math.max(...table.map((t) => t[i]!.length)))
  return table.map((t) => t.map((v, i) => v.padEnd(widths[i]!)).join("  ").trimEnd()).join("\n")
}

export function printResult(result: CommandResult, json: boolean, io: CliIo): void {
  if (json) io.out(JSON.stringify(result.json ?? null, null, 2) + "\n")
  else if (result.text !== "") io.out(result.text.endsWith("\n") ? result.text : result.text + "\n")
}

// `{"error":{"code","message","hint"}}`, plus `field` for a ValidationError that names one. Anything that is
// not a PmError (a SQLite error, a bug) is `internal`, exit 1, with its message and without a stack.
export function errorJson(e: unknown): { error: { code: string; message: string; hint: string | null; field?: string } } {
  const pm = e instanceof PmError ? e : undefined
  const field = e instanceof ValidationError ? e.field : undefined
  return {
    error: {
      code: pm?.code ?? "internal",
      message: e instanceof Error ? e.message : String(e),
      hint: pm?.hint ?? null,
      ...(field !== undefined ? { field } : {}),
    },
  }
}

export function exitCodeOf(e: unknown): 1 | 2 | 3 {
  return e instanceof PmError && e.exitCode !== 0 ? e.exitCode : 1
}

// Prints the error (JSON on stdout, or `error:`/`hint:` lines on stderr) and returns the exit code.
export function printError(e: unknown, json: boolean, io: CliIo): number {
  const { error } = errorJson(e)
  if (json) io.out(JSON.stringify({ error }) + "\n")
  else io.err(`error: ${error.message}\n${error.hint ? `hint: ${error.hint}\n` : ""}`)
  return exitCodeOf(e)
}
