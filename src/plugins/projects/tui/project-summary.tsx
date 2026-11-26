// The project detail's Overview tab (spec §9, screen design "Project detail"): the Overview panel with the headline
// facts (health with its muted comment under the value, status, dates, effort, sponsor, team, the extra fields other
// plugins registered for projects (<RecordFields>), then the muted description) beside four bordered panels stacked
// on the right (milestones, deliverables, open risks and issues, recent decisions), three rows each, in the design's
// 1 : 1.25 columns. The panels take no focus (moving focus between them is not built), so none is highlighted. `h`
// opens the health form, `e` the project form. Sponsor and team come from the involvements and the people.person
// view.
import { createSignal, For, Show } from "solid-js"
import {
  dueLabel,
  Panel,
  printable,
  RecordFields,
  shortDate,
  Table,
  theme,
  toneColor,
  useKeys,
  useNav,
  useOverlay,
  useQuery,
  useRuntime,
  useScreenKeys,
  useToday,
  type Hint,
  type TableColumn,
  type TableRow,
  type Tone,
} from "@ttybrain/api/tui"
import { makeItems } from "../logic/items"
import { makeStore } from "../logic/records"

const ROWS = 3
// The status bar as the design draws it, less the keys of the focusable panels (tab panel, n new, x done).
const HINTS: Hint[] = [
  { key: "←→", label: "tabs" },
  { key: "e", label: "edit" },
  { key: "h", label: "health" },
  { key: "Esc", label: "back" },
]
const SEVERITY: Record<string, number> = { high: 0, medium: 1, low: 2 }
const SEVERITY_TONE: Record<string, Tone> = { high: "red", medium: "amber" }
// The design's short severity (a 6-cell column).
const SEVERITY_TEXT: Record<string, string> = { medium: "med" }
const STATUS_TONE: Record<string, Tone> = { delivered: "green", in_review: "cyan", in_progress: "amber" }
// The facts' labels take 14 cells, then a 2-cell gap, while that leaves the values 30 cells; on a narrower panel
// they take the longest label's width.
const LABEL = 14
const GAP = 2
const VALUE_ROOM = 30
const COMPACT_LABEL = Math.max(...["Health", "Status", "Dates", "Effort", "Sponsor", "Team"].map((l) => l.length))

// `1 Sep 2026`
export const fullDate = (iso: string) => `${shortDate(iso)} ${iso.slice(0, 4)}`
const label = (s: string) => s.replace(/_/g, " ")
const firstName = (name: string) => name.split(/\s+/)[0] ?? name
const byDue = (a: { due_date: string | null }, b: { due_date: string | null }) =>
  a.due_date === b.due_date ? 0 : a.due_date === null ? 1 : b.due_date === null ? -1 : a.due_date < b.due_date ? -1 : 1
// ROWS items starting at the last complete one before the first open one, so the next ones show (`✓ … ○ … ○ …`).
function around<T>(all: T[], open: (x: T) => boolean): T[] {
  const next = all.findIndex(open)
  const start = next < 0 ? Math.max(0, all.length - ROWS) : Math.max(0, next - 1)
  return all.slice(start, start + ROWS)
}

// The short lists' columns, from the design; on a narrow terminal the deliverables' owner and due date give way
// before the title is cut.
const MILESTONE_COLUMNS: TableColumn[] = [
  { id: "done", title: "", width: 2 },
  { id: "title", title: "", width: "grow" },
  { id: "due", title: "", width: 8 },
]
const DELIVERABLE_COLUMNS: TableColumn[] = [
  { id: "title", title: "", width: "grow", minWidth: 17 },
  { id: "owner", title: "", width: 7, drop: 2 },
  { id: "status", title: "", width: 12 },
  { id: "due", title: "", width: 7, drop: 1 },
]
const RISK_COLUMNS: TableColumn[] = [
  { id: "ref", title: "", width: 5 },
  { id: "title", title: "", width: "grow", minWidth: 20 },
  { id: "severity", title: "", width: 6 },
  { id: "type", title: "", width: 6, drop: 1 },
]
const DECISION_COLUMNS: TableColumn[] = [
  { id: "date", title: "", width: 7 },
  { id: "title", title: "", width: "grow" },
]

