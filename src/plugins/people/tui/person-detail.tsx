// The detail of one person (mockup "3 People", right-hand panel; also the body of the person's Summary tab):
// `Label  value` facts (role, projects and roles, influence and interest, email, phone, archived), then short
// lists of up to `rows` entries each.
// - A stakeholder: open follow-ups (open actions for them, by due date) and interactions (the latest notes).
// - A team member who is not a stakeholder: open actions they own and the latest 1:1 notes.
// - A team member (stakeholder or not): open goals by target date, last.
// Projects data comes only from the projects.* views (none without the projects plugin). It takes no keys.
import { createSignal, For, Show } from "solid-js"
import { displayWidth, dueLabel, fitWidth, shortDate, theme, toneColor, truncate, useQuery, useRuntime, useToday, type Tone } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"
import { roleText } from "./people-list"

export const PANEL_MIN_WIDTH = 110
const LABEL_WIDTH = 10
const GAP = 2

type Cell = { text: string; width: number | "grow"; tone?: Tone }
type Part = { text: string; tone?: Tone }
type Due = { due: string | null; id: number }

// By date, no date last, then by id.
const byDue = (a: Due, b: Due) =>
  a.due === b.due ? a.id - b.id : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1
const pad = (s: string, w: number) => truncate(s, w) + " ".repeat(Math.max(0, w - displayWidth(truncate(s, w))))
const firstLine = (s: string) => s.split("\n")[0] ?? ""

// `Label     value` (the design's 10-cell label and 2-cell gap): the label muted; the value's parts side by side
// one space apart, wrapping as whole parts.
function Fact(props: { name: string; children?: string; parts?: Part[] }) {
  return (
    <box flexDirection="row" flexShrink={0} columnGap={GAP}>
      <box width={LABEL_WIDTH} flexShrink={0}>
        <text fg={theme.muted}>{props.name}</text>
      </box>
      <box flexDirection="row" flexWrap="wrap" columnGap={1} flexGrow={1} flexShrink={1}>
        <For each={props.parts ?? [{ text: props.children ?? "" }]}>{(p) => <text fg={toneColor(p.tone)}>{p.text}</text>}</For>
      </box>
    </box>
  )
}

// The cell that takes the rest of the row, its text cut with `…` to the width it measures.
function GrowCell(props: { cell: Cell }) {
  const [width, setWidth] = createSignal(0)
  return (
    <box
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      minWidth={0}
      overflow="hidden"
      onSizeChange={function () {
        setWidth(this.width)
      }}
    >
      <text fg={toneColor(props.cell.tone)} wrapMode="none">
        {width() === 0 ? props.cell.text : truncate(props.cell.text, width())}
      </text>
    </box>
  )
}

