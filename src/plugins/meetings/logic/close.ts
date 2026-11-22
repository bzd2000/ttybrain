// The end of a meeting (design §5.2, §5.3, rulings M4–M6). Closing marks it held, remembers the talk items it keeps
// open for next time (talk.ts shows them on the held meeting's agenda), and stores a 1:1's notes on its person as a
// `one_on_one` note (people.addNote, dated the meeting's day; the notes also stay on the meeting). The result says it
// in one line: `1:1 Anna closed · 2 discussed, 3 kept for next time · 2 actions created · notes saved`. A meeting that
// closes itself (auto_close 1, still planned 3 days after its date) is closed the same way by the `auto-close` upkeep.
// Agreed actions are ordinary actions (actions.addAction) linked to what `agreeLinks` gives: the meeting and its subject.
import { addDays, currentContext, formatRef, NonBlank, Type, type PluginContext } from "@ttybrain/api"
import { GONE, type Store } from "./records"
import { KIND_LABELS, MeetingRecord, type MeetingRecord as Meeting } from "./schema"
import type { Talks } from "./talk"

export const CLOSE_AFTER_DAYS = 3 // a meeting still planned this many days after its date closes itself

export const Closed = Type.Object({
  ...MeetingRecord.properties,
  logged: Type.Object({ actions: Type.Integer(), decisions: Type.Integer() }), // every action and decision linked to it
  discussed: Type.Integer(), // talk items discussed in it
  kept: Type.Integer(), // talk items on its agenda still open at close
  actions: Type.Integer(), // open or done actions linked to it (agreed in it)
  notesSaved: Type.Boolean(), // a 1:1's notes stored on the person
  message: Type.String(),
})
export type Closed = Meeting & { logged: { actions: number; decisions: number }; discussed: number; kept: number; actions: number; notesSaved: boolean; message: string }
export type Closer = ReturnType<typeof makeCloser>

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

// The close line; each part only when it is not zero, "notes saved" only when they were.
export function closeMessage(name: string, c: { discussed: number; kept: number; actions: number; notesSaved: boolean }): string {
  const talk = [c.discussed ? `${c.discussed} discussed` : "", c.kept ? `${c.kept} kept for next time` : ""].filter(Boolean).join(", ")
  const parts = [talk, c.actions ? `${plural(c.actions, "action")} created` : "", c.notesSaved ? "notes saved" : ""].filter(Boolean)
  return [`${name} closed`, ...parts].join(" · ")
}

export function makeCloser(ctx: PluginContext, store: Store, talks: Talks) {
  const db = ctx.data

  const subjectOf = async (m: Meeting) => {
    const s = await db.selectFrom("meeting").select(["subject_type", "subject_id"]).where("id", "=", m.id).executeTakeFirstOrThrow()
    return s.subject_type === null ? null : { type: String(s.subject_type), id: Number(s.subject_id) }
  }
  // The 1:1's person, through the people view: undefined when there is none (or it is gone).
  async function personOf(m: Meeting): Promise<{ handle: string; name: string; archived: boolean } | undefined> {
    const s = await subjectOf(m)
    if (m.kind !== "one_on_one" || s?.type !== "person") return undefined
    const p = await store.unlessUnavailable(undefined as Record<string, unknown> | undefined, () =>
      db.selectFrom("people.person").select(["handle", "name", "archived"]).where("id", "=", s.id).executeTakeFirst(),
    )
    return p && { handle: String(p.handle), name: String(p.name), archived: Boolean(Number(p.archived)) }
  }

  // Marks a planned meeting held, with everything that goes with it (the caller checks it may be closed).
  async function close(m: Meeting): Promise<Closed> {
    const kept = (await talks.agenda(m.ref)).items.filter((t) => t.status === "open")
    const discussed = (await talks.discussedIn(m.id)).length
    await talks.keep(m.id, kept)
    await db.updateTable("meeting").set({ status: "held", updated_at: currentContext().now }).where("id", "=", m.id).execute()

    const person = await personOf(m)
    const notesSaved = person !== undefined && !person.archived && m.notes.trim() !== ""
    if (notesSaved) await ctx.use("people")!.write.addNote!({ person: `@${person.handle}`, kind: "one_on_one", text: m.notes, date: m.date })

    const linked = await db
      .selectFrom("actions.link as l")
      .innerJoin("actions.action as a", "a.id", "l.action_id")
      .select("a.status")
      .where("l.record_type", "=", "meeting")
      .where("l.record_id", "=", m.id)
      .execute()
    const decisions = await db.selectFrom("projects.decision").select("id").where("meeting_id", "=", m.id).execute()
    const actions = linked.filter((a) => a.status !== "cancelled").length
    const name = person ? `${KIND_LABELS.one_on_one} ${person.name.split(/\s+/)[0]}` : m.title
    const counts = { discussed, kept: kept.length, actions, notesSaved }
    return { ...(await store.meeting(m.ref)), logged: { actions: linked.length, decisions: decisions.length }, ...counts, message: closeMessage(name, counts) }
  }

  // The meetings that close themselves today: auto_close 1, still planned, dated 3 days ago or earlier.
  async function overdue(): Promise<Meeting[]> {
    const rows = await db
      .selectFrom("meeting")
      .select("id")
      .where("auto_close", "=", 1)
      .where("status", "=", "planned")
      .where("date", "<=", addDays(currentContext().today, -CLOSE_AFTER_DAYS))
      .orderBy("date")
      .orderBy("id")
      .execute()
    const out: Meeting[] = []
    for (const r of rows) out.push(await store.meeting(formatRef("M-", Number(r.id))))
    return out
  }

  return { close, overdue }
}

export function registerClose(ctx: PluginContext, store: Store, closer: Closer): void {
  ctx.expose({
    read: {
      // What an action agreed in a meeting links to: the meeting, then its subject (when it has one that resolves).
      agreeLinks: {
        input: Type.Object({ meeting: NonBlank() }),
        output: Type.Array(Type.String()),
        toolDescription: "The records an action agreed in a meeting links to: the meeting and its subject (person or project).",
        run: async (i: { meeting: string }) => {
          const m = await store.meeting(i.meeting)
          const about = m.about
          return about === null || about === GONE || about.includes(":") ? [m.ref] : [m.ref, about]
        },
      },
    },
  })

  // On every write-capable start (M1): each meeting left open 3 days after its date closes itself, as `closeMeeting`
  // would close it (M6 included), all in this upkeep's one transaction.
  ctx.upkeep("auto-close", async () => {
    for (const m of await closer.overdue()) await closer.close(m)
  })
}
