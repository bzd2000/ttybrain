// Quick capture to a talk-list (the 2026-11-20 `capture` design, ruling M9): a capture that starts with `talk ` and
// tags exactly one person or one project that resolve (a person's item may tag one project too) goes onto that
// talk-list, not into the inbox. The lines under the input say where it lands:
//   → Anna Peeters' talk-list · next 1:1 Mon 23 Nov
//     linked to #CRM, so it also shows at CRM steering until discussed
//     without "talk" it goes to the inbox as before
// Text that starts with `talk ` but is not one (no tag, two people, a tag that does not resolve) still goes to the
// inbox, and the lines say why (Review Focus 5). Anything else is not this route's (null: no lines, as before).
// The item's text is the capture without `talk` and its tags, its first letter capitalised.
import { act, dayDate, type CapturePreview, type CaptureRouteDef, type CellPart, type TuiContext } from "@ttybrain/api/tui"
import { makeSubjects, meetingName } from "./subject"

const START = /^talk\s/i
const TAG = /(^|[\s([])([@#][A-Za-z0-9][A-Za-z0-9-]*)/g
const HINT = 'a talk item needs one person or project tag: talk @anna …'
const INBOX_TOO = 'without "talk" it goes to the inbox as before'

export type TalkCapture = { about: string; project?: string; text: string }
type Parsed = { ok: true; capture: TalkCapture; name: string; projectCode?: string } | { ok: false; why: string }

// The tags of a text, in order (`@anna`, `#CRM`).
export const tagsOf = (text: string) => [...text.matchAll(TAG)].map((m) => m[2]!)

// The item's text: without `talk`, the tags it was routed by and extra spaces; its first letter capitalised.
export function talkText(text: string, tags: string[]): string {
  let rest = text.replace(START, " ")
  for (const t of tags) rest = rest.replace(new RegExp(`(^|[\\s([])${t.replace(/[-]/g, "\\-")}(?![A-Za-z0-9-])`), "$1")
  rest = rest.replace(/\s+/g, " ").trim()
  return rest.slice(0, 1).toUpperCase() + rest.slice(1)
}

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`)

export function registerTalkCapture(ui: TuiContext): void {
  const subjects = makeSubjects(ui)

  // What the text is: a talk item (its subject resolved), or why it is not one.
  async function parse(text: string): Promise<Parsed | null> {
    if (!START.test(text)) return null
    const tags = tagsOf(text)
    const people = tags.filter((t) => t.startsWith("@"))
    const projects = tags.filter((t) => t.startsWith("#"))
    if (tags.length === 0) return { ok: false, why: "no person or project tagged" }
    if (people.length > 1) return { ok: false, why: `${people.length} people tagged` }
    if (projects.length > 1) return { ok: false, why: `${projects.length} projects tagged` }
    // Each tag as its record's own ref (`@anna`, `#CRM`), or why it is not one.
    const refs: string[] = []
    for (const t of tags) {
      const found = await ui.records.resolve(t).catch(() => null)
      const type = t.startsWith("@") ? "person" : "project"
      if (!found || found.type !== type) return { ok: false, why: `${t} is not a ${type}` }
      refs.push(await ui.records.refOf(found.type, found.id))
    }
    const body = talkText(text, tags)
    if (body === "") return { ok: false, why: "nothing to talk about yet" }
    const about = refs.find((r) => r.startsWith("@")) ?? refs[0]!
    const project = people.length === 1 ? refs.find((r) => r.startsWith("#")) : undefined
    const name = about.startsWith("@") ? await ui.records.label(about) : about.slice(1)
    return { ok: true, capture: { about, text: body, ...(project ? { project } : {}) }, name, ...(project ? { projectCode: project } : {}) }
  }

  async function preview(text: string): Promise<CapturePreview | null> {
    const p = await parse(text)
    if (p === null) return null
    if (!p.ok)
      return {
        declined: true,
        lines: [
          [{ text: "→", tone: "green" }, { text: " goes to the inbox" }, { text: ` · ${p.why}`, tone: "muted" }],
          [{ text: `  ${HINT}`, tone: "muted" }],
        ],
      }
    const next = await subjects.next(await subjects.store.subject(p.capture.about))
    const lines: CellPart[][] = [
      [
        { text: "→", tone: "green" },
        { text: ` ${possessive(p.name)} talk-list` },
        { text: next === null ? " · no meeting planned" : ` · next ${meetingName(next)} ${dayDate(next.date)}`, tone: "muted" },
      ],
    ]
    if (p.projectCode !== undefined) {
      const at = await subjects.next(await subjects.store.subject(p.projectCode))
      lines.push([
        { text: "  linked to ", tone: "muted" },
        { text: p.projectCode, tone: "cyan" },
        { text: `, so it also shows at ${at === null ? `${p.projectCode.slice(1)}'s next meeting` : at.title} until discussed`, tone: "muted" },
      ])
    }
    lines.push([{ text: `  ${INBOX_TOO}`, tone: "muted" }])
    return { lines }
  }

  async function submit(text: string): Promise<string> {
    const p = await parse(text)
    if (p === null || !p.ok) throw new Error(p === null ? "not a talk item" : p.why)
    const r = await act(() => ui.self().write.addTalk!(p.capture) as Promise<{ ref: string }>)
    if (!r.ok) throw r.error
    return `added ${r.value.ref} to ${possessive(p.name)} talk-list`
  }

  const route: CaptureRouteDef = { id: "talk", preview, submit }
  ui.captureRoute(route)
}
