// The board view's Summary tab (design §5.7; no mock draws it): the "Summary" panel with the board's facts laid out as
// a project's Overview has them, a muted label column of 14 cells and 2 cells before the values (the longest label's
// width on a narrow panel): Code (cyan), Name, Note (— without one) and Status (`active`, or `archived since 10 Oct
// 2026`, muted). `e` opens the board form; a code edit moves the view to the new ref. `A` archives the board, or
// restores an archived one, after a confirmation. The bar is the tab's own, as the project's Overview has it.
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { act, Panel, printable, shortDate, theme, toneColor, useKeys, useNav, useOverlay, useQuery, useRuntime, useScreenKeys, type Hint, type Tone } from "@ttybrain/api/tui"
import { makeStore } from "../logic/records"

const LABELS = ["Code", "Name", "Note", "Status"]
const LABEL = 14
const GAP = 2
const VALUE_ROOM = 30
const COMPACT_LABEL = Math.max(...LABELS.map((l) => l.length))

const fullDate = (iso: string) => `${shortDate(iso)} ${iso.slice(0, 4)}`

function Fact(props: { name: string; at: number; text: string; tone?: Tone | undefined }) {
  return (
    <box flexDirection="row" flexShrink={0}>
      <box width={props.at} flexShrink={0}>
        <text fg={theme.muted}>{props.name}</text>
      </box>
      <box flexGrow={1} flexShrink={1}>
        <text fg={toneColor(props.tone)}>{props.text}</text>
      </box>
    </box>
  )
}

export function BoardSummary(props: { recordRef: string }) {
  const rt = useRuntime()
  const store = makeStore(rt)
  const overlay = useOverlay()
  const nav = useNav()
  const keys = useKeys()
  const [inner, setInner] = createSignal(0)
  const at = () => (inner() === 0 || inner() - LABEL - GAP >= VALUE_ROOM ? LABEL : COMPACT_LABEL) + GAP

  const q = useQuery(
    async () => {
      const b = await store.board(props.recordRef)
      const row = await rt.data.selectFrom("board").select("archived_at").where("id", "=", b.id).executeTakeFirst()
      return { ...b, archivedAt: row?.archived_at === null || row?.archived_at === undefined ? null : String(row.archived_at) }
    },
    { key: () => props.recordRef },
  )
  type Data = NonNullable<ReturnType<typeof q.data>>
  const archived = () => q.data()?.archived === true
  createEffect(() => {
    const hints: Hint[] = [
      { key: "←→", label: "tabs" },
      { key: "e", label: "edit" },
      { key: "A", label: archived() ? "restore" : "archive" },
      { key: "Esc", label: "back" },
    ]
    onCleanup(keys.hints(hints, { exact: true, frame: [] }))
  })

  // A code edit changes the ref: the view moves to the new one (as a project's does).
  const edit = async (ref: string) => {
    const saved = await overlay.openForm("board", "board", { recordRef: ref })
    if (saved === undefined || saved === ref) return
    const top = nav.route()
    if (top.kind !== "record" || top.ref !== ref) return
    nav.back()
    await nav.open(saved)
  }
  // Ask first, then write (never await a question inside act).
  const toggleArchive = async (ref: string, isArchived: boolean) => {
    const question = isArchived ? `Restore ${ref}?` : `Archive ${ref}? Its meetings and talk-list stay; it takes no new ones until it is restored.`
    if (!(await overlay.confirm(question))) return
    const op = isArchived ? "restoreBoard" : "archiveBoard"
    await act(() => rt.self().write[op]!({ board: ref }), { ok: () => `${isArchived ? "restored" : "archived"} ${ref}` })
  }

  useScreenKeys((key) => {
    const b = q.data()
    if (b === undefined) return
    const ch = printable(key)
    if (ch === "e") void edit(b.ref)
    else if (ch === "A") void toggleArchive(b.ref, b.archived)
    else return
    key.preventDefault()
  })

  return (
    <Show when={q.data()}>
      {(b: () => Data) => (
        <box flexDirection="column" flexShrink={0}>
          <Panel title="Summary">
            <box
              flexDirection="column"
              flexShrink={0}
              onSizeChange={function () {
                setInner(this.width)
              }}
            >
              <Fact name="Code" at={at()} text={b().code} tone="cyan" />
              <Fact name="Name" at={at()} text={b().name} />
              <Fact name="Note" at={at()} text={b().note ?? "—"} />
              <Fact
                name="Status"
                at={at()}
                text={b().archivedAt === null ? "active" : `archived since ${fullDate(b().archivedAt!.slice(0, 10))}`}
                tone={b().archivedAt === null ? undefined : "muted"}
              />
            </box>
          </Panel>
        </box>
      )}
    </Show>
  )
}