// A muted sub-heading over rows of fixed-width cells, 2 cells apart (the design's column gap).
function ShortList(props: { title: string; rows: Cell[][] }) {
  return (
    <box flexDirection="column" flexShrink={0} marginTop={1}>
      <text fg={theme.muted}>{props.title}</text>
      <Show when={props.rows.length > 0} fallback={<text fg={theme.muted}>—</text>}>
        <For each={props.rows}>
          {(cells) => (
            <box flexDirection="row" height={1} flexShrink={0} gap={GAP}>
              <For each={cells}>
                {(c) =>
                  c.width === "grow" ? (
                    <GrowCell cell={c} />
                  ) : (
                    <box width={c.width} flexShrink={0} overflow="hidden">
                      <text fg={toneColor(c.tone)} wrapMode="none">
                        {pad(c.text, c.width)}
                      </text>
                    </box>
                  )
                }
              </For>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

export function PersonDetail(props: { recordRef: string; rows?: number }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const today = useToday()
  const rows = () => props.rows ?? 3

  const q = useQuery(
    async () => {
      const p = await store.person(props.recordRef)
      const limit = rows()
      const involvements = await store.unlessUnavailable([] as Array<{ code: unknown; role: unknown }>, () =>
        rt.data
          .selectFrom("projects.involvement as i")
          .innerJoin("projects.project as pr", "pr.id", "i.project_id")
          .select(["pr.code", "i.role"])
          .where("i.person_id", "=", p.id)
          .orderBy("pr.code")
          .execute(),
      )
      // Open actions for the person (a stakeholder's follow-ups) or owned by them (a team member's).
      const actions = (column: "for_person_id" | "owner_id") =>
        store.unlessUnavailable([] as Array<{ id: unknown; title: unknown; due_date: unknown }>, () =>
          rt.data
            .selectFrom("actions.action as a")
            .select(["a.id", "a.title", "a.due_date"])
            .where(`a.${column}`, "=", p.id)
            .where("a.status", "=", "open")
            .execute(),
        )
      const toAction = async (r: { id: unknown; title: unknown; due_date: unknown }) => ({
        id: Number(r.id),
        ref: await rt.records.refOf("action", Number(r.id)),
        title: String(r.title),
        due: r.due_date === null ? null : String(r.due_date),
      })
      const openActions = async (column: "for_person_id" | "owner_id") =>
        Promise.all((await actions(column)).map(toAction)).then((xs) => xs.sort(byDue).slice(0, limit))
      const notes = async (oneOnOne: boolean) => {
        let query = store.noteQuery().where("n.person_id", "=", p.id)
        if (oneOnOne) query = query.where("n.kind", "=", "one_on_one")
        return (await query.orderBy("n.date", "desc").orderBy("n.id", "desc").limit(limit).execute()).map(store.toNote)
      }
      const stakeholder = p.is_stakeholder
      const member = p.is_team && !p.is_stakeholder
      return {
        p,
        projects: involvements.map((r) => ({ code: String(r.code), role: r.role === null ? "" : String(r.role) })),
        followUps: stakeholder ? await openActions("for_person_id") : [],
        interactions: stakeholder ? await notes(false) : [],
        owned: member ? await openActions("owner_id") : [],
        oneOnOnes: member ? await notes(true) : [],
        goals: p.is_team
          ? (await store.goalQuery().where("g.person_id", "=", p.id).where("g.status", "=", "open").execute())
              .map(store.toGoal)
              .sort((a, b) => byDue({ due: a.target_date, id: a.id }, { due: b.target_date, id: b.id }))
              .slice(0, limit)
          : [],
      }
    },
    { key: () => [props.recordRef, rows()] },
  )

  // The design's due column is 5 cells; it widens to 6 when a date label (`17 Nov`) needs it.
  const dueWidth = (dues: Array<string | null>) => fitWidth(dues.map((d) => dueLabel(d, today())), 5, 6)
  const dueCell = (due: string | null, width: number): Cell => ({
    text: dueLabel(due, today()),
    width,
    tone: due !== null && due < today() ? "red" : "muted",
  })
  const actionRows = (xs: Array<{ ref: string; title: string; due: string | null }>): Cell[][] => {
    const w = dueWidth(xs.map((a) => a.due))
    return xs.map((a) => [{ text: a.ref, width: 5, tone: "muted" }, { text: a.title, width: "grow" }, dueCell(a.due, w)])
  }
  const noteRows = (xs: Array<{ date: string; text: string }>): Cell[][] =>
    xs.map((n) => [
      { text: shortDate(n.date), width: 7, tone: "muted" },
      { text: firstLine(n.text), width: "grow" },
    ])
  // `CRM sponsor · ERP steerco`: codes cyan.
  const projectParts = (xs: Array<{ code: string; role: string }>): Part[] =>
    xs.length === 0
      ? [{ text: "—" }]
      : xs.flatMap((x, i) => [
          ...(i > 0 ? [{ text: "·" }] : []),
          { text: x.code, tone: "cyan" as const },
          ...(x.role === "" ? [] : [{ text: x.role }]),
        ])

  return (
    <Show when={q.data()}>
      {(d: () => NonNullable<ReturnType<typeof q.data>>) => {
        const p = () => d().p
        return (
          <box flexDirection="column" flexGrow={1} overflow="hidden">
            <Fact name="Role">{roleText(p()) || "—"}</Fact>
            <Fact name="Projects" parts={projectParts(d().projects)} />
            <Show when={p().is_stakeholder}>
              <Fact name="Influence" parts={[{ text: p().influence ?? "—" }, { text: "· interest", tone: "muted" }, { text: p().interest ?? "—" }]} />
            </Show>
            <Show when={p().email}>{(v: () => string) => <Fact name="Email">{v()}</Fact>}</Show>
            <Show when={p().phone}>{(v: () => string) => <Fact name="Phone">{v()}</Fact>}</Show>
            <Show when={p().archived}>
              <Fact name="Archived">yes</Fact>
            </Show>
            <Show when={p().is_stakeholder}>
              <ShortList title="Open follow-ups" rows={actionRows(d().followUps)} />
              <ShortList title="Interactions" rows={noteRows(d().interactions)} />
            </Show>
            <Show when={p().is_team && !p().is_stakeholder}>
              <ShortList title="Open actions" rows={actionRows(d().owned)} />
              <ShortList title="1:1 notes" rows={noteRows(d().oneOnOnes)} />
            </Show>
            <Show when={p().is_team}>
              <ShortList
                title="Goals"
                rows={d().goals.map((g) => [{ text: g.title, width: "grow" }, dueCell(g.target_date, dueWidth(d().goals.map((x) => x.target_date)))])}
              />
            </Show>
          </box>
        )
      }}
    </Show>
  )
}