// `Label         value`: the label muted; the value's parts side by side one space apart, wrapping as whole parts.
function Fact(props: { name: string; at: number; parts: Array<{ text: string; tone?: Tone }> }) {
  return (
    <box flexDirection="row" flexShrink={0}>
      <box width={props.at} flexShrink={0}>
        <text fg={theme.muted}>{props.name}</text>
      </box>
      <box flexDirection="row" flexWrap="wrap" columnGap={1} flexGrow={1} flexShrink={1}>
        <For each={props.parts}>{(p) => <text fg={toneColor(p.tone)}>{p.text}</text>}</For>
      </box>
    </box>
  )
}

function ShortList(props: { title: string; columns: TableColumn[]; rows: TableRow[] }) {
  return (
    <Panel title={props.title}>
      <Table columns={props.columns} rows={props.rows} header={false} focused={false} empty="—" />
    </Panel>
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
  keys.hints(HINTS, { exact: true, frame: [] })
  // The Overview panel's inner width (measured), and from it the facts' label width; its inner height and the
  // height its content needs, to mark clipped content with `…`.
  const [inner, setInner] = createSignal(0)
  const [room, setRoom] = createSignal(0)
  const [need, setNeed] = createSignal(0)
  const labelWidth = () => (inner() === 0 || inner() - LABEL - GAP >= VALUE_ROOM ? LABEL : COMPACT_LABEL)
  const at = () => labelWidth() + GAP

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
      // Delivered ones too, with the owner's name (or me).
      const deliverables = (await items.deliverableQuery().select("pp.name as owner_name").where("d.project_id", "=", p.id).orderBy("d.id").execute())
        .map((r: any) => ({ ...items.toDeliverable(r), ownerName: r.owner_name === null ? null : String(r.owner_name) }))
        .sort(byDue)
      const risks = (await items.riskQuery().where("r.project_id", "=", p.id).where("r.status", "=", "open").orderBy("r.id").execute()).map(items.toRisk)
      const decisions = (await items.decisionQuery().where("d.project_id", "=", p.id).orderBy("d.date", "desc").orderBy("d.id", "desc").limit(ROWS).execute()).map(items.toDecision)
      risks.sort((a, b) => (SEVERITY[a.severity] ?? 3) - (SEVERITY[b.severity] ?? 3))
      return { p, sponsors, team, milestones, deliverables, risks, decisions }
    },
    { key: () => props.recordRef },
  )
  type Data = NonNullable<ReturnType<typeof q.data>>

  // A done milestone is muted throughout; an open one's date is plain, red when it is past.
  const milestoneRows = (d: Data): TableRow[] =>
    around(d.milestones, (m) => m.done_date === null).map((m) => {
      const done = m.done_date !== null
      return {
        ref: m.ref,
        cells: {
          done: { text: done ? "✓" : "○", tone: done ? "green" : undefined },
          title: { text: m.title, tone: done ? "muted" : undefined },
          due: { text: shortDate(m.due_date), tone: done ? "muted" : m.due_date < today() ? "red" : undefined },
        },
      }
    })
  // A delivered one's date is muted; an open one's is relative (`Fri` within the week), red when it is past.
  const deliverableRows = (d: Data): TableRow[] =>
    around(d.deliverables, (x) => x.status !== "delivered").map((x) => {
      const delivered = x.status === "delivered"
      const due = x.due_date === null ? "—" : delivered ? shortDate(x.due_date) : dueLabel(x.due_date, today())
      return {
        ref: x.ref,
        cells: {
          title: x.title,
          owner: x.owner_me ? { text: "me", tone: "muted" } : x.ownerName === null ? "" : firstName(x.ownerName),
          status: { text: label(x.status), tone: STATUS_TONE[x.status] ?? "muted" },
          due: { text: due, tone: delivered || x.due_date === null ? "muted" : x.due_date < today() ? "red" : undefined },
        },
      }
    })
  const riskRows = (d: Data): TableRow[] =>
    d.risks.slice(0, ROWS).map((x) => ({
      ref: x.ref,
      cells: {
        ref: { text: x.ref, tone: "muted" },
        title: x.title,
        severity: { text: SEVERITY_TEXT[x.severity] ?? x.severity, tone: SEVERITY_TONE[x.severity] ?? "muted" },
        type: { text: x.type, tone: "muted" },
      },
    }))
  const decisionRows = (d: Data): TableRow[] =>
    d.decisions.map((x) => ({ ref: x.ref, cells: { date: { text: shortDate(x.date), tone: "muted" }, title: x.title } }))

  useScreenKeys((key) => {
    const ch = printable(key)
    if (ch === "h") void overlay.openForm("project", "health", { recordRef: props.recordRef })
    else if (ch === "e") void edit(props.recordRef)
    else return
    key.preventDefault()
  })

  return (
    <Show when={q.data()}>
      {(d: () => Data) => {
        const p = () => d().p
        const dates = () =>
          p().start_date === null && p().end_date === null
            ? "—"
            : `${p().start_date === null ? "?" : fullDate(p().start_date!)} → ${p().end_date === null ? "?" : fullDate(p().end_date!)}`
        return (
          <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
            <box flexDirection="row" flexShrink={1} minHeight={0} gap={1}>
              <box flexDirection="column" flexGrow={1} flexBasis={0} flexShrink={1}>
                <Panel title="Overview" grow>
                  {/* On a short terminal the facts are clipped inside the panel, which keeps its border. */}
                  <box
                    flexDirection="column"
                    flexGrow={1}
                    flexShrink={1}
                    minHeight={0}
                    overflow="hidden"
                    onSizeChange={function () {
                      setInner(this.width)
                      setRoom(this.height)
                    }}
                  >
                    <box
                      flexDirection="column"
                      flexShrink={0}
                      onSizeChange={function () {
                        setNeed(this.height)
                      }}
                    >
                      <Fact
                        name="Health"
                        at={at()}
                        parts={
                          p().health === null
                            ? [{ text: "not set", tone: "muted" }]
                            : [
                                { text: `● ${p().health}`, tone: p().health! },
                                { text: `· ${shortDate(p().health_date ?? today())}`, tone: "muted" },
                              ]
                        }
                      />
                      <Show when={p().health_comment}>
                        {(c: () => string) => (
                          <box paddingLeft={at()} flexShrink={0}>
                            <text fg={theme.muted}>{c()}</text>
                          </box>
                        )}
                      </Show>
                      <text> </text>
                      <Fact name="Status" at={at()} parts={[{ text: label(p().status) }]} />
                      <Fact name="Dates" at={at()} parts={[{ text: dates() }]} />
                      <Fact
                        name="Effort"
                        at={at()}
                        parts={
                          p().effort_estimate_days === null
                            ? [{ text: "—" }]
                            : [
                                { text: `${p().effort_estimate_days} person-days` },
                                ...(p().effort_note ? [{ text: `(${p().effort_note})`, tone: "muted" as Tone }] : []),
                              ]
                        }
                      />
                      <Fact name="Sponsor" at={at()} parts={[d().sponsors.length === 0 ? { text: "—" } : { text: d().sponsors.join(", "), tone: "magenta" }]} />
                      <Fact name="Team" at={at()} parts={[{ text: d().team.length === 0 ? "—" : d().team.join(", ") }]} />
                      <RecordFields recordType="project" recordRef={props.recordRef} labelWidth={labelWidth()} />
                      <Show when={p().description}>
                        {(t: () => string) => (
                          <>
                            <text> </text>
                            <text fg={theme.muted}>{t()}</text>
                          </>
                        )}
                      </Show>
                    </box>
                    <Show when={room() > 0 && need() > room()}>
                      <text position="absolute" bottom={0} right={0} fg={theme.muted} bg={theme.bg}>
                        …
                      </text>
                    </Show>
                  </box>
                </Panel>
              </box>
              <box flexDirection="column" flexGrow={1.25} flexBasis={0} flexShrink={1}>
                <ShortList title="Milestones" columns={MILESTONE_COLUMNS} rows={milestoneRows(d())} />
                <ShortList title="Deliverables" columns={DELIVERABLE_COLUMNS} rows={deliverableRows(d())} />
                <ShortList title="Open risks & issues" columns={RISK_COLUMNS} rows={riskRows(d())} />
                <ShortList title="Recent decisions" columns={DECISION_COLUMNS} rows={decisionRows(d())} />
              </box>
            </box>
          </box>
        )
      }}
    </Show>
  )
}
