// The detail of one person (mockup "3 People", right-hand panel; also the body of the person's Summary tab):
// `Label  value` facts (role, projects and roles, influence and interest, email, phone, archived), then short
// lists of up to `rows` entries each.
// - A stakeholder: open follow-ups (open actions for them, by due date) and interactions (the latest notes).
// - A team member who is not a stakeholder: open actions they own and the latest 1:1 notes.
// - A team member (stakeholder or not): open goals by target date, last.
// Projects data comes only from the projects.* views (none without the projects plugin). It takes no keys.
import { For, Show } from "solid-js"
import { displayWidth, dueLabel, shortDate, theme, toneColor, truncate, useQuery, useRuntime, useToday, type Tone } from "@pm/api/tui"
import { makeStore } from "../logic/records"
import { roleText } from "./people-list"

export const PANEL_MIN_WIDTH = 110
const LABEL_WIDTH = 10

type Cell = { text: string; width: number | "grow"; tone?: Tone }
type Due = { due: string | null; id: number }

// By date, no date last, then by id.
const byDue = (a: Due, b: Due) =>
  a.due === b.due ? a.id - b.id : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1
const pad = (s: string, w: number) => truncate(s, w) + " ".repeat(Math.max(0, w - displayWidth(truncate(s, w))))
const firstLine = (s: string) => s.split("\n")[0] ?? ""

function Fact(props: { name: string; children: string }) {
  return (
    <box flexDirection="row" flexShrink={0}>
      <box width={LABEL_WIDTH} flexShrink={0}>
        <text fg={theme.muted}>{props.name}</text>
      </box>
      <text fg={theme.text}>{props.children}</text>
    </box>
  )
}

function ShortList(props: { title: string; rows: Cell[][] }) {
  return (
    <box flexDirection="column" flexShrink={0} marginTop={1}>
      <text fg={theme.accent}>{props.title}</text>
      <Show when={props.rows.length > 0} fallback={<text fg={theme.muted}>—</text>}>
        <For each={props.rows}>
          {(cells) => (
            <box flexDirection="row" height={1} flexShrink={0} gap={1}>
              <For each={cells}>
                {(c) => (
                  <box width={c.width === "grow" ? undefined : c.width} flexGrow={c.width === "grow" ? 1 : 0} flexShrink={c.width === "grow" ? 1 : 0} overflow="hidden">
                    <text fg={toneColor(c.tone)} wrapMode="none">
                      {c.width === "grow" ? c.text : pad(c.text, c.width)}
                    </text>
                  </box>
                )}
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
            .selectFrom("projects.action as a")
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
        projects: involvements.map((r) => (r.role === null || String(r.role) === "" ? String(r.code) : `${r.code} ${r.role}`)),
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

  const actionRows = (xs: Array<{ ref: string; title: string; due: string | null }>): Cell[][] =>
    xs.map((a) => [
      { text: a.ref, width: 5, tone: "muted" },
      { text: a.title, width: "grow" },
      { text: dueLabel(a.due, today()), width: 6, tone: a.due !== null && a.due < today() ? "red" : "muted" },
    ])
  const noteRows = (xs: Array<{ date: string; text: string }>): Cell[][] =>
    xs.map((n) => [
      { text: shortDate(n.date), width: 6, tone: "muted" },
      { text: firstLine(n.text), width: "grow" },
    ])

  return (
    <Show when={q.data()}>
      {(d: () => NonNullable<ReturnType<typeof q.data>>) => {
        const p = () => d().p
        return (
          <box flexDirection="column" flexGrow={1} overflow="hidden">
            <Fact name="Role">{roleText(p()) || "—"}</Fact>
            <Fact name="Projects">{d().projects.length === 0 ? "—" : d().projects.join(" · ")}</Fact>
            <Show when={p().is_stakeholder}>
              <Fact name="Influence">{`${p().influence ?? "—"} · interest ${p().interest ?? "—"}`}</Fact>
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
                rows={d().goals.map((g) => [
                  { text: g.title, width: "grow" },
                  { text: dueLabel(g.target_date, today()), width: 6, tone: g.target_date !== null && g.target_date < today() ? "red" : "muted" },
                ])}
              />
            </Show>
          </box>
        )
      }}
    </Show>
  )
}
