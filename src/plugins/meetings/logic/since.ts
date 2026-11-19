// The "since" date for a project in a meeting (design §8): the meeting's own `since_date`, else the date of the
// most recent earlier held meeting with an agenda item for that project, else the meeting date minus 30 days.
import { addDays, formatRef } from "@ttybrain/api"
import type { Store } from "./records"
import type { MeetingRecord } from "./schema"

export type SinceResult = {
  since: string
  source: "meeting" | "previous" | "default"
  // The earlier held meeting that covered the project, whichever rule wins.
  previous: { ref: string; title: string; date: string } | null
}

const DEFAULT_DAYS = 30

// "Earlier" is a date before the meeting's, or the same date with a lower id.
const earlier = (m: { id: number; date: string }, than: Pick<MeetingRecord, "id" | "date">) => m.date < than.date || (m.date === than.date && m.id < than.id)

export async function sinceFor(store: Store, meeting: Pick<MeetingRecord, "id" | "date" | "since_date">, projectId: number): Promise<SinceResult> {
  const found = (await store.heldMeetingsWith(projectId)).find((m) => earlier(m, meeting))
  const previous = found ? { ref: formatRef("M-", found.id), title: found.title, date: found.date } : null
  if (meeting.since_date !== null) return { since: meeting.since_date, source: "meeting", previous }
  if (previous) return { since: previous.date, source: "previous", previous }
  return { since: addDays(meeting.date, -DEFAULT_DAYS), source: "default", previous: null }
}
