// The meetings plugin's Attention panel (the 2026-11-20 `home` design): "Upcoming meetings · next 7 days", first
// (priority 5). Columns Date · Meeting · About · To talk · Your act. (upcoming.ts); a series' meeting ends with a muted
// `r` (the note on the bottom border: `r recurring`), a board meeting shows its agenda length (`5 items`), "Your act."
// is amber with `· n late` when one of them is overdue. Under the rows, "Before <meeting> · your actions" for the
// selected meeting. Keys: `t` adds to the meeting's talk-list (the talk-item form, its subject filled in), `x` in the
// action block marks that action done (actions.completeAction).
import { act, addDays, type Cell, type OverviewRow, type TuiContext } from "@ttybrain/api/tui"
import { dayOnly, dueCell, makeUpcoming, MUTED_DASH, type Upcoming } from "./upcoming"

export const PANEL_TITLE = "Upcoming meetings · next 7 days"
export const PANEL_EMPTY = "No meetings in the next 7 days."
const DAYS_AHEAD = 7

// "Your act.": `—`, the count, or the count and how many are late (amber).
export function actCell(actions: Array<{ due: string | null }>, today: string, withLate: boolean): Cell {
  if (actions.length === 0) return MUTED_DASH
  const late = actions.filter((a) => a.due !== null && a.due < today).length
  if (late === 0) return { text: String(actions.length) }
  return { text: withLate ? `${actions.length} · ${late} late` : String(actions.length), tone: "amber" }
}

export function registerPanels(ui: TuiContext): void {
  const upcoming = makeUpcoming(ui)
  // The meetings shown, by ref, for the keys and the detail block.
  let shown = new Map<string, Upcoming>()
  const find = async (ref: string): Promise<Upcoming | undefined> => {
    if (shown.has(ref)) return shown.get(ref)
    const today = ui.clock.today()
    return (await upcoming.between(today, addDays(today, DAYS_AHEAD))).find((m) => m.ref === ref)
  }

  ui.overviewPanel({
    id: "upcoming-meetings",
    title: PANEL_TITLE,
    priority: 5,
    count: false,
    empty: PANEL_EMPTY,
    note: "r recurring",
    header: ["Date", "Meeting", "About", "To talk", "Your act."],
    // Date, Meeting (grows), About (codes whole), To talk, Your act.; the counts give way first on a narrow terminal.
    columns: [10, "grow", { min: 7, max: 16 }, { min: 7, max: 8, drop: 1 }, { min: 9, max: 10, drop: 2 }],
    load: async (): Promise<OverviewRow[]> => {
      const today = ui.clock.today()
      const list = await upcoming.between(today, addDays(today, DAYS_AHEAD))
      shown = new Map(list.map((m) => [m.ref, m]))
      return Promise.all(
        list.map(async (m) => {
          const talk = await upcoming.talk(m)
          const meeting: Cell = m.series === null ? { text: m.title } : { text: `${m.title} r`, parts: [{ text: `${m.title} ` }, { text: "r", tone: "muted" }] }
          const toTalk: Cell = talk === null ? MUTED_DASH : { text: m.kind === "board" ? `${talk} item${talk === 1 ? "" : "s"}` : String(talk) }
          return { ref: m.ref, cells: [{ text: dayOnly(m.date) }, meeting, await upcoming.about(m.subject), toTalk, actCell(await upcoming.mine(m), today, true)] }
        }),
      )
    },
    keys: [
      {
        key: "t",
        label: "to talk",
        run: async (ref, { overlay }) => {
          const m = await find(ref)
          const about = m === undefined || m.subject === null ? undefined : await upcoming.subjectRef(m.subject)
          await overlay.openForm("talk_item", "talk", about === undefined || about === null ? {} : { prefill: { about } })
        },
      },
    ],
    detail: {
      rows: 2,
      columns: [{ min: 5, max: 10 }, "grow", 7],
      keys: [
        {
          key: "x",
          label: "done",
          run: async (ref) => {
            const today = ui.clock.today()
            await act(() => ui.use("actions")!.write.completeAction!({ ref, date: today }), { ok: () => `done ${ref}` })
          },
        },
      ],
      load: async (ref) => {
        const m = await find(ref)
        if (m === undefined) return null
        const mine = await upcoming.mine(m)
        if (mine.length === 0) return null
        const today = ui.clock.today()
        return {
          title: `Before ${m.title} · your actions`,
          rows: mine.map((a) => ({ ref: a.ref, cells: [{ text: a.ref, tone: "muted" }, { text: a.title }, dueCell(a.due, today)] })),
        }
      },
    },
  })
}
