// The project detail's Summary tab (spec §9, mockup "Project detail"): the headline facts on the left (health with
// its comment, status, dates, effort, sponsor, team, description) and four short lists on the right (milestones,
// deliverables, open risks and issues, recent decisions), three rows each. `h` opens the health form, `e` the
// project form. Sponsor and team come from the involvements and the people.person view; the extra fields other
// plugins registered for projects (<RecordFields>) follow the team.
import { For, Show } from "solid-js"
import {
  shortDate,
  theme,
  toneColor,
  truncate,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  useToday,
  printable,
  RecordFields,
  displayWidth,
  type Hint,
  type Tone,
} from "@ttybrain/api/tui"
import { makeItems } from "../logic/items"
import { makeStore } from "../logic/records"

const ROWS = 3
const HINTS: Hint[] = [
  { key: "h", label: "health" },
  { key: "e", label: "edit" },
]
const SEVERITY: Record<string, number> = { high: 0, medium: 1, low: 2 }

// `1 Sep 2026`
export const fullDate = (iso: string) => `${shortDate(iso)} ${iso.slice(0, 4)}`
const label = (s: string) => s.replace(/_/g, " ")
const firstName = (name: string) => name.split(/\s+/)[0] ?? name
const pad = (s: string, w: number) => truncate(s, w) + " ".repeat(Math.max(0, w - displayWidth(truncate(s, w))))
const byDue = (a: { due_date: string | null }, b: { due_date: string | null }) =>
  a.due_date === b.due_date ? 0 : a.due_date === null ? 1 : b.due_date === null ? -1 : a.due_date < b.due_date ? -1 : 1

type Cell = { text: string; width: number | "grow"; tone?: Tone }
type Row = Cell[]

function Fact(props: { name: string; children: string; tone?: Tone }) {
  return (
    <box flexDirection="row" flexShrink={0}>
      <box width={9} flexShrink={0}>
        <text fg={theme.muted}>{props.name}</text>
      </box>
      <text fg={toneColor(props.tone)}>{props.children}</text>
    </box>
  )
}

function ShortList(props: { title: string; rows: Row[] }) {
  return (
    <box flexDirection="column" flexShrink={0} marginBottom={1}>
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

export function ProjectSummary(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const items = makeItems(rt, store)
  const overlay = useOverlay()
  const nav = useNav()
  const keys = useKeys()
  const today = useToday()
  keys.hints(HINTS)

  // A code edit changes the ref: the record view moves to the new one (as a person's handle edit does), and when
  // it was opened from the Projects screen, that screen selects the renamed project after Esc.
  const edit = async (ref: string) => {
    const saved = await overlay.openForm("project", "project", { recordRef: ref })
    if (saved === undefined || saved === ref) return
    const top = nav.route()
    if (top.kind !== "record" || top.ref !== ref) return
    nav.back()
    const below = nav.route()
    if (below.kind === "screen" && below.screen === "projects") nav.replaceParams({ ...below.params, selected: saved })
    await nav.open(saved)
  }

  const q = useQuery(
    async () => {
      const p = await store.project(props.recordRef)
      const people = await rt.data
        .selectFrom("involvement as i")
        .innerJoin("people.person as pp", "pp.id", "i.person_id")
        .select(["pp.name", "pp.is_team", "i.role"])
        .where("i.project_id", "=", p.id)
        .orderBy("pp.name")
        .execute()
      const sponsors = people.filter((r) => String(r.role).trim().toLowerCase() === "sponsor").map((r) => String(r.name))
      const team: string[] = []
      for (const r of people) if (Number(r.is_team) === 1 && !team.includes(firstName(String(r.name)))) team.push(firstName(String(r.name)))
      const milestones = (await items.milestoneQuery().where("m.project_id", "=", p.id).orderBy("m.due_date").orderBy("m.id").execute()).map(items.toMilestone)
      const deliverables = (await items.deliverableQuery().where("d.project_id", "=", p.id).where("d.status", "!=", "delivered").orderBy("d.id").execute())
        .map(items.toDeliverable)
        .sort(byDue)
      const risks = (await items.riskQuery().where("r.project_id", "=", p.id).where("r.status", "=", "open").orderBy("r.id").execute()).map(items.toRisk)
      const decisions = (await items.decisionQuery().where("d.project_id", "=", p.id).orderBy("d.date", "desc").orderBy("d.id", "desc").limit(ROWS).execute()).map(items.toDecision)
      risks.sort((a, b) => (SEVERITY[a.severity] ?? 3) - (SEVERITY[b.severity] ?? 3))
      return { p, sponsors, team, milestones, deliverables, risks, decisions }
    },
    { key: () => props.recordRef },
  )

  // Three milestones, starting at the last done one so the next ones show (`✓ … ○ … ○ …`).
  const milestoneRows = (): Row[] => {
    const all = q.data()?.milestones ?? []
    const next = all.findIndex((m) => m.done_date === null)
    const start = next < 0 ? Math.max(0, all.length - ROWS) : Math.max(0, next - 1)
    return all.slice(start, start + ROWS).map((m) => [
      { text: m.done_date === null ? "○" : "✓", width: 1, tone: m.done_date === null ? undefined : "green" },
      { text: m.title, width: "grow" },
      { text: shortDate(m.due_date), width: 6, tone: m.done_date === null && m.due_date < today() ? "red" : "muted" },
    ])
  }

  useScreenKeys((key) => {
    const ch = printable(key)
    if (ch === "h") void overlay.openForm("project", "health", { recordRef: props.recordRef })
    else if (ch === "e") void edit(props.recordRef)
    else return
    key.preventDefault()
  })

  return (
    <Show when={q.data()}>
      {(d: () => NonNullable<ReturnType<typeof q.data>>) => {
        const p = () => d().p
        return (
          <box flexDirection="row" flexGrow={1} gap={2} paddingTop={1} overflow="hidden">
            <box flexDirection="column" flexGrow={1} flexBasis={0} flexShrink={1}>
              <Fact name="Health" tone={p().health ?? "muted"}>
                {p().health === null ? "not set" : `● ${p().health} · ${shortDate(p().health_date ?? today())}`}
              </Fact>
              <Show when={p().health_comment}>{(c: () => string) => <text fg={theme.text}>{c()}</text>}</Show>
              <text> </text>
              <Fact name="Status">{label(p().status)}</Fact>
              <Fact name="Dates">
                {p().start_date === null && p().end_date === null
                  ? "—"
                  : `${p().start_date === null ? "?" : fullDate(p().start_date!)} → ${p().end_date === null ? "?" : fullDate(p().end_date!)}`}
              </Fact>
              <Fact name="Effort">
                {p().effort_estimate_days === null ? "—" : `${p().effort_estimate_days} person-days${p().effort_note ? ` (${p().effort_note})` : ""}`}
              </Fact>
              <Fact name="Sponsor">{d().sponsors.length === 0 ? "—" : d().sponsors.join(", ")}</Fact>
              <Fact name="Team">{d().team.length === 0 ? "—" : d().team.join(", ")}</Fact>
              <RecordFields recordType="project" recordRef={props.recordRef} />
              <Show when={p().description}>
                {(t: () => string) => (
                  <>
                    <text> </text>
                    <text fg={theme.text}>{t()}</text>
                  </>
                )}
              </Show>
            </box>
            <box flexDirection="column" flexGrow={1} flexBasis={0} flexShrink={1}>
              <ShortList title="Milestones" rows={milestoneRows()} />
              <ShortList
                title="Deliverables"
                rows={d().deliverables.slice(0, ROWS).map((x) => [
                  { text: x.title, width: "grow" },
                  { text: x.owner === null ? "" : x.owner.replace(/^@/, ""), width: 7, tone: "muted" },
                  { text: label(x.status), width: 11, tone: "muted" },
                  { text: x.due_date === null ? "—" : shortDate(x.due_date), width: 6, tone: x.due_date !== null && x.due_date < today() ? "red" : "muted" },
                ])}
              />
              <ShortList
                title="Open risks & issues"
                rows={d().risks.slice(0, ROWS).map((x) => [
                  { text: x.ref, width: 5, tone: "muted" },
                  { text: x.title, width: "grow" },
                  { text: x.severity, width: 6, tone: x.severity === "high" ? "red" : x.severity === "medium" ? "amber" : "muted" },
                  { text: x.type, width: 5, tone: "muted" },
                ])}
              />
              <ShortList
                title="Recent decisions"
                rows={d().decisions.map((x) => [
                  { text: shortDate(x.date), width: 6, tone: "muted" },
                  { text: x.title, width: "grow" },
                ])}
              />
            </box>
          </box>
        )
      }}
    </Show>
  )
}
